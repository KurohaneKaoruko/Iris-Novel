# Iris-Creation

本地小说创作 IDE：Tauri v2 + React + Monaco Editor。目标是让“设定/大纲/正文”结构清晰、AI 写作与编辑器深度联动，并把与小说无关的项目文件统一收纳到 `.novel/`。

## 功能概览

- 工作区（Workspace）打开与初始化：自动创建 `concept/`、`outline/`、`stories/` 与 `.novel/`
- 文件树浏览（默认仅展示 `concept/outline/stories`，且只显示 `.md`）
- Monaco 编辑器：多标签、脏标记、保存
- AI 对话面板：
  - 引用编辑器选区
  - AI 输出一键插入到光标/选区
  - 快捷键：Ctrl+Shift+L 聚焦输入；Ctrl+Enter 发送
  - 流式显示（后端事件推送 token）
- 多 Provider：
  - OpenAI 兼容接口（可配置 Base URL / Model）
  - Claude（Anthropic Messages API）
  - 文心一言（按 OpenAI 兼容方式配置）
- 智能体（Agent）：
  - 内置模板（玄幻/科幻/言情）
  - 可编辑/新增/删除/导入导出
  - 对话时自动注入系统提示词并覆盖生成参数
- Git 面板：init/status/diff/commit/log
- 本地会话历史：生成完成后自动保存到应用侧数据目录
- 创作辅助：
  - 章节目标字数（项目级配置）
  - 智能补全：提取光标附近上下文，结合目标字数提示 AI 续写/收尾
- 人物关系图谱：从 `concept/*.md` 抽取并可视化

## 小说项目（Workspace）目录约定（重要）

Iris-Creation 认为“小说本身”只由三个主目录构成，且这三个目录只放 `.md` 文档：

```
<workspace>/
  concept/   # 设定（仅 .md）
  outline/   # 大纲（仅 .md）
  stories/   # 正文（仅 .md）
  .novel/    # 与小说本身无关的项目文件（缓存/索引/项目设置等）
```

### 三个主目录的含义

- concept/：世界观、人物、术语、地点、组织等设定文档
- outline/：章节/事件大纲、时间线等
- stories/：章节正文（建议一章一个文件）

### .novel/ 放什么

`.novel/` 类似 Trae 的 `.trae`、Kiro 的 `.kiro`，用于存放与小说本身无关的项目文件，例如：

- `.novel/.settings/project.json`：项目级设置（如章节目标字数）
- `.novel/.cache/*`：索引/缓存（例如 concept 索引、outline 缓存等）

### 强约束（防止目录污染）

后端会强制限制：`concept/outline/stories` 下只能创建/写入 `.md`。如果尝试写入其它扩展名会直接报错。

## 快速开始（开发）

### 环境依赖（Windows）

- Node.js（建议 18+）
- Rust（stable，含 cargo）
- Visual Studio Build Tools（勾选 Desktop development with C++ / MSVC 工具链）
- WebView2 Runtime（Win10/11 通常已自带；没有请安装 Evergreen Runtime）

### 启动开发模式

```powershell
npm install
npm run tauri:dev
```

说明：`tauri:dev` 会自动先跑前端 dev server（默认端口 1420），再启动 Tauri 桌面壳。

## 构建发行版（安装包）

```powershell
npm install
npm run tauri:build
```

构建产物通常在：

- `src-tauri/target/release/bundle/**`
- 以及裸可执行文件（按平台/配置不同）：`src-tauri/target/release/*.exe`

## 使用指南（UI）

### 打开工作区

1. 顶部输入工作区路径（例如 `D:\\Novels\\MyBook`）
2. 点击“打开”
3. 首次使用 AI 对话（发送消息/智能补全）时，会自动初始化目录结构与模板文档

### 新建章节

- 点击“新建章节”或“开新章”
- 默认创建到：`stories/chapter-YYYYMMDD-HHMM.md`

### AI 面板

- “引用选区”：把当前编辑器选区追加到输入框
- “发送”：发起对话（Ctrl+Enter）
- “插入到光标”：把 AI 输出插入到编辑器当前选区/光标位置
- 快捷键：Ctrl+Shift+L 聚焦 AI 输入框

### 智能补全

- 点击“智能补全”会：
  - 读取光标附近上下文
  - 结合项目配置的章节目标字数
  - 提示 AI 续写/收尾建议

### 人物关系图谱（从 Markdown 抽取）

图谱数据来自两个文件：

- `concept/characters.md`：人物列表（每行 `- 人名`）
- `concept/relations.md`：关系定义（`A -> B : 关系`）

示例：

```md
# Characters

- 林渊
- 白栀
```

```md
# Relations

林渊 -> 白栀 : 盟友
白栀 -> 林渊 : 试探
```

## AI Provider 与智能体配置

在右侧 AI 面板中点击“设置”：

- Provider：OpenAI（兼容）/ Claude / 文心一言（兼容）
- 输出格式：默认纯文本；可开启 Markdown 输出
- 智能体：选择/编辑提示词、温度、MaxTokens；支持导入/导出 JSON

### 设置存储位置（应用侧）

设置与密钥不写入小说工作区（避免污染项目、避免误提交）。

- 应用设置（不含密钥）：AppData 下 `Iris-Creation/settings.json`
- 智能体库：AppData 下 `Iris-Creation/agents.json`
- 会话历史：AppData 下 `Iris-Creation/chat_history.json`

### API Key 安全存储

API Key 使用系统 Keyring 存储（Windows 为 Credential Manager）。应用设置里输入 Key 后会写入安全存储，`settings.json` 中不会保留明文 Key。

## Git 面板

侧边栏 Git 面板支持：

- 初始化仓库（git init）
- 查看变更列表（status）
- 查看单文件 diff（patch）
- 一键提交（默认 stage 全部变更）
- 最近提交历史（log）

## 项目技术栈

- Desktop：Tauri v2（Rust）
- Frontend：React + TypeScript + Vite（rolldown-vite）
- Editor：Monaco Editor
- HTTP：reqwest（Rust）
- Git：git2（Rust）

## 开发脚本

见 `package.json`：

- `npm run tauri:dev`：启动桌面开发模式
- `npm run tauri:build`：构建发行版
- `npm run build`：仅构建前端
- `npm run lint`：ESLint

## License

待定（根据你的开源/闭源选择再补充）。
