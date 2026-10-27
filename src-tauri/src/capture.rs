//! Screen capture layer.
//!
//! Produces a single virtual-desktop composite from all monitors so the
//! selection overlay can span every screen with one coordinate system.
//! Physical pixels are used throughout: mixing logical (DPI-scaled) and
//! physical coordinates is the main source of off-by-scale capture bugs on
//! multi-monitor setups.

use image::{
    codecs::png::{CompressionType, FilterType, PngEncoder},
    ImageBuffer, ImageEncoder, Rgba, RgbaImage,
};
use xcap::Monitor;

/// Bounds of one physical monitor within the virtual desktop, in physical pixels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DesktopRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl From<&MonitorBounds> for DesktopRect {
    fn from(bounds: &MonitorBounds) -> Self {
        Self {
            left: bounds.x,
            top: bounds.y,
            right: bounds.x + bounds.width as i32,
            bottom: bounds.y + bounds.height as i32,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("no monitors detected")]
    NoMonitors,
    #[error("failed to enumerate monitors: {0}")]
    Enumerate(String),
    #[error("failed to capture monitor '{name}': {reason}")]
    MonitorCapture { name: String, reason: String },
    #[error("failed to encode capture as PNG: {0}")]
    Encode(String),
}

/// Captures every monitor and composites them into one virtual-desktop image.
pub fn capture_virtual_desktop() -> Result<Vec<u8>, CaptureError> {
    let monitors = Monitor::all().map_err(|e| CaptureError::Enumerate(e.to_string()))?;
    if monitors.is_empty() {
        return Err(CaptureError::NoMonitors);
    }
    // Read geometry before capture so Windows can identify which monitor is
    // occupied by a foreground fullscreen surface.
    let mut monitor_info = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let name = monitor
            .name()
            .map_err(|e| CaptureError::MonitorCapture {
                name: "<unknown>".into(),
                reason: e.to_string(),
            })?;

        let read = |label: &str, value: Result<i32, xcap::XCapError>| -> Result<i32, CaptureError> {
            value.map_err(|e| CaptureError::MonitorCapture {
                name: format!("{name} ({label})"),
                reason: e.to_string(),
            })
        };

        #[cfg(not(target_os = "windows"))]
        let scale = monitor.scale_factor().unwrap_or(1.0).max(1.0);
        #[cfg(target_os = "windows")]
        let scale = 1.0_f32;

        let raw_x = read("x", monitor.x())?;
        let raw_y = read("y", monitor.y())?;
        let raw_width = monitor.width().map_err(|e| CaptureError::MonitorCapture {
            name: format!("{name} (width)"),
            reason: e.to_string(),
        })?;
        let raw_height = monitor.height().map_err(|e| CaptureError::MonitorCapture {
            name: format!("{name} (height)"),
            reason: e.to_string(),
        })?;

        let bounds = MonitorBounds {
            x: (raw_x as f32 * scale).round() as i32,
            y: (raw_y as f32 * scale).round() as i32,
            width: (raw_width as f32 * scale).round().max(1.0) as u32,
            height: (raw_height as f32 * scale).round().max(1.0) as u32,
        };

        monitor_info.push((monitor, bounds, name));
    }

    #[cfg(target_os = "windows")]
    let fullscreen = foreground_window_rect();

    // A one-monitor capture needs no second full-size image. Apart from being
    // faster, this avoids briefly doubling the most common capture's memory.
    if monitor_info.len() == 1 {
        let (monitor, bounds, name) = monitor_info.pop().expect("monitor count checked above");
        #[cfg(target_os = "windows")]
        let image = capture_monitor_image(
            &monitor,
            &bounds,
            &name,
            fullscreen.is_some_and(|window| covers_monitor(window, &bounds)),
        )?;
        #[cfg(not(target_os = "windows"))]
        let image = capture_monitor_image(&monitor, &bounds, &name)?;
        return encode_png(&image);
    }

    let virtual_x = monitor_info.iter().map(|(_, bounds, _)| bounds.x).min().unwrap_or(0);
    let virtual_y = monitor_info.iter().map(|(_, bounds, _)| bounds.y).min().unwrap_or(0);
    let virtual_right = monitor_info
        .iter()
        .map(|(_, bounds, _)| bounds.x + bounds.width as i32)
        .max()
        .unwrap_or(0);
    let virtual_bottom = monitor_info
        .iter()
        .map(|(_, bounds, _)| bounds.y + bounds.height as i32)
        .max()
        .unwrap_or(0);

    let canvas_width = (virtual_right - virtual_x).max(1) as u32;
    let canvas_height = (virtual_bottom - virtual_y).max(1) as u32;

    // Allocate the destination first and composite each monitor immediately.
    // This keeps only the canvas plus one monitor frame alive at a time.
    let mut canvas: RgbaImage =
        ImageBuffer::from_pixel(canvas_width, canvas_height, Rgba([0, 0, 0, 255]));

    for (monitor, bounds, name) in monitor_info {
        #[cfg(target_os = "windows")]
        let image = capture_monitor_image(
            &monitor,
            &bounds,
            &name,
            fullscreen.is_some_and(|window| covers_monitor(window, &bounds)),
        )?;
        #[cfg(not(target_os = "windows"))]
        let image = capture_monitor_image(&monitor, &bounds, &name)?;
        let offset_x = bounds.x - virtual_x;
        let offset_y = bounds.y - virtual_y;
        image::imageops::replace(&mut canvas, &image, offset_x as i64, offset_y as i64);
    }

    encode_png(&canvas)
}

