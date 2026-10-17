//! 事件抽象：AI 流式事件的输出通道。
//!
//! 桌面端（Tauri）实现包装 `app.emit`；Web 服务端实现写入 per-session
//! broadcast 通道，由 axum WS 端点转发。业务代码只依赖本 trait，
//! 不感知自己运行在哪条通道上。

use serde_json::Value;
use std::sync::Arc;

/// 事件汇：把流式事件投递到当前运行通道。
pub trait EventSink: Send + Sync {
  /// 发射一个事件（如 `ai_stream_token`、`ai_error`）。
  fn emit(&self, event: &str, payload: Value);
}

/// Tauri 桌面端实现：直接 `app.emit`。
pub struct TauriEventSink {
  app: tauri::AppHandle,
}

impl TauriEventSink {
  pub fn new(app: tauri::AppHandle) -> Self {
    Self { app }
  }
}

impl EventSink for TauriEventSink {
  fn emit(&self, event: &str, payload: Value) {
    use tauri::Emitter;
    let _ = self.app.emit(event, payload);
  }
}

/// 内存实现：per-session broadcast 通道，供 axum WS 端点转发。
/// 也用于单元测试收集事件。
#[derive(Clone)]
pub struct BroadcastEventSink {
  sender: tokio::sync::broadcast::Sender<(String, Value)>,
}

impl BroadcastEventSink {
  pub fn new(capacity: usize) -> Self {
    let (sender, _) = tokio::sync::broadcast::channel(capacity);
    Self { sender }
  }

  /// 订阅事件流（配合 WS 转发使用）。
  pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<(String, Value)> {
    self.sender.subscribe()
  }
}

impl EventSink for BroadcastEventSink {
  fn emit(&self, event: &str, payload: Value) {
    // 无订阅者时 send 失败，忽略即可（事件可丢，不阻塞生成）。
    let _ = self.sender.send((event.to_string(), payload));
  }
}

/// 测试/收集用途：把事件存进 Vec。
#[derive(Default)]
pub struct CollectingEventSink {
  pub events: std::sync::Mutex<Vec<(String, Value)>>,
}

impl EventSink for CollectingEventSink {
  fn emit(&self, event: &str, payload: Value) {
    self
      .events
      .lock()
      .map(|mut v| v.push((event.to_string(), payload)))
      .ok();
  }
}

pub type SharedEventSink = Arc<dyn EventSink>;

/// 便捷：包装为共享 sink。
pub fn shared(sink: impl EventSink + 'static) -> SharedEventSink {
  Arc::new(sink)
}

/// 进程级全局事件汇：fs_watcher 等无法穿透传 sink 的旧代码路径使用。
/// 桌面端在 main 启动时初始化为 TauriEventSink；服务端初始化为 broadcast。
/// 未初始化时事件仅丢弃（如纯库测试）。
pub mod global {
  use super::SharedEventSink;
  use serde_json::Value;
  use std::sync::{Mutex, OnceLock};

  static GLOBAL_SINK: OnceLock<Mutex<Option<SharedEventSink>>> = OnceLock::new();

  fn cell() -> &'static Mutex<Option<SharedEventSink>> {
    GLOBAL_SINK.get_or_init(|| Mutex::new(None))
  }

  /// 设置全局 sink（可重复调用，后者覆盖前者）。
  pub fn init(sink: SharedEventSink) {
    if let Ok(mut slot) = cell().lock() {
      *slot = Some(sink);
    }
  }

  pub fn emit(event: &str, payload: Value) {
    if let Ok(slot) = cell().lock() {
      if let Some(sink) = slot.as_ref() {
        sink.emit(event, payload);
      }
    }
  }
}

/// 可延迟绑定 Tauri AppHandle 的 sink：main 先装上占位，setup 回调里再绑定真实 handle。
pub struct LateTauriEventSink {
  handle: std::sync::Mutex<Option<tauri::AppHandle>>,
}

impl Default for LateTauriEventSink {
  fn default() -> Self {
    Self {
      handle: std::sync::Mutex::new(None),
    }
  }
}

impl LateTauriEventSink {
  pub fn bind(&self, app: tauri::AppHandle) {
    if let Ok(mut slot) = self.handle.lock() {
      *slot = Some(app);
    }
  }
}

impl EventSink for LateTauriEventSink {
  fn emit(&self, event: &str, payload: Value) {
    use tauri::Emitter;
    if let Ok(slot) = self.handle.lock() {
      if let Some(app) = slot.as_ref() {
        let _ = app.emit(event, payload);
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn broadcast_sink_delivers_to_subscriber() {
    let sink = BroadcastEventSink::new(8);
    let mut rx = sink.subscribe();
    sink.emit("ai_stream_token", serde_json::json!({ "token": "你" }));
    let (event, payload) = rx.try_recv().expect("event should be delivered");
    assert_eq!(event, "ai_stream_token");
    assert_eq!(payload["token"], "你");
  }

  #[test]
  fn broadcast_sink_without_subscriber_does_not_panic() {
    let sink = BroadcastEventSink::new(2);
    sink.emit("ai_error", serde_json::json!({ "message": "x" }));
  }

  #[test]
  fn collecting_sink_records_events() {
    let sink = CollectingEventSink::default();
    sink.emit("ai_stream_start", serde_json::json!({ "streamId": "s1" }));
    let events = sink.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "ai_stream_start");
  }
}
