use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// 存储根目录 override（由 server 启动参数或环境变量设置）。
/// 桌面端默认不设置，沿用可执行文件所在目录；server 端通过
/// `NICE_DATA_DIR` 或 `--data-dir` 指向与桌面端相同的目录，
/// 以共享 settings/secrets/chat_history/bookshelf 状态。
static STORAGE_ROOT_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// 设置存储根目录 override（进程级，只能设置一次；重复设置以首次为准）。
pub fn set_storage_root_override(dir: PathBuf) {
  let _ = STORAGE_ROOT_OVERRIDE.set(dir);
}

pub fn data_file_path(file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir("data")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn config_file_path(file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir("config")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create config dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn state_file_path(file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir("state")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create state dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn secrets_file_path(file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir("secrets")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create secrets dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

fn storage_dir(category: &str) -> Result<PathBuf, String> {
  Ok(storage_root_dir()?.join(category))
}

fn storage_root_dir() -> Result<PathBuf, String> {
  if let Some(dir) = STORAGE_ROOT_OVERRIDE.get() {
    return Ok(dir.clone());
  }
  if let Ok(from_env) = std::env::var("NICE_DATA_DIR") {
    let trimmed = from_env.trim().to_string();
    if !trimmed.is_empty() {
      let path = PathBuf::from(trimmed);
      let _ = STORAGE_ROOT_OVERRIDE.set(path.clone());
      return Ok(path);
    }
  }
  let exe_path = std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?;
  let exe_dir = exe_path
    .parent()
    .ok_or_else(|| "resolve executable directory failed".to_string())?;
  Ok(exe_dir.to_path_buf())
}
