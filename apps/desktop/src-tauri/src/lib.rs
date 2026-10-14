mod migrate;
mod platform;

use tauri::{Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_task_logger_schema_v1",
        sql: include_str!("../migrations/001_v1.sql"),
        kind: MigrationKind::Up,
    }];

    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:logger.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            migrate::migrate_legacy_if_needed,
            migrate::smoke_insert_task_entry,
            platform::show_capture_window,
            platform::hide_capture_window,
            platform::toggle_capture_window,
            platform::ensure_android_ongoing_notification,
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_shell::init());
        builder = builder.setup(|app| {
            platform::setup_tray(app.handle())?;
            Ok(())
        });
        builder = builder.on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == "capture" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Personal Logger");
}
