# Design

## Context

当前系统为 Tauri v2 桌面应用：前端 `src-react`（React 19 + Lexical）经 `tauri.ts`（637 行、61 个命令封装，含 `isTauriApp()` 判断）以 IPC 调用 Rust 后端 `src-tauri`（`commands.rs` 约 4000 行、61 个命令；AI 流式经 `app.emit("ai_stream_token", ...)` 等 Tauri 事件推送）。`App.tsx` 约 5400 行，承载 IDE 式主布局与大量业务胶水。已有可复用基础：`ChapterService`、`memoryIndex`、`documentSummary`、`inlineReferences`、`chatComposer` 等服务层模块，以及 `.novel/` 索引的 `source: auto/manual`、`locked` 治理语义。动机与目标行为见 proposal.md 与各 spec delta。

## Goals / Non-Goals

**Goals**

- Rust 侧形成可双通道复用的服务层：Tauri IPC 与本地 HTTP/WS 服务共享同一业务逻辑
- 前端经统一传输适配层透明切换 IPC / HTTP+WS，业务组件零感知
- 主布局替换为四区小说式工作区，并交付沉浸模式；桌面与 Web 共用
- 交付角色卡、关联图谱、剧情线三类资料视图，`.md` 仍为唯一事实来源
- 交付"分析 → 注入 → 约束生成"的设定一致性管线

**Non-Goals**

- 不做公网部署 / 多用户账户体系（服务端仅本机服务）
- 不改变作品目录结构与 `.md` 文件格式
- 不实现移动端（Tauri mobile 构建保留，但本变更不验证移动端布局）
- 不引入通用状态管理框架重构全部组件（仅拆分布局所需部分）

## Decisions

### D1. 提取共享服务层，Tauri 命令与 HTTP 路由都是薄壳

将 `commands.rs` 中的业务逻辑提取为 `src-tauri/src/services/`（同名模块按域拆分：workspace、fs、settings、chat、ai_stream、bookshelf）。Tauri `#[tauri::command]` 与 axum handler 仅做参数解析、调用服务、映射响应。

- 备选：axum handler 直接调用现有 command 函数 —— 否决：command 签名耦合 `AppHandle`/`State<T>`，Web 通道无法构造；强行适配会产生双份分支逻辑。
- 后果：一次性搬移约 4000 行逻辑，但以命令签名为契约冻结，行为不变。

### D2. 事件与流式经 `EventSink` 抽象双通道输出

定义 `EventSink` trait（`emit(event, payload)`），Tauri 实现包装 `app.emit`，Web 实现写入 per-session `tokio::sync::broadcast` 通道，由 axum WS 端点转发。AI 流式（`ai_stream_start/token/done`、`ai_agent_step`、`ai_change_set`、`ai_error`）与取消（`chat_cancel_stream`）全部改走该抽象。

- 备选：Web 端轮询 —— 否决：流式 token 轮询体验差且浪费。
- 备选：SSE —— 可行但取消指令与双向代理步骤事件用 WS 更自然，统一单 WS 连接。

### D3. Web 服务以同一 crate 的第二个二进制交付

`src-tauri` 调整为 lib + 双 bin：`iris-novel`（现有 Tauri 应用）与 `iris-novel-server`（headless axum 服务，复用 lib）。服务端默认绑定 `127.0.0.1`，端口默认固定值可配置，启动时输出访问地址；托管前端构建产物（静态目录）。

- 备选：Tauri 应用内嵌 server 随桌面启动 —— 可作为后续增强（LAN 访问场景），首版不做，避免桌面路径复杂化。
- 备选：独立 server crate —— 增加构建编排成本，共享类型收益不明显。

### D4. 前端传输适配层：保持 `tauri.ts` 导出签名不变

`tauri.ts` 中全部 61 个封装函数保持签名与返回类型不变，内部按 `isTauriApp()` 分派：IPC 直走 `invoke`；Web 走 `httpTransport`（fetch 封装）与 `wsEvents`（事件订阅，替代 `listen()`）。事件订阅封装（现有 `tauriChat.ts` 一带）同样双通道化。业务组件不改调用方式。

- 备选：新建独立 API 层、逐步迁移调用点 —— 否决：61 个命令 × 全部组件的迁移面过大且无行为收益。
- 依赖新增：无（fetch 与 WebSocket 为浏览器原生）。

### D5. 主布局拆分：先抽容器，后换结构

