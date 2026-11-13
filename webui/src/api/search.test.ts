import { describe, expect, it } from 'vitest'
import {
  SEARCH_SCOPES,
  SEARCH_BATCH_SIZE,
  MAX_HITS_PER_FILE,
  MAX_TOTAL_HITS,
  escapeRegExp,
  isValidQuery,
  collectScopeFiles,
  truncateAround,
  splitHighlight,
  matchInContent,
  searchFiles,
  type FsEntryLike,
} from './search'
import type { FsEntry } from './backend'

describe('isValidQuery / escapeRegExp', () => {
  it('空查询与纯空白无效', () => {
    expect(isValidQuery('')).toBe(false)
    expect(isValidQuery('   ')).toBe(false)
    expect(isValidQuery('\n\t ')).toBe(false)
    expect(isValidQuery('剑')).toBe(true)
  })

  it('正则元字符转义为字面量匹配', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c')
    const hits = matchInContent('f.md', 'a.bxc\na.b*c', 'a.b*c')
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(2)
  })

  it('中文查询正常匹配', () => {
    const hits = matchInContent('c.md', '林越拔剑。\n他望向苏晚。', '苏晚')
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(2)
    expect(hits[0].text).toBe('他望向苏晚。')
  })
})

describe('collectScopeFiles（范围收集）', () => {
  const tree: FsEntry = {
    name: 'work',
    path: '',
    kind: 'dir',
    children: [
      {
        name: 'stories',
        path: 'stories',
        kind: 'dir',
        children: [
          { name: 'c2.md', path: 'stories/b.md', kind: 'file' },
          { name: 'c1.md', path: 'stories/a.md', kind: 'file' },
          { name: 'note.txt', path: 'stories/note.txt', kind: 'file' },
          { name: 'img.png', path: 'stories/img.png', kind: 'file' },
        ],
      },
      {
        name: 'concept',
        path: 'concept',
        kind: 'dir',
        children: [{ name: 'characters.md', path: 'concept/characters.md', kind: 'file' }],
      },
      { name: 'outline', path: 'outline', kind: 'dir', children: [{ name: 'v1.md', path: 'outline/v1.md', kind: 'file' }] },
      { name: 'dot', path: '.novel', kind: 'dir', children: [{ name: 'x.md', path: '.novel/x.md', kind: 'file' }] },
      { name: 'root.md', path: 'README.md', kind: 'file' },
    ],
  }

  it('只收集范围内文档文件并排序', () => {
    const files = collectScopeFiles(tree, ['stories', 'concept'])
    expect(files).toEqual(['concept/characters.md', 'stories/a.md', 'stories/b.md', 'stories/note.txt'])
  })

  it('三范围全集不含 .novel 与根目录散文件', () => {
    const files = collectScopeFiles(tree, SEARCH_SCOPES.map((s) => s.id))
    expect(files).toContain('outline/v1.md')
    expect(files).not.toContain('.novel/x.md')
    expect(files).not.toContain('README.md')
  })
})

describe('truncateAround（超长行截断）', () => {
  it('短行原样返回', () => {
    expect(truncateAround('短行', 0, 2)).toBe('短行')
  })

  it('超长行以命中为中心截断并加省略号', () => {
    const line = '前'.repeat(300) + '命中词' + '后'.repeat(300)
    const out = truncateAround(line, 300, 3)
    expect(out.length).toBeLessThanOrEqual(202)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toContain('命中词')
  })

  it('命中靠近行首时左端无省略号', () => {
    const line = '命中词' + 'x'.repeat(500)
    const out = truncateAround(line, 0, 3)
    expect(out.startsWith('命中词')).toBe(true)
    expect(out.startsWith('…')).toBe(false)
  })
})

describe('splitHighlight（高亮切分）', () => {
  it('切分命中段与非命中段', () => {
    const parts = splitHighlight('他说风云变色，果然风云变色了', '风云变色')
    expect(parts).toEqual([
      { text: '他说', hit: false },
      { text: '风云变色', hit: true },
      { text: '，果然', hit: false },
      { text: '风云变色', hit: true },
      { text: '了', hit: false },
    ])
  })

  it('大小写不敏感默认开启', () => {
    const parts = splitHighlight('Sword and sword', 'sword')
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Sword', 'sword'])
  })

  it('大小写敏感开关生效', () => {
    const parts = splitHighlight('Sword sword', 'Sword', true)
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Sword'])
  })

  it('正则元字符按字面量高亮', () => {
    const parts = splitHighlight('a.b xc a.b*c', 'a.b*c')
    expect(parts.filter((p) => p.hit)).toEqual([{ text: 'a.b*c', hit: true }])
  })

  it('空查询返回整段无命中', () => {
    expect(splitHighlight('任意文本', '')).toEqual([{ text: '任意文本', hit: false }])
  })
})

