import { describe, expect, it } from 'vitest'
import {
  sanitizeFilename,
  timestampSuffix,
  buildExportFilename,
  stripMarkdown,
  assembleBookTxt,
  assembleDossier,
  sha256Hex,
  isBackupExcluded,
  collectBackupFiles,
  assembleBackupReport,
} from './exportCenter'
import type { Character, CodexEntry, PlotLine } from './novel'

describe('sanitizeFilename', () => {
  it('替换 Windows 非法字符与路径分隔符', () => {
    expect(sanitizeFilename('我的 小说:卷一/末章?')).toBe('我的 小说_卷一_末章_')
    expect(sanitizeFilename('a*b"c<d>e|f\\g')).toBe('a_b_c_d_e_f_g')
  })

  it('保留合法字符并去除首尾空白', () => {
    expect(sanitizeFilename('  clean-name_2  ')).toBe('clean-name_2')
    expect(sanitizeFilename('《书名》')).toBe('《书名》')
  })

  it('空名兜底 untitled', () => {
    expect(sanitizeFilename('')).toBe('untitled')
    expect(sanitizeFilename('  ')).toBe('untitled')
    expect(sanitizeFilename('///')).toBe('untitled')
  })
})

describe('timestampSuffix', () => {
  it('固定时间输出 yyyymmdd-HHmm', () => {
    expect(timestampSuffix(new Date(2026, 0, 5, 7, 8))).toBe('20260105-0708')
    expect(timestampSuffix(new Date(2026, 10, 23, 21, 3))).toBe('20261123-2103')
  })
})

describe('buildExportFilename', () => {
  it('组装「书名-种类-时间戳.扩展名」', () => {
    expect(buildExportFilename('星海', 'book', 'txt', new Date(2026, 0, 2, 3, 4))).toBe('星海-全文-20260102-0304.txt')
    expect(buildExportFilename('星海', 'dossier', 'md', new Date(2026, 0, 2, 3, 4))).toBe('星海-资料册-20260102-0304.md')
    expect(buildExportFilename('', 'backup', 'md', new Date(2026, 0, 2, 3, 4))).toBe('未命名作品-备份清单-20260102-0304.md')
  })
})