#[cfg(target_os = "windows")]
fn capture_monitor_image(
    monitor: &Monitor,
    bounds: &MonitorBounds,
    name: &str,
    foreground_fullscreen: bool,
) -> Result<RgbaImage, CaptureError> {
    capture_windows_monitor(monitor, bounds, foreground_fullscreen).map_err(|reason| {
        CaptureError::MonitorCapture {
            name: name.to_owned(),
            reason,
        }
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_monitor_image(
    monitor: &Monitor,
    _bounds: &MonitorBounds,
    name: &str,
) -> Result<RgbaImage, CaptureError> {
    monitor
        .capture_image()
        .map_err(|error| CaptureError::MonitorCapture {
            name: name.to_owned(),
            reason: error.to_string(),
        })
}

/// A small tolerance absorbs invisible borders on borderless fullscreen
/// windows while still rejecting ordinary maximized windows with taskbars.
fn covers_monitor(window: DesktopRect, monitor: &MonitorBounds) -> bool {
    const TOLERANCE: i32 = 3;
    let monitor = DesktopRect::from(monitor);
    window.left <= monitor.left + TOLERANCE
        && window.top <= monitor.top + TOLERANCE
        && window.right >= monitor.right - TOLERANCE
        && window.bottom >= monitor.bottom - TOLERANCE
}

#[cfg(target_os = "windows")]
fn foreground_window_rect() -> Option<DesktopRect> {
    use std::{ffi::c_void, mem};
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic},
    };

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() || IsIconic(window) != 0 {
            return None;
        }

        let mut rect = RECT::default();
        let dwm_result = DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut rect as *mut RECT as *mut c_void,
            mem::size_of::<RECT>() as u32,
        );
        if dwm_result < 0 && GetWindowRect(window, &mut rect) == 0 {
            return None;
        }

        (rect.right > rect.left && rect.bottom > rect.top).then_some(DesktopRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        })
    }
}

/// Uses DXGI Desktop Duplication as the primary capture path on Windows so
/// DirectX/OpenGL/Vulkan flip-model and fullscreen games (such as League of
/// Legends) are captured from the GPU output instead of GDI returning the
/// desktop behind the game. Falls back to `PrintWindow(PW_RENDERFULLCONTENT)`
/// and GDI if DXGI is unavailable (e.g. hybrid GPU display handoff).
#[cfg(target_os = "windows")]
fn capture_windows_monitor(
    monitor: &Monitor,
    bounds: &MonitorBounds,
    foreground_fullscreen: bool,
) -> Result<RgbaImage, String> {
    let mut dxgi_candidate = None;
    let mut dxgi_error = None;
    let mut gdi_error = None;

    match capture_monitor_dxgi(bounds, foreground_fullscreen) {
        Ok(image) if !looks_like_blocked_capture(&image) => return Ok(image),
        Ok(image) => dxgi_candidate = Some(image),
        Err(error) => dxgi_error = Some(error),
    }

    // If a fullscreen game is active and DXGI returned black or failed (for
    // example on an Optimus hybrid laptop), ask DWM to render the foreground
    // window's DirectComposition surface via PrintWindow(PW_RENDERFULLCONTENT).
    if foreground_fullscreen {
        if let Some(printed) = capture_foreground_window_print(bounds) {
            if !looks_like_blocked_capture(&printed) {
                return Ok(printed);
            }
        }
    }

    let gdi = match monitor.capture_image() {
        Ok(mut image) => {
            ensure_opaque_alpha(&mut image);
            if !looks_like_blocked_capture(&image) {
                return Ok(image);
            }
            Some(image)
        }
        Err(error) => {
            gdi_error = Some(error.to_string());
            None
        }
    };

    if let Some(image) = dxgi_candidate {
        return Ok(image);
    }

    gdi.ok_or_else(|| {
        let gdi = gdi_error.unwrap_or_else(|| "no GDI frame available".to_string());
        let dxgi = dxgi_error.unwrap_or_else(|| "no DXGI frame available".to_string());
        format!("GDI and DXGI capture failed; GDI: {gdi}; DXGI: {dxgi}")
    })
}

