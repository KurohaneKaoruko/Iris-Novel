import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import { characterService } from '../src/services/CharacterService'

const invokeMock = vi.mocked(callCommand)

/** 内存文件系统：read_text/write_text 落到 store */
function makeFs(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (!(p in store)) throw new Error('read failed: No such file or directory (os error 2)')
      return store[p]
    }
    if (command === 'write_text') {
      store[String(args?.relativePath)] = String(args?.content ?? '')
      return undefined
    }
    throw new Error(`unexpected: ${command}`)
  })
  return store
}

describe('CharacterService 卡片编辑 → 文件更新 → 重开一致 (5.2)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('create -> update -> reload returns identical state', async () => {
    const store = makeFs()

    // 1. 新建角色（写文件）
    const created = await characterService.createCharacter({
      name: '林秋',
      appearance: '清瘦，常年黑衣',
      personality: '沉默寡言',
    })
    expect(store['concept/characters.md']).toContain('林秋')

    // 2. 编辑卡片（更新文件）
    await characterService.updateCharacter(created.id, {
      personality: '外冷内热，只信证据',
    })

    // 3. 重开（重新 list）与编辑后状态一致
    const reloaded = await characterService.listCharacters()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].id).toBe(created.id)
    expect(reloaded[0].name).toBe('林秋')
    expect(reloaded[0].data.appearance).toBe('清瘦，常年黑衣')
    expect(reloaded[0].data.personality).toBe('外冷内热，只信证据')
  })

  it('external file edits are reflected on reload (single source of truth)', async () => {
    const store = makeFs({
      'concept/characters.md': [
        '# 人物',
        '',
        '## 苏晚 <!-- id: character-su -->',
        '',
        '- **外貌**: 白大褂',
        '- **性格**: 冷静',
        '',
      ].join('\n'),
    })

    const before = await characterService.listCharacters()
    expect(before[0].name).toBe('苏晚')
    expect(before[0].data.personality).toBe('冷静')

    // 外部修改文件（不经服务）
    store['concept/characters.md'] = store['concept/characters.md'].replace('冷静', '缜密而温柔')

    const after = await characterService.listCharacters()
    expect(after[0].data.personality).toBe('缜密而温柔')
  })

  it('delete removes the section from file', async () => {
    const store = makeFs({
      'concept/characters.md': [
        '## 甲 <!-- id: character-a -->',
        '',
        '- **性格**: a',
        '',
        '## 乙 <!-- id: character-b -->',
        '',
        '- **性格**: b',
      ].join('\n'),
    })

    await characterService.deleteCharacter('character-a')
    const rest = await characterService.listCharacters()
    expect(rest.map((c) => c.name)).toEqual(['乙'])
    expect(store['concept/characters.md']).not.toContain('character-a')
  })
})
