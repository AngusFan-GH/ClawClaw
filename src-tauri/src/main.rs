#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod native;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, Command}, sync::{Mutex, oneshot}};

type Reply = oneshot::Sender<Result<Value, String>>;
struct Backend {
    input: Mutex<ChildStdin>, child: Mutex<Child>, pending: Mutex<HashMap<String, Reply>>,
    ready: AtomicBool, alive: AtomicBool, stopping: AtomicBool,
}
impl Backend {
    async fn write(&self, message: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        self.input.lock().await.write_all(&bytes).await.map_err(|e| e.to_string())
    }
    async fn stop(&self) {
        if self.stopping.swap(true, Ordering::SeqCst) { return; }
        let _ = self.write(json!({"type":"shutdown"})).await;
        let mut child = self.child.lock().await;
        if tokio::time::timeout(Duration::from_secs(20), child.wait()).await.is_err() {
            #[cfg(windows)]
            if let Some(pid) = child.id() {
                let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x08000000).output().await;
            }
            let _ = child.kill().await;
        }
    }
}

#[tauri::command]
fn host_platform() -> &'static str {
    if cfg!(target_os = "windows") { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" }
}

#[tauri::command]
async fn host_request(window: tauri::WebviewWindow, state: tauri::State<'_, Arc<Backend>>, channel: String, args: Vec<Value>) -> Result<Value, String> {
    if window.label() != "main" { return Err("Unauthorized window".into()); }
    let backend = state.inner();
    tokio::time::timeout(Duration::from_secs(60), async {
        while !backend.ready.load(Ordering::SeqCst) {
            if !backend.alive.load(Ordering::SeqCst) { return Err("Backend exited; restart the application and inspect its logs".to_string()); }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok(())
    }).await.map_err(|_| "Backend startup timed out".to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    backend.pending.lock().await.insert(id.clone(), tx);
    if let Err(error) = backend.write(json!({"type":"request", "id":id,"channel":channel,"args":args})).await {
        backend.pending.lock().await.remove(&id); return Err(error);
    }
    let result = tokio::time::timeout(Duration::from_secs(300), rx).await;
    backend.pending.lock().await.remove(&id);
    result.map_err(|_| "Host request timed out".to_string())?.map_err(|_| "Backend disconnected".to_string())?
}

fn start_backend(app: &tauri::AppHandle) -> Result<Arc<Backend>, Box<dyn std::error::Error>> {
    let dev_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let root = if cfg!(debug_assertions) {
        dev_root
    } else if let Ok(runtime_root) = std::env::var("CLAWCLAW_RUNTIME_ROOT") {
        std::path::PathBuf::from(runtime_root)
    } else {
        app.path().resource_dir()?.join("runtime")
    };
    let node = if cfg!(debug_assertions) { std::env::var("CLAWCLAW_NODE").unwrap_or_else(|_| "node".into()) } else { root.join("bin").join(if cfg!(windows) { "node.exe" } else { "node" }).to_string_lossy().to_string() };
    let mut command = Command::new(node);
    command.arg(root.join("dist-backend/entry.mjs")).current_dir(&root)
        .env("CLAWCLAW_APP_ROOT", &root).env("CLAWCLAW_VERSION", app.package_info().version.to_string())
        .env("CLAWCLAW_RESOURCES", if cfg!(debug_assertions) { root.join("resources") } else { root.clone() })
        .env("CLAWCLAW_PACKAGED", if cfg!(debug_assertions) { "0" } else { "1" })
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000);
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing stdout")?;
    let stderr = child.stderr.take().ok_or("Missing stderr")?;
    let input = child.stdin.take().ok_or("Missing stdin")?;
    let backend = Arc::new(Backend { input: Mutex::new(input), child: Mutex::new(child), pending: Mutex::new(HashMap::new()), ready: AtomicBool::new(false), alive: AtomicBool::new(true), stopping: AtomicBool::new(false) });
    let b = backend.clone(); let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<Value>(&line) else { eprintln!("Invalid backend frame"); continue; };
            match message["type"].as_str().unwrap_or("") {
                "ready" => { b.ready.store(true, Ordering::SeqCst); let _ = handle.emit("backend-ready", ()); },
                "response" => if let Some(id) = message["id"].as_str() {
                    if let Some(reply) = b.pending.lock().await.remove(id) {
                        let result = if let Some(error) = message["error"].as_str() { Err(error.into()) } else { Ok(message["data"].clone()) };
                        let _ = reply.send(result);
                    }
                },
                "event" => { let _ = handle.emit("host-event", json!({"channel":message["channel"],"args":message["args"]})); },
                "native" => {
                    let h = handle.clone(); let b2 = b.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = native::dispatch(&h, message["command"].as_str().unwrap_or(""), message["payload"].clone()).await;
                        let response = match result { Ok(data) => json!({"type":"native_result","id":message["id"],"data":data}), Err(error) => json!({"type":"native_result","id":message["id"],"error":error}) };
                        let _ = b2.write(response).await;
                    });
                },
                _ => {}
            }
        }
        b.alive.store(false, Ordering::SeqCst);
        for (_, reply) in b.pending.lock().await.drain() { let _ = reply.send(Err("Backend exited".into())); }
        let _ = handle.emit("host-event", json!({"channel":"gateway:error","args":["Backend exited. Please restart ClawClaw."]}));
    });
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("backend.log");
    tauri::async_runtime::spawn(async move {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(log_path).ok();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await { eprintln!("{line}"); if let Some(f) = file.as_mut() { let _ = writeln!(f, "{line}"); } }
    });
    Ok(backend)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![host_platform, host_request])
        .setup(|app| {
            app.manage(start_backend(app.handle())?);
            native::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Unable to initialize ClawClaw")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let backend = app.state::<Arc<Backend>>().inner().clone();
                if !backend.stopping.load(Ordering::SeqCst) {
                    api.prevent_exit(); let app = app.clone();
                    tauri::async_runtime::spawn(async move { backend.stop().await; app.exit(0); });
                }
            }
        });
}
