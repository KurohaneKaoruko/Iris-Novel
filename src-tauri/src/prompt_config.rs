use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct AgentPromptConfig {
  pub builtin_workflow_appendix: String,
  pub runtime_prompt_template: String,
  pub mode_auto_apply: String,
  pub mode_review: String,
}

const AGENT_PROMPTS_RAW: &str = include_str!("../config/agent_prompts.toml");
static AGENT_PROMPTS: OnceLock<AgentPromptConfig> = OnceLock::new();

pub fn agent_prompts() -> &'static AgentPromptConfig {
  AGENT_PROMPTS.get_or_init(|| {
    toml::from_str(AGENT_PROMPTS_RAW)
      .unwrap_or_else(|e| panic!("parse agent prompt config failed: {e}"))
  })
}

/// 内置 AI 的默认系统提示词：小说创作特化规范。
/// 只描述写作纪律（视角/文风/结构/设定一致性/伏笔回收/纯 Markdown 正文），
/// 不包含任何命令执行、shell、系统操作类引导。
pub const DEFAULT_NOVEL_SYSTEM_PROMPT: &str = r#"你是深耕本作品的小说创作助手，一切产出服务于这部小说的正文与资料。

## 视角一致性
- 全程遵守既定叙事视角（第一人称/第三人称限知/全知），不擅自切换。
- 限知视角下只呈现视角人物可感知的信息，不泄露其未知内容。

## 文风统一
- 延续本书既有的语言风格、节奏与用词习惯，参考已发布章节。
- 对话符合人物的身份、性格与语言习惯，杜绝千人一面。

## 章节结构（起承转合）
- 起：简要承接上文，自然入题，不复述前情。
- 承：推进主线冲突，张弛有度。
- 转：制造关键转折、冲突升级或情感落点。
- 合：收束本章并留下钩子（悬念/期待/新问题）。

## 设定一致性
- 人物性格、能力、关系、立场不得与既有设定矛盾；若发现冲突，以设定资料为准并提出修正建议。
- 时间线、地理、规则体系前后一致；新增设定须与旧设定兼容并回写资料。
- 伏笔有设必有收：埋设时登记到 `.novel/state/foreshadow-index.md`，回收时标记闭环。
- 人物状态变化（受伤、情感、关系、所在地）须同步到 `.novel/state/character-state-index.md`。

## 输出格式
- 仅输出纯 Markdown 正文或资料内容，不输出与创作无关的解释性文字。
- 章节正文写入 `stories/`（可用 novel_write_chapter），设定与大纲分别写入 `concept/`、`outline/`。
- 你的职责仅限写作：规划、起草、修改、维护一致性；不做任何与创作无关的任务。"#;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_prompt_is_novel_specialized() {
    let p = DEFAULT_NOVEL_SYSTEM_PROMPT;
    assert!(p.contains("视角"), "must cover viewpoint consistency");
    assert!(p.contains("文风"), "must cover style consistency");
    assert!(p.contains("起承转合"), "must cover chapter structure");
    assert!(p.contains("设定一致性"), "must cover setting consistency");
    assert!(p.contains("伏笔"), "must cover foreshadowing");
    assert!(p.contains("Markdown"), "must require plain Markdown output");
  }

  #[test]
  fn default_prompt_has_no_command_execution_guidance() {
    let p = DEFAULT_NOVEL_SYSTEM_PROMPT;
    for banned in [
      "exec",
      "shell",
      "bash",
      "terminal",
      "命令行",
      "执行命令",
      "运行命令",
      "系统操作",
      "network",
      "curl",
      "wget",
      "process",
    ] {
      assert!(
        !p.to_lowercase().contains(banned),
        "default prompt must not contain '{banned}' guidance"
      );
    }
  }

  #[test]
  fn prompts_config_parses() {
    let _ = agent_prompts();
  }
}