describe('matchInContent（单文件匹配）', () => {
  it('行号 1-based 且带前后上下文', () => {
    const content = ['一', '二', '目标行', '四', '五'].join('\n')
    const hits = matchInContent('f.md', content, '目标', { contextLines: 1 })
    expect(hits[0]).toMatchObject({ line: 3, text: '目标行' })
    expect(hits[0].before).toEqual(['二'])
    expect(hits[0].after).toEqual(['四'])
  })

  it('大小写不敏感为默认', () => {
    const hits = matchInContent('f.md', 'The Sword', 'sword')
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('The Sword')
  })

  it('大小写敏感可关闭不敏感', () => {
    expect(matchInContent('f.md', 'The Sword', 'sword', { caseSensitive: true })).toHaveLength(0)
  })

  it('CRLF 归一化', () => {
    const hits = matchInContent('f.md', '雨夜\r\n便利店目标货架', '目标')
    expect(hits[0].line).toBe(2)
  })

  it('超长命中行截断', () => {
    const long = 'x'.repeat(500) + 'needle' + 'y'.repeat(500)
    const hits = matchInContent('f.md', long, 'needle')
    expect(hits[0].text.length).toBeLessThanOrEqual(202)
    expect(hits[0].text).toContain('needle')
  })

  it('单文件命中数上限（防刷屏）', () => {
    const content = Array.from({ length: 50 }, (_, i) => `重复命中 ${i}`).join('\n')
    const hits = matchInContent('f.md', content, '命中')
    expect(hits).toHaveLength(MAX_HITS_PER_FILE)
    expect(hits[MAX_HITS_PER_FILE - 1].line).toBe(MAX_HITS_PER_FILE)
  })

  it('空查询返回空', () => {
    expect(matchInContent('f.md', '任意', '  ')).toEqual([])
  })
})

describe('searchFiles（分批搜索）', () => {
  const mk = (n: number, hitAt?: number): string[] =>
    Array.from({ length: n }, (_, i) => (hitAt === i ? `命中文件 #${i}` : `文件 ${i} 无命中`))

  it('空查询直接返回不读文件', async () => {
    let reads = 0
    const r = await searchFiles(['a.md', 'b.md'], async () => {
      reads += 1
      return 'x'
    }, ' ')
    expect(r.hits).toEqual([])
    expect(r.scanned).toBe(0)
    expect(reads).toBe(0)
  })

  it('逐文件读取并聚合命中', async () => {
    const files = mk(5, 2)
    const r = await searchFiles(files, async (p) => (p === '命中文件 #2' ? '命中内容' : '空'), '命中')
    expect(r.hits).toEqual([{ path: '命中文件 #2', line: 1, text: '命中内容', before: [], after: [] }])
    expect(r.scanned).toBe(5)
    expect(r.truncated).toBe(false)
    expect(r.cancelled).toBe(false)
  })

  it('按批读取，批间让出主线程', async () => {
    const files = mk(SEARCH_BATCH_SIZE * 2 + 3)
    let reads = 0
    const r = await searchFiles(files, async () => {
      reads += 1
      return ''
    }, '命中', { batchSize: SEARCH_BATCH_SIZE })
    expect(r.scanned).toBe(files.length)
    expect(reads).toBe(files.length)
  })

  it('取消信号中止剩余扫描', async () => {
    const files = mk(200)
    const signal = { cancelled: false }
    let reads = 0
    const r = await searchFiles(files, async () => {
      reads += 1
      if (reads >= SEARCH_BATCH_SIZE) signal.cancelled = true
      return ''
    }, '命中', { batchSize: SEARCH_BATCH_SIZE, signal })
    expect(r.cancelled).toBe(true)
    expect(reads).toBeLessThan(files.length)
  })

  it('达到总命中上限截断', async () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.md`)
    const r = await searchFiles(files, async () => Array.from({ length: 40 }, (_, i) => `命中 ${i}`).join('\n'), '命中', {
      batchSize: 2,
    })
    expect(r.truncated).toBe(true)
    expect(r.hits.length).toBe(MAX_TOTAL_HITS)
  })

  it('读取失败静默跳过（默认）', async () => {
    const r = await searchFiles(['ok.md', 'bad.md'], async (p) => (p === 'bad.md' ? Promise.reject(new Error('io')) : '有命中词'), '命中词')
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].path).toBe('ok.md')
    expect(r.scanned).toBe(2)
  })

  it('onProgress 汇报进度', async () => {
    const files = mk(SEARCH_BATCH_SIZE * 2)
    const prog: number[] = []
    await searchFiles(files, async () => '', 'q', { batchSize: SEARCH_BATCH_SIZE, onProgress: (p) => prog.push(p.scanned) })
    expect(prog).toEqual([SEARCH_BATCH_SIZE, SEARCH_BATCH_SIZE * 2])
  })
})

describe('FsEntryLike（结构化类型兼容）', () => {
  it('accepts plain objects shaped like FsEntry', () => {
    const fake: FsEntryLike = { name: 'x', path: 'stories/x.md', kind: 'file' }
    expect(collectScopeFiles({ name: 'w', path: '', kind: 'dir', children: [fake] }, ['stories'])).toEqual(['stories/x.md'])
  })
})
