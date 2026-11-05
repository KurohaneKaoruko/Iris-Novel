/** 快捷键帮助弹层：? 或 Ctrl+/ 打开 */
import './ShortcutsModal.css'

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: '全局',
    items: [
      ['Ctrl / ⌘ + K 或 P', '命令面板（搜索命令/章节/资料）'],
      ['? 或 Ctrl + /', '快捷键帮助（本面板）'],
      ['Esc', '关闭弹层'],
    ],
  },
  {
    title: '编辑器',
    items: [
      ['Ctrl / ⌘ + S', '保存章节'],
      ['选中文字', '浮出 AI 润色栏与设定快查'],
    ],
  },
  {
    title: '聊天',
    items: [
      ['Enter', '发送消息'],
      ['Shift + Enter', '换行'],
      ['/skill <id> <要求>', '选用写作技能'],
      ['/role <名> / /role off', '进入/退出角色扮演'],
    ],
  },
  {
    title: '对话指令（聊天框输入）',
    items: [
      ['📄 附本章', '把当前章节正文注入对话上下文'],
      ['🎭 角色下拉', '以人物卡身份对话'],
    ],
  },
]

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box shortcuts-box" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>快捷键与指令</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </header>
        <div className="modal-body shortcuts-body">
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcut-group">
              <h3>{g.title}</h3>
              <dl>
                {g.items.map(([k, d]) => (
                  <div key={k} className="shortcut-row">
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
