//! Application entry point: window orchestration, global hotkey and tray.
//!
//! Two windows exist:
//! - `main`: launcher shown at startup; teaches the hotkey and stays out of
//!   the way.
//! - `overlay`: transparent, undecorated, always-on-top, spanning the whole
//!   virtual desktop. Kept warm and hidden at rest with all capture bitmaps
//!   and canvases released between captures so hotkey activation is instant.
//!
//! Selection, annotation and export all happen inside the overlay, so a
//! capture never leaves the screen it was taken from.

mod capture;
#[cfg(target_os = "windows")]
mod dxgi_capture;

use std::{
    env,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use capture::capture_virtual_desktop;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

const OVERLAY_WINDOW: &str = "overlay";
const MAIN_WINDOW: &str = "main";

/// Store file holding user settings across sessions.
const SETTINGS_STORE: &str = "settings.json";
const SHORTCUT_KEY: &str = "captureShortcut";
const LANGUAGE_KEY: &str = "language";

/// Fallback chain used when the user has not chosen a shortcut.
///
/// Win+Shift+S is absent deliberately because Windows reserves that chord at
/// the OS level.
const DEFAULT_SHORTCUTS: [&str; 3] = ["Ctrl+Shift+X", "Ctrl+Shift+P", "Alt+Shift+S"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum AppLanguage {
    En,
    PtBr,
}

impl AppLanguage {
    fn from_code(code: Option<&str>) -> Self {
        match code {
            Some(value) if value.to_ascii_lowercase().starts_with("pt") => Self::PtBr,
            _ => Self::En,
        }
    }

    fn tray_capture_label(self) -> &'static str {
        match self {
            Self::En => "New capture",
            Self::PtBr => "Nova captura",
        }
    }

    fn tray_settings_label(self) -> &'static str {
        match self {
            Self::En => "Settings",
            Self::PtBr => "Configurações",
        }
    }

    fn tray_quit_label(self) -> &'static str {
        match self {
            Self::En => "Quit",
            Self::PtBr => "Sair",
        }
    }

    fn tray_tooltip(self) -> &'static str {
        match self {
            Self::En => "prin — click to capture, double-click to open",
            Self::PtBr => "prin — clique para capturar, duplo clique para abrir",
        }
    }

    fn overlay_title(self) -> &'static str {
        match self {
            Self::En => "prin — capture",
            Self::PtBr => "prin — captura",
        }
    }
}

/// Human-readable label of the hotkey that actually registered.
///
/// Resolved at runtime because the preferred combination may already be owned
/// by another application, so the UI cannot hardcode it.
#[derive(Default)]
struct ActiveShortcut(Mutex<Option<String>>);

/// Persisted interface language (`"en"` or `"pt-BR"`).
#[derive(Default)]
struct ActiveLanguage(Mutex<Option<String>>);

/// True while the settings window owns keyboard input to record a new chord.
///
/// Merely ignoring the global callback is insufficient on Windows: a
/// registered hotkey is consumed by the OS and never reaches the webview.
#[derive(Default)]
struct ShortcutRecording(AtomicBool);

/// A level-triggered request avoids losing a capture action while the hidden
/// overlay webview is still installing its frontend event listener.
#[derive(Default)]
struct OverlayCaptureRequest(AtomicBool);

/// Guard while the overlay is transitioning to hidden.
#[derive(Default)]
struct OverlayClosing(AtomicBool);

/// PNG captured before the overlay is allowed to touch focus or z-order.
///
/// This preserves transient UI such as web dropdowns and modals that disappear
/// as soon as the active page loses focus.
#[derive(Default)]
struct PendingCapture(Mutex<Option<Result<Vec<u8>, String>>>);

struct TrayHandles {
    capture_item: MenuItem<tauri::Wry>,
    settings_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
    tray_icon: TrayIcon<tauri::Wry>,
}

/// Mutable handles for the tray menu items and icon so accelerator and
/// language changes take effect live without rebuilding the tray.
#[derive(Default)]
struct TrayState(Mutex<Option<TrayHandles>>);

fn current_language(app: &AppHandle) -> AppLanguage {
    let code = app
        .state::<ActiveLanguage>()
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.clone());
    AppLanguage::from_code(code.as_deref())
}

