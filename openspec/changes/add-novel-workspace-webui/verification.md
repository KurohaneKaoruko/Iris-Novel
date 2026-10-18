# 9.2 双端验收走查记录

日期：2026-10-18
方式：浏览器端经 iris-novel-server API 级 + 静态产物验证（本环境无浏览器工具）；
桌面端 Tauri 行为与服务端共享同一服务层与前端代码，构建/测试全过，
真机手测清单留待用户补做（见文末）。

## Web 服务 spec（web-service）

| 场景 | 结果 |
|---|---|
| 本地服务启动（127.0.0.1 绑定、端口可配） | ✅ `--host/--port` 参数，日志输出监听地址 |
| 静态产物托管 | ✅ `/` 200 text/html，assets js/css 200 |
| SPA fallback（非 API/WS 深路径回退 index.html） | ✅ 修复 not_found_service 状态覆盖后 `/workbench` `/a/b/c` 均 200 + index.html |
| RPC 等价（IPC 与 HTTP 同命令一致） | ✅ 抽样 set_workspace/list_workspace_tree/read_text/write_text/create_dir/get_app_settings 返回结构与 tauri.ts 类型一致 |
| 未知命令 | ✅ `{"err":"unknown command: ..."}` 结构化错误，不 5xx |
| WS 事件转发/取消 | ✅ 此前 8.7 已验（output/finished 事件、取消路由） |
| 来源校验（evil Origin 403） | ✅ `Origin: http://evil.example` → 403 |
| 密钥不泄漏（get_app_settings 清空 api_key） | ✅ providers[].api_key 全为 `""` |

## 小说工作区布局 spec（novel-workspace-layout）

| 场景 | 结果 |
|---|---|
| 四区布局（章节列表/标签/编辑器/AI 栏） | ✅ WorkspaceLayout 组件 + 5 例测试；App.tsx 主布局已替换 |
| 打开作品→章节列表显示章节 | ✅ ChapterList(ChapterService) 组件测试覆盖 |
| 章节点击→编辑器打开+高亮+标签 | ✅ 组件测试（onOpenChapter 路由 onOpenByPath） |
| 新建章节 | ✅ ChapterList 头部 + 按钮（经 onNewChapter） |
| 折叠/展开/拖宽、会话保留 | ✅ 组件测试（折叠→恢复内容不丢）；UISettingsManager 持久化宽度/折叠 |
| 沉浸模式进入（仅 AI 区） | ✅ 组件测试（仅 aiPanelSlot，tabs/editor 不渲染） |
| 沉浸模式生成不中断 | ✅ D6：纯布局分支，服务层流式无感知（ai_stream 未改动） |
| 沉浸模式退出恢复布局 | ✅ 快照恢复 + Esc；组件测试三场景 |

## 资料工程化 spec（material-management）

| 场景 | 结果 |
|---|---|
| 角色卡列表/编辑写回 | ✅ CharacterService 测试（编辑→文件→重开一致） |
| 外部改文件视图同步 | ✅ 三服务测试（外部改 → 重读反映） |
| 图谱生成/节点定位 | ✅ MaterialGraphPanel 测试（SVG 节点/边、点击详情、打开源文件） |
| 剧情线章节轴进展 | ✅ PlotLineService 测试 + PlotLineManager（Gantt 可视化已有） |
| 索引缓存/损坏重建/手动重建 | ✅ MaterialIndexService 测试（损坏降级、locked 保留）；CharacterManager「重建索引」按钮 |

## 上下文注入 spec（ai-context-injection）

| 场景 | 结果 |
|---|---|
| 生成前资料分析产出清单 | ✅ analyzeInjectionPlan 测试（显式引用/名称匹配/关系传导/当前章节） |
| 清单缺失条目标注不中断 | ✅ composeInjectedContext 测试（missing 块内标注） |
| 项目侧确定性注入 | ✅ onSendChat 拼接注入块（模式包装后），不依赖 AI 自主读取 |
| 注入来源可视化 | ✅ ContextInjectionCard（类型/来源/路径 tooltip） |
| 用户调整注入范围 | ✅ 卡片增删（removedKeys 受控，调整作用于下次发送）测试 |
| 超限裁剪并告知 | ✅ 优先级裁剪测试 + trimmed 提示 i18n |
| 端到端设定冲突生成（6.4） | ⏳ 需真机 + 真实模型 API key（清单/注入链路已由上述测试覆盖） |

## 内置 AI 小说特化 spec（novel-specialized-ai）

| 场景 | 结果 |
|---|---|
| 工具白名单（无命令执行/shell/网络） | ✅ 白名单守护测试（7.x 已完成） |
| 小说专用工具 | ✅ novel_list_chapters/novel_read_index/novel_write_chapter |
| 小说创作规范系统提示词 | ✅ prompt_config.rs（视角/文风/章节结构/设定一致性）+ 测试 |

## 外部 Agent CLI spec（external-agent-cli）

| 场景 | 结果 |
|---|---|
| CLI 检测（PATH+版本探测超时） | ✅ 8.1-8.5 cargo 测试（含临时目录 CWD 加固） |
| headless 执行/实时输出 | ✅ 8.7 WS output/finished 事件验证 |
| 快照 diff 审阅/接受/回滚 | ✅ HTTP decide 链路验证 + 前端 AgentCliPanel 测试 |
| 执行互斥 | ✅ cargo 测试 |

## 桌面端真机手测清单（留待用户）

- [ ] 打开作品→四区布局呈现，章节列表正确
- [ ] 点击章节/新建章节/标签切换关闭
- [ ] 折叠左右栏、拖宽、重启后布局保留
- [ ] 沉浸模式进入→AI 生成→Esc 退出恢复
- [ ] 角色卡编辑写回、图谱节点定位、剧情线视图
- [ ] 含设定冲突的生成请求验证注入生效（6.4）
- [ ] Agent CLI 面板检测/执行/审阅全流程