#[cfg(target_os = "windows")]
fn ensure_opaque_alpha(image: &mut RgbaImage) {
    for alpha in image.as_mut().iter_mut().skip(3).step_by(4) {
        *alpha = 255;
    }
}

#[cfg(target_os = "windows")]
fn capture_foreground_window_print(bounds: &MonitorBounds) -> Option<RgbaImage> {
    use std::{ffi::c_void, mem, ptr};
    use windows_sys::Win32::{
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetWindowDC, ReleaseDC,
            SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        },
        Storage::Xps::PrintWindow,
        UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic, PW_RENDERFULLCONTENT},
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsIconic(hwnd) != 0 {
            return None;
        }
        let width = bounds.width;
        let height = bounds.height;
        if width == 0 || height == 0 {
            return None;
        }

        let window_dc = GetWindowDC(hwnd);
        if window_dc.is_null() {
            return None;
        }
        let mem_dc = CreateCompatibleDC(window_dc);
        if mem_dc.is_null() {
            ReleaseDC(hwnd, window_dc);
            return None;
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // Top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [ mem::zeroed() ],
        };

        let mut bits: *mut c_void = ptr::null_mut();
        let dib = CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0);
        if dib.is_null() || bits.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(hwnd, window_dc);
            return None;
        }

        let old_obj = SelectObject(mem_dc, dib);
        let printed = PrintWindow(hwnd, mem_dc, PW_RENDERFULLCONTENT);

        let result = if printed != 0 {
            let total_bytes = (width as usize) * (height as usize) * 4;
            let src = std::slice::from_raw_parts(bits as *const u8, total_bytes);
            let mut rgba = vec![255u8; total_bytes];
            for (src_px, dst_px) in src.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
                dst_px[0] = src_px[2];
                dst_px[1] = src_px[1];
                dst_px[2] = src_px[0];
                dst_px[3] = 255;
            }
            RgbaImage::from_raw(width, height, rgba)
        } else {
            None
        };

        SelectObject(mem_dc, old_obj);
        DeleteObject(dib);
        DeleteDC(mem_dc);
        ReleaseDC(hwnd, window_dc);

        result
    }
}

#[cfg(target_os = "windows")]
fn capture_monitor_dxgi(
    bounds: &MonitorBounds,
    foreground_fullscreen: bool,
) -> Result<RgbaImage, String> {
    crate::dxgi_capture::capture_monitor(bounds, foreground_fullscreen)
}

#[cfg(target_os = "windows")]
fn looks_like_blocked_capture(image: &RgbaImage) -> bool {
    let pixels = image.as_raw();
    if pixels.is_empty() {
        return true;
    }

    let pixel_count = pixels.len() / 4;
    let step = (pixel_count / 4096).max(1);
    (0..pixel_count)
        .step_by(step)
        .all(|index| pixels[index * 4..index * 4 + 3].iter().all(|value| *value <= 6))
}

/// Encodes an image as PNG bytes for Tauri's raw binary IPC response.
///
/// Uses `CompressionType::Fast` with `FilterType::NoFilter` so `fdeflate`
/// compresses scanlines in a single pass without per-row filter trials.
fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, CaptureError> {
    let estimated_capacity = ((image.width() as usize) * (image.height() as usize)).max(64 * 1024);
    let mut buffer = Vec::with_capacity(estimated_capacity);
    let encoder =
        PngEncoder::new_with_quality(&mut buffer, CompressionType::Fast, FilterType::NoFilter);
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| CaptureError::Encode(e.to_string()))?;

    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor() -> MonitorBounds {
        MonitorBounds {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
        }
    }

    #[test]
    fn recognises_exact_and_borderless_fullscreen_windows() {
        assert!(covers_monitor(
            DesktopRect {
                left: 1920,
                top: 0,
                right: 4480,
                bottom: 1440,
            },
            &monitor(),
        ));
        assert!(covers_monitor(
            DesktopRect {
                left: 1922,
                top: 1,
                right: 4478,
                bottom: 1438,
            },
            &monitor(),
        ));
    }

    #[test]
    fn rejects_an_ordinary_maximised_window_with_a_taskbar() {
        assert!(!covers_monitor(
            DesktopRect {
                left: 1920,
                top: 0,
                right: 4480,
                bottom: 1392,
            },
            &monitor(),
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn flags_only_nearly_black_frames_for_gpu_fallback() {
        let black = RgbaImage::from_pixel(32, 32, Rgba([0, 0, 0, 255]));
        let dark_scene = RgbaImage::from_pixel(32, 32, Rgba([7, 7, 7, 255]));

        assert!(looks_like_blocked_capture(&black));
        assert!(!looks_like_blocked_capture(&dark_scene));
    }

    #[test]
    fn encodes_valid_png_bytes() {
        let image = RgbaImage::from_pixel(64, 64, Rgba([99, 102, 241, 255]));
        let encoded = encode_png(&image).expect("PNG encoding should succeed");
        assert!(encoded.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]));
    }
}
