import { describe, expect, it, vi, beforeEach } from 'vitest'

// parseComposerInput 依赖 ../tauri 的 isTauriApp / parseComposerDirective
vi.mock('../src/tauri', () => ({
  isTauriApp: () => false,
  parseComposerDirective: vi.fn(),
}))

import { parseComposerInput } from '../src/services/chatComposer'

describe('parseComposerInput /skill 指令（本地解析）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('解析 /skill <id> 与剩余正文', async () => {
    const parsed = await parseComposerInput('/skill novel-craft 写一段对话场景')
    expect(parsed.matched).toBe(true)
    expect(parsed.skillId).toBe('novel-craft')
    expect(parsed.content).toBe('写一段对话场景')
    expect(parsed.requestedMode).toBeNull()
  })

  it('/skill 无 id 时 skillId 为 null 且 content 为空', async () => {
    const parsed = await parseComposerInput('/skill')
    expect(parsed.matched).toBe(true)
    expect(parsed.skillId).toBeNull()
    expect(parsed.content).toBe('')
  })

  it('支持中文别名 /技能', async () => {
    const parsed = await parseComposerInput('/技能 novel-prose-standards')
    expect(parsed.matched).toBe(true)
    expect(parsed.skillId).toBe('novel-prose-standards')
  })

  it('技能 id 大小写归一化', async () => {
    const parsed = await parseComposerInput('/skill Novel-Craft 润色')
    expect(parsed.skillId).toBe('novel-craft')
    expect(parsed.content).toBe('润色')
  })

  it('非 /skill 输入不受影响', async () => {
    const plain = await parseComposerInput('直接写正文')
    expect(plain.matched).toBe(false)
    expect(plain.skillId).toBeNull()
    expect(plain.content).toBe('直接写正文')

    const mode = await parseComposerInput('/plan 设计下一卷')
    expect(mode.matched).toBe(true)
    expect(mode.requestedMode).toBe('plan')
    expect(mode.skillId).toBeNull()
  })
})
