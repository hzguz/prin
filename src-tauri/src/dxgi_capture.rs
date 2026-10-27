//! Reusable Desktop Duplication capture for desktop and fullscreen GPU surfaces.
//!
//! Caches the D3D11 device, output duplication, and staging texture across
//! captures so screenshots avoid re-initializing DXGI every time, while
//! automatically recreating the session after mode switches (Alt+Enter),
//! fullscreen game transitions, or resolution changes.

use std::sync::Mutex;

use image::{imageops::FilterType, RgbaImage};
use windows::{
    core::Interface,
    Win32::{
        Foundation::{HMODULE, POINT},
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN},
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource,
                ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
                D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dxgi::{
                Common::{
                    DXGI_FORMAT, DXGI_FORMAT_R10G10B10A2_UNORM, DXGI_FORMAT_R16G16B16A16_FLOAT,
                    DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM_SRGB,
                },
                CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, IDXGIOutput1,
                IDXGIOutputDuplication, IDXGIResource, DXGI_ERROR_WAIT_TIMEOUT,
                DXGI_OUTDUPL_FRAME_INFO,
            },
            Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONULL},
        },
    },
};

use crate::capture::MonitorBounds;

struct CachedSession {
    bounds: MonitorBounds,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: Option<(ID3D11Texture2D, D3D11_TEXTURE2D_DESC)>,
}

// Access is strictly serialized through `SESSION` and the D3D11 device is
// created with default multithread safety (not SINGLETHREADED).
unsafe impl Send for CachedSession {}

static SESSION: Mutex<Option<CachedSession>> = Mutex::new(None);

fn dxgi_error(message: &str) -> windows::core::Error {
    windows::core::Error::new(windows::core::HRESULT(0x80004005u32 as i32), message)
}

pub(crate) fn capture_monitor(
    bounds: &MonitorBounds,
    foreground_fullscreen: bool,
) -> Result<RgbaImage, String> {
    let mut guard = SESSION
        .lock()
        .map_err(|_| "DXGI session lock poisoned".to_string())?;

    if guard
        .as_ref()
        .is_some_and(|session| &session.bounds != bounds)
    {
        *guard = None;
    }

    if let Some(session) = guard.as_mut() {
        // When a fullscreen game is active, require a live frame from the
        // duplication stream rather than reusing an old desktop staging texture
        // that may predate the game entering fullscreen.
        match unsafe { capture_from_session(session, !foreground_fullscreen) } {
            Ok(image) => return Ok(image),
            Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                return Err(error.to_string());
            }
            Err(_) => {
                // Session became stale (e.g. Alt+Enter, game mode switch, TDR).
                *guard = None;
            }
        }
    }

    let mut fresh = unsafe { create_session(bounds).map_err(|error| error.to_string())? };
    let result = unsafe { capture_from_session(&mut fresh, !foreground_fullscreen) };
    match result {
        Ok(image) => {
            *guard = Some(fresh);
            Ok(image)
        }
        Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => {
            *guard = Some(fresh);
            Err(error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

unsafe fn create_session(bounds: &MonitorBounds) -> windows::core::Result<CachedSession> {
    let point = POINT {
        x: bounds.x + bounds.width as i32 / 2,
        y: bounds.y + bounds.height as i32 / 2,
    };
    let target_monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONULL) };
    if target_monitor.is_invalid() {
        return Err(dxgi_error("monitor not found for DXGI capture"));
    }

    // Search across all DXGI adapters so multi-GPU desktops and hybrid laptops
    // find the exact adapter driving the target monitor.
    if let Ok(factory) = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() } {
        let mut adapter_index = 0;
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapter_index) } {
            adapter_index += 1;
            let mut output_index = 0;
            while let Ok(output) = unsafe { adapter.EnumOutputs(output_index) } {
                output_index += 1;
                let Ok(description) = (unsafe { output.GetDesc() }) else {
                    continue;
                };
                if description.Monitor == target_monitor {
                    if let Ok(session) =
                        unsafe { create_session_for_adapter_output(&adapter, &output, bounds) }
                    {
                        return Ok(session);
                    }
                }
            }
        }
    }

    // Fallback to the default hardware adapter.
    let mut device: Option<ID3D11Device> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )?;
    }
    let device = device.ok_or_else(|| dxgi_error("D3D11 device was not created"))?;
    let context = unsafe { device.GetImmediateContext()? };
    let dxgi_device = device.cast::<IDXGIDevice>()?;
    let adapter = unsafe { dxgi_device.GetAdapter()? };

    let mut output_index = 0;
    let duplication = loop {
        let output = unsafe { adapter.EnumOutputs(output_index)? };
        output_index += 1;
        let description = unsafe { output.GetDesc()? };
        if description.Monitor == target_monitor {
            let output = output.cast::<IDXGIOutput1>()?;
            break unsafe { output.DuplicateOutput(&dxgi_device)? };
        }
    };

    Ok(CachedSession {
        bounds: bounds.clone(),
        device,
        context,
        duplication,
        staging: None,
    })
}