/// Parses a human-readable accelerator such as `Ctrl+Shift+X`.
///
/// Accepting the same syntax the UI displays means the stored value is the
/// label, with no second representation to keep in sync.
fn parse_shortcut(label: &str) -> Option<Shortcut> {
    let mut modifiers = Modifiers::empty();
    let mut key_code = None;

    for part in label.split('+').map(str::trim).filter(|part| !part.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "win" | "super" | "meta" | "cmd" => modifiers |= Modifiers::SUPER,
            other => key_code = parse_key_code(other),
        }
    }

    // A bare key with no modifiers would swallow normal typing system-wide.
    if modifiers.is_empty() {
        return None;
    }

    key_code.map(|code| Shortcut::new(Some(modifiers), code))
}

fn parse_key_code(key: &str) -> Option<Code> {
    let code = match key {
        "a" => Code::KeyA, "b" => Code::KeyB, "c" => Code::KeyC, "d" => Code::KeyD,
        "e" => Code::KeyE, "f" => Code::KeyF, "g" => Code::KeyG, "h" => Code::KeyH,
        "i" => Code::KeyI, "j" => Code::KeyJ, "k" => Code::KeyK, "l" => Code::KeyL,
        "m" => Code::KeyM, "n" => Code::KeyN, "o" => Code::KeyO, "p" => Code::KeyP,
        "q" => Code::KeyQ, "r" => Code::KeyR, "s" => Code::KeyS, "t" => Code::KeyT,
        "u" => Code::KeyU, "v" => Code::KeyV, "w" => Code::KeyW, "x" => Code::KeyX,
        "y" => Code::KeyY, "z" => Code::KeyZ,
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2, "3" => Code::Digit3,
        "4" => Code::Digit4, "5" => Code::Digit5, "6" => Code::Digit6, "7" => Code::Digit7,
        "8" => Code::Digit8, "9" => Code::Digit9,
        "f1" => Code::F1, "f2" => Code::F2, "f3" => Code::F3, "f4" => Code::F4,
        "f5" => Code::F5, "f6" => Code::F6, "f7" => Code::F7, "f8" => Code::F8,
        "f9" => Code::F9, "f10" => Code::F10, "f11" => Code::F11, "f12" => Code::F12,
        "space" => Code::Space,
        "printscreen" | "print" => Code::PrintScreen,
        "insert" => Code::Insert,
        _ => return None,
    };
    Some(code)
}

/// Captures the virtual desktop and returns PNG through raw binary IPC.
#[tauri::command]
async fn take_capture(
    pending: tauri::State<'_, PendingCapture>,
) -> Result<tauri::ipc::Response, String> {
    if let Some(capture) = pending.0.lock().map_err(|e| e.to_string())?.take() {
        return capture.map(tauri::ipc::Response::new);
    }

    let capture = tauri::async_runtime::spawn_blocking(capture_virtual_desktop)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(capture))
}

const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

fn write_clipboard_with_retry(
    app: &AppHandle,
    image: &tauri::image::Image<'_>,
) -> Result<(), String> {
    // Another application (or Windows Clipboard History) may briefly lock the
    // OS clipboard for ~0.5-2ms. Poll at 2ms intervals rather than 25ms so a
    // transient lock never delays a fast Ctrl+V paste.
    const MAX_ATTEMPTS: usize = 25;
    for attempt in 0..MAX_ATTEMPTS {
        match app.clipboard().write_image(image) {
            Ok(()) => return Ok(()),
            Err(error) if attempt + 1 == MAX_ATTEMPTS => return Err(error.to_string()),
            Err(_) => std::thread::sleep(Duration::from_millis(2)),
        }
    }
    unreachable!()
}

/// Writes the exported capture to the system clipboard and immediately hides
/// the overlay so keyboard focus returns to the target application only after
/// the new image is guaranteed to be on the clipboard.
///
/// Accepts either:
/// - Raw RGBA pixels prefixed with `[width_u32_le, height_u32_le]` (8 bytes),
///   which skips PNG encoding in JS and PNG decoding in Rust completely, or
/// - Standard PNG bytes as a fallback.
#[tauri::command]
async fn copy_capture(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected image bytes".into());
    };

    if bytes.len() >= 8 && !bytes.starts_with(&PNG_SIGNATURE) {
        let width = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let height = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        let expected_rgba_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4));

        if expected_rgba_len == Some(bytes.len() - 8) {
            let image = tauri::image::Image::new(&bytes[8..], width, height);
            write_clipboard_with_retry(&app, &image)?;
            let _ = hide_overlay_window(&app);
            return Ok(());
        }
    }

    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
        write_clipboard_with_retry(&app, &image)?;
        let _ = hide_overlay_window(&app);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reports which hotkey is live, or None when every candidate was taken.
