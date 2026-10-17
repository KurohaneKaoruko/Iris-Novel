import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import { plotLineService } from '../src/services/PlotLineService'

const invokeMock = vi.mocked(callCommand)

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

describe('PlotLineService（5.4 数据层：剧情线按章节轴组织）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('create -> update -> reload consistent; file is single source of truth', async () => {
    const store = makeFs()

    const created = await plotLineService.createPlotLine({
      name: '失踪案',
      startChapter: 'chapter-1',
      endChapter: 'chapter-5',
      status: 'ongoing',
      description: '贯穿第一卷的主线',
    })
    expect(store['outline/plotlines.md']).toContain('失踪案')

    await plotLineService.updatePlotLine(created.id, { status: 'completed' })

    const reloaded = await plotLineService.listPlotLines()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].name).toBe('失踪案')
    expect(reloaded[0].status).toBe('completed')
    expect(reloaded[0].startChapter).toBe('chapter-1')
    expect(reloaded[0].endChapter).toBe('chapter-5')

    // 外部修改 → 重读反映（单一事实来源）
    store['outline/plotlines.md'] = store['outline/plotlines.md'].replace('贯穿第一卷的主线', '修订后的主线描述')
    const external = await plotLineService.listPlotLines()
    expect(external[0].description).toBe('修订后的主线描述')
  })

  it('returns empty when outline/plotlines.md missing', async () => {
    makeFs()
    const list = await plotLineService.listPlotLines()
    expect(list).toEqual([])
  })
})
