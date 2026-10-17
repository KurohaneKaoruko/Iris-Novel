//! 本地服务端：以 HTTP/WS 暴露与 Tauri 命令等价的 API。
//!
//! 设计要点：
//! - `POST /api/rpc/{command}`：与 Tauri invoke 等价的统一 RPC 端点，
//!   请求体为命令参数的 JSON 对象，返回 `{"ok": result}` 或 `{"err": message}`。
//! - `/ws`：WebSocket 事件通道，转发 EventSink 上的全部流式事件；
//!   客户端可发送 `{"type":"cancel","streamId":...}` 取消流任务。
//! - 静态托管前端构建产物（默认 `../src-react/dist`）。
//! - 默认绑定 `127.0.0.1`，端口可配置；来源校验（Host/Origin）防 DNS rebinding。

use crate::event_sink::{BroadcastEventSink, SharedEventSink};
use crate::state::AppState;
use axum::{
  Router,
  extract::{Path, State, WebSocketUpgrade},
  http::{HeaderMap, StatusCode},
  response::IntoResponse,
  routing::{get, post},
};
use serde_json::{Value, json};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

pub struct ServerConfig {
  pub host: String,
  pub port: u16,
  pub static_dir: Option<PathBuf>,
  pub data_dir: Option<PathBuf>,
}

impl Default for ServerConfig {
  fn default() -> Self {
    Self {
      host: "127.0.0.1".to_string(),
      port: 8765,
      static_dir: None,
      data_dir: None,
    }
  }
}

#[derive(Clone)]
pub struct ServerContext {
  pub app_state: Arc<AppState>,
  pub event_sink: SharedEventSink,
  pub broadcast: BroadcastEventSink,
}

pub async fn run(config: ServerConfig) -> Result<(), String> {
  if let Some(dir) = &config.data_dir {
    crate::app_data::set_storage_root_override(dir.clone());
  }

  let addr: SocketAddr = format!("{}:{}", config.host, config.port)
    .parse()
    .map_err(|e| format!("invalid bind address: {e}"))?;

  let broadcast = BroadcastEventSink::new(256);
  let ctx = ServerContext {
    app_state: Arc::new(AppState::default()),
    event_sink: Arc::new(broadcast.clone()),
    broadcast,
  };

  let dist_dir = config
    .static_dir
    .clone()
    .or_else(|| std::env::var("IRIS_NOVEL_STATIC_DIR").ok().map(PathBuf::from))
    .unwrap_or_else(|| PathBuf::from("../src-react/dist"));

  let index_file = dist_dir.join("index.html");
  let serve_frontend = tower_http::services::ServeDir::new(&dist_dir)
    .not_found_service(tower::service_fn(move |req: axum::http::Request<axum::body::Body>| {
      // SPA fallback：非 API/WS 路径全部回退到 index.html
      let index = index_file.clone();
      let is_api = req.uri().path().starts_with("/api/") || req.uri().path() == "/ws";
      async move {
        if is_api {
          return Ok::<_, std::convert::Infallible>(
            axum::http::Response::builder()
              .status(StatusCode::NOT_FOUND)
              .body(axum::body::Body::from("not found"))
              .unwrap(),
          );
        }
        match tokio::fs::read(&index).await {
          Ok(bytes) => Ok(axum::http::Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html; charset=utf-8")
            .body(axum::body::Body::from(bytes))
            .unwrap()),
          Err(_) => Ok(axum::http::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(axum::body::Body::from("frontend dist not built (run pnpm run build first)"))
            .unwrap()),
        }
      }
    }));

  let app = Router::new()
    .route("/api/health", get(health))
    .route("/api/rpc/{command}", post(rpc))
    .route("/ws", get(ws_upgrade))
    .fallback_service(serve_frontend)
    .with_state(ctx);

  let listener = tokio::net::TcpListener::bind(addr)
    .await
    .map_err(|e| format!("bind {addr} failed: {e}"))?;
  println!(
    "[iris-novel-server] listening on http://{}  (static: {})",
    addr,
    config
      .static_dir
      .as_ref()
      .map(|p| p.display().to_string())
      .unwrap_or_else(|| "disabled".to_string())
  );
  axum::serve(listener, app)
    .await
    .map_err(|e| format!("server error: {e}"))
}