unsafe fn create_session_for_adapter_output(
    adapter: &IDXGIAdapter1,
    output: &windows::Win32::Graphics::Dxgi::IDXGIOutput,
    bounds: &MonitorBounds,
) -> windows::core::Result<CachedSession> {
    let mut device: Option<ID3D11Device> = None;
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )?;
    }
    let device = device.ok_or_else(|| dxgi_error("D3D11 adapter device was not created"))?;
    let context = unsafe { device.GetImmediateContext()? };
    let dxgi_device = device.cast::<IDXGIDevice>()?;
    let output1 = output.cast::<IDXGIOutput1>()?;
    let duplication = unsafe { output1.DuplicateOutput(&dxgi_device)? };

    Ok(CachedSession {
        bounds: bounds.clone(),
        device,
        context,
        duplication,
        staging: None,
    })
}

unsafe fn capture_from_session(
    session: &mut CachedSession,
    allow_cached_on_timeout: bool,
) -> windows::core::Result<RgbaImage> {
    let max_attempts = if allow_cached_on_timeout { 1 } else { 3 };
    for attempt in 0..max_attempts {
        let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        let timeout_ms = if allow_cached_on_timeout {
            if session.staging.is_some() {
                0
            } else {
                20
            }
        } else if attempt == 0 {
            40
        } else {
            80
        };

        match unsafe {
            session
                .duplication
                .AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource)
        } {
            Ok(()) => {
                if frame_info.LastPresentTime == 0 && resource.is_none() {
                    let _ = unsafe { session.duplication.ReleaseFrame() };
                    if allow_cached_on_timeout {
                        if let Some((staging, desc)) = session.staging.clone() {
                            return unsafe { read_staging_texture(session, &staging, &desc) };
                        }
                    }
                    continue;
                }

                let copy_result = unsafe { copy_frame_to_staging(session, resource) };
                let release_result = unsafe { session.duplication.ReleaseFrame() };
                let (staging, desc) = copy_result?;
                release_result?;
                return unsafe { read_staging_texture(session, &staging, &desc) };
            }
            Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                if allow_cached_on_timeout {
                    if let Some((staging, desc)) = session.staging.clone() {
                        return unsafe { read_staging_texture(session, &staging, &desc) };
                    }
                }
                continue;
            }
            Err(error) => return Err(error),
        }
    }

    Err(windows::core::Error::new(
        DXGI_ERROR_WAIT_TIMEOUT,
        "DXGI did not produce a desktop frame in time",
    ))
}

unsafe fn copy_frame_to_staging(
    session: &mut CachedSession,
    resource: Option<IDXGIResource>,
) -> windows::core::Result<(ID3D11Texture2D, D3D11_TEXTURE2D_DESC)> {
    let source = resource
        .ok_or_else(|| dxgi_error("DXGI did not return a desktop resource"))?
        .cast::<ID3D11Texture2D>()?;
    let mut source_desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { source.GetDesc(&mut source_desc) };

    if source_desc.Width == 0 || source_desc.Height == 0 {
        return Err(dxgi_error("DXGI returned an empty texture"));
    }

    let needs_new_staging = match session.staging.as_ref() {
        Some((_, existing_desc)) => {
            existing_desc.Width != source_desc.Width
                || existing_desc.Height != source_desc.Height
                || existing_desc.Format != source_desc.Format
        }
        None => true,
    };

    let (staging, desc) = if !needs_new_staging {
        session.staging.clone().unwrap()
    } else {
        let mut staging_desc = source_desc;
        staging_desc.BindFlags = 0;
        staging_desc.MiscFlags = 0;
        staging_desc.Usage = D3D11_USAGE_STAGING;
        staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;

        let mut created: Option<ID3D11Texture2D> = None;
        unsafe {
            session
                .device
                .CreateTexture2D(&staging_desc, None, Some(&mut created))?
        };
        let created = created.ok_or_else(|| dxgi_error("DXGI staging texture was not created"))?;
        let pair = (created, staging_desc);
        session.staging = Some(pair.clone());
        pair
    };

    let region = D3D11_BOX {
        left: 0,
        top: 0,
        right: source_desc.Width,
        bottom: source_desc.Height,
        front: 0,
        back: 1,
    };
    unsafe {
        session.context.CopySubresourceRegion(
            Some(&staging.cast()?),
            0,
            0,
            0,
            0,
            Some(&source.cast()?),
            0,
            Some(&region),
        );
    }

    Ok((staging, desc))
}

