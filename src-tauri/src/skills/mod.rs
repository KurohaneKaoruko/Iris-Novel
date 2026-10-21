use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Skill 定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub category: String,
    pub enabled: bool,
}

/// 从 SKILL.md 的 YAML frontmatter 解析 name/description。
/// frontmatter 形如：
/// ```yaml
/// ---
/// name: novel-craft
/// description: ……（单行）
/// ---
/// ```
fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let after_open = &trimmed[3..];
    let end = match after_open.find("\n---") {
        Some(idx) => idx,
        None => return (None, None),
    };
    let body = &after_open[..end];
    let mut name = None;
    let mut description = None;
    for line in body.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("name:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !value.is_empty() && name.is_none() {
                name = Some(value);
            }
        } else if let Some(rest) = line.strip_prefix("description:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !value.is_empty() && description.is_none() {
                description = Some(value);
            }
        }
    }
    (name, description)
}

/// SKILL.md 正文（frontmatter 之后的内容），作为 skill 的 prompt。
fn frontmatter_body(text: &str) -> &str {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return text;
    }
    let after_open = &trimmed[3..];
    match after_open.find("\n---") {
        Some(idx) => after_open[idx + 4..].trim_start_matches('\n'),
        None => text,
    }
}

impl Skill {
    pub fn new(id: &str, name: &str, description: &str, category: &str, prompt: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            prompt: prompt.to_string(),
            category: category.to_string(),
            enabled: true,
        }
    }
}

/// 内置 Skill 库
pub fn builtin_skills() -> Vec<Skill> {
    vec![
        // 写作技巧类
        Skill::new(
            "style_wuwei",
            "无为风格",
            "使用无为风格写作：平淡如水的叙事，却暗藏机锋",
            r#"你是一个"无为"风格的作家。你的文字平淡如开水，却在细节处暗藏机锋。
            
写作特点：
- 几乎不做心理描写
- 通过动作和对话展现人物内心
- 环境描写极少
- 情节推进平缓但暗流涌动
- 对话简短，有时前言不搭后语

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 不使用空行"#,
            "写作风格"
        ),
        Skill::new(
            "style_guanzhu",
            "馆zolh风格",
            "使用话唠风格写作：废话流，疯狂输出心理描写和环境描写",
            r#"你是一个"废话流"作家。你的文字像开了闸的水龙头，挡都挡不住。

写作特点：
- 大段大段的心理描写
- 详尽的环境描写（从天空到地面到空气的味道）
- 主角内心OS比弹幕还密集
- 一个简单动作能水500字
- 战斗时会详细描述每一招每一式

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 尽情水"#,
            "写作风格"
        ),
        Skill::new(
            "style_jianjie",
            "简洁风格",
            "使用简洁风格写作：惜字如金，每句都有信息量",
            r#"你是一个简洁风格的作家。每一个字都有它的作用。

写作特点：
- 很少用形容词
- 动作描写为主
- 几乎不写心理
- 对话简短有力
- 场景转换用分隔符

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 用最少的字写最多的信息"#,
            "写作风格"
        ),
        
        // 剧情类
        Skill::new(
            "plot_twist",
            "反转剧情",
            "在剧情中加入意想不到的反转",
            r#"你是一个擅长反转的作家。读者以为猜到了结局，但你总能给他们惊喜。

技巧：
- 提前埋下伏笔，但不明显
- 反转要合理，不能强行
- 反转后要解释清楚为什么
- 一个反转可以，多了会腻
- 反转不等于降智

输出：续写内容，在结尾加入反转"#,
            "剧情技巧"
        ),
        Skill::new(
            "plot_suspense",
            "悬念制造",
            "在章节结尾制造悬念，吸引读者",
            r#"你是一个悬念大师。读者明明已经很累了，明明第二天还要上班，但就是想熬夜看完。

技巧：
- 章节结尾中断关键信息
- 公布一个秘密，但隐藏更重要的问题
- 人物陷入危险但在高潮停止
- 用对比/并列引出悬念

输出：在内容结尾添加悬念"#,
            "剧情技巧"
        ),
        
        // 人物类
        Skill::new(
            "character_dialogue",
            "对话设计",
            "设计符合人物性格的对话",
            r#"你是一个人物对话专家。你写的对话让读者一眼就能认出是谁在说话。

技巧：
- 不同人物用不同的说话方式
- 身份地位影响说话语气
- 心里想的不一定要说出来
- 对话要推动剧情
- 避免废话连篇

根据以下人物设定，设计合适的对话：
- 性格：
- 身份：
- 与对方的关系：
- 当前情绪："#,
            "人物塑造"
        ),
        
        // 完善类
        Skill::new(
            "polish",
            "润色修改",
            "对已有内容进行润色，提升文笔",
            r#"你是文字润色专家。你的任务是让原本平淡的文字变得生动。

润色方向：
- 动词替换：把"走"变成"踏""踩""溜"
- 形容词：增加感官细节
- 删减冗余：去掉废话
- 节奏感：长短句结合
- 画面感：用比喻通感

要求：
- 保持原意
- 不要过度润色
- 保留个人风格"#,
            "完善修改"
        ),
        Skill::new(
            "expand",
            "扩写",
            "对简短内容进行扩写，丰富细节",
            r#"你是扩写专家。你能把一句话变成一段话，把一段话变成一章。

扩写技巧：
- 添加环境描写
- 加入心理描写
- 细化动作
- 增加对话
- 感官细节（视听觉味嗅觉触）

要求：
- 围绕核心内容扩写
- 不要偏离原意
- 扩写部分要自然"#,
            "完善修改"
        ),
        Skill::new(
            "condense",
            "缩写",
            "对冗长内容进行精简",
            r#"你是缩写专家。你能把废话变成干货。

缩写技巧：
- 删除重复信息
- 合并相似内容
- 保留关键信息
- 用一句话代替一段话

要求：
- 保留核心信息
- 保持逻辑连贯
- 不要影响理解"#,
            "完善修改"
        ),
        
        // 创意类
        Skill::new(
            "brainstorm",
            "头脑风暴",
            "针对某个主题进行创意发散",
            r#"你是创意头脑风暴专家。针对给定主题，产出大量创意点子。

方法：
- 自由联想
- 强制关联
- 极端化思考
- 打破常规
- 从多个角度切入

输出格式：
列出10-20个创意点子，每个用1-2句话描述"#,
            "创意生成"
        ),
        Skill::new(
            "outline_gen",
            "大纲生成",
            "根据题材生成小说大纲",
            r#"你是大纲生成专家。

需要信息：
- 题材类型：
- 主角设定：
- 核心冲突：
- 目标字数：

输出结构：
1. 简介（一句话）
2. 主线剧情（3-5个情节点）
3. 支线设定（可选）
4. 人物小传（主角+关键配角）
5. 世界观设定（如果需要）"#,
            "创意生成"
        ),
    ]
}