`App.tsx` 按现有职责拆出 hooks 与子组件（文件打开状态、AI 侧栏状态、工作区引导等），新 `WorkspaceLayout` 容器承载四区（`ChapterList` / `TabBar`（复用） / 编辑区（复用 LexicalEditor） / `AIPanel`（复用））。章节列表数据源为 `ChapterService`。布局状态（折叠、宽度、沉浸模式）并入现有 `UISettingsManager` 持久化。桌面端直接替换为该布局（用户已确认双端共用）。

- 备选：保留 IDE 布局做模式切换 —— 否决：双布局双维护成本高，且用户明确要求重构。

### D6. 沉浸模式为纯前端布局状态

沉浸模式仅切换 `WorkspaceLayout` 的呈现分支（渲染全屏 AI 对话区），不中断任何服务层活动；进入前布局快照存于组件状态与 UISettings，退出恢复。生成落盘等行为与普通模式共用同一链路，满足布局层"不因收起而中断"的要求。

### D7. 资料视图：解析器 + `.novel/` 索引 + 自绘 SVG 图谱

新增前端解析器将 `concept/`、`outline/` 的 Markdown 解析为结构化条目（沿用 `.novel/` 索引缓存模式与 `source/locked` 语义，缓存文件入 `.novel/index/`）。角色卡为列表 + 详情双栏；关联图谱以自绘 SVG 力导向渲染（作品级节点为几十量级，自绘可控）；剧情线视图复用 `PlotLineService` 数据。

- 备选：引入专业图库（reactflow/cytoscape） —— 暂缓：当前规模自绘足够，避免显著 bundle 增长；解析层与渲染层解耦，后续可替换。

### D8. 上下文注入管线：分析、检索、组装三段式，全部项目侧控制

1. **分析**：生成前用一次轻量 LLM 调用（结构化 JSON 输出：人物/设定/伏笔/前情清单），叠加本地确定性信号（`inlineReferences` 引用解析、当前章节人物名匹配）形成涉及资料清单；
2. **确认**：清单进入对话 UI（上下文卡），用户可增删；
3. **注入**：`chatComposer` 组装请求时按清单检索资料内容（优先级：当前章节 > 清单人物 > 其余设定/前情），以 system 侧"设定一致性约束块"注入；超限按优先级裁剪并向 UI 报告被裁项。
4. **降级**：分析调用失败或超时 → 回退到现有上下文组装（不阻塞生成），UI 标注"未执行一致性分析"。

- 备选：让 AI 通过 agent 工具自取资料 —— 否决：这正是当前"AI 不记得看"的痛点，注入必须由项目确定性完成。

### D9. 外部 Agent CLI 适配器：进程外执行 + 快照/diff 审阅，写入模式可切换

新增 `src-tauri/src/agent_cli.rs`（或 services/agent_cli），定义 `CliAdapter` 内部约定，预置三个适配器，均以 headless 模式运行：

| CLI | 命令形态 | 输出 |
|---|---|---|
| Claude Code | `claude -p "<task>" --output-format json`（cwd=作品目录） | stdout JSON（含 result 文本） |
| Codex CLI | `codex exec "<task>"`（cwd=作品目录） | stdout |
| DeepSeek Harness | `dsh --profile headless "<task>"`（cwd=作品目录） | stdout |

- **任务上下文拼装**：复用 `chatComposer` 同源的小说上下文（设定/大纲/前情/当前章节），生成一段完整任务书（含写作规范、目录结构说明、MUST NOT 触碰 `.novel/` 的约束），作为 prompt 传入 CLI。CLI 的任务书拼装与内置 AI 上下文注入共享同一管线（D8）。
- **写入管控（两种模式可切换，默认快照+审阅）**：
  - *快照+审阅（默认）*：任务启动前对作品目录（不含 `.novel/`）做文件级快照（路径→内容 hash+内容副本存 `.novel/snapshots/<task-id>/`）；CLI 结束后对比快照产出变更集（新增/修改/删除、新旧全文与统一 diff）；用户在 UI 逐文件接受/回滚；全部处理完毕后清理快照。
  - *直接写入*：跳过快照与审阅，CLI 结束后自动刷新文件树并记录一条版本历史快照（复用 `create_history_snapshot`）。
- **进度与取消**：CLI 的 stdout/stderr 增量经 `EventSink`（D2）推送（`agent_cli_output` 事件），UI 实时显示；取消 = kill 进程组（`kill_on_drop(true)` + 进程组），取消后进入变更集审阅（如有改动）。
- **并发**：同一作品同时只允许一个外部 CLI 任务（互斥锁 per-workspace），不同作品互不影响。
- **检测**：`agent_cli_detect` 命令返回各 CLI 是否可用（`which`/PATH 查找 + `--version` 探测，带超时）。
- Web 端通过 HTTP/WS 使用同一能力（CLI 在服务端主机执行）。

