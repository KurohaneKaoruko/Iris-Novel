# 设计：液态玻璃视觉语言

## 背景与约束

- 双端共用同一套前端：桌面端（Tauri）与浏览器端（iris-novel-server）视觉必须一致。
- 不做组件大搬家：以「重定义令牌 + 壳层样式覆盖 + 新增组件」的方式落地，控制回归风险。
- 性能优先：动画只使用 `transform`/`opacity`；滚动联动用 rAF 节流；模糊点数量受控（避免大面积实时 backdrop-filter 叠加造成低端机掉帧）。
- 可访问性：`prefers-reduced-motion` 与既有 `data-motion="reduced"` 时关闭非必要动效。

## D1. 设计令牌方案

在 `App.css` 的 `:root`（深色默认）与 `[data-theme="light"]` 重写色板：

- 基色：`--bg-primary: #14161f` 系（深蓝灰），表面三级 `--surface-1/2/3` 依次提亮；
- 发丝边框：`--border-subtle: rgba(255,255,255,.07)`，强调边框 `rgba(255,255,255,.14)`；
- 状态色改为低饱和但可辨识（成功 #4 系、警告琥珀、危险珊瑚红）；
- 圆角升级：`--radius-sm: 8px / md: 12px / lg: 16px / xl: 22px / pill: 999px`；
- 投影升级：多层柔和黑影（карт 8/24、float 18/50）；
- 动效令牌：`--ease-out: cubic-bezier(.22,1,.36,1)`、`--dur-fast: 140ms / med: 240ms / slow: 420ms`；
- 新增玻璃令牌：`--glass-bg`（半透明表面）、`--glass-border`、`--glass-blur`、`--glass-highlight`（顶部 1px 亮线）。

新玻璃基元类：`.glass-panel`（面板）、`.glass-float`（悬浮条/胶囊），统一包含 `backdrop-filter: blur(var(--glass-blur)) saturate(160%)` 与 `-webkit-` 前缀（WebKitGTK/Safari）。

## D2. 自定义窗口边框

- `tauri.conf.json` 窗口 `decorations: false`；标题栏组件 `TitleBar` 高度 40px。
- 拖拽：`data-tauri-drag-region` 属性 + 背景 `onMouseDown` 调 `getCurrentWindow().startDragging()` 双保险；双击切换最大化。
- 控制按钮：最小化 / 最大化还原 / 关闭，调用 Tauri v2 window API；浏览器端 `isTauriApp()` 为 false 时不渲染按钮（保留头部品牌区与居中标题）。
- 右侧预留操作区：刷新/设置等既有顶部动作迁移进标题栏右侧（若有冲突则保留原位）。

## D3. 书架封面流（Coverflow）

**布局数学**（每帧仅写 CSS 变量，不触发重排）：

- 条目定位：绝对定位水平排列，条目间距 `gap = 48px`，聚焦条目滚动至视口中心；
- 对每个条目计算 `d = (itemCenter - viewportCenter) / viewportWidth`，做 clamp；
- `scale = lerp(1.0 → 0.62, |d|)`、`translateY = lerp(0, 26px, |d|)`（参考图中两侧卡片略低）、`opacity = lerp(1 → 0.35, |d|)`、`zIndex = round((1-|d|)*10)`；
- 透视：容器 `perspective: 1200px`，条目 `rotateY(±6deg * d)` 制造参考图的扇形感。

**交互**：

- 拖动：pointerdown/move 计算 scrollLeft（`scroll-behavior: auto`），释放后按速度惯性由原生滚动接管；
- 滚轮：`deltaY` 映射为水平滚动；
- 键盘：←/→ 切换聚焦条目，Enter 打开作品；
- 吸附：滚动停止 120ms 后 `scrollTo({ behavior: 'smooth' })` 对齐最近条目中心；
- 聚焦变化时顶部信息区（作品名/简介/统计）淡入同步更新。

**程序化封面**：`coverArt.ts` 提供 `coverFor(title)`：FNV-1a 哈希 → 两组色相 → `linear-gradient(155deg, hsl(h1 42% 32%), hsl(h2 48% 16%))` + 叠加两层径向光斑 + 大号标题首二字 + 细噪点（CSS 渐变矩阵）；同标题恒定输出（可单测）。封面区比例 3:4，圆角 `--radius-lg`，内描边高光。

**动作卡**：流首「新建作品」（+ 图标，点击弹玻璃对话框输入名称/简介）、流尾「导入作品 / 按路径打开」（桌面端调原生目录选择，浏览器端输入路径）。原页面的创建表单、手动路径表单改为玻璃对话框，不再占据主视觉。

**功能保留**：最近作品与外部作品合并展示（角标区分）；卡片悬浮层提供「打开 / 简介编辑 / 忘记」（外部作品）操作，语义与现状一致。

## D4. 工作台壳层

- 活动栏：窄化视觉重量（半透明底 + 图标药丸高亮）；侧栏/右栏玻璃化，与内容区之间用发丝分隔线而非硬边框。
- 编辑区：`.novel-editor` 内容列最大宽度 780px 居中（长文写作舒适），标签栏玻璃化。
- 状态条：改为悬浮胶囊（`position: absolute; bottom: 14px; 居中`），玻璃底，含保存状态/字数/分栏切换/主题入口；编辑内容区补底部安全间距防止遮挡。
- FAB：右下悬浮圆形按钮，展开玻璃菜单（新建章节/保存/导出/沉浸模式）。
- 弹窗：统一玻璃壳（遮罩 `rgba(8,10,16,.5)` + blur 8px，面板玻璃 + xl 圆角 + float 投影）。

## D5. 动效库

- 转场：书架↔工作台 `opacity + scale(.985→1)` 420ms `--ease-out`；
- 卡片：hover `translateY(-4px)` + 投影加深；聚焦封面额外泛光；
- 面板：侧栏/右栏宽度过渡 240ms；弹窗 `scale(.96→1) + fade`；
- 全部动效在 `[data-motion="reduced"]` 或 `prefers-reduced-motion: reduce` 下退化为瞬时切换。

## R1. 风险与缓解

| 风险 | 缓解 |
|---|---|
| backdrop-filter 在 WebKitGTK 上性能差 | 模糊层限定在壳层与弹窗；内容区不使用实时模糊 |
| decorations:false 后窗口不可拖动 | 双保险（属性 + startDragging()）；Esc 前置检查 |
| Coverflow 在低端设备掉帧 | transform-only 动画；rAF 合并写；条目数 > 60 时降级为普通网格（书架通常 < 30） |
| 令牌重写引发局部对比度回归 | 逐屏截图走查 + 保留 light 主题对照 |
