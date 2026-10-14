use tauri::{
    AppHandle, Manager, Runtime,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub async fn show_capture_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| "capture window missing".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn hide_capture_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_capture_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| "capture window missing".to_string())?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Android: low-importance ongoing notification that deep-links to capture.
/// On desktop this is a no-op beyond a permission check.
#[tauri::command]
pub async fn ensure_android_ongoing_notification<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    let permission = app
        .notification()
        .permission_state()
        .map_err(|e| e.to_string())?;

    if permission != tauri_plugin_notification::PermissionState::Granted {
        app.notification()
            .request_permission()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "android")]
    {
        app.notification()
            .builder()
            .id(1001)
            .title("Personal Logger")
            .body("Tap to capture")
            .ongoing(true)
            .auto_cancel(false)
            .show()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(desktop)]
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    let _ = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("Personal Logger")
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = toggle_capture_window(app).await;
                });
            }
        })
        .build(app)?;
    Ok(())
}