#[tauri::command]
async fn active_shortcut(state: tauri::State<'_, ActiveShortcut>) -> Result<Option<String>, String> {
    let label = state.0.lock().map_err(|e| e.to_string())?;
    Ok(label.clone())
}

/// Reports the persisted interface language, or None if not yet set.
#[tauri::command]
async fn active_language(state: tauri::State<'_, ActiveLanguage>) -> Result<Option<String>, String> {
    let language = state.0.lock().map_err(|e| e.to_string())?;
    Ok(language.clone())
}

/// Persists the interface language and updates the system tray menu in place.
#[tauri::command]
async fn set_language(
    app: AppHandle,
    language: String,
    state: tauri::State<'_, ActiveLanguage>,
) -> Result<(), String> {
    let normalized = if language.to_ascii_lowercase().starts_with("pt") {
        "pt-BR".to_string()
    } else {
        "en".to_string()
    };

    if let Ok(store) = app.store(SETTINGS_STORE) {
        store.set(LANGUAGE_KEY, serde_json::Value::String(normalized.clone()));
        let _ = store.save();
    }

    if let Ok(mut slot) = state.0.lock() {
        *slot = Some(normalized.clone());
    }

    let lang = AppLanguage::from_code(Some(&normalized));
    if let Ok(guard) = app.state::<TrayState>().0.lock() {
        if let Some(handles) = guard.as_ref() {
            let _ = handles.capture_item.set_text(lang.tray_capture_label());
            let _ = handles.settings_item.set_text(lang.tray_settings_label());
            let _ = handles.quit_item.set_text(lang.tray_quit_label());
            let _ = handles.tray_icon.set_tooltip(Some(lang.tray_tooltip()));
        }
    }

    if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW) {
        let _ = overlay.set_title(lang.overlay_title());
    }

    let _ = app.emit("language-changed", &normalized);
    Ok(())
}

/// Temporarily releases the active global shortcut while the settings UI is
/// recording keys, then restores it if recording is cancelled.
#[tauri::command]
async fn set_shortcut_recording(
    app: AppHandle,
    recording: bool,
    active: tauri::State<'_, ActiveShortcut>,
    suspended: tauri::State<'_, ShortcutRecording>,
) -> Result<(), String> {
    let lang = current_language(&app);
    if recording {
        if suspended.0.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let label = active.0.lock().map_err(|e| e.to_string())?.clone();
        if let Some(shortcut) = label.as_deref().and_then(parse_shortcut) {
            if let Err(error) = app.global_shortcut().unregister(shortcut) {
                suspended.0.store(false, Ordering::SeqCst);
                return Err(match lang {
                    AppLanguage::En => format!("could not pause shortcut: {error}"),
                    AppLanguage::PtBr => format!("não foi possível pausar o atalho: {error}"),
                });
            }
        }
        return Ok(());
    }

    if !suspended.0.swap(false, Ordering::SeqCst) {
        return Ok(());
    }

    let label = active.0.lock().map_err(|e| e.to_string())?.clone();
    if let (Some(label), Some(shortcut)) = (
        label.as_deref(),
        label.as_deref().and_then(parse_shortcut),
    ) {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            suspended.0.store(true, Ordering::SeqCst);
            return Err(match lang {
                AppLanguage::En => format!("could not restore {label}: {error}"),
                AppLanguage::PtBr => format!("não foi possível restaurar {label}: {error}"),
            });
        }
    }

    Ok(())
}

