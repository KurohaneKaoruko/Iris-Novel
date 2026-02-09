use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
  pub output: OutputSettings,
  pub providers: Vec<ModelProvider>,
  pub active_provider_id: String,
  pub active_agent_id: String,
}

impl Default for AppSettings {
  fn default() -> Self {
    let mut providers = vec![
      ModelProvider {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        kind: ProviderKind::OpenAI,
        api_key: String::new(),
        base_url: "https://api.openai.com/v1".to_string(),
        model_name: "gpt-4o-mini".to_string(),
      },
      ModelProvider {
        id: "claude".to_string(),
        name: "Claude".to_string(),
        kind: ProviderKind::Anthropic,
        api_key: String::new(),
        base_url: "https://api.anthropic.com".to_string(),
        model_name: "claude-3-5-sonnet-20241022".to_string(),
      },
      ModelProvider {
        id: "deepseek".to_string(),
        name: "DeepSeek".to_string(),
        kind: ProviderKind::OpenAICompatible,
        api_key: String::new(),
        base_url: "https://api.deepseek.com".to_string(),
        model_name: "deepseek-chat".to_string(),
      },
    ];
    Self {
      output: OutputSettings::default(),
      providers,
      active_provider_id: "openai".to_string(),
      active_agent_id: "fantasy".to_string(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
  pub id: String,
  pub name: String,
  pub kind: ProviderKind,
  pub api_key: String,
  pub base_url: String,
  pub model_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderKind {
  OpenAI,
  Anthropic,
  OpenAICompatible, // For Ollama, DeepSeek, etc.
}

pub fn load(app: &tauri::AppHandle) -> Result<AppSettings, String> {
  let path = settings_path(app)?;
  if !path.exists() {
    return Ok(AppSettings::default());
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read settings failed: {e}"))?;
  serde_json::from_str(&raw).map_err(|e| format!("parse settings failed: {e}"))
}

pub fn save(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create settings dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize settings failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write settings failed: {e}"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app data dir failed: {e}"))?;
  Ok(base.join("Iris-Creation").join("settings.json"))
}