/// Skill 管理器
pub struct SkillManager {
    skills: HashMap<String, Skill>,
}

/// 已解析的 skills 子模块目录（进程级缓存；目录缺失时为空表）。
static SKILLS_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// 解析技能库目录，优先级：
/// 1. `IRIS_NOVEL_SKILLS_DIR` 环境变量（server / 开发覆盖）
/// 2. 可执行文件旁的 `skills/`（随包分发的子模块）
/// 3. 开发目录回退（target/../skills，即仓库根的 skills 子模块）
fn resolve_skills_dir() -> Option<PathBuf> {
    SKILLS_DIR
        .get_or_init(|| {
            if let Ok(from_env) = std::env::var("IRIS_NOVEL_SKILLS_DIR") {
                let trimmed = from_env.trim().to_string();
                if !trimmed.is_empty() {
                    let path = PathBuf::from(trimmed);
                    if path.is_dir() {
                        return Some(path);
                    }
                }
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(exe_dir) = exe.parent() {
                    // 桌面安装布局：<install>/iris-novel + <install>/skills/
                    let beside = exe_dir.join("skills");
                    if beside.join("novel-craft").is_dir() {
                        return Some(beside);
                    }
                    // 开发布局：<repo>/src-tauri/target/{profile}/iris-novel + <repo>/skills/
                    for ancestor in exe_dir.ancestors().skip(1) {
                        if ancestor.file_name().map(|n| n == "target").unwrap_or(false) {
                            continue;
                        }
                        // ancestor 形如 target/debug 或 target；仓库根是其 parent
                        if let Some(repo_root) = ancestor.parent() {
                            let candidate = repo_root.join("skills");
                            if candidate.join("novel-craft").is_dir() {
                                return Some(candidate);
                            }
                        }
                    }
                }
            }
            None
        })
        .clone()
}

// build.rs 从 skills/ 子模块（Novelist-Skills）内嵌的技能原文
include!(concat!(env!("OUT_DIR"), "/skills_data.rs"));

/// 内嵌技能的懒解析结果（id -> Skill）。
static EMBEDDED_PARSED: OnceLock<Vec<Skill>> = OnceLock::new();

