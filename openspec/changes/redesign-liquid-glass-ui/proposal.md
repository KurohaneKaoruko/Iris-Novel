# 提案：UI 全面重构——液态玻璃视觉语言

## Why

当前界面是 VS Code 风格的经典 IDE 布局：贴边面板、直角边框、灰阶色板，与「小说创作工具」的气质不符，也缺少令人愉悦的视觉层次。用户提供了参考图（深色音乐库界面），要求：

- 深色玻璃质感、流畅丝滑的动效
- 自定义应用边框（自绘标题栏）
- 丝滑的作品查看页（封面流式书架）
- 尽量模仿参考图 UI 风格

## What Changes

1. **设计令牌层重构**：深色主题改为深蓝灰基调 + 玻璃配方（backdrop-blur、半透明表面、发丝边框）+ 大圆角 + 柔和投影 + 统一缓动曲线；浅色主题同步更新匹配。组件结构不变，全部组件经令牌自动获得新视觉。
2. **自定义窗口边框**：桌面端 `decorations: false`，自绘玻璃标题栏（拖拽区、最小化/最大化/关闭），浏览器端降级为同款非交互头部。
3. **封面流书架**：BookshelfPage 重构为参考图式封面流（Coverflow）——聚焦作品居中放大、两侧渐次缩小淡出的 3D 透视排列；程序化生成封面（标题哈希→渐变）；顶部居中显示当前作品信息；拖拽/滚轮/键盘丝滑切换 + 吸附动画；新建/导入以动作卡形式融入流中；保留全部现有功能（启动行为、刷新、导入、创建、忘记外部作品、简介编辑）。
4. **工作台壳层视觉**：活动栏/侧栏/右栏/标签栏/弹窗全面玻璃化与圆角化；编辑区改为居中书写栏；底部状态栏改为悬浮玻璃胶囊；右下新增悬浮动作按钮（快速新建/保存/导出/沉浸）。
5. **动效**：书架↔工作台转场、卡片悬浮提升、面板滑入；尊重 `prefers-reduced-motion` 与现有 `data-motion` 设置。

## Impact

- Affected specs: 新增 `ui-design-system`、`bookshelf-coverflow`、`custom-window-frame` 三个能力
- Affected code:
  - `src-react/src/App.css`（令牌重写 + 壳层样式）
  - `src-react/src/App.tsx`（TitleBar/FAB/悬浮状态条接线）
  - `src-react/src/components/ProjectPickerPage.tsx`（书架重构）
  - 新增 `TitleBar`、`CoverflowShelf`、`coverArt` 工具与对应样式/测试
  - `src-tauri/tauri.conf.json`（`decorations: false`）
- 行为兼容：全部既有功能保持不变；桌面端窗口装饰由自绘替代；浏览器端不受影响