/// Replaces the capture hotkey and persists it.
///
/// The previous binding is released first: leaving it registered would let a
/// stale combination keep opening the overlay.
#[tauri::command]
async fn set_capture_shortcut(
    app: AppHandle,
    label: String,
    state: tauri::State<'_, ActiveShortcut>,
    suspended: tauri::State<'_, ShortcutRecording>,
) -> Result<(), String> {
    let lang = current_language(&app);
    let shortcut = parse_shortcut(&label).ok_or_else(|| match lang {
        AppLanguage::En => format!("invalid shortcut: {label}"),
        AppLanguage::PtBr => format!("atalho inválido: {label}"),
    })?;
    // Resolve the store before changing any OS registration. If storage is
    // unavailable, the currently working shortcut remains untouched.
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;

    let previous_label = state.0.lock().map_err(|e| e.to_string())?.clone();
    let was_suspended = suspended.0.swap(false, Ordering::SeqCst);

    if !was_suspended {
        if let Some(previous) = previous_label.as_deref().and_then(parse_shortcut) {
            let _ = app.global_shortcut().unregister(previous);
        }
    }

    if let Err(error) = app.global_shortcut().register(shortcut) {
        // A failed replacement must not silently leave the user without the
        // shortcut they had before opening the recorder.
        if let Some(previous) = previous_label.as_deref().and_then(parse_shortcut) {
            let _ = app.global_shortcut().register(previous);
        }
        return Err(match lang {
            AppLanguage::En => format!("could not register {label}: {error}"),
            AppLanguage::PtBr => format!("não foi possível registrar {label}: {error}"),
        });
    }

    let previous_stored_value = store.get(SHORTCUT_KEY);
    store.set(SHORTCUT_KEY, serde_json::Value::String(label.clone()));
    if let Err(error) = store.save() {
        // Registration, memory and disk form one transaction. A disk failure
        // must restore the old live binding instead of leaving the UI and
        // runtime disagreeing about which shortcut is active.
        let _ = app.global_shortcut().unregister(shortcut);
        let restore_result = previous_label
            .as_deref()
            .and_then(parse_shortcut)
            .map(|previous| app.global_shortcut().register(previous));

        if let Some(value) = previous_stored_value {
            store.set(SHORTCUT_KEY, value);
        } else {
            store.delete(SHORTCUT_KEY);
        }

        if let Some(Err(restore_error)) = restore_result {
            return Err(match lang {
                AppLanguage::En => format!(
                    "could not save {label}: {error}; also failed to restore previous shortcut: {restore_error}"
                ),
                AppLanguage::PtBr => format!(
                    "não foi possível salvar {label}: {error}; também não foi possível restaurar o atalho anterior: {restore_error}"
                ),
            });
        }
        return Err(match lang {
            AppLanguage::En => format!("could not save {label}: {error}"),
            AppLanguage::PtBr => format!("não foi possível salvar {label}: {error}"),
        });
    }

    if let Ok(mut current) = state.0.lock() {
        *current = Some(label.clone());
    }

    if let Ok(guard) = app.state::<TrayState>().0.lock() {
        if let Some(handles) = guard.as_ref() {
            let _ = handles.capture_item.set_accelerator(Some(label.as_str()));
        }
    }

    Ok(())
}

/// Whether the app is registered to launch on login.
#[tauri::command]
async fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Turns launch-on-login on or off.
#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

/// Brings the main window forward and selects its settings tab.
#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    let lang = current_language(&app);
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| match lang {
            AppLanguage::En => "main window unavailable".to_string(),
            AppLanguage::PtBr => "janela principal indisponível".to_string(),
        })?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.emit("navigate-settings", ()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens the fullscreen selection overlay.
#[tauri::command]
async fn open_overlay(app: AppHandle) -> Result<(), String> {
    show_overlay(&app, true).map_err(|e| e.to_string())
}

/// Reports whether the overlay has a capture waiting to be loaded.
/// The request stays latched until `reveal_overlay` finishes, preventing a
/// second hotkey press during frontend decode from creating an orphan request.
#[tauri::command]
async fn overlay_capture_requested(
    state: tauri::State<'_, OverlayCaptureRequest>,
) -> Result<bool, String> {
    Ok(state.0.load(Ordering::SeqCst))
}

/// Reveals the overlay once the frontend has the screenshot rendered.
///
/// The window is kept hidden and shown from here rather than before decode:
/// showing it earlier exposes an empty webview before the captured frame is
/// painted.
#[tauri::command]
async fn reveal_overlay(
    app: AppHandle,
    request: tauri::State<'_, OverlayCaptureRequest>,
) -> Result<(), String> {
    let result = if let Some(window) = app.get_webview_window(OVERLAY_WINDOW) {
        disable_overlay_transitions(&window);
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|e| e.to_string())
    } else {
        Ok(())
    };
    request.0.store(false, Ordering::SeqCst);
    result
}

