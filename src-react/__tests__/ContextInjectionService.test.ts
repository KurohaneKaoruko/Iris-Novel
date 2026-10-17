import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import {
  analyzeInjectionPlan,
  composeInjectedContext,
} from '../src/services/ContextInjectionService'

const invokeMock = vi.mocked(callCommand)

const CONCEPT_MD = [
  '## 林秋',
  '',
  '- 身份： 侦探',
  '- 关系： 苏晚（搭档）',
  '',
  '沉默寡言。',
  '',
  '## 苏晚',
  '',
  '- 身份： 法医',
  '',
  '## 旧城禁区',
  '',
  '- 类型： 世界设定',
].join('\n')

function mockBackend(opts?: { indexFail?: boolean }) {
  const store: Record<string, string> = {
    'concept/人物.md': CONCEPT_MD,
    'stories/ch3.md': '# 第三章\n\n前情内容。',
  }
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_workspace_tree') {
      return {
        name: '', path: '', kind: 'dir',
        children: [
          { name: 'concept', path: 'concept', kind: 'dir', children: [
            { name: '人物.md', path: 'concept/人物.md', kind: 'file' },
          ] },
          { name: 'outline', path: 'outline', kind: 'dir', children: [] },
        ],
      }
    }
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (p in store) return store[p]
      if (p === '.novel/index/material-index.json') {
        if (opts?.indexFail) throw new Error('boom')
        return 'corrupted{'
      }
      throw new Error('not found')
    }
    if (command === 'write_text') return undefined
    throw new Error(`unexpected: ${command}`)
  })
  return store
}

describe('analyzeInjectionPlan (6.1)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('matches mentioned characters by name and propagates relations', async () => {
    mockBackend()
    const plan = await analyzeInjectionPlan({
      requestText: '写林秋调查旧城禁区失踪案的章节',
      currentChapterPath: 'stories/ch3.md',
    })
    const titles = plan.items.map((i) => i.title)
    // 名称命中
    expect(titles).toContain('林秋')
    expect(titles).toContain('旧城禁区')
    // 关系传导：林秋 -> 苏晚
    expect(titles).toContain('苏晚')
    // 当前章节注入
    expect(plan.items.some((i) => i.kind === 'chapter' && i.matchedBy === 'current-chapter')).toBe(true)
    // 优先级：chapter < character < setting
    const chapter = plan.items.find((i) => i.kind === 'chapter')!
    const lin = plan.items.find((i) => i.title === '林秋')!
    expect(chapter.priority).toBeLessThan(lin.priority)
    expect(plan.degraded).toBe(false)
  })

  it('explicit refs take precedence and missing refs are flagged without breaking', async () => {
    mockBackend()
    const plan = await analyzeInjectionPlan({
      requestText: '继续写',
      currentChapterPath: null,
      explicitRefs: ['concept/人物.md', 'concept/不存在.md'],
    })
    const explicit = plan.items.find((i) => i.matchedBy === 'explicit' && i.sourcePath === 'concept/人物.md')
    expect(explicit?.kind).toBe('character')
    const missing = plan.items.find((i) => i.kind === 'missing')
    expect(missing?.sourcePath).toBe('concept/不存在.md')
  })

  it('degrades gracefully when material index cannot be built at all', async () => {
    // list_workspace_tree 也失败 -> 条目匹配无法进行 -> degraded
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'read_text') {
        const p = String(args?.relativePath ?? '')
        if (p === 'stories/ch3.md') return '# 第三章\n\n前情内容。'
        throw new Error('not found')
      }
      throw new Error('boom')
    })
    const plan = await analyzeInjectionPlan({
      requestText: '写林秋的章节',
      currentChapterPath: 'stories/ch3.md',
    })
    expect(plan.degraded).toBe(true)
    expect(plan.degradeReason).toBeTruthy()
    // 降级仍有当前章节
    expect(plan.items.some((i) => i.kind === 'chapter')).toBe(true)
  })
})

describe('composeInjectedContext (6.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    mockBackend()
  })

  it('includes constraint header/footer and orders by priority', async () => {
    const plan = await analyzeInjectionPlan({
      requestText: '林秋去旧城禁区',
      currentChapterPath: 'stories/ch3.md',
    })
    const { contextBlock, included, trimmed } = composeInjectedContext(plan, 100_000)
    expect(contextBlock).toContain('设定一致性约束')
    expect(contextBlock).toContain('MUST')
    expect(included.length).toBeGreaterThan(0)
    expect(trimmed).toHaveLength(0)
    // chapter 排最前
    expect(included[0].kind).toBe('chapter')
  })

  it('trims lowest-priority items first when over budget and reports them', async () => {
    // 手工清单（长度确定）：chapter 短、低优先级条目长
    const plan: import('../src/services/ContextInjectionService').InjectionPlan = {
      degraded: false,
      degradeReason: null,
      items: [
        { key: 'c:1', kind: 'character', title: '人物甲', sourcePath: 'concept/a.md', content: '长'.repeat(600), matchedBy: 'name-match', priority: 1 },
        { key: 'c:2', kind: 'character', title: '人物乙', sourcePath: 'concept/b.md', content: '中'.repeat(120), matchedBy: 'name-match', priority: 1 },
        { key: 's:1', kind: 'setting', title: '设定丙', sourcePath: 'concept/s.md', content: '短'.repeat(30), matchedBy: 'name-match', priority: 2 },
        { key: 'ch:1', kind: 'chapter', title: '当前章', sourcePath: 'stories/c.md', content: '前情', matchedBy: 'current-chapter', priority: 0 },
      ],
    }
    // 预算 = 头尾 + chapter + 设定丙(30)，容不下两个长人物条目
    const budget = 160 + 30 + 40
    const { included, trimmed, contextBlock } = composeInjectedContext(plan, budget)
    expect(included.map((i) => i.key)).toEqual(['ch:1', 's:1'])
    expect(trimmed.map((i) => i.key).sort()).toEqual(['c:1', 'c:2'])
    // 高优先级条目仍在块内，被裁条目不在
    expect(contextBlock).toContain('当前章')
    expect(contextBlock).toContain('设定丙')
    expect(contextBlock).not.toContain('人物甲')
  })

  it('missing items are annotated in block, not silently dropped', async () => {
    const plan = await analyzeInjectionPlan({
      requestText: '写',
      currentChapterPath: null,
      explicitRefs: ['concept/不存在.md'],
    })
    const { contextBlock } = composeInjectedContext(plan, 100_000)
    expect(contextBlock).toContain('缺失条目')
    expect(contextBlock).toContain('concept/不存在.md')
  })
})
