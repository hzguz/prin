//! Reusable Desktop Duplication capture for fullscreen GPU surfaces.
//!
//! Caches the D3D11 device, output duplication, and staging texture across
//! captures so fullscreen screenshots avoid re-initializing DXGI every time,
//! while automatically recreating the session after mode switches (Alt+Enter)
//! or resolution changes.

use std::sync::Mutex;

use image::RgbaImage;
use windows::{
    core::Interface,
    Win32::{
        Foundation::{HMODULE, POINT},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource,
                ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
                D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dxgi::{
                IDXGIDevice, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
                DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
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
    staging: Option<ID3D11Texture2D>,
}

// Access is strictly serialized through `SESSION` and the D3D11 device is
// created with default multithread safety (not SINGLETHREADED).
unsafe impl Send for CachedSession {}

static SESSION: Mutex<Option<CachedSession>> = Mutex::new(None);

fn dxgi_error(message: &str) -> windows::core::Error {
    windows::core::Error::new(windows::core::HRESULT(0x80004005u32 as i32), message)
}

pub(crate) fn capture_monitor(bounds: &MonitorBounds) -> Result<RgbaImage, String> {
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
        if let Ok(image) = unsafe { capture_from_session(session) } {
            return Ok(image);
        }
        // Session became stale (e.g. Alt+Enter, display mode change, TDR).
        *guard = None;
    }

    let mut fresh = unsafe { create_session(bounds).map_err(|error| error.to_string())? };
    let result = unsafe { capture_from_session(&mut fresh).map_err(|error| error.to_string()) };
    if result.is_ok() {
        *guard = Some(fresh);
    }
    result
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

unsafe fn capture_from_session(session: &mut CachedSession) -> windows::core::Result<RgbaImage> {
    for _attempt in 0..3 {
        let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        // When a staging texture is already cached from a prior capture, poll
        // with 0ms timeout: if DWM presented a new frame it returns immediately,
        // and if the screen was completely static it returns WAIT_TIMEOUT in 0ms
        // so we can reuse the cached staging texture without waiting 80ms.
        let timeout_ms = if session.staging.is_some() { 0 } else { 150 };

        match unsafe {
            session
                .duplication
                .AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource)
        } {
            Ok(()) => {
                // A zero LastPresentTime means only cursor metadata changed;
                // if we already have a populated staging texture from the
                // previous frame we can read it immediately, otherwise release
                // and wait for the next desktop frame.
                if frame_info.LastPresentTime == 0 && resource.is_none() {
                    let _ = unsafe { session.duplication.ReleaseFrame() };
                    if let Some(staging) = session.staging.clone() {
                        return unsafe { read_staging_texture(session, &staging) };
                    }
                    continue;
                }

                let copy_result = unsafe { copy_frame_to_staging(session, resource) };
                let release_result = unsafe { session.duplication.ReleaseFrame() };
                let staging = copy_result?;
                release_result?;
                return unsafe { read_staging_texture(session, &staging) };
            }
            Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                // Static screen since the previous capture: reuse the last
                // desktop texture already in staging without re-duplicating.
                if let Some(staging) = session.staging.clone() {
                    return unsafe { read_staging_texture(session, &staging) };
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        }
    }

    Err(dxgi_error("DXGI did not produce a desktop frame in time"))
}

unsafe fn copy_frame_to_staging(
    session: &mut CachedSession,
    resource: Option<IDXGIResource>,
) -> windows::core::Result<ID3D11Texture2D> {
    let bounds = &session.bounds;
    let source = resource
        .ok_or_else(|| dxgi_error("DXGI did not return a desktop resource"))?
        .cast::<ID3D11Texture2D>()?;
    let mut source_desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { source.GetDesc(&mut source_desc) };

    if source_desc.Width != bounds.width || source_desc.Height != bounds.height {
        return Err(windows::core::Error::new(
            windows::core::HRESULT(0x80070057u32 as i32),
            format!(
                "DXGI frame size {}x{} differs from monitor {}x{}",
                source_desc.Width, source_desc.Height, bounds.width, bounds.height
            ),
        ));
    }

    let staging = match session.staging.as_ref() {
        Some(existing) => existing.clone(),
        None => {
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
            let created =
                created.ok_or_else(|| dxgi_error("DXGI staging texture was not created"))?;
            session.staging = Some(created.clone());
            created
        }
    };

    let region = D3D11_BOX {
        left: 0,
        top: 0,
        right: bounds.width,
        bottom: bounds.height,
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

    Ok(staging)
}

unsafe fn read_staging_texture(
    session: &CachedSession,
    staging: &ID3D11Texture2D,
) -> windows::core::Result<RgbaImage> {
    let bounds = &session.bounds;
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

    let row_bytes = (bounds.width * 4) as usize;
    let mut rgba = vec![0u8; (bounds.width * bounds.height * 4) as usize];
    let source_pointer = mapped.pData as *const u8;
    for row in 0..bounds.height {
        let source_row = unsafe {
            std::slice::from_raw_parts(
                source_pointer.add((row * mapped.RowPitch) as usize),
                row_bytes,
            )
        };
        let destination_offset = (row * bounds.width * 4) as usize;
        let destination_row = &mut rgba[destination_offset..destination_offset + row_bytes];
        for (source_pixel, destination_pixel) in source_row
            .chunks_exact(4)
            .zip(destination_row.chunks_exact_mut(4))
        {
            destination_pixel[0] = source_pixel[2];
            destination_pixel[1] = source_pixel[1];
            destination_pixel[2] = source_pixel[0];
            destination_pixel[3] = source_pixel[3];
        }
    }
    unsafe { session.context.Unmap(Some(&staging_resource), 0) };

    RgbaImage::from_raw(bounds.width, bounds.height, rgba).ok_or_else(|| {
        windows::core::Error::new(
            windows::core::HRESULT(0x80004005u32 as i32),
            "DXGI returned an invalid RGBA frame",
        )
    })
}