describe('stripMarkdown', () => {
  it('剥 frontmatter 与 HTML 注释', () => {
    const src = '---\ntitle: x\n---\n\n正文 <!-- id: c-1 --> 继续\n'
    expect(stripMarkdown(src)).toContain('正文  继续')
    expect(stripMarkdown(src)).not.toContain('title:')
    expect(stripMarkdown(src)).not.toContain('id:')
  })

  it('行级去标题/引用/列表/分隔线', () => {
    const src = '# 一级\n## 二级\n### 三级\n\n> 引用句\n\n- 项目一\n* 项目二\n1. 第一章\n\n---\n\n正文'
    const out = stripMarkdown(src)
    expect(out).not.toMatch(/^#/)
    expect(out).toContain('一级')
    expect(out).toContain('引用句')
    expect(out).toContain('项目一')
    expect(out).toContain('第一章')
    expect(out).not.toMatch(/^---$/m)
  })

  it('行内去粗体/斜体/删除线/行内代码/链接图片', () => {
    const out = stripMarkdown('**粗体** *斜体* ~~划掉~~ `code` [链接文字](http://x) ![图](http://y.png)')
    expect(out).toContain('粗体 斜体 划掉 code 链接文字 图')
    expect(out).not.toContain('**')
    expect(out).not.toContain('http')
  })

  it('连续空行压为一个空行', () => {
    expect(stripMarkdown('甲\n\n\n\n乙')).toBe('甲\n\n乙')
  })

  it('缩进列表保留缩进', () => {
    const out = stripMarkdown('- 外层\n  - 内层')
    expect(out).toContain('外层')
    expect(out.split('\n')[1]).toBe('  内层')
  })
})

describe('assembleBookTxt', () => {
  it('章节标题独立行、正文去 Markdown、空行分隔', () => {
    const txt = assembleBookTxt(
      [
        { title: '第一章 觉醒', content: '# 第一章 觉醒\n\n**林越**睁开眼。\n\n> 天地一片漆黑。' },
        { title: '第二章 入门', content: '## 开场\n\n师父说道：\n\n- 第一件事\n- 第二件事\n' },
      ],
      '测试书',
    )
    const lines = txt.split('\n')
    expect(lines[0]).toBe('《测试书》')
    expect(lines).toContain('第一章 觉醒')
    expect(lines).toContain('第二章 入门')
    // 正文去语法
    expect(txt).toContain('林越睁开眼。')
    expect(txt).toContain('天地一片漆黑。')
    expect(txt).toContain('师父说道：')
    expect(txt).toContain('第一件事')
    expect(txt).not.toContain('**')
    expect(txt).not.toMatch(/^#.*觉醒/m)
    expect(txt.split('\n').filter((l) => l === '第一章 觉醒').length).toBe(1)
    // 章内重复标题被剥
    expect(txt.split('第一章 觉醒').length).toBe(2)
  })

  it('空正文（仅标题）只保留标题行', () => {
    const txt = assembleBookTxt([{ title: '空章', content: '# 空章' }], '书')
    expect(txt.trim()).toBe('《书》\n\n空章')
  })

  it('章内后续小标题降为纯文本行（全篇无 Markdown 井号）', () => {
    const txt = assembleBookTxt([{ title: '第二章', content: '# 第二章\n\n## 场景一\n\n情节推进。' }], '书')
    expect(txt).toContain('场景一')
    expect(txt).toContain('情节推进。')
    expect(txt.split('第二章').length).toBe(2)
  })

  it('无标题章节兜底「未命名章节」', () => {
    const txt = assembleBookTxt([{ title: '', content: '正文' }], '书')
    expect(txt).toContain('未命名章节')
    expect(txt).toContain('正文')
  })
})

describe('assembleDossier', () => {
  const characters: Character[] = [
    {
      id: 'c1',
      name: '林越',
      data: { name: '林越', appearance: '黑发', personality: '外冷内热', background: '', relationships: '与苏晚为师徒', notes: '' },
    },
  ]
  const codex: CodexEntry[] = [
    { id: 'x1', name: '青云宗', type: 'faction', summary: '正道第一', details: '立派千年' },
    { id: 'x2', name: '剑冢', type: 'location', summary: '', details: '' },
  ]
  const plotLines: PlotLine[] = [
    { id: 'p1', name: '复仇线', startChapter: '第 1 章', endChapter: '', status: 'ongoing', description: '灭门之仇' },
  ]

  it('人物/设定/情节线三区合并，类型中文化', () => {
    const md = assembleDossier({ workName: '星海', characters, codex, plotLines })
    expect(md).toContain('# 《星海》资料册')
    expect(md).toContain('## 人物')
    expect(md).toContain('### 林越')
    expect(md).toContain('- **外貌**: 黑发')
    expect(md).toContain('- **性格**: 外冷内热')
    expect(md).toContain('## 设定集')
    expect(md).toContain('### 青云宗')
    expect(md).toContain('- **类型**: 组织')
    expect(md).toContain('### 剑冢')
    expect(md).toContain('- **类型**: 地点')
    expect(md).toContain('## 情节线')
    expect(md).toContain('### 复仇线')
    expect(md).toContain('- **状态**: 进行中')
    expect(md).toContain('- **简介**: 灭门之仇')
  })

  it('人物不携带内部 id 注释', () => {
    const md = assembleDossier({ workName: '星海', characters, codex, plotLines })
    expect(md).not.toContain('id:')
    expect(md).not.toContain('<!--')
  })

  it('空区块整段跳过；全空时只有头部', () => {
    const md = assembleDossier({ workName: '星海', characters: [], codex: [], plotLines: [] })
    expect(md).toContain('# 《星海》资料册')
    expect(md).not.toContain('## 人物')
    expect(md).not.toContain('## 设定集')
    expect(md).not.toContain('## 情节线')
  })

  it('导出统计行计数正确', () => {
    const md = assembleDossier({ workName: '星海', characters, codex, plotLines, exportedAt: 0 })
    expect(md).toContain('人物 1 · 设定 2 · 情节线 1')
  })
})

describe('备份快照报告', () => {
  it('sha256Hex 输出 64 位 hex 且区分不同内容', async () => {
    const a = await sha256Hex('hello')
    const b = await sha256Hex('hello!')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    // 已知向量（UTF-8 "hello"）
    expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('isBackupExcluded 只拦 exports/ 前缀（备份落点），.novel/ 照常纳入', () => {
    expect(isBackupExcluded('exports/书-全文-20260101-0000.md')).toBe(true)
    expect(isBackupExcluded('exports\\backups\\x.md')).toBe(true)
    expect(isBackupExcluded('exports-other/x.md')).toBe(false)
    expect(isBackupExcluded('.novel/.settings/chapters.json')).toBe(false)
    expect(isBackupExcluded('stories/chapter-0001.md')).toBe(false)
  })

  it('collectBackupFiles 收集文件、排除 exports/、按路径排序', () => {
    const tree = {
      path: 'w',
      kind: 'dir',
      children: [
        { path: 'stories', kind: 'dir', children: [{ path: 'stories/chapter-0002.md', kind: 'file' }, { path: 'stories/chapter-0001.md', kind: 'file' }] },
        { path: 'exports', kind: 'dir', children: [{ path: 'exports/old.md', kind: 'file' }] },
        { path: '.novel', kind: 'dir', children: [{ path: '.novel/.settings/chapters.json', kind: 'file' }] },
        { path: 'README.md', kind: 'file' },
      ],
    }
    expect(collectBackupFiles(tree)).toEqual([
      '.novel/.settings/chapters.json',
      'README.md',
      'stories/chapter-0001.md',
      'stories/chapter-0002.md',
    ])
  })

  it('报告含摘要行、分组与逐文件 hash/字数', () => {
    const md = assembleBackupReport({
      workName: '星海',
      createdAt: 0,
      files: [
        { path: 'stories/chapter-0001.md', words: 1200, bytes: 3600, hash: 'a'.repeat(64) },
        { path: 'concept/characters.md', words: 300, bytes: 900, hash: 'b'.repeat(64) },
      ],
    })
    expect(md).toContain('# 《星海》备份快照')
    expect(md).toContain('文件 2 个 · 总字数 1,500 · 总大小 4 KB')
    expect(md).toContain('## concept/')
    expect(md).toContain('- `concept/characters.md` — 300 字 · 1 KB · `bbbbbbbbbbbb…`')
    expect(md).toContain('## stories/')
    expect(md).toContain('- `stories/chapter-0001.md` — 1,200 字 · 4 KB · `aaaaaaaaaaaa…`')
    expect(md).toContain('SHA-256')
  })

  it('空工程输出摘要行', () => {
    const md = assembleBackupReport({ workName: '星海', files: [] })
    expect(md).toContain('文件 0 个 · 总字数 0 · 总大小 1 KB')
  })
})
