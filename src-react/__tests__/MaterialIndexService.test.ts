import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import {
  buildMaterialIndex,
  getMaterialIndex,
  parseMaterialFile,
} from '../src/services/MaterialIndexService'

const invokeMock = vi.mocked(callCommand)

const CONCEPT_MD = [
  '---',
  'source: manual',
  '---',
  '## 林秋',
  '',
  '- 身份： 夜行侦探',
  '- 关系： 苏晚（搭档）, 老周（线人）',
  '',
  '沉默寡言，只信证据。',
  '',
  '## 苏晚',
  '',
  '- 身份： 法医',
  '- 关系： 林秋',
].join('\n')

const OUTLINE_MD = ['## 第一幕', '', '- 关联： 林秋', '', '相遇与冲突。'].join('\n')

function mockBackend(opts?: { noCache?: boolean }) {
  const written: Record<string, string> = {}
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_workspace_tree') {
      return {
        name: '', path: '', kind: 'dir',
        children: [
          { name: 'concept', path: 'concept', kind: 'dir', children: [
            { name: '人物.md', path: 'concept/人物.md', kind: 'file' },
          ] },
          { name: 'outline', path: 'outline', kind: 'dir', children: [
            { name: '主线.md', path: 'outline/主线.md', kind: 'file' },
          ] },
        ],
      }
    }
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (p === 'concept/人物.md') return CONCEPT_MD
      if (p === 'outline/主线.md') return OUTLINE_MD
      if (p === '.novel/index/material-index.json') {
        if (opts?.noCache) throw new Error('not found')
        return written[p] ?? 'not-a-valid-json{'
      }
      throw new Error(`unexpected read: ${p}`)
    }
    if (command === 'write_text') {
      written[String(args?.relativePath)] = String(args?.content ?? '')
      return undefined
    }
    throw new Error(`unexpected: ${command}`)
  })
  return written
}

describe('parseMaterialFile', () => {
  it('splits sections by headings and extracts attributes and relations', () => {
    const entries = parseMaterialFile('concept/人物.md', CONCEPT_MD)
    expect(entries).toHaveLength(2)
    const lin = entries[0]
    expect(lin.title).toBe('林秋')
    expect(lin.kind).toBe('character')
    expect(lin.attributes['身份']).toBe('夜行侦探')
    expect(lin.relations).toEqual(['苏晚', '老周'])
    expect(lin.body).toContain('沉默寡言')
    // front matter 的 source: manual 不进 attributes（条目 meta 默认 auto，由缓存层处理）
    const su = entries[1]
    expect(su.title).toBe('苏晚')
    expect(su.relations).toEqual(['林秋'])
  })

  it('file without headings becomes a single entry named after the file', () => {
    const entries = parseMaterialFile('outline/主线.md', '只有一段正文。\n- 关联： 无\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('主线')
    expect(entries[0].attributes['关联']).toBe('无')
  })

  it('ignores files outside concept/ and outline/', () => {
    expect(parseMaterialFile('stories/ch1.md', '# x')).toEqual([])
    expect(parseMaterialFile('plans/a.md', '# x')).toEqual([])
  })
})

describe('material index build & cache', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('builds index from source files and writes cache (missing cache rebuilds)', async () => {
    const written = mockBackend({ noCache: true })
    const index = await buildMaterialIndex()
    expect(index.entries.map((e) => e.title)).toEqual(['林秋', '苏晚', '第一幕'])
    expect(written['.novel/index/material-index.json']).toContain('"林秋"')

    // 缓存缺失时 getMaterialIndex 也能重建
    const viaGet = await getMaterialIndex()
    expect(viaGet.entries).toHaveLength(3)
  })

  it('corrupted cache falls back to rebuild without failing', async () => {
    mockBackend() // read cache 返回 'not-a-valid-json{' -> parseCache null
    const index = await getMaterialIndex()
    expect(index.entries).toHaveLength(3)
  })

  it('locked/manual cached entries survive rebuild', async () => {
    const written = mockBackend({ noCache: true })
    await buildMaterialIndex()

    // 模拟用户手动改缓存：把林秋标记为 manual + locked，改名
    const cached = JSON.parse(written['.novel/index/material-index.json'])
    cached.entries[0].meta = { source: 'manual', locked: true }
    cached.entries[0].title = '林秋（手改）'
    written['.novel/index/material-index.json'] = JSON.stringify(cached)
    // 让下次读缓存命中新内容（mock 直接读 written）
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'list_workspace_tree') {
        return {
          name: '', path: '', kind: 'dir',
          children: [
            { name: 'concept', path: 'concept', kind: 'dir', children: [
              { name: '人物.md', path: 'concept/人物.md', kind: 'file' },
            ] },
            { name: 'outline', path: 'outline', kind: 'dir', children: [
              { name: '主线.md', path: 'outline/主线.md', kind: 'file' },
            ] },
          ],
        }
      }
      if (command === 'read_text') {
        const p = String(args?.relativePath ?? '')
        if (p === 'concept/人物.md') return CONCEPT_MD
        if (p === 'outline/主线.md') return OUTLINE_MD
        if (p === '.novel/index/material-index.json') return written[p]
        throw new Error('unexpected')
      }
      if (command === 'write_text') {
        written[String(args?.relativePath)] = String(args?.content ?? '')
        return undefined
      }
      throw new Error('unexpected')
    })

    const rebuilt = await buildMaterialIndex()
    const lin = rebuilt.entries.find((e) => e.id.startsWith('character:concept/人物.md:'))!
    expect(lin.title).toBe('林秋（手改）')
    expect(lin.meta.locked).toBe(true)
    // 其他条目仍来自源文件
    expect(rebuilt.entries.find((e) => e.title === '苏晚')).toBeTruthy()
  })
})
