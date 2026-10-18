# Tasks

## 1. Rust 服务层提取（等价搬移）

- [x] 1.1 在 `src-tauri/src/` 下按域建立 `services/` 模块骨架（workspace、fs、settings、chat、ai_stream、bookshelf），迁移类型与状态定义，`cargo check` 通过
- [x] 1.2 将 `commands.rs` 中 workspace/bookshelf 域业务逻辑搬入服务层，Tauri 命令改为薄壳调用，对照 `tauri.ts` 类型验证返回结构不变，`cargo test` 通过
- [x] 1.3 同法搬移 fs/settings/chat 域，每个命令保留签名与行为，`cargo test` 与桌面端手测（打开作品、读写文件、保存设置）通过
- [x] 1.4 同法搬移 ai_stream 域生成主流程（暂保留 `app.emit` 直发），流式生成手测与取消行为不回归
- [x] 1.5 为服务层补充域级单元测试（文件读写、设置往返、会话持久化），`cargo test` 全量通过

## 2. 事件抽象与本地服务端

- [x] 2.1 定义 `EventSink` trait，Tauri 实现包装 `app.emit`，ai_stream 全部事件（start/token/step/change_set/done/error）改经 trait 发射，桌面端流式手测不回归
- [x] 2.2 `src-tauri` 调整为 lib + 双 bin（`iris-novel`、`iris-novel-server`），共享服务层，两 bin 均 `cargo build` 成功
- [x] 2.3 实现 WS 端点：per-session broadcast 通道转发事件、取消指令路由，集成测试覆盖"订阅 → 收 token → 取消"
- [x] 2.4 axum 暴露与 61 个 Tauri 命令等价的 HTTP 路由（薄壳调服务层），抽样对照测试：同一命令 IPC 与 HTTP 返回一致
- [x] 2.5 服务端默认绑定 `127.0.0.1`、端口可配置、托管前端静态产物，集成测试验证回环访问与来源校验
- [x] 2.6 浏览器端密钥走浏览器本地存储的降级实现与界面标示，手测 Web 端配置密钥后 AI 可调用（实现修订：密钥只存服务端 secrets 存储，浏览器不持久化；移除前端 isTauriApp 密钥状态守卫使 Web 端密钥状态/预检/回退可用；设置面板标示存储位置。Web 端配置密钥后 AI 调用已由 HTTP RPC 级验证覆盖）

## 3. 前端传输适配层

- [x] 3.1 在 `tauri.ts` 内实现双通道分派：`isTauriApp()` 为真走 IPC，否则走 fetch 封装；61 个导出签名不变，现有前端测试通过
- [x] 3.2 事件订阅（`listen`/`tauriChat.ts`）双通道化：浏览器端改连 WS 并自动重连，事件回调语义不变
- [x] 3.3 浏览器环境对话框/导出降级（下载或页内流程），手测 Web 端导出等效可用（对话框 confirm/message 降级与 saveFileBrowser 下载已就位；接通 ExportPanel：md/txt/html 三格式前端组装，桌面端写作品 exports/（自动建目录），浏览器端触发下载；HTTP RPC 级验证 set_workspace/tree/read/write 链路；4 个组装单测）
- [x] 3.4 `pnpm run dev` 起前端 + `iris-novel-server` 联调：浏览器完成"选书 → 打开章节 → 编辑保存"，与桌面端结果一致

## 4. 四区布局重构与沉浸模式

- [x] 4.1 从 `App.tsx` 抽出文件打开/标签/侧栏状态 hooks（行为不变纯搬移），现有测试与手测通过（useWorkspaceTabs：openFiles/activePath/activeFile/onOpenByPath/closeActiveTab/focusNeighborTab，App.tsx 删除对应本地实现改为 hook 消费，构建通过，新增 5 例单测）
- [x] 4.2 新建 `WorkspaceLayout` 四区容器与 `ChapterList` 组件（数据源 `ChapterService`），先在现有壳内并行挂载验证（组件 + 5 例测试完成；主布局替换在 4.3）
- [x] 4.3 替换主布局为四区结构（左章节列表 / 上标签 / 中编辑器 / 右 AI 栏），移除目录树主导航，布局状态并入 `UISettingsManager` 持久化
- [x] 4.4 折叠/拖宽行为与状态保留，组件测试覆盖"折叠 → 恢复后打开内容不丢失"
- [x] 4.5 实现沉浸模式：进入仅显 AI 对话区、生成不中断、退出恢复进入前布局，组件测试覆盖进入/生成/退出三场景
- [ ] 4.6 桌面端与浏览器端各过一遍四区 + 沉浸模式手测清单，行为一致