async fn health() -> impl IntoResponse {
  json!({ "ok": true, "app": "iris-novel-server" }).to_string()
}

/// 来源校验：仅允许本机回环来源（防 DNS rebinding / 跨站访问）。
fn origin_allowed(headers: &HeaderMap) -> bool {
  fn host_is_local(host: &str) -> bool {
    let h = host.split(':').next().unwrap_or("").trim();
    h == "127.0.0.1" || h == "localhost" || h == "[::1]" || h.is_empty()
  }
  // Host header 必须是本机
  if let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) {
    if !host_is_local(host) {
      return false;
    }
  }
  // 若带 Origin，也必须是本机
  if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
    if !origin.contains("127.0.0.1") && !origin.contains("localhost") {
      return false;
    }
  }
  true
}

async fn rpc(
  State(ctx): State<ServerContext>,
  Path(command): Path<String>,
  headers: HeaderMap,
  body: axum::body::Bytes,
) -> impl IntoResponse {
  if !origin_allowed(&headers) {
    return (StatusCode::FORBIDDEN, json!({"error": "forbidden origin"}).to_string());
  }
  let args: Value = if body.is_empty() {
    json!({})
  } else {
    match serde_json::from_slice(&body) {
      Ok(v) => v,
      Err(e) => {
        return (
          StatusCode::BAD_REQUEST,
          json!({ "error": format!("invalid json body: {e}") }).to_string(),
        )
      }
    }
  };
  match crate::server::rpc_dispatch::dispatch(&ctx, &command, args).await {
    Ok(v) => (StatusCode::OK, json!({ "ok": v }).to_string()),
    Err(e) => (StatusCode::OK, json!({ "err": e }).to_string()),
  }
}

async fn ws_upgrade(
  State(ctx): State<ServerContext>,
  ws: WebSocketUpgrade,
  headers: HeaderMap,
) -> impl IntoResponse {
  if !origin_allowed(&headers) {
    return axum::response::Response::builder()
      .status(StatusCode::FORBIDDEN)
      .body(axum::body::Body::from("forbidden origin"))
      .unwrap();
  }
  ws.on_upgrade(move |socket| ws_handle(ctx, socket))
}

async fn ws_handle(ctx: ServerContext, socket: axum::extract::ws::WebSocket) {
  use futures_util::{SinkExt, StreamExt};
  let mut rx = ctx.broadcast.subscribe();
  let (mut tx, mut rx_from_client) = socket.split();
  loop {
    tokio::select! {
      // 服务端事件 -> 客户端
      ev = rx.recv() => {
        match ev {
          Ok((event, payload)) => {
            let msg = json!({ "event": event, "payload": payload }).to_string();
            if tx.send(axum::extract::ws::Message::Text(msg.into())).await.is_err() {
              break;
            }
          }
          Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
          Err(_) => break,
        }
      }
      // 客户端指令 -> 取消等
      msg = rx_from_client.next() => {
        match msg {
          Some(Ok(axum::extract::ws::Message::Text(text))) => {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
              if v["type"] == "cancel" {
                if let Some(sid) = v["streamId"].as_str() {
                  let _ = crate::services::ai_stream::cancel_stream(sid);
                  crate::event_sink::EventSink::emit(&*ctx.event_sink, "ai_stream_done", json!({ "streamId": sid, "cancelled": true }));
                }
              }
            }
          }
          Some(Ok(_)) => {}
          Some(Err(_)) | None => break,
        }
      }
    }
  }
}

pub mod rpc_dispatch;