fn embedded_skills() -> &'static [Skill] {
    EMBEDDED_PARSED.get_or_init(|| {
        EMBEDDED_SKILLS
            .iter()
            .filter_map(|(id, text)| {
                let (fm_name, fm_desc) = parse_frontmatter(text);
                let prompt = frontmatter_body(text).trim().to_string();
                if prompt.is_empty() {
                    return None;
                }
                Some(Skill::new(
                    id,
                    &fm_name.unwrap_or_else(|| id.to_string()),
                    &fm_desc.unwrap_or_default(),
                    "Novelist-Skills",
                    &prompt,
                ))
            })
            .collect()
    })
}

/// 从目录扫描加载 SKILL.md 技能（Novelist-Skills 子模块格式）。
/// 目录名即技能 id；frontmatter 提供 name/description，正文即 prompt。
pub fn load_skills_from_dir(dir: &Path) -> Vec<Skill> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path().join("SKILL.md");
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let (fm_name, fm_desc) = parse_frontmatter(&text);
        let name = fm_name.unwrap_or_else(|| dir_name.clone());
        let description = fm_desc.unwrap_or_default();
        let prompt = frontmatter_body(&text).trim().to_string();
        if prompt.is_empty() {
            continue;
        }
        out.push(Skill::new(
            &dir_name,
            &name,
            &description,
            "Novelist-Skills",
            &prompt,
        ));
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

impl SkillManager {
    pub fn new() -> Self {
        let mut manager = Self {
            skills: HashMap::new(),
        };
        // 加载内置 skills
        for skill in builtin_skills() {
            manager.skills.insert(skill.id.clone(), skill);
        }
        // 叠加 Novelist-Skills 子模块：内嵌兜底 + 运行时目录覆盖（id 冲突时后者优先）
        for skill in embedded_skills() {
            manager.skills.insert(skill.id.clone(), skill.clone());
        }
        if let Some(dir) = resolve_skills_dir() {
            for skill in load_skills_from_dir(&dir) {
                manager.skills.insert(skill.id.clone(), skill);
            }
        }
        manager
    }

    #[allow(dead_code)]
    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn get_all(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }

    pub fn get_by_category(&self, category: &str) -> Vec<&Skill> {
        self.skills
            .values()
            .filter(|s| s.category == category && s.enabled)
            .collect()
    }

    pub fn categories(&self) -> Vec<String> {
        let mut cats: Vec<String> = self.skills
            .values()
            .map(|s| s.category.clone())
            .collect();
        cats.sort();
        cats.dedup();
        cats
    }

    #[allow(dead_code)]
    pub fn add(&mut self, skill: Skill) {
        self.skills.insert(skill.id.clone(), skill);
    }

    #[allow(dead_code)]
    pub fn remove(&mut self, id: &str) {
        self.skills.remove(id);
    }

    pub fn apply_skill(&self, skill_id: &str, content: &str) -> String {
        if let Some(skill) = self.skills.get(skill_id) {
            format!("{}\n\n---\n\n{}", skill.prompt, content)
        } else {
            content.to_string()
        }
    }
}

impl Default for SkillManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_name_and_description() {
        let text = "---\nname: novel-craft\ndescription: 写场景与对话\n---\n\n# 场景与对话写作技法\n\n正文内容";
        let (name, desc) = parse_frontmatter(text);
        assert_eq!(name.as_deref(), Some("novel-craft"));
        assert_eq!(desc.as_deref(), Some("写场景与对话"));
        assert_eq!(frontmatter_body(text), "# 场景与对话写作技法\n\n正文内容");
    }

    #[test]
    fn frontmatter_without_fences_falls_back_to_full_text() {
        let text = "# 无 frontmatter 的技能\n\n正文";
        assert_eq!(parse_frontmatter(text), (None, None));
        assert_eq!(frontmatter_body(text), text);
    }

    #[test]
    fn loads_skills_from_directory() {
        let dir = std::env::temp_dir().join(format!("iris-skill-test-{}", std::process::id()));
        let sub = dir.join("novel-test-skill");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            sub.join("SKILL.md"),
            "---\nname: novel-test-skill\ndescription: 测试技能\n---\n\n测试正文",
        )
        .unwrap();

        let skills = load_skills_from_dir(&dir);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "novel-test-skill");
        assert_eq!(skills[0].prompt, "测试正文");
        assert_eq!(skills[0].category, "Novelist-Skills");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn builtin_and_submodule_skills_merge() {
        let manager = SkillManager::new();
        // 内置技能仍在
        assert!(manager.get("style_wuwei").is_some());
        // 子模块技能：内嵌兜底（编译期打包）或运行时目录，二者必有其一
        assert!(
            manager.get("novel-craft").is_some(),
            "novel-craft should load from embedded data or the skills/ dir"
        );
        assert!(
            manager
                .categories()
                .iter()
                .any(|c| c == "Novelist-Skills"),
            "submodule category should be present"
        );
    }
}
