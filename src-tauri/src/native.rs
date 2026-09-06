use serde_json::{json, Value};
use tauri::Manager;

fn string(value: &Value) -> Result<&str, String> { value.as_str().ok_or_else(|| "Expected a string".into()) }
pub async fn dispatch(app: &tauri::AppHandle, command: &str, payload: Value) -> Result<Value, String> {
    let window = app.get_webview_window("main").ok_or("Main window unavailable")?;
    match command {
        "window:minimize" => window.minimize().map_err(|e| e.to_string())?,
        "window:maximize" => window.maximize().map_err(|e| e.to_string())?,
        "window:unmaximize" => window.unmaximize().map_err(|e| e.to_string())?,
        "window:isMaximized" => return Ok(json!(window.is_maximized().map_err(|e| e.to_string())?)),
        "window:close" => window.hide().map_err(|e| e.to_string())?,
        "app:quit" => app.exit(0),
        "app:relaunch" => {
            app.state::<std::sync::Arc<super::Backend>>().stop().await;
            app.restart();
        },
        "shell:openExternal" => {
            let url = string(&payload)?;
            if !url.starts_with("https://") && !url.starts_with("http://") && !url.starts_with("mailto:") { return Err("Unsupported external URL scheme".into()); }
            open::that_detached(url).map_err(|e| e.to_string())?;
        },
        "shell:openPath" => {
            open::that_detached(string(&payload)?).map_err(|e| e.to_string())?;
            return Ok(json!(""));
        },
        "shell:showItemInFolder" => {
            let path = std::path::PathBuf::from(string(&payload)?);
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).creation_flags(0x08000000).spawn().map_err(|e| e.to_string())?;
            }
            #[cfg(not(windows))] open::that_detached(path.parent().ok_or("Invalid file path")?).map_err(|e| e.to_string())?;
        },
        "dialog:open" | "dialog:save" => {
            let mut dialog = rfd::AsyncFileDialog::new();
            if let Some(title) = payload["title"].as_str() { dialog = dialog.set_title(title); }
            if let Some(path) = payload["defaultPath"].as_str() {
                let path = std::path::Path::new(path);
                if path.is_dir() { dialog = dialog.set_directory(path); }
                else {
                    if let Some(parent) = path.parent() { dialog = dialog.set_directory(parent); }
                    if let Some(name) = path.file_name() { dialog = dialog.set_file_name(name.to_string_lossy()); }
                }
            }
            if let Some(filters) = payload["filters"].as_array() {
                for filter in filters {
                    let extensions: Vec<&str> = filter["extensions"].as_array().map(|items| items.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                    dialog = dialog.add_filter(filter["name"].as_str().unwrap_or("Files"), &extensions);
                }
            }
            if command == "dialog:save" {
                let file = dialog.save_file().await;
                return Ok(json!({"canceled": file.is_none(), "filePath":file.map(|f| f.path().to_string_lossy().to_string())}));
            }
            let properties = payload["properties"].as_array().cloned().unwrap_or_default();
            let directory = properties.iter().any(|v| v == "openDirectory");
            let multiple = properties.iter().any(|v| v == "multiSelections");
            let files = if directory { if multiple { dialog.pick_folders().await } else { dialog.pick_folder().await.map(|f| vec![f]) } }
                else if multiple { dialog.pick_files().await } else { dialog.pick_file().await.map(|f| vec![f]) };
            return Ok(json!({"canceled":files.is_none(), "filePaths":files.unwrap_or_default().iter().map(|f|f.path().to_string_lossy().to_string()).collect::<Vec<_>>()}));
        },
        "dialog:message" => {
            let labels = payload["buttons"].as_array().cloned().unwrap_or_else(|| vec![json!("OK")]);
            let buttons = if labels.len() >= 2 { rfd::MessageButtons::OkCancelCustom(labels[0].as_str().unwrap_or("OK").into(), labels[1].as_str().unwrap_or("Cancel").into()) } else { rfd::MessageButtons::Ok };
            let result = rfd::AsyncMessageDialog::new().set_title(payload["title"].as_str().unwrap_or("ClawClaw"))
                .set_description(format!("{}\n{}", payload["message"].as_str().unwrap_or(""), payload["detail"].as_str().unwrap_or("")))
                .set_buttons(buttons).show().await;
            let accepted = result == rfd::MessageDialogResult::Ok || result == rfd::MessageDialogResult::Custom(labels[0].as_str().unwrap_or("OK").into());
            return Ok(json!({"response": if accepted {0} else {1}, "checkboxChecked":false}));
        },
        "secret:set" => {
            let account = payload["account"].as_str().ok_or("Missing credential account")?;
            let value = payload["value"].as_str().ok_or("Missing credential value")?;
            let entry = keyring::Entry::new("app.clawclaw.desktop", account).map_err(|e| e.to_string())?;
            entry.set_password(value).map_err(|e| e.to_string())?;
        },
        "secret:get" => {
            let account = payload["account"].as_str().ok_or("Missing credential account")?;
            let entry = keyring::Entry::new("app.clawclaw.desktop", account).map_err(|e| e.to_string())?;
            return match entry.get_password() { Ok(value) => Ok(json!(value)), Err(keyring::Error::NoEntry) => Ok(Value::Null), Err(error) => Err(error.to_string()) };
        },
        "secret:delete" => {
            let account = payload["account"].as_str().ok_or("Missing credential account")?;
            let entry = keyring::Entry::new("app.clawclaw.desktop", account).map_err(|e| e.to_string())?;
            match entry.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => {}, Err(error) => return Err(error.to_string()) }
        },
        _ => return Err(format!("Unsupported native operation: {command}")),
    }
    Ok(Value::Null)
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}};
    let show = MenuItem::with_id(app, "show", "ClawClaw", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("ClawClaw").on_menu_event(|app, event| {
        if event.id.as_ref() == "quit" { app.exit(0); }
        else if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    }).on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::DoubleClick { .. } = event { if let Some(window) = tray.app_handle().get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } }
    });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    Ok(())
}
