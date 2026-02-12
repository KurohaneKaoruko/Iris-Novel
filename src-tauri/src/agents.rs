use crate::app_data;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Agent {
  pub id: String,
  pub name: String,
  pub category: String,
  pub system_prompt: String,
  pub temperature: f32,
  pub max_tokens: u32,
}

impl Default for Agent {
  fn default() -> Self {
    Self {
      id: String::new(),
      name: String::new(),
      category: String::new(),
      system_prompt: String::new(),
      temperature: 0.7,
      max_tokens: 1024,
    }
  }
}

pub fn load(app: &tauri::AppHandle) -> Result<Vec<Agent>, String> {
  let path = agents_path(app)?;
  if !path.exists() {
    let defaults = default_agents();
    save(app, &defaults)?;
    return Ok(defaults);
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read agents failed: {e}"))?;
  let agents: Vec<Agent> = serde_json::from_str(&raw).map_err(|e| format!("parse agents failed: {e}"))?;
  Ok(agents)
}

pub fn save(app: &tauri::AppHandle, agents: &[Agent]) -> Result<(), String> {
  let path = agents_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create agents dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(agents).map_err(|e| format!("serialize agents failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write agents failed: {e}"))
}

pub fn default_agents() -> Vec<Agent> {
  vec![
    Agent {
      id: "fantasy".to_string(),
      name: "玄幻助手".to_string(),
      category: "玄幻".to_string(),
      system_prompt: "你是一个玄幻小说创作助手。保持节奏爽快、冲突清晰、设定自洽。避免空行与段首空格，除非用户开启 Markdown 输出。".to_string(),
      temperature: 0.8,
      max_tokens: 1024,
    },
    Agent {
      id: "scifi".to_string(),
      name: "科幻助手".to_string(),
      category: "科幻".to_string(),
      system_prompt: "你是一个科幻小说创作助手。强调科学感与逻辑闭环，避免硬伤；注重概念阐释但不过度科普。避免空行与段首空格，除非用户开启 Markdown 输出。".to_string(),
      temperature: 0.7,
      max_tokens: 1024,
    },
    Agent {
      id: "romance".to_string(),
      name: "言情助手".to_string(),
      category: "言情".to_string(),
      system_prompt: "你是一个言情小说创作助手。重视人物情绪与关系推进，台词自然，节奏张弛有度。避免空行与段首空格，除非用户开启 Markdown 输出。".to_string(),
      temperature: 0.75,
      max_tokens: 1024,
    },
  ]
}

fn agents_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app_data::data_file_path(app, "agents.json")
}
