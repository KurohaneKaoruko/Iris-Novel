import { describe, it, expect } from 'vitest'
import { sessionToMarkdown } from './sessionExport'
import type { ChatItem } from '../hooks/useChat'

const msg = (p: Partial<ChatItem> & { role: 'user' | 'assistant'; content: string }): ChatItem => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  ...p,
})

describe('sessionToMarkdown', () => {
  it('基本结构：标题/统计/问答分节', () => {
    const md = sessionToMarkdown({
      workName: 'test-work',
      messages: [
        msg({ role: 'user', content: '看看目录' }),
        msg({ role: 'assistant', content: '目录结构如下…' }),
        msg({ role: 'user', content: '写第一章' }),
        msg({ role: 'assistant', content: '已完成，见 `stories/chapter-0001.md`' }),
      ],
      exportedAt: new Date('2026-01-15T10:30:00').getTime(),
    })
    expect(md).toContain('# test-work · 会话记录')
    expect(md).toContain('2 问 2 答')
    expect(md).toContain('## ❓ 看看目录')
    expect(md).toContain('## ❓ 写第一章')
    expect(md).toContain('stories/chapter-0001.md')
  })

  it('失败轮次标注警告', () => {
    const md = sessionToMarkdown({
      workName: 'w',
      messages: [msg({ role: 'assistant', content: '', failed: '未配置 API Key' })],
    })
    expect(md).toContain('⚠ 本轮失败：未配置 API Key')
  })

  it('工具步骤渲染为编号列表 + details 折叠', () => {
    const md = sessionToMarkdown({
      workName: 'w',
      messages: [
        msg({ role: 'user', content: 'q' }),
        msg({
          role: 'assistant',
          content: 'done',
          steps: [
            { actionId: 'a1', step: 1, tool: 'fs_list_dir', phase: 'finish', ok: true, durationMs: 12, listItems: [{ name: 'stories', kind: 'dir' }, { name: 'a.md', kind: 'file' }] },
            { actionId: 'a2', step: 2, tool: 'fs_write_text', phase: 'finish', ok: false, writePath: 'stories/ch-1.md' },
          ],
        }),
      ],
    })
    expect(md).toContain('<details><summary>工具调用过程</summary>')
    expect(md).toContain('1. **浏览目录**（finish，12ms）')
    expect(md).toContain('stories/')
    expect(md).toContain('2. **写入文件**（finish，失败）')
    expect(md).toContain('</details>')
  })
})
