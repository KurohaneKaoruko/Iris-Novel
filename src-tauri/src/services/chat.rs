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
  // 未指定标题时，取首条用户消息截断为会话标题
  if incoming.title.trim().is_empty() {
    incoming.title = incoming
      .messages
      .iter()
      .find(|m| m.role == "user")
      .map(|m| {
        let t = m.content.trim().replace(['\n', '\r'], " ");
        let mut end = 0;
        for (i, ch) in t.char_indices() {
          if i >= 24 {
            break;
          }
          end = i + ch.len_utf8();
        }
        if end < t.len() {
          format!("{}…", &t[..end])
        } else {
          t
        }
      })
      .unwrap_or_else(|| "未命名会话".to_string());
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
      title: s.title,
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

pub fn delete_chat_session(id: &str) -> Result<bool, String> {
  let mut sessions = chat_history::load()?;
  let before = sessions.len();
  sessions.retain(|s| s.id != id);
  let removed = sessions.len() < before;
  if removed {
    chat_history::save(&sessions)?;
  }
  Ok(removed)
}

