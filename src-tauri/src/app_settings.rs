use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
  pub output: OutputSettings,
  pub providers: ProvidersSettings,
  pub active_agent_id: String,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self {
      output: OutputSettings { use_markdown: false },
      providers: ProvidersSettings {
        active: "openai".to_string(),
        openai: OpenAiSettings::default(),
        claude: AnthropicSettings::default(),
        wenxin: OpenAiSettings {
          base_url: "https://api.openai.com/v1".to_string(),
          ..OpenAiSettings::default()
        },
      },
      active_agent_id: "fantasy".to_string(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OutputSettings {
  pub use_markdown: bool,
}

impl Default for OutputSettings {
  fn default() -> Self {
    Self { use_markdown: false }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProvidersSettings {
  pub active: String,
  pub openai: OpenAiSettings,
  pub claude: AnthropicSettings,
  pub wenxin: OpenAiSettings,
}

impl Default for ProvidersSettings {
  fn default() -> Self {
    Self {
      active: "openai".to_string(),
      openai: OpenAiSettings::default(),
      claude: AnthropicSettings::default(),
      wenxin: OpenAiSettings::default(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OpenAiSettings {
  pub api_key: String,
  pub base_url: String,
  pub model: String,
  pub temperature: f32,
  pub max_tokens: u32,
}

impl Default for OpenAiSettings {
  fn default() -> Self {
    Self {
      api_key: String::new(),
      base_url: "https://api.openai.com/v1".to_string(),
      model: "gpt-4o-mini".to_string(),
      temperature: 0.7,
      max_tokens: 1024,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AnthropicSettings {
  pub api_key: String,
  pub model: String,
  pub max_tokens: u32,
}

impl Default for AnthropicSettings {
  fn default() -> Self {
    Self {
      api_key: String::new(),
      model: "claude-3-5-sonnet-20241022".to_string(),
      max_tokens: 1024,
    }
  }
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