#[inline]
fn f16_to_u8(bits: u16) -> u8 {
    let sign = (bits >> 15) & 0x1;
    if sign != 0 {
        return 0;
    }
    let exp = ((bits >> 10) & 0x1f) as i32;
    let mant = (bits & 0x3ff) as u32;
    let linear = if exp == 0 {
        (mant as f32 / 1024.0) * (2.0_f32).powi(-14)
    } else if exp == 31 {
        1.0
    } else {
        (1.0 + mant as f32 / 1024.0) * (2.0_f32).powi(exp - 15)
    };
    // Approximate sRGB gamma curve for SDR display of HDR swapchains.
    let srgb = linear.clamp(0.0, 1.0).powf(1.0 / 2.2);
    (srgb * 255.0).round() as u8
}

unsafe fn read_staging_texture(
    session: &CachedSession,
    staging: &ID3D11Texture2D,
    desc: &D3D11_TEXTURE2D_DESC,
) -> windows::core::Result<RgbaImage> {
    let width = desc.Width;
    let height = desc.Height;
    let format: DXGI_FORMAT = desc.Format;
    let staging_resource: ID3D11Resource = staging.cast()?;
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe {
        session.context.Map(
            Some(&staging_resource),
            0,
            D3D11_MAP_READ,
            0,
            Some(&mut mapped),
        )?;
    }

    let mut rgba = vec![255u8; (width * height * 4) as usize];
    let source_pointer = mapped.pData as *const u8;
    let dst_row_bytes = (width * 4) as usize;

    for row in 0..height {
        let row_ptr = unsafe { source_pointer.add((row * mapped.RowPitch) as usize) };
        let dst_offset = (row * width * 4) as usize;
        let dst_row = &mut rgba[dst_offset..dst_offset + dst_row_bytes];

        if format == DXGI_FORMAT_R16G16B16A16_FLOAT {
            let src_u16 =
                unsafe { std::slice::from_raw_parts(row_ptr as *const u16, (width * 4) as usize) };
            for (src_px, dst_px) in src_u16.chunks_exact(4).zip(dst_row.chunks_exact_mut(4)) {
                dst_px[0] = f16_to_u8(src_px[0]);
                dst_px[1] = f16_to_u8(src_px[1]);
                dst_px[2] = f16_to_u8(src_px[2]);
                dst_px[3] = 255;
            }
        } else if format == DXGI_FORMAT_R10G10B10A2_UNORM {
            let src_u32 =
                unsafe { std::slice::from_raw_parts(row_ptr as *const u32, width as usize) };
            for (&packed, dst_px) in src_u32.iter().zip(dst_row.chunks_exact_mut(4)) {
                dst_px[0] = (((packed & 0x3ff) * 255 + 511) / 1023) as u8;
                dst_px[1] = ((((packed >> 10) & 0x3ff) * 255 + 511) / 1023) as u8;
                dst_px[2] = ((((packed >> 20) & 0x3ff) * 255 + 511) / 1023) as u8;
                dst_px[3] = 255;
            }
        } else if format == DXGI_FORMAT_R8G8B8A8_UNORM || format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB
        {
            let src_row = unsafe { std::slice::from_raw_parts(row_ptr, dst_row_bytes) };
            for (src_px, dst_px) in src_row.chunks_exact(4).zip(dst_row.chunks_exact_mut(4)) {
                dst_px[0] = src_px[0];
                dst_px[1] = src_px[1];
                dst_px[2] = src_px[2];
                // Force opaque alpha: DirectX games frequently leave 0 in the
                // backbuffer alpha channel, which would make the screenshot invisible.
                dst_px[3] = 255;
            }
        } else {
            // Default B8G8R8A8 / B8G8R8X8 swizzle.
            let src_row = unsafe { std::slice::from_raw_parts(row_ptr, dst_row_bytes) };
            for (src_px, dst_px) in src_row.chunks_exact(4).zip(dst_row.chunks_exact_mut(4)) {
                dst_px[0] = src_px[2];
                dst_px[1] = src_px[1];
                dst_px[2] = src_px[0];
                dst_px[3] = 255;
            }
        }
    }

    unsafe { session.context.Unmap(Some(&staging_resource), 0) };

    let image = RgbaImage::from_raw(width, height, rgba).ok_or_else(|| {
        windows::core::Error::new(
            windows::core::HRESULT(0x80004005u32 as i32),
            "DXGI returned an invalid RGBA frame",
        )
    })?;

    // If a fullscreen game runs at a resolution different from the desktop
    // monitor bounds, scale the captured frame to fit the monitor's bounds.
    if width != session.bounds.width || height != session.bounds.height {
        Ok(image::imageops::resize(
            &image,
            session.bounds.width,
            session.bounds.height,
            FilterType::Triangle,
        ))
    } else {
        Ok(image)
    }
}