fn hide_overlay_window(app: &AppHandle) -> Result<(), String> {
    if app.state::<OverlayClosing>().0.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Ok(mut pending) = app.state::<PendingCapture>().0.lock() {
        *pending = None;
    }
    app.state::<OverlayCaptureRequest>()
        .0
        .store(false, Ordering::SeqCst);
    let result = if let Some(window) = app.get_webview_window(OVERLAY_WINDOW) {
        disable_overlay_transitions(&window);
        window.hide().map_err(|e| e.to_string())
    } else {
        Ok(())
    };
    app.state::<OverlayClosing>().0.store(false, Ordering::SeqCst);
    result
}

/// Hides the overlay after the frontend has revoked its screenshot blob and
/// unmounted the Konva stage. Keeping the empty webview warm eliminates the
/// ~300ms WebView2 process creation penalty on subsequent captures.
#[tauri::command]
async fn close_overlay(app: AppHandle) -> Result<(), String> {
    hide_overlay_window(&app)
}

/// Captures the screen and signals the warm overlay window to render it.
fn show_overlay(app: &AppHandle, hide_main_before_capture: bool) -> tauri::Result<()> {
    if app.state::<OverlayClosing>().0.load(Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(existing) = app.get_webview_window(OVERLAY_WINDOW) {
        if existing.is_visible().unwrap_or(false) {
            existing.set_focus()?;
            return Ok(());
        }
    }

    if app
        .state::<OverlayCaptureRequest>()
        .0
        .swap(true, Ordering::SeqCst)
    {
        return Ok(());
    }

    if let Ok(mut pending) = app.state::<PendingCapture>().0.lock() {
        *pending = None;
    }

    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        // Hotkey/tray captures normally preserve focus so transient UI in the
        // active application stays open. If our own launcher is visible,
        // however, it must leave the frame before pixels are captured.
        if hide_main_before_capture || main.is_visible().unwrap_or(false) {
            disable_overlay_transitions(&main);
            let _ = main.hide();
            flush_windows_compositor();
        }
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let capture = std::panic::catch_unwind(capture_virtual_desktop)
            .map_err(|_| "capture worker panicked; try capturing again".to_string())
            .and_then(|result| result.map_err(|e| e.to_string()));

        if let Ok(mut pending) = app_handle.state::<PendingCapture>().0.lock() {
            *pending = Some(capture);
        } else {
            app_handle
                .state::<OverlayCaptureRequest>()
                .0
                .store(false, Ordering::SeqCst);
            return;
        }

        let scheduled_handle = app_handle.clone();
        if app_handle
            .run_on_main_thread(move || {
                if reveal_overlay_capture(&scheduled_handle).is_err() {
                    if let Ok(mut pending) = scheduled_handle.state::<PendingCapture>().0.lock() {
                        *pending = None;
                    }
                    scheduled_handle
                        .state::<OverlayCaptureRequest>()
                        .0
                        .store(false, Ordering::SeqCst);
                }
            })
            .is_err()
        {
            if let Ok(mut pending) = app_handle.state::<PendingCapture>().0.lock() {
                *pending = None;
            }
            app_handle
                .state::<OverlayCaptureRequest>()
                .0
                .store(false, Ordering::SeqCst);
        }
    });

    Ok(())
}

fn reveal_overlay_capture(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        if main.is_visible().unwrap_or(false) {
            disable_overlay_transitions(&main);
            let _ = main.hide();
            flush_windows_compositor();
        }
    }

    if let Some(existing) = app.get_webview_window(OVERLAY_WINDOW) {
        size_overlay_window(&existing)?;
        existing.emit("start-capture", ())?;
        return Ok(());
    }

    build_overlay_window(app)?;
    Ok(())
}

/// Builds a hidden overlay window ready to receive captures immediately.
fn build_overlay_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let lang = current_language(app);
    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_WINDOW,
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title(lang.overlay_title())
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .focused(false)
    .build()?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            handle.state::<OverlayClosing>().0.store(false, Ordering::SeqCst);
        }
    });

    disable_overlay_transitions(&window);
    size_overlay_window(&window)?;

    // Deliberately left hidden: the frontend claims a pending request, takes
    // the screenshot and reveals only after that frame has been painted.
    Ok(window)
}