备选与否决：
- 备选：MCP 方式集成 —— 否决：三个 CLI 均非 MCP server；项目内 `mcp/mod.rs` 仅是占位类型，首版不扩展。
- 备选：强制每次都走快照审阅 —— 否决：用户明确要求两种模式可切换；默认审阅保守安全。
- 备选：强制直接写入 —— 否决：外部 CLI 无逐条拦截能力，快照+diff 是唯一可靠的审阅手段。

### D10. 内置 AI 小说特化：工具白名单 + 小说专用工具

`agent_system.rs` 的 `ToolRegistry` 收敛为白名单注册制，内置 AI MUST NOT 注册命令执行/网络访问类工具（现状即无此类工具，固化为规范与测试）：

- **保留**：`fs_read_text`、`fs_list_dir`、`fs_exists`、`fs_create_dir`、`fs_create_file`、`fs_delete_entry`、`fs_rename_entry`、`fs_write_text`（全部路径约束在工作区内）+ `memory_upsert`、`memory_search`。
- **新增小说专用工具**：`novel_list_chapters`（章节列表+字数）、`novel_read_index`（人物状态/伏笔索引）、`novel_write_chapter`（`stories/` 下整章写入，带字数统计）。
- **提示词**：系统提示词强调小说创作规范（视角、文风、章节结构、设定一致性），替代通用 agent 自由探索提示词。
- **守护**：新增 Rust 单元测试断言工具注册表不含 `exec/shell/bash/network/http` 类工具名，且 fs 工具路径逃逸测试（`../` 拒绝）保持通过。
- 外部 CLI 与内置 AI 的能力边界：外部 CLI 是用户机器上的独立程序，能力不受 Iris-Novel 限制（因此需要快照审阅）；内置 AI 是项目自身 agent，能力白名单化。

## Risks / Trade-offs

- [App.tsx 拆分引入行为回归] → 拆分以"先移动后修改"两步提交；布局容器先行、行为逻辑不动；`pnpm run test` 全量守护。
- [服务层搬移改变 61 个命令行为] → 以 `tauri.ts` 类型与命令签名为契约；每个域搬移后跑对应测试；Web 通道用同一契约做对照验证。
- [WS 断线导致流式中断] → 前端自动重连 + 会话级任务句柄重挂；断线时 UI 明示状态而非静默失败。
- [注入管线增加生成前延迟（多一次 LLM 分析）] → 分析与本地检索并行；清单按章节缓存复用；分析模型可用低成本配置。
- [Markdown 解析出的图谱/角色卡不准] → 索引支持手动修订与锁定（沿用既有 `source/locked` 语义），一键重建兜底。
- [Web 端密钥安全性] → 密钥只存服务端 secrets 存储（Windows DPAPI 加密），`get_app_settings` 返回前清空密钥字段，浏览器从不持久化密钥；界面标示存储位置；服务端默认仅回环绑定，来源校验。
- [外部 CLI 写坏作品文件] → 默认快照+审阅模式兜底；直接写入模式也自动记录版本历史；`.novel/` 目录对 CLI 任务书声明为禁止触碰。
- [CLI 长时间运行/挂死] → 启动超时与空闲输出超时（stdout 超过 N 分钟无输出判定挂死）可配置；取消走进程组 kill。
- [CLI 未安装或未登录] → `agent_cli_detect` 预检 + 任务启动前二次校验，UI 明确报错而非静默失败。
- [内置 AI 能力被误扩展回通用 agent] → Rust 单元测试固化工具白名单（无 exec/shell/network 类工具名 + fs 路径逃逸防护测试）。

## Migration Plan

按可独立验证的八个阶段推进（详见 tasks.md）：

1. 服务层提取（纯等价搬移，桌面端行为不变）
2. `EventSink` + WS 通道 + `iris-novel-server` 骨架（桌面端仍为主要使用路径）
3. 前端传输适配层（IPC 路径行为不变，Web 通道贯通）
4. 布局拆分与四区重构 + 沉浸模式（双端共用）
5. 资料管理三视图
6. 上下文注入管线
7. 内置 AI 小说特化（工具白名单收敛 + 小说专用工具）
8. 外部 Agent CLI 集成（适配器、快照审阅、UI）

每阶段结束时应用可构建、测试可过；回滚以阶段为单位 revert。

## Open Questions

- 多浏览器会话同时连接服务端编辑同一作品的并发语义（现有 review-first 快照重放可兜底，是否需要会话互斥）——可在实现 web-service 阶段验证后定。
- 服务端口与"开机随桌面应用启动 server"的配置面 —— 首版固定默认值 + CLI 参数，后续按反馈扩展。
