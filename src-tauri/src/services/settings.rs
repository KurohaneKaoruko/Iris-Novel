//! 设置域：项目写作设置、应用设置、API 密钥、提供商解析与写作助手配置。

use crate::agents;
use crate::app_settings;
use crate::secrets;
use super::workspace::get_workspace_root;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectWritingSettings {
  pub chapter_word_target: u32,
  pub auto_min_chars: u32,
  pub auto_max_chars: u32,
  pub auto_max_rounds: u32,
  pub auto_max_chapter_advances: u32,
  /// 作品级默认写作技能 id（如 novel-style-xianxia）；空 = 不启用
  #[serde(default)]
  pub default_skill_id: String,
}

impl Default for ProjectWritingSettings {
  fn default() -> Self {
    Self {
      chapter_word_target: 2000,
      auto_min_chars: 500,
      auto_max_chars: 2400,
      auto_max_rounds: 120,
      auto_max_chapter_advances: 24,
      default_skill_id: String::new(),
    }
  }
}

#[derive(Deserialize, Default)]
pub(crate) struct PartialProjectWritingSettings {
  pub(crate) chapter_word_target: Option<u32>,
  pub(crate) auto_min_chars: Option<u32>,
  pub(crate) auto_max_chars: Option<u32>,
  pub(crate) auto_max_rounds: Option<u32>,
  pub(crate) auto_max_chapter_advances: Option<u32>,
  #[serde(default)]
  pub(crate) default_skill_id: Option<String>,
}
// ---- 由 commands.rs 等价搬移（项目写作设置）----
fn normalize_project_writing_settings(mut v: ProjectWritingSettings) -> ProjectWritingSettings {
  v.chapter_word_target = v.chapter_word_target.clamp(0, 200_000);
  v.auto_min_chars = v.auto_min_chars.clamp(120, 20_000);
  v.auto_max_chars = v.auto_max_chars.clamp(180, 60_000);
  if v.auto_max_chars < v.auto_min_chars {
    v.auto_max_chars = v.auto_min_chars;
  }
  v.auto_max_rounds = v.auto_max_rounds.clamp(1, 1_000);
  v.auto_max_chapter_advances = v.auto_max_chapter_advances.clamp(0, 200);
  v.default_skill_id = v.default_skill_id.trim().to_string();
  // 技能 id 白名单校验：目录名风格（字母数字与连字符），拒绝路径穿越等脏值
  let valid_id = !v.default_skill_id.is_empty()
    && v
      .default_skill_id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
  if !valid_id {
    v.default_skill_id.clear();
  }
  v
}

fn project_settings_path(root: &Path) -> PathBuf {
  root.join(".novel").join(".settings").join("project.json")
}

fn load_project_writing_settings_internal(root: &Path) -> Result<ProjectWritingSettings, String> {
  let path = project_settings_path(root);
  let mut settings = ProjectWritingSettings::default();
  if path.exists() {
    let raw = fs::read_to_string(&path).map_err(|e| format!("read project settings failed: {e}"))?;
    let parsed = serde_json::from_str::<PartialProjectWritingSettings>(&raw)
      .map_err(|e| format!("parse project settings failed: {e}"))?;
    if let Some(v) = parsed.chapter_word_target {
      settings.chapter_word_target = v;
    }
    if let Some(v) = parsed.auto_min_chars {
      settings.auto_min_chars = v;
    }
    if let Some(v) = parsed.auto_max_chars {
      settings.auto_max_chars = v;
    }
    if let Some(v) = parsed.auto_max_rounds {
      settings.auto_max_rounds = v;
    }
    if let Some(v) = parsed.auto_max_chapter_advances {
      settings.auto_max_chapter_advances = v;
    }
    if let Some(v) = parsed.default_skill_id {
      settings.default_skill_id = v;
    }
  }
  Ok(normalize_project_writing_settings(settings))
}

fn save_project_writing_settings_internal(root: &Path, settings: &ProjectWritingSettings) -> Result<(), String> {
  let path = project_settings_path(root);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create project settings dir failed: {e}"))?;
  }
  let normalized = normalize_project_writing_settings(settings.clone());
  let raw = serde_json::to_string_pretty(&normalized).map_err(|e| format!("serialize project settings failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write project settings failed: {e}"))
}