fn size_overlay_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    remove_overlay_native_chrome(window);

    // Size to the union of every monitor rather than calling maximize():
    // maximize covers only the current monitor, and is unreliable on a window
    // that has not been shown yet.
    if let Ok(monitors) = window.available_monitors() {
        if let Some((origin, size)) = virtual_desktop_bounds(&monitors) {
            window.set_position(origin)?;
            window.set_size(size)?;
        }
    }

    Ok(())
}

/// Forces the capture surface to be a true borderless popup on Windows.
///
/// `decorations(false)` is not sufficient on every WebView2/Windows build:
/// the HWND can retain an invisible `WS_CAPTION`, which adds non-client pixels
/// around the requested client size and lets the whole capture be dragged like
/// a normal application window.
#[cfg(target_os = "windows")]
fn remove_overlay_native_chrome(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };

    let Ok(raw_handle) = window.hwnd() else {
        return;
    };
    let hwnd = raw_handle.0 as windows_sys::Win32::Foundation::HWND;

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let native_chrome =
            WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
        let borderless_style = (style & !native_chrome) | WS_POPUP;

        if borderless_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, borderless_style as isize);
            let _ = SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_overlay_native_chrome(_window: &tauri::WebviewWindow) {}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn tray_double_click_delay() -> Duration {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;

    // Respect the accessibility setting chosen in Windows. A small margin
    // guarantees the double-click event wins before the single-click action.
    Duration::from_millis(unsafe { GetDoubleClickTime() } as u64 + 40)
}

#[cfg(not(target_os = "windows"))]
fn tray_double_click_delay() -> Duration {
    Duration::from_millis(320)
}

