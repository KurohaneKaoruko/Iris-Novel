use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 拆书分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book拆书Result {
    pub title: String,
    pub author: Option<String>,
    pub source: String, // 来源：原创/同人/大纲等
    
    // 结构分析
    pub structure: Book结构,
    pub plot_arcs: Vec<剧情线>,
    
    // 节奏分析
    pub rhythm: 节奏分析,
    pub climax_points: Vec<高潮点>,
    
    // 爽点分析
    pub 爽点列表: Vec<爽点>,
    
    // 人物分析
    pub characters: Vec<人物分析>,
    pub character_relationships: Vec<人物关系>,
    
    // 世界观
    pub world_settings: Vec<世界设定>,
    pub power_system: Vec<力量体系>,
    
    // 写作技巧
    pub techniques: Vec<写作技巧>,
    
    // 总结
    pub summary: String,
    pub learnable_points: Vec<String>,
}

/// 书籍结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book结构 {
    pub type: String, // 线性/多线/环状/倒叙等
    pub acts: Vec<幕>,
    pub pacing: String, // 快节奏/中等/慢节奏
    pub audience: String, // 目标读者
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 幕 {
    pub id: usize,
    pub name: String, // 铺垫/发展/高潮/结局
    pub chapters: Vec<usize>,
    pub description: String,
}

/// 剧情线
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 剧情线 {
    pub name: String,
    pub main: bool,
    pub chapters: Vec<usize>,
    pub description: String,
}

/// 节奏分析
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 节奏分析 {
    pub average_chapter_length: usize, // 平均章节字数
    pub conflict_density: String, // 冲突密度：高/中/低
    pub turning_points: Vec<转折点>,
    pub chapter_hooks: Vec<String>, // 章尾钩子类型
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 转折点 {
    pub chapter: usize,
    pub type: String, // 重大转折/小高潮/意外等
    pub description: String,
}

/// 高潮点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 高潮点 {
    pub chapter: usize,
    pub type: String, // 战斗/情感/揭秘等
    pub intensity: u8, // 1-10
    pub description: String,
}

/// 爽点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 爽点 {
    pub chapter: usize,
    pub type: String, // 打脸/逆袭/开后宫/系统奖励等
    pub description: String,
    pub frequency: String, // 出现频率
}

/// 人物分析
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 人物分析 {
    pub name: String,
    pub role: String, // 主角/反派/配角/工具人
    pub archetype: String, // 人设原型
    pub growth: String, // 成长曲线
    pub main_moments: Vec<String>, // 高光时刻
    pub relationships: Vec<String>, // 与其他人物的关系
}

/// 人物关系
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 人物关系 {
    pub from: String,
    pub to: String,
    pub type: String, // 敌人/恋人/兄弟/师徒等
    pub description: String,
}

/// 世界设定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 世界设定 {
    pub name: String,
    pub category: String, // 地理/势力/物品/规则等
    pub importance: String, // 核心/重要/辅助
    pub description: String,
}

/// 力量体系
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 力量体系 {
    pub name: String,
    pub levels: Vec<String>, // 等级划分
    pub cultivation_method: String, // 修炼方式
    pub resources: Vec<String>, // 资源/道具
}

/// 写作技巧
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct 写作技巧 {
    pub category: String, // 叙事/对话/描写/节奏等
    pub technique: String,
    pub example: String,
    pub application: String, // 如何应用
}

/// 拆书配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book拆书Config {
    pub target_words_per_chapter: usize,
    pub analyze_rhythm: bool,
    pub analyze_climax: bool,
    pub analyze_爽点: bool,
    pub extract_characters: bool,
    pub extract_world: bool,
    pub extract_techniques: bool,
}

impl Default for Book拆书Config {
    fn default() -> Self {
        Self {
            target_words_per_chapter: 3000,
            analyze_rhythm: true,
            analyze_climax: true,
            analyze_爽点: true,
            extract_characters: true,
            extract_world: true,
            extract_techniques: true,
        }
    }
}

impl Book拆书Result {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            author: None,
            source: "未知".to_string(),
            structure: Book结构 {
                type: "待分析".to_string(),
                acts: vec![],
                pacing: "待分析".to_string(),
                audience: "待分析".to_string(),
            },
            plot_arcs: vec![],
            rhythm: 节奏分析 {
                average_chapter_length: 0,
                conflict_density: "待分析".to_string(),
                turning_points: vec![],
                chapter_hooks: vec![],
            },
            climax_points: vec![],
            爽点列表: vec![],
            characters: vec![],
            character_relationships: vec![],
            world_settings: vec![],
            power_system: vec![],
            techniques: vec![],
            summary: String::new(),
            learnable_points: vec![],
        }
    }
}