pub fn get_project_writing_settings(state: &AppState) -> Result<ProjectWritingSettings, String> {
  let root = get_workspace_root(state)?;
  let settings = load_project_writing_settings_internal(&root)?;
  save_project_writing_settings_internal(&root, &settings)?;
  Ok(settings)
}

pub fn set_project_writing_settings(
  state: &AppState,
  settings: ProjectWritingSettings,
) -> Result<ProjectWritingSettings, String> {
  let root = get_workspace_root(state)?;
  let normalized = normalize_project_writing_settings(settings);
  save_project_writing_settings_internal(&root, &normalized)?;
  Ok(normalized)
}

// ---- 由 commands.rs 等价搬移（活动助手归一化与应用设置）----
fn normalize_active_agent_id(settings: &mut app_settings::AppSettings) {
  let agents_list = agents::load().unwrap_or_else(|_| agents::default_agents());
  if agents_list.is_empty() {
    settings.active_writing_assistant_id.clear();
    settings.active_agent_id.clear();
    return;
  }
  let current = if settings.active_writing_assistant_id.trim().is_empty() {
    settings.active_agent_id.trim().to_string()
  } else {
    settings.active_writing_assistant_id.trim().to_string()
  };
  let exists = !current.is_empty() && agents_list.iter().any(|a| a.id == current);
  if exists {
    settings.active_writing_assistant_id = current.clone();
    settings.active_agent_id = current;
    return;
  }
  let fallback = agents_list
    .iter()
    .find(|a| a.id == "general")
    .or_else(|| agents_list.first())
    .map(|a| a.id.clone())
    .unwrap_or_default();
  settings.active_writing_assistant_id = fallback.clone();
  settings.active_agent_id = fallback;
}

pub fn get_app_settings() -> Result<app_settings::AppSettings, String> {
  let mut s = app_settings::load()?;
  let prev_agent_id = s.active_agent_id.clone();
  let prev_active_writing_assistant_id = s.active_writing_assistant_id.clone();
  normalize_active_agent_id(&mut s);
  if s.active_agent_id != prev_agent_id || s.active_writing_assistant_id != prev_active_writing_assistant_id {
    let _ = app_settings::save(&s);
  }
  // Clear keys for display security
  for p in &mut s.providers {
    p.api_key.clear();
  }
  Ok(s)
}

pub fn set_app_settings(settings: app_settings::AppSettings) -> Result<(), String> {
  let mut s = settings.clone();

  if s.providers.is_empty() {
    s.providers = app_settings::AppSettings::default().providers;
  }
  if s.active_provider_id.trim().is_empty() || !s.providers.iter().any(|p| p.id == s.active_provider_id) {
    s.active_provider_id = s.providers[0].id.clone();
  }
  normalize_active_agent_id(&mut s);

  // Save API keys to secrets if present
  for p in &mut s.providers {
    if !p.api_key.trim().is_empty() {
      secrets::set_api_key(&p.id, p.api_key.trim())?;
      p.api_key.clear();
    }
  }
  
  app_settings::save(&s)
}

#[allow(non_snake_case)]
pub fn get_api_key_status(providerId: Option<String>, provider_id: Option<String>) -> Result<bool, String> {
  let pid = providerId
    .or(provider_id)
    .unwrap_or_default();
  match secrets::get_api_key(pid.trim()) {
    Ok(Some(v)) => Ok(!v.trim().is_empty()),
    Ok(None) => Ok(false),
    Err(e) => Err(e),
  }
}

#[allow(non_snake_case)]
pub fn set_api_key(
  providerId: Option<String>,
  provider_id: Option<String>,
  apiKey: Option<String>,
  api_key: Option<String>,
) -> Result<(), String> {
  let pid = providerId.or(provider_id).unwrap_or_default();
  let pid = pid.trim();
  if pid.is_empty() {
    return Err("provider_id is required".to_string());
  }
  let key = apiKey.or(api_key).unwrap_or_default();
  let key = key.trim();
  if key.is_empty() {
    return Err("api_key is required".to_string());
  }
  secrets::set_api_key(pid, key)
}

// ---- 由 commands.rs 等价搬移（提供商解析与连通性）----
#[derive(Serialize)]
pub struct ProviderConnectivityResult {
  pub ok: bool,
  pub status_code: u16,
  pub latency_ms: u128,
  pub message: String,
}

