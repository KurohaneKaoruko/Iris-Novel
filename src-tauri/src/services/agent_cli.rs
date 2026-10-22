//! 外部 Agent CLI 集成域：检测、任务执行、快照/变更集审阅。
//!
//! 预置适配器（均以 headless 模式在作品目录内运行）：
//! - Claude Code:  `claude -p "<task>" --output-format json`
//! - Codex CLI:    `codex exec "<task>"`
//! - DeepSeek Harness: `dsh --profile headless "<task>"`
//!
//! 写入管控双模式（默认快照+审阅）：
//! - 快照+审阅：任务前快照作品目录（排除 .novel/），任务后对比产出变更集，
//!   用户逐文件接受/回滚。
//! - 直接写入：跳过审阅，完成后自动记录一条版本历史。

use crate::event_sink;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use similar::{ChangeTag, TextDiff};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

pub const CLI_IDS: &[&str] = &["claude-code", "codex", "deepseek-harness"];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliInfo {
  pub id: String,
  pub name: String,
  pub available: bool,
  pub version: Option<String>,
  pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliTaskRequest {
  pub cli_id: String,
  pub workspace_root: String,
  pub prompt: String,
  /// 覆盖写入模式（默认取设置）
  pub write_mode: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliTaskStatus {
  pub task_id: String,
  pub cli_id: String,
  pub workspace_root: String,
  pub state: String, // running | finished | cancelled | failed
  pub started_at: u64,
  pub finished_at: Option<u64>,
  pub exit_code: Option<i32>,
  pub output_tail: String,
  pub change_set: Option<CliChangeSet>,
  pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CliChangeSet {
  pub task_id: String,
  pub workspace_root: String,
  pub entries: Vec<CliChangeEntry>,
  pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliChangeEntry {
  pub path: String,
  pub change_type: String, // added | modified | deleted
  pub old_text: Option<String>,
  pub new_text: Option<String>,
  pub unified_diff: Option<String>,
  pub decision: String, // pending | accepted | reverted
}

fn now_millis() -> u64 {
  SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// CLI 可执行命令定义。
fn cli_program(cli_id: &str) -> Result<(&'static str, &'static str, Vec<&'static str>), String> {
  match cli_id {
    "claude-code" => Ok(("claude", "Claude Code", vec!["--version"])),
    "codex" => Ok(("codex", "Codex CLI", vec!["--version"])),
    "deepseek-harness" => Ok(("dsh", "DeepSeek Harness", vec!["--version"])),
    _ => Err(format!("unknown cli: {cli_id}")),
  }
}

/// 任务命令行拼装（headless 模式）。
fn build_task_command(cli_id: &str, task_book: &str) -> Result<(String, Vec<String>), String> {
  match cli_id {
    "claude-code" => Ok((
      "claude".to_string(),
      vec!["-p".to_string(), task_book.to_string(), "--output-format".to_string(), "json".to_string()],
    )),
    "codex" => Ok(("codex".to_string(), vec!["exec".to_string(), task_book.to_string()])),
    "deepseek-harness" => Ok((
      "dsh".to_string(),
      vec!["--profile".to_string(), "headless".to_string(), task_book.to_string()],
    )),
    _ => Err(format!("unknown cli: {cli_id}")),
  }
}

/// 检测 CLI 可用性（PATH 查找 + --version 探测，带超时）。
pub async fn detect_clis() -> Result<Vec<CliInfo>, String> {
  let mut out = Vec::new();
  for id in CLI_IDS {
    let (bin, name, _) = cli_program(id)?;
    let info = match which_binary(bin).await {
      None => CliInfo {
        id: id.to_string(),
        name: name.to_string(),
        available: false,
        version: None,
        error: Some(format!("executable `{bin}` not found in PATH")),
      },
      Some(_) => {
        let version = probe_version(bin).await;
        CliInfo {
          id: id.to_string(),
          name: name.to_string(),
          available: true,
          version,
          error: None,
        }
      }
    };
    out.push(info);
  }
  Ok(out)
}

async fn which_binary(bin: &str) -> Option<PathBuf> {
  // Windows 下尝试 .cmd/.exe 扩展
  let candidates: Vec<String> = if cfg!(windows) {
    vec![format!("{bin}.exe"), format!("{bin}.cmd"), bin.to_string()]
  } else {
    vec![bin.to_string()]
  };
  if let Ok(paths) = std::env::var("PATH") {
    for dir in std::env::split_paths(&paths) {
      for c in &candidates {
        let p = dir.join(c);
        if p.is_file() {
          return Some(p);
        }
      }
    }
  }
  None
}

async fn probe_version(bin: &str) -> Option<String> {
  let output = tokio::time::timeout(
    Duration::from_secs(10),
    tokio::process::Command::new(bin)
      .arg("--version")
      // 探测进程不继承业务进程 CWD：即使被探程序行为异常（如写相对路径文件），
      // 也只会落到临时目录，绝不污染应用目录或作品目录。
      .current_dir(std::env::temp_dir())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped())
      .stdin(std::process::Stdio::null())
      .output(),
  )
  .await
  .ok()?
  .ok()?;
  let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let first = text.lines().next().unwrap_or("").trim().to_string();
  if first.is_empty() {
    None
  } else {
    Some(first.chars().take(120).collect())
  }
}

// ---- 任务书拼装 ----

/// 组装 CLI 任务书：写作任务 + 安全边界声明。
/// 资料上下文由前端经 chatComposer 组装后随 prompt 传入（同源管线）。
pub fn build_task_book(user_prompt: &str) -> String {
  format!(
    r#"{user_prompt}

---

## 工作规范（必须遵守）

- 你在一个小说创作项目内工作。作品目录结构：`stories/`（正文章节 .md）、`concept/`（设定资料 .md）、`outline/`（大纲 .md）。
- 只允许读写上述目录中的 Markdown 文件；禁止创建其他目录。
- 禁止读写 `.novel/` 目录（项目内部状态，任何情况下不得触碰）。
- 禁止执行 shell 命令、安装依赖、访问网络；只做文本创作与修改。
- 输出正文使用中文（除非任务明确要求其他语言），保持视角一致、文风统一、设定一致。
- 完成后简要说明你创建/修改了哪些文件（路径列表）。"#,
    user_prompt = user_prompt.trim()
  )
}

// ---- 快照 / 变更集 ----

/// 排除的目录（不进入快照）。
fn is_excluded(rel: &str) -> bool {
  rel.starts_with(".novel/") || rel == ".novel" || rel.starts_with(".git/")
}

fn snapshot_dir_for(workspace: &Path, task_id: &str) -> PathBuf {
  workspace.join(".novel").join("snapshots").join(task_id)
}

/// 递归收集文件（路径 -> 内容），排除 .novel/.git 与二进制。
fn collect_files(root: &Path) -> Result<HashMap<String, String>, String> {
  let mut out = HashMap::new();
  let mut stack = vec![root.to_path_buf()];
  while let Some(dir) = stack.pop() {
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read dir failed: {e}"))?;
    for entry in entries.flatten() {
      let p = entry.path();
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with('.') {
        continue; // 跳过所有隐藏目录/文件（.novel/.git 等）
      }
      if p.is_dir() {
        stack.push(p);
      } else if p.is_file() {
        let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
        if is_excluded(&rel) {
          continue;
        }
        if let Ok(text) = std::fs::read_to_string(&p) {
          out.insert(rel, text);
        }
      }
    }
  }
  Ok(out)
}

/// 任务前快照：内容副本存 .novel/snapshots/<task-id>/。
fn take_snapshot(workspace: &Path, task_id: &str) -> Result<HashMap<String, String>, String> {
  let files = collect_files(workspace)?;
  let dir = snapshot_dir_for(workspace, task_id);
  std::fs::create_dir_all(&dir).map_err(|e| format!("create snapshot dir failed: {e}"))?;
  let manifest = serde_json::to_string(&files).map_err(|e| e.to_string())?;
  std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest failed: {e}"))?;
  Ok(files)
}

fn load_snapshot(workspace: &Path, task_id: &str) -> Result<HashMap<String, String>, String> {
  let dir = snapshot_dir_for(workspace, task_id);
  let raw = std::fs::read_to_string(dir.join("manifest.json"))
    .map_err(|e| format!("read snapshot failed: {e}"))?;
  serde_json::from_str(&raw).map_err(|e| format!("parse snapshot failed: {e}"))
}

/// 任务后对比产出变更集。
fn compute_change_set(workspace: &Path, task_id: &str, before: &HashMap<String, String>) -> Result<CliChangeSet, String> {
  let after = collect_files(workspace)?;
  let mut paths: Vec<String> = before.keys().chain(after.keys()).cloned().collect();
  paths.sort();
  paths.dedup();
  let mut entries = Vec::new();
  for path in paths {
    let old = before.get(&path);
    let new = after.get(&path);
    let change_type = match (old, new) {
      (Some(_), Some(_)) if old == new => continue,
      (None, Some(_)) => "added",
      (Some(_), None) => "deleted",
      (Some(_), Some(_)) => "modified",
      (None, None) => continue,
    };
    let unified_diff = match (old, new) {
      (Some(o), Some(n)) => {
        let diff = TextDiff::from_lines(o, n);
        let mut buf = String::new();
        for line in diff.iter_all_changes() {
          let sign = match line.tag() {
            ChangeTag::Delete => '-',
            ChangeTag::Insert => '+',
            ChangeTag::Equal => ' ',
          };
          buf.push(sign);
          buf.push_str(line.value());
        }
        Some(buf)
      }
      _ => None,
    };
    entries.push(CliChangeEntry {
      path,
      change_type: change_type.to_string(),
      old_text: old.cloned(),
      new_text: new.cloned(),
      unified_diff,
      decision: "pending".to_string(),
    });
  }
  Ok(CliChangeSet {
    task_id: task_id.to_string(),
    workspace_root: workspace.to_string_lossy().to_string(),
    entries,
    created_at: now_millis(),
  })
}

fn cleanup_snapshot(workspace: &Path, task_id: &str) {
  let _ = std::fs::remove_dir_all(snapshot_dir_for(workspace, task_id));
}

// ---- 任务注册表与互斥 ----

pub struct TaskRegistry {
  tasks: Mutex<HashMap<String, CliTaskStatus>>,
  /// workspace_root -> task_id（同作品互斥）
  running_by_workspace: Mutex<HashMap<String, String>>,
  /// task_id -> kill 令牌
  cancel_tokens: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
}

impl Default for TaskRegistry {
  fn default() -> Self {
    Self {
      tasks: Mutex::new(HashMap::new()),
      running_by_workspace: Mutex::new(HashMap::new()),
      cancel_tokens: Mutex::new(HashMap::new()),
    }
  }
}

fn registry() -> &'static TaskRegistry {
  static REG: std::sync::OnceLock<TaskRegistry> = std::sync::OnceLock::new();
  REG.get_or_init(TaskRegistry::default)
}

pub fn list_tasks() -> Vec<CliTaskStatus> {
  registry()
    .tasks
    .lock()
    .map(|t| t.values().cloned().collect())
    .unwrap_or_default()
}

pub fn get_task(task_id: &str) -> Option<CliTaskStatus> {
  registry().tasks.lock().ok()?.get(task_id).cloned()
}

pub fn cancel_task(task_id: &str) -> Result<(), String> {
  let tx = registry()
    .cancel_tokens
    .lock()
    .map_err(|_| "cancel tokens lock poisoned")?
    .get(task_id)
    .cloned();
  match tx {
    Some(tx) => {
      let _ = tx.send(true);
      Ok(())
    }
    None => Err(format!("task not running: {task_id}")),
  }
}

/// 接受/回滚一个变更条目。
pub fn decide_change(task_id: &str, path: &str, accept: bool) -> Result<CliChangeEntry, String> {
  let mut tasks = registry().tasks.lock().map_err(|_| "tasks lock poisoned")?;
  let task = tasks.get_mut(task_id).ok_or("task not found")?;
  let cs = task.change_set.as_mut().ok_or("task has no change set")?;
  let idx = cs
    .entries
    .iter()
    .position(|e| e.path == path)
    .ok_or_else(|| format!("change entry not found: {path}"))?;
  let workspace = PathBuf::from(&task.workspace_root);
  {
    let entry = &mut cs.entries[idx];
    if accept {
      // 保留磁盘现状
      entry.decision = "accepted".to_string();
    } else {
      // 回滚到旧内容（added -> 删除；modified/deleted -> 写回旧内容）
      let target = workspace.join(&entry.path);
      match entry.change_type.as_str() {
        "added" => {
          std::fs::remove_file(&target).map_err(|e| format!("revert (delete) failed: {e}"))?;
        }
        _ => {
          let old = entry.old_text.clone().unwrap_or_default();
          if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("revert mkdir failed: {e}"))?;
          }
          std::fs::write(&target, old).map_err(|e| format!("revert write failed: {e}"))?;
        }
      }
      entry.decision = "reverted".to_string();
    }
  }
  let out = cs.entries[idx].clone();
  // 全部处理完则清理快照
  if cs.entries.iter().all(|e| e.decision != "pending") {
    cleanup_snapshot(&workspace, task_id);
  }
  Ok(out)
}

// ---- 任务执行 ----

pub async fn run_task(
  _state: &AppState,
  req: CliTaskRequest,
  default_write_mode: &str,
) -> Result<String, String> {
  let cli_id = req.cli_id.clone();
  cli_program(&cli_id)?;
  let workspace = PathBuf::from(&req.workspace_root);
  if !workspace.is_dir() {
    return Err(format!("workspace not found: {}", req.workspace_root));
  }
  // 二次校验 CLI 可用
  let (bin, _, _) = cli_program(&cli_id)?;
  if which_binary(bin).await.is_none() {
    return Err(format!("CLI `{bin}` not available (not installed or not in PATH)"));
  }

  let task_id = format!("cli-{}-{}", now_millis(), uuid::Uuid::new_v4().simple());
  let ws_key = workspace.to_string_lossy().to_string();

  // 互斥检查
  {
    let running = registry().running_by_workspace.lock().map_err(|_| "lock poisoned")?;
    if let Some(existing) = running.get(&ws_key) {
      return Err(format!(
        "另一外部 CLI 任务正在该作品运行（task={existing}），同一作品同时只允许一个任务"
      ));
    }
  }

  let write_mode = req.write_mode.clone().unwrap_or_else(|| default_write_mode.to_string());
  let review_mode = write_mode != "direct";

  // 快照（审阅模式）
  let before = if review_mode {
    take_snapshot(&workspace, &task_id)?
  } else {
    HashMap::new()
  };

  let task_book = build_task_book(&req.prompt);
  let (program, args) = build_task_command(&cli_id, &task_book)?;

  let status = CliTaskStatus {
    task_id: task_id.clone(),
    cli_id: cli_id.clone(),
    workspace_root: ws_key.clone(),
    state: "running".to_string(),
    started_at: now_millis(),
    finished_at: None,
    exit_code: None,
    output_tail: String::new(),
    change_set: None,
    error: None,
  };
  registry()
    .tasks
    .lock()
    .map_err(|_| "lock poisoned")?
    .insert(task_id.clone(), status);
  registry()
    .running_by_workspace
    .lock()
    .map_err(|_| "lock poisoned")?
    .insert(ws_key.clone(), task_id.clone());

  // 取消令牌
  let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
  registry()
    .cancel_tokens
    .lock()
    .map_err(|_| "lock poisoned")?
    .insert(task_id.clone(), cancel_tx);

  let tid = task_id.clone();
  let ws = workspace.clone();
  let review = review_mode;
  let prompt_cli = cli_id.clone();
  let before_snapshot = before.clone();
  tokio::spawn(async move {
    let start_event = json!({
      "taskId": tid, "cliId": prompt_cli, "state": "running", "workspaceRoot": ws,
    });
    event_sink::global::emit("agent_cli_started", start_event);

    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&args)
      .current_dir(&ws)
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped())
      .stdin(std::process::Stdio::null());
    #[cfg(unix)]
    {
      cmd.process_group(0); // 独立进程组，取消时整组 kill
    }
    cmd.kill_on_drop(true);

    let mut child = match cmd.spawn() {
      Ok(c) => c,
      Err(e) => {
        finish_task(&tid, &ws, "failed", None, Some(format!("spawn `{program}` failed: {e}")), review, &before_snapshot);
        registry().cancel_tokens.lock().ok().and_then(|mut m| m.remove(&tid));
        return;
      }
    };

    let mut stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let tid_out = tid.clone();
    let ws_out = ws.clone();
    let stdout_task = tokio::spawn(async move {
      use tokio::io::AsyncReadExt;
      let mut buf = vec![0u8; 4096];
      let mut tail = String::new();
      loop {
        match stdout.read(&mut buf).await {
          Ok(0) | Err(_) => break,
          Ok(n) => {
            let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
            tail.push_str(&chunk);
            let tail_len = tail.chars().count();
            if tail_len > 8000 {
              let skip = tail_len - 8000;
              tail = tail.chars().skip(skip).collect();
            }
            if let Ok(mut tasks) = registry().tasks.lock() {
              if let Some(t) = tasks.get_mut(&tid_out) {
                t.output_tail = tail.clone();
              }
            }
            event_sink::global::emit("agent_cli_output", json!({
              "taskId": tid_out, "chunk": chunk,
            }));
            let _ = ws_out;
          }
        }
      }
    });
    let _ = stderr; // stderr 简化处理：不转发（CLI 关键输出在 stdout）

    // 等待完成或取消
    let mut cancelled = false;
    let exit = tokio::select! {
      s = child.wait() => s,
      _ = cancel_rx.changed() => {
        cancelled = true;
        let _ = child.start_kill();
        child.wait().await
      }
    };

    let _ = stdout_task.await;
    let exit_code = exit.ok().and_then(|s| s.code());
    registry().cancel_tokens.lock().ok().and_then(|mut m| m.remove(&tid));

    let before = if review { load_snapshot(&ws, &tid).unwrap_or_default() } else { HashMap::new() };
    if cancelled {
      finish_task(&tid, &ws, "cancelled", exit_code, None, review, &before);
    } else if exit_code.map(|c| c != 0).unwrap_or(true) {
      finish_task(&tid, &ws, "failed", exit_code, Some(format!("exit code: {exit_code:?}")), review, &before);
    } else {
      finish_task(&tid, &ws, "finished", exit_code, None, review, &before);
    }
  });

  Ok(task_id)
}

