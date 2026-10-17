//! 外部 Agent CLI 集成测试：用假 CLI 可执行文件验证"检测 → 任务 → 快照 → 变更集 → 审阅"全流程。
//!
//! 假 CLI：PATH 中的 `fake-writer` 脚本，在 cwd 内写两个文件（模拟 CLI 直接写作品目录）。

use iris_novel::services::agent_cli::{
    self, CliTaskRequest, decide_change, detect_clis, run_task,
};
use iris_novel::state::AppState;
use std::path::PathBuf;

fn fake_bin_dir() -> PathBuf {
    PathBuf::from("/tmp/opencode/fake-bin")
}

fn path_with_fake_bin() {
    let bin = fake_bin_dir();
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{}", bin.display(), path));
}

fn make_workspace(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("iris-cli-e2e-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("stories")).unwrap();
    std::fs::create_dir_all(dir.join(".novel/state")).unwrap();
    std::fs::write(dir.join("stories/ch1.md"), "# 第一章\n\n旧内容。\n").unwrap();
    dir
}

/// 注入一个以 fake-writer 为后端的"claude"假命令（build_task_command 生成 claude 调用）。
fn install_fake_claude() {
    let dir = fake_bin_dir();
    let _ = std::fs::create_dir_all(&dir);
    let link = dir.join("claude");
    let _ = std::fs::write(
        &link,
        "#!/bin/bash\nexec /tmp/opencode/fake-bin/fake-writer \"$@\"\n",
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&link, std::fs::Permissions::from_mode(0o755));
    }
}

// 两个测试共享 PATH 注入与假命令文件，必须串行执行。
// （vitest/cargo 默认并行；这里用全局锁协防。）
static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn e2e_detect_run_snapshot_review() {
    let _guard = TEST_LOCK.lock().unwrap();
    path_with_fake_bin();
    install_fake_claude();

    // 1. 检测：claude 可用（fake），其余不可用
    let infos = detect_clis().await.unwrap();
    let claude = infos.iter().find(|i| i.id == "claude-code").unwrap();
    assert!(claude.available, "fake claude should be available");

    // 2. 发起任务（审阅模式）
    let ws = make_workspace("e2e");
    let state = AppState::default();
    let task_id = run_task(
        &state,
        CliTaskRequest {
            cli_id: "claude-code".to_string(),
            workspace_root: ws.display().to_string(),
            prompt: "续写两章".to_string(),
            write_mode: Some("review".to_string()),
        },
        "review",
    )
    .await
    .unwrap();

    // 3. 等待任务完成
    let mut finished = None;
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if let Some(t) = agent_cli::get_task(&task_id) {
            if t.state != "running" {
                finished = Some(t);
                break;
            }
        }
    }
    let task = finished.expect("task should finish");
    assert_eq!(task.state, "finished");
    assert!(task.output_tail.contains("fake-writer done"), "output tail should contain CLI output");

    // 4. 变更集：ch1 modified + ch2 added；.novel 不在内
    let cs = task.change_set.expect("change set should exist in review mode");
    let by_path: std::collections::HashMap<&str, &iris_novel::services::agent_cli::CliChangeEntry> =
        cs.entries.iter().map(|e| (e.path.as_str(), e)).collect();
    assert_eq!(by_path["stories/ch1.md"].change_type, "modified");
    assert_eq!(by_path["stories/ch2.md"].change_type, "added");
    assert!(!by_path.contains_key(".novel/state/character-state-index.md"));
    assert!(by_path["stories/ch1.md"].unified_diff.as_deref().unwrap_or("").contains("旧内容"));

    // 5. 接受 ch2，回滚 ch1
    let e = decide_change(&task_id, "stories/ch2.md", true).unwrap();
    assert_eq!(e.decision, "accepted");
    let e = decide_change(&task_id, "stories/ch1.md", false).unwrap();
    assert_eq!(e.decision, "reverted");

    // 6. 磁盘验证：ch1 回滚为旧内容，ch2 保留新内容
    let ch1 = std::fs::read_to_string(ws.join("stories/ch1.md")).unwrap();
    assert!(ch1.contains("旧内容"));
    let ch2 = std::fs::read_to_string(ws.join("stories/ch2.md")).unwrap();
    assert!(ch2.contains("第二章"));

    // 7. 快照已清理（全部决策完成）
    assert!(!ws.join(".novel/snapshots").join(&task_id).exists());

    let _ = std::fs::remove_dir_all(&ws);
}

#[tokio::test]
async fn e2e_mutex_rejects_concurrent_same_workspace() {
    let _guard = TEST_LOCK.lock().unwrap();
    path_with_fake_bin();
    install_fake_claude();

    let ws = make_workspace("mutex");
    let state = AppState::default();

    // 第一个任务（会 sleep 完成，fake-writer 只 0.3s，改用一个慢脚本）
    let slow_dir = fake_bin_dir();
    let _ = std::fs::write(
        slow_dir.join("claude"),
        "#!/bin/bash\nsleep 3\necho done\n",
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(slow_dir.join("claude"), std::fs::Permissions::from_mode(0o755));
    }

    // 用 codex 假命令（慢速），避免与 e2e 主测试的 claude 假命令相互覆盖
    let slow_dir = fake_bin_dir();
    let _ = std::fs::write(
        slow_dir.join("codex"),
        "#!/bin/bash
sleep 3
echo done
",
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(slow_dir.join("codex"), std::fs::Permissions::from_mode(0o755));
    }

    let t1 = run_task(
        &state,
        CliTaskRequest {
            cli_id: "codex".to_string(),
            workspace_root: ws.display().to_string(),
            prompt: "慢任务".to_string(),
            write_mode: Some("review".to_string()),
        },
        "review",
    )
    .await
    .unwrap();

    // 同作品第二个任务必须被拒
    let err = run_task(
        &state,
        CliTaskRequest {
            cli_id: "codex".to_string(),
            workspace_root: ws.display().to_string(),
            prompt: "第二个任务".to_string(),
            write_mode: None,
        },
        "review",
    )
    .await
    .unwrap_err();
    assert!(err.contains("同时只允许一个"), "got: {err}");

    // 取消第一个任务
    agent_cli::cancel_task(&t1).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let t = agent_cli::get_task(&t1).unwrap();
    assert_eq!(t.state, "cancelled");

    let _ = std::fs::remove_dir_all(&ws);
}