/// Disables the Windows compositor's native zoom/fade for the capture window.
///
/// The overlay already waits until its first complete frame before becoming
/// visible, so a window transition only makes the frozen desktop appear to
/// move. The main application window keeps the standard system behavior.
#[cfg(target_os = "windows")]
fn disable_overlay_transitions(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use windows_sys::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED},
    };

    let Ok(raw_handle) = window.hwnd() else {
        return;
    };
    let disabled = 1_i32;
    unsafe {
        let _ = DwmSetWindowAttribute(
            raw_handle.0 as HWND,
            DWMWA_TRANSITIONS_FORCEDISABLED as u32,
            &disabled as *const i32 as *const c_void,
            std::mem::size_of_val(&disabled) as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn disable_overlay_transitions(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn flush_windows_compositor() {
    unsafe {
        let _ = windows_sys::Win32::Graphics::Dwm::DwmFlush();
    }
}

#[cfg(not(target_os = "windows"))]
fn flush_windows_compositor() {}

/// Bounding box of all monitors, in physical pixels.
///
/// Mirrors the compositing done in `capture.rs`, so overlay coordinates line
/// up with the captured image even across monitors of differing scale.
fn virtual_desktop_bounds(
    monitors: &[tauri::Monitor],
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let first = monitors.first()?;

    let mut left = first.position().x;
    let mut top = first.position().y;
    let mut right = left + first.size().width as i32;
    let mut bottom = top + first.size().height as i32;

    for monitor in monitors.iter().skip(1) {
        let position = monitor.position();
        let size = monitor.size();
        left = left.min(position.x);
        top = top.min(position.y);
        right = right.max(position.x + size.width as i32);
        bottom = bottom.max(position.y + size.height as i32);
    }

    Some((
        tauri::PhysicalPosition::new(left, top),
        tauri::PhysicalSize::new((right - left).max(1) as u32, (bottom - top).max(1) as u32),
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Started minimised to the tray: launching straight into a window
            // on every login would be intrusive for a background utility.
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Fire on key press only; ignoring release avoids a
                    // duplicate overlay per hotkey activation.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // Covers the tiny race between the settings UI entering
                    // recording mode and the OS completing the unregister.
                    if app.state::<ShortcutRecording>().0.load(Ordering::SeqCst) {
                        return;
                    }
                    // Only capture shortcuts are registered, so any hit here
                    // means "start a capture".
                    let _ = show_overlay(app, false);
                })
                .build(),
        )
        .manage(ActiveShortcut::default())
        .manage(ActiveLanguage::default())
        .manage(ShortcutRecording::default())
        .manage(OverlayCaptureRequest::default())
        .manage(OverlayClosing::default())
        .manage(PendingCapture::default())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            take_capture,
            copy_capture,
            open_overlay,
            overlay_capture_requested,
            reveal_overlay,
            close_overlay,
            active_shortcut,
            active_language,
            set_language,
            set_shortcut_recording,
            set_capture_shortcut,
            autostart_enabled,
            set_autostart,
            open_settings
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let launched_from_autostart = env::args().any(|arg| arg == "--autostart");

            // Apply the bundle icon explicitly in development as well. On
            // Windows the debug executable can otherwise show a generic icon.
            if let (Some(window), Some(icon)) = (
                app.get_webview_window(MAIN_WINDOW),
                app.default_window_icon(),
            ) {
                window.set_icon(icon.clone())?;
            }

            let store = app.store(SETTINGS_STORE).ok();

            let saved_language = store
                .as_ref()
                .and_then(|s| s.get(LANGUAGE_KEY))
                .and_then(|value| value.as_str().map(str::to_owned));

            app.state::<ActiveLanguage>()
                .0
                .lock()
                .map(|mut slot| *slot = saved_language)
                .ok();

            // A shortcut the user chose takes precedence; the defaults are
            // only a fallback chain for a first run or a freed-up binding.
            let saved_shortcut = store
                .and_then(|s| s.get(SHORTCUT_KEY))
                .and_then(|value| value.as_str().map(str::to_owned));

            let candidates: Vec<String> = saved_shortcut
                .into_iter()
                .chain(DEFAULT_SHORTCUTS.iter().map(|label| label.to_string()))
                .collect();

            let registered = candidates.into_iter().find(|label| {
                parse_shortcut(label)
                    .is_some_and(|shortcut| app.global_shortcut().register(shortcut).is_ok())
            });

            let label = registered.clone();
            app.state::<ActiveShortcut>()
                .0
                .lock()
                .map(|mut slot| *slot = label)
                .ok();

            build_tray(&handle, registered.as_deref())?;

            // Pre-warm the hidden overlay webview before showing main so the
            // very first hotkey capture has zero WebView creation latency.
            let _ = build_overlay_window(&handle);

            if !launched_from_autostart {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    window.show()?;
                    window.set_focus()?;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Builds the system tray icon and its context menu.
fn build_tray(app: &AppHandle, shortcut_label: Option<&str>) -> tauri::Result<()> {
    let lang = current_language(app);
    let capture_item = MenuItem::with_id(
        app,
        "capture",
        lang.tray_capture_label(),
        true,
        shortcut_label,
    )?;
    let settings_item = MenuItem::with_id(
        app,
        "settings",
        lang.tray_settings_label(),
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", lang.tray_quit_label(), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture_item, &settings_item, &quit_item])?;
    let click_generation = Arc::new(AtomicU64::new(0));
    let suppress_click_after_double = Arc::new(AtomicBool::new(false));

    let tray_icon = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip(lang.tray_tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let _ = show_overlay(app, false);
            }
            "settings" => {
                let handle = app.clone();
                // Spawned because the command is async and this handler is not.
                tauri::async_runtime::spawn(async move {
                    let _ = open_settings(handle).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event({
            let click_generation = Arc::clone(&click_generation);
            let suppress_click_after_double = Arc::clone(&suppress_click_after_double);

            move |tray, event| match event {
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    // Invalidate the pending first click before opening the app.
                    click_generation.fetch_add(1, Ordering::SeqCst);
                    // Windows emits a final button-up Click after DoubleClick.
                    // Suppress it so opening the app never also starts capture.
                    suppress_click_after_double.store(true, Ordering::SeqCst);
                    let _ = show_main_window(tray.app_handle());
                }
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    if suppress_click_after_double.swap(false, Ordering::SeqCst) {
                        return;
                    }

                    let ticket = click_generation.fetch_add(1, Ordering::SeqCst) + 1;
                    let generation = Arc::clone(&click_generation);
                    let app_handle = tray.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(tray_double_click_delay());
                        if generation.load(Ordering::SeqCst) != ticket {
                            return;
                        }

                        let scheduled_handle = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            let _ = show_overlay(&scheduled_handle, false);
                        });
                    });
                }
                _ => {}
            }
        })
        .build(app)?;

    if let Ok(mut slot) = app.state::<TrayState>().0.lock() {
        *slot = Some(TrayHandles {
            capture_item,
            settings_item,
            quit_item,
            tray_icon,
        });
    }

    Ok(())
}