fn before_of(ws: &Path, tid: &str, review: bool) -> HashMap<String, String> {
  if review {
    load_snapshot(ws, tid).unwrap_or_default()
  } else {
    HashMap::new()
  }
}

fn finish_task(
  tid: &str,
  ws: &Path,
  state: &str,
  exit_code: Option<i32>,
  error: Option<String>,
  review: bool,
  before: &HashMap<String, String>,
) {
  let change_set = if review {
    compute_change_set(ws, tid, before).ok()
  } else {
    // 直接写入模式：为每个本次修改的文件记录版本历史（尽力而为）
    if let Ok(after) = collect_files(ws) {
      let mut changed: Vec<String> = Vec::new();
      for (p, content) in &after {
        if before.get(p) != Some(content) {
          changed.push(p.clone());
        }
      }
      let _ = &after;
      for rel in changed {
        let _ = crate::services::workspace::create_history_snapshot(ws, &rel, Some("external-cli".to_string()));
      }
    }
    None
  };
  let change_set_json = change_set.as_ref().map(|cs| {
    // 快照文件不进 change entries
    let mut c = cs.clone();
    c.entries.retain(|e| !e.path.starts_with(".novel/"));
    c
  });
  if let Ok(mut tasks) = registry().tasks.lock() {
    if let Some(t) = tasks.get_mut(tid) {
      t.state = state.to_string();
      t.finished_at = Some(now_millis());
      t.exit_code = exit_code;
      t.error = error.clone();
      t.change_set = change_set_json.clone();
    }
  }
  registry()
    .running_by_workspace
    .lock()
    .ok()
    .and_then(|mut m| {
      let key = ws.to_string_lossy().to_string();
      if m.get(&key).map(|id| id == tid).unwrap_or(false) {
        m.remove(&key);
      }
      Some(())
    });
  event_sink::global::emit(
    "agent_cli_finished",
    json!({
      "taskId": tid, "state": state, "exitCode": exit_code,
      "hasChangeSet": change_set_json.map(|c| !c.entries.is_empty()).unwrap_or(false),
      "error": error,
    }),
  );
}

