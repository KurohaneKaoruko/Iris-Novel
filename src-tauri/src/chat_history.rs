use crate::app_data;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ChatHistoryMessage {
  pub role: String,
  pub content: String,
}

impl Default for ChatHistoryMessage {
  fn default() -> Self {
    Self {
      role: String::new(),
      content: String::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ChatSession {
  pub id: String,
  pub workspace_root: String,
  pub created_at: i64,
  pub updated_at: i64,
  pub messages: Vec<ChatHistoryMessage>,
}

impl Default for ChatSession {
  fn default() -> Self {
    Self {
      id: String::new(),
      workspace_root: String::new(),
      created_at: 0,
      updated_at: 0,
      messages: Vec::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionSummary {
  pub id: String,
  pub workspace_root: String,
  pub updated_at: i64,
  pub message_count: usize,
}

pub fn load(app: &tauri::AppHandle) -> Result<Vec<ChatSession>, String> {
  let path = history_path(app)?;
  if !path.exists() {
    return Ok(Vec::new());
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read history failed: {e}"))?;
  serde_json::from_str(&raw).map_err(|e| format!("parse history failed: {e}"))
}

pub fn save(app: &tauri::AppHandle, sessions: &[ChatSession]) -> Result<(), String> {
  let path = history_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create history dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(sessions).map_err(|e| format!("serialize history failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write history failed: {e}"))
}

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app_data::data_file_path(app, "chat_history.json")
}
