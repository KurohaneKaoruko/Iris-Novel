//! 聊天域：聊天会话持久化。
//!
//! 会话类型定义位于 `crate::chat_history`；本模块在后续任务中承接
//! 会话存取的业务逻辑，使 Tauri 命令与本地服务共用同一实现。
//! 聊天域：会话持久化业务逻辑。

use crate::chat_history;

// ---- 由 commands.rs 等价搬移（会话持久化）----
pub fn save_chat_session(session: chat_history::ChatSession) -> Result<(), String> {
  let mut sessions = chat_history::load()?;
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64;

  let mut incoming = session.clone();
  if incoming.created_at <= 0 {
    incoming.created_at = now;
  }
  incoming.updated_at = now;

  if let Some(pos) = sessions.iter().position(|s| s.id == incoming.id) {
    sessions[pos] = incoming;
  } else {
    sessions.push(incoming);
  }

  sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  if sessions.len() > 50 {
    sessions.truncate(50);
  }

  chat_history::save(&sessions)
}

pub fn list_chat_sessions(workspace_root: Option<String>) -> Result<Vec<chat_history::ChatSessionSummary>, String> {
  let sessions = chat_history::load()?;
  let mut out: Vec<chat_history::ChatSessionSummary> = Vec::new();
  for s in sessions {
    if let Some(root) = &workspace_root {
      if &s.workspace_root != root {
        continue;
      }
    }
    out.push(chat_history::ChatSessionSummary {
      id: s.id,
      workspace_root: s.workspace_root,
      updated_at: s.updated_at,
      message_count: s.messages.len(),
    });
  }
  Ok(out)
}

pub fn get_chat_session(id: &str) -> Result<chat_history::ChatSession, String> {
  let sessions = chat_history::load()?;
  sessions.into_iter().find(|s| s.id == id).ok_or_else(|| "session not found".to_string())
}