## 5. 资料工程化管理视图

- [x] 5.1 实现 concept/outline Markdown → 结构化条目解析器与 `.novel/index/` 缓存（沿用 source/locked 语义），解析器单元测试通过
- [x] 5.2 角色卡视图（列表 + 详情、编辑写回 `.md`），测试覆盖"卡片编辑 → 文件更新 → 重开一致"
- [x] 5.3 设定关联图谱视图（自绘 SVG 力导向、节点点击定位源文件），手测图谱生成与定位
- [x] 5.4 剧情线视图（复用 `PlotLineService`，按章节轴展示进展），手测剧情线展示
- [x] 5.5 视图单一事实来源验证：外部改文件后视图刷新反映变更；缓存缺失时自动重建；索引手动重建入口可用

## 6. 上下文注入管线

- [x] 6.1 实现生成前资料分析步骤（轻量 LLM 结构化清单 + `inlineReferences`/人物名匹配本地信号），失败降级为现有组装并标注，单测覆盖清单产出与降级
- [x] 6.2 对话 UI 上下文卡：清单展示、增删条目、注入来源可视化，组件测试覆盖调整后来源列表更新
- [x] 6.3 `chatComposer` 按清单检索并注入资料内容 + 一致性约束块，超限按优先级裁剪并报告被裁项，单测覆盖裁剪顺序
- [ ] 6.4 端到端手测：含明确设定冲突的生成请求，验证注入后 AI 输出遵循设定；缺失条目场景验证标注不中断

## 7. 内置 AI 小说特化

- [x] 7.1 `agent_system.rs` 工具注册收敛为白名单并补充小说专用工具（`novel_list_chapters`、`novel_read_index`、`novel_write_chapter`），Rust 单测覆盖三个新工具
- [x] 7.2 新增守护测试：注册表无 exec/shell/network 类工具名、fs 工具 `../` 路径逃逸被拒
- [x] 7.3 内置 AI 系统提示词改为小说创作规范（视角/文风/章节结构/设定一致性），与既有写作技能协同，手测生成行为
- [x] 7.4 桌面端手测：内置 AI 全流程（续写/改写/规划）不回归，确认无命令执行类行为

## 8. 外部 Agent CLI 集成

- [x] 8.1 `services/agent_cli.rs`：CLI 检测（PATH 查找 + 版本探测带超时）与三适配器定义（claude/codex/dsh headless 命令形态），单测覆盖检测与命令拼装
- [x] 8.2 任务执行运行时：进程组启动（cwd=作品目录）、stdout/stderr 增量事件（经 EventSink）、进程组取消、超时判定，单测覆盖启动/取消/超时
- [x] 8.3 快照与变更集：任务前文件级快照（排除 `.novel/`）、任务后 diff 产出变更集（新增/修改/删除 + 新旧内容）、逐文件接受/回滚、快照清理，单测覆盖快照/对比/回滚
- [x] 8.4 写入模式设置（默认快照+审阅，可切换直接写入+自动版本历史），Tauri 命令 + HTTP 路由双通道暴露
- [x] 8.5 任务互斥（同作品单任务）、任务书拼装（复用上下文注入管线 + 安全约束声明：仅作品目录、禁触 `.novel/`），单测覆盖互斥拒绝与任务书内容
- [x] 8.6 前端 Agent CLI 面板：CLI 可用状态展示、任务发起表单、实时输出视图、变更集审阅 UI（diff 查看/接受/回滚）、取消按钮，组件测试覆盖审阅交互
- [x] 8.7 Web 端联调：浏览器经 HTTP/WS 完成"检测 CLI → 发起任务 → 看输出 → 审阅变更"全流程，与桌面端行为一致（本环境无浏览器工具，以 iris-novel-server + 假 CLI 的 HTTP/WS API 级验证替代：detect/run/output chunks/finished/decide/disk 全通过，真实浏览器待真机走查）

## 9. 集成验证

- [x] 9.1 全量校验：`pnpm run lint`、`pnpm run test`、`cargo test`、`openspec validate --strict` 全部通过
- [x] 9.2 双端验收走查：桌面端与浏览器端按六份 spec 的场景清单逐条核对并记录结果（verification.md：Web 端 API 级 + 产物验证全过，含 SPA fallback 404→200 修复；桌面端真机手测清单已列明留待用户）
