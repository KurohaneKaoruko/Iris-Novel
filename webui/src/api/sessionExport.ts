import type { ChatItem } from '../hooks/useChat'

/** 一次性 Markdown 分享稿生成：消息流 + 工具步骤附录 */
export function sessionToMarkdown(opts: {
  workName: string
  messages: ChatItem[]
  exportedAt?: number
}): string {
  const { workName, messages } = opts
  const time = new Date(opts.exportedAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false })
  const out: string[] = [
    `# ${workName} · 会话记录`,
    '',
    `> 导出时间：${time} · ${messages.filter((m) => m.role === 'user').length} 问 ${messages.filter((m) => m.role === 'assistant').length} 答`,
    '',
  ]
  let stepNo = 0
  for (const m of messages) {
    if (m.role === 'user') {
      out.push(`---`, '', `## ❓ ${m.content}`, '')
    } else {
      out.push(`## 💬 回答`, '')
      if (m.failed) {
        out.push(`> ⚠ 本轮失败：${m.failed}`, '')
      }
      if (m.content.trim()) {
        out.push(m.content, '')
      }
      if (m.steps && m.steps.length > 0) {
        out.push('<details><summary>工具调用过程</summary>', '')
        for (const s of m.steps) {
          stepNo += 1
          out.push(`${stepNo}. **${stepName(s.tool)}**（${s.phase}${s.ok === false ? '，失败' : ''}${s.durationMs != null ? `，${s.durationMs}ms` : ''}）`)
          if (s.inputPreview) out.push(`   - 输入：\`${s.inputPreview}\``)
          if (s.observationPreview) out.push(`   - 结果：${s.observationPreview}`)
          if (s.listItems && s.listItems.length > 0) {
            out.push(`   - 列出：${s.listItems.map((it) => `${it.name}${it.kind === 'dir' ? '/' : ''}`).join('、')}`)
          }
          if (s.readPath) out.push(`   - 读取：\`${s.readPath}\``)
          if (s.writePath) out.push(`   - 写入：\`${s.writePath}\``)
        }
        out.push('', '</details>', '')
      }
    }
  }
  return out.join('\n')
}

function stepName(tool: string): string {
  const names: Record<string, string> = {
    fs_list_dir: '浏览目录',
    fs_read_text: '读取文件',
    fs_write_text: '写入文件',
    fs_exists: '检查存在',
    memory_search: '检索记忆',
    memory_upsert: '写入记忆',
  }
  return names[tool] ?? tool
}