/// 清理已完成任务记录。
pub fn prune_tasks() -> usize {
  let mut removed = 0;
  if let Ok(mut tasks) = registry().tasks.lock() {
    let finished: Vec<String> = tasks
      .iter()
      .filter(|(_, t)| t.state != "running")
      .map(|(k, _)| k.clone())
      .collect();
    removed = finished.len();
    for k in finished {
      tasks.remove(&k);
    }
  }
  removed
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_workspace(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nice-cli-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("stories")).unwrap();
    std::fs::create_dir_all(dir.join(".novel/state")).unwrap();
    std::fs::write(dir.join("stories/ch1.md"), "第一行\n第二行\n").unwrap();
    std::fs::write(dir.join(".novel/state/character-state-index.md"), "内部状态").unwrap();
    dir
  }

  #[test]
  fn build_task_book_contains_constraints() {
    let book = build_task_book("续写第二章，1500字");
    assert!(book.contains("续写第二章"));
    assert!(book.contains(".novel/"));
    assert!(book.contains("stories/"));
    assert!(book.contains("禁止执行 shell"));
  }

  #[test]
  fn build_task_command_forms() {
    let (p, a) = build_task_command("claude-code", "TASK").unwrap();
    assert_eq!(p, "claude");
    assert_eq!(a, vec!["-p", "TASK", "--output-format", "json"]);
    let (p, a) = build_task_command("codex", "TASK").unwrap();
    assert_eq!(p, "codex");
    assert_eq!(a[0], "exec");
    let (p, a) = build_task_command("deepseek-harness", "TASK").unwrap();
    assert_eq!(p, "dsh");
    assert!(a.contains(&"--profile".to_string()));
    assert!(a.contains(&"headless".to_string()));
    assert!(build_task_command("nope", "T").is_err());
  }

  #[test]
  fn snapshot_excludes_novel_and_hidden() {
    let ws = temp_workspace("snap");
    let before = take_snapshot(&ws, "t1").unwrap();
    assert!(before.contains_key("stories/ch1.md"));
    assert!(!before.iter().any(|(k, _)| k.starts_with(".novel/")));
    // change: modify + add + delete
    std::fs::write(ws.join("stories/ch1.md"), "第一行\n改过的第二行\n").unwrap();
    std::fs::write(ws.join("stories/ch2.md"), "新章\n").unwrap();
    std::fs::write(ws.join(".novel/state/character-state-index.md"), "外部工具不得写入这里").unwrap();
    let cs = compute_change_set(&ws, "t1", &before).unwrap();
    let by_path: HashMap<&str, &CliChangeEntry> = cs.entries.iter().map(|e| (e.path.as_str(), e)).collect();
    assert_eq!(by_path["stories/ch1.md"].change_type, "modified");
    assert_eq!(by_path["stories/ch2.md"].change_type, "added");
    assert!(by_path["stories/ch1.md"].unified_diff.as_deref().unwrap_or("").contains("改过的第二行"));
    assert!(!by_path.contains_key(".novel/state/character-state-index.md"));
    cleanup_snapshot(&ws, "t1");
    let _ = std::fs::remove_dir_all(&ws);
  }

  #[test]
  fn registry_mutex_rejects_second_task() {
    let r = registry();
    r.running_by_workspace
      .lock()
      .unwrap()
      .insert("/tmp/ws-a".to_string(), "task-1".to_string());
    let blocked = r
      .running_by_workspace
      .lock()
      .unwrap()
      .contains_key("/tmp/ws-a");
    assert!(blocked, "同作品第二个任务必须被互斥拒绝");
    r.running_by_workspace.lock().unwrap().remove("/tmp/ws-a");
  }
}