pub(crate) fn provider_has_configured_api_key(provider: &app_settings::ModelProvider) -> bool {
  if !provider.api_key.trim().is_empty() {
    return true;
  }
  matches!(
    secrets::get_api_key(provider.id.trim()),
    Ok(Some(v)) if !v.trim().is_empty()
  )
}

pub(crate) fn resolve_current_provider(
  settings: &app_settings::AppSettings,
) -> Result<app_settings::ModelProvider, String> {
  if settings.providers.is_empty() {
    return Err("no providers configured".to_string());
  }

  let active = settings
    .providers
    .iter()
    .find(|p| p.id == settings.active_provider_id);

  if let Some(provider) = active {
    if provider_has_configured_api_key(provider) {
      return Ok(provider.clone());
    }
  }

  if let Some(provider) = settings
    .providers
    .iter()
    .find(|p| provider_has_configured_api_key(p))
  {
    return Ok(provider.clone());
  }

  active
    .cloned()
    .or_else(|| settings.providers.first().cloned())
    .ok_or_else(|| "provider not found".to_string())
}

pub(crate) fn ensure_provider_ready(
  provider: &app_settings::ModelProvider,
) -> Result<(), String> {
  if provider.base_url.trim().is_empty() {
    return Err(format!(
      "provider={} base_url is empty. Set it in Settings > Models.",
      provider.id
    ));
  }
  if provider.model_name.trim().is_empty() {
    return Err(format!(
      "provider={} model_name is empty. Set it in Settings > Models.",
      provider.id
    ));
  }
  if !provider_has_configured_api_key(provider) {
    return Err(format!(
      "no API key configured for provider={}. Set it in Settings > Models.",
      provider.id
    ));
  }
  Ok(())
}

pub(crate) fn resolve_chat_provider(
  settings: &app_settings::AppSettings,
  requested_provider_id: Option<&str>,
) -> Result<app_settings::ModelProvider, String> {
  if settings.providers.is_empty() {
    return Err("no providers configured".to_string());
  }

  if let Some(provider_id) = requested_provider_id {
    let provider_id = provider_id.trim();
    if !provider_id.is_empty() {
      let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("provider not found: {}", provider_id))?;
      ensure_provider_ready(&provider)?;
      return Ok(provider);
    }
  }

  let provider = resolve_current_provider(settings)?;
  ensure_provider_ready(&provider)?;
  Ok(provider)
}

pub(crate) fn resolve_provider_api_key(
  provider: &app_settings::ModelProvider,
  override_key: Option<String>,
) -> Result<String, String> {
  if let Some(raw) = override_key {
    let trimmed = raw.trim().to_string();
    if !trimmed.is_empty() {
      return Ok(trimmed);
    }
  }
  match secrets::get_api_key(provider.id.trim()) {
    Ok(Some(v)) if !v.trim().is_empty() => Ok(v),
    Ok(_) => {
      let fallback = provider.api_key.trim().to_string();
      if fallback.is_empty() {
        Err(format!(
          "no API key configured for provider={}. Set it in Settings > Models.",
          provider.id
        ))
      } else {
        Ok(fallback)
      }
    }
    Err(e) => Err(format!("keyring read failed: {e}")),
  }
}

async fn probe_provider_connectivity(
  client: &reqwest::Client,
  provider: &app_settings::ModelProvider,
  api_key: &str,
) -> Result<ProviderConnectivityResult, String> {
  let started = Instant::now();
  match provider.kind {
    app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
      let base = provider.base_url.trim().trim_end_matches('/');
      if base.is_empty() {
        return Err("base_url is empty".to_string());
      }
      let url = format!("{base}/chat/completions");
      let body = serde_json::json!({
        "model": provider.model_name,
        "messages": [{"role":"user","content":"Reply with OK."}],
        "max_tokens": 8,
        "temperature": 0.0,
        "stream": false
      });
      let resp = client
        .post(url.as_str())
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
      let status = resp.status();
      if status.is_success() {
        return Ok(ProviderConnectivityResult {
          ok: true,
          status_code: status.as_u16(),
          latency_ms: started.elapsed().as_millis(),
          message: "Provider reachable and model responded.".to_string(),
        });
      }
      let raw = resp.text().await.unwrap_or_else(|_| String::new());
      let snippet = if raw.chars().count() > 260 {
        format!("{}...", raw.chars().take(260).collect::<String>())
      } else {
        raw
      };
      Err(format!("http {}: {}", status.as_u16(), snippet))
    }
    app_settings::ProviderKind::Anthropic => {
      let base = provider.base_url.trim().trim_end_matches('/');
      let endpoint = if base.is_empty() {
        "https://api.anthropic.com/v1/messages".to_string()
      } else if base.ends_with("/messages") {
        base.to_string()
      } else {
        format!("{base}/messages")
      };
      let body = serde_json::json!({
        "model": provider.model_name,
        "max_tokens": 16,
        "messages": [{"role":"user","content":"Reply with OK."}]
      });
      let resp = client
        .post(endpoint.as_str())
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
      let status = resp.status();
      if status.is_success() {
        return Ok(ProviderConnectivityResult {
          ok: true,
          status_code: status.as_u16(),
          latency_ms: started.elapsed().as_millis(),
          message: "Provider reachable and model responded.".to_string(),
        });
      }
      let raw = resp.text().await.unwrap_or_else(|_| String::new());
      let snippet = if raw.chars().count() > 260 {
        format!("{}...", raw.chars().take(260).collect::<String>())
      } else {
        raw
      };
      Err(format!("http {}: {}", status.as_u16(), snippet))
    }
  }
}

#[allow(non_snake_case)]
pub async fn test_provider_connectivity(
  provider: app_settings::ModelProvider,
  apiKey: Option<String>,
  api_key: Option<String>,
) -> Result<ProviderConnectivityResult, String> {
  if provider.id.trim().is_empty() {
    return Err("provider id is empty".to_string());
  }
  if provider.base_url.trim().is_empty() {
    return Err("base_url is empty".to_string());
  }
  if provider.model_name.trim().is_empty() {
    return Err("model_name is empty".to_string());
  }
  let merged_key = apiKey.or(api_key);
  let key = resolve_provider_api_key(&provider, merged_key)?;
  let client = crate::services::build_http_client()?;
  probe_provider_connectivity(&client, &provider, key.as_str()).await
}

// ---- 由 commands.rs 等价搬移（写作助手配置）----
pub fn get_agents() -> Result<Vec<agents::Agent>, String> {
  agents::load()
}

pub fn set_agents(agents_list: Vec<agents::Agent>) -> Result<(), String> {
  agents::save( &agents_list)
}

pub fn export_agents() -> Result<String, String> {
  let list = agents::load_custom()?;
  serde_json::to_string_pretty(&list).map_err(|e| format!("export agents failed: {e}"))
}

pub fn import_agents(json: String) -> Result<(), String> {
  let list: Vec<agents::Agent> = serde_json::from_str(&json).map_err(|e| format!("import agents failed: {e}"))?;
  agents::save_custom( &list)
}


#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_skill_id_roundtrip_and_normalization() {
    let dir = std::env::temp_dir().join(format!("iris-ws-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join(".novel").join(".settings")).unwrap();

    // 默认值为空
    let loaded = load_project_writing_settings_internal(&dir).unwrap();
    assert_eq!(loaded.default_skill_id, "");

    // 保存合法 id 后可读回
    let mut s = ProjectWritingSettings::default();
    s.default_skill_id = "novel-style-xianxia".to_string();
    save_project_writing_settings_internal(&dir, &s).unwrap();
    let loaded = load_project_writing_settings_internal(&dir).unwrap();
    assert_eq!(loaded.default_skill_id, "novel-style-xianxia");

    // 旧格式文件（无 default_skill_id）不破坏加载
    std::fs::write(
      project_settings_path(&dir),
      r#"{"chapter_word_target": 3000}"#,
    )
    .unwrap();
    let legacy = load_project_writing_settings_internal(&dir).unwrap();
    assert_eq!(legacy.chapter_word_target, 3000);
    assert_eq!(legacy.default_skill_id, "");

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn normalize_rejects_invalid_skill_ids() {
    let mut s = ProjectWritingSettings::default();
    s.default_skill_id = "../etc/passwd".to_string();
    let n = normalize_project_writing_settings(s);
    assert_eq!(n.default_skill_id, "");

    let mut s = ProjectWritingSettings::default();
    s.default_skill_id = "  novel-craft  ".to_string();
    let n = normalize_project_writing_settings(s);
    assert_eq!(n.default_skill_id, "novel-craft");
  }
}
