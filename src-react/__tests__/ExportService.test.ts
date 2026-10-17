import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => false,
  saveFileBrowser: vi.fn(),
}))

import { callCommand, saveFileBrowser } from '../src/transport'
import { exportWork } from '../src/services/ExportService'
import type { TreeItem } from '../src/services/ExportService'

const invokeMock = vi.mocked(callCommand)
const downloadMock = vi.mocked(saveFileBrowser)

function makeTree(): TreeItem {
  const mk = (name: string, path: string, kind: 'file' | 'dir', children?: TreeItem[]): TreeItem => ({
    name,
    path,
    kind,
    children,
  })
  return mk('', '', 'dir', [
    mk('stories', 'stories', 'dir', [
      mk('ch1.md', 'stories/ch1.md', 'file'),
      mk('ch2.md', 'stories/ch2.md', 'file'),
    ]),
    mk('outline', 'outline', 'dir', [mk('主线.md', 'outline/主线.md', 'file')]),
    mk('concept', 'concept', 'dir', [mk('人物.md', 'concept/人物.md', 'file')]),
  ])
}

/** list_workspace_tree / chapterService.listChapters（经 read_text + 元数据）/ read_text 统一 mock */
function mockBackend() {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_workspace_tree') return makeTree()
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (p === 'stories/ch1.md') return '# 第一章\n\n**雨夜**的街道。\n'
      if (p === 'stories/ch2.md') return '# 第二章\n\n门后的世界。\n'
      if (p === 'outline/主线.md') return '## 主线\n\n三幕结构。\n'
      if (p === 'concept/人物.md') return '## 主角\n\n侦探，三十岁。\n'
      throw new Error(`unexpected read: ${p}`)
    }
    if (command === 'write_text') return undefined
    throw new Error(`unexpected command: ${command}`)
  })
}

// ChapterService.listChapters 会读写 .novel/.settings/chapters.json；
// 这里让它读取 stories 下两个文件。它自身也调 list_workspace_tree，与上面一致。
// read_text 对 .novel 元数据返回不存在会导致 ChapterService 走新建分支——可接受。

describe('exportWork', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    downloadMock.mockClear()
    mockBackend()
  })

  it('exports markdown with title page and appends outline/concept when enabled', async () => {
    const r = await exportWork({
      format: 'md',
      includeOutline: true,
      includeCharacters: true,
      includeMetadata: true,
      title: '测试小说',
    })
    expect(r.downloaded).toBe(true)
    expect(r.fileName).toBe('测试小说.md')
    expect(r.chapterCount).toBe(2)
    const content = downloadMock.mock.calls[0][1] as string
    expect(content).toContain('# 测试小说')
    expect(content).toContain('# 第一章')
    expect(content).toContain('# 第二章')
    expect(content).toContain('# 大纲')
    expect(content).toContain('## 主线')
    expect(content).toContain('# 设定资料')
    expect(content).toContain('## 主角')
  })

  it('strips markdown syntax for txt export', async () => {
    await exportWork({ format: 'txt', includeMetadata: false, includeOutline: false, includeCharacters: false })
    const [name, content] = downloadMock.mock.calls[0]
    expect(name).toMatch(/\.txt$/)
    const text = content as string
    expect(text).not.toMatch(/^#{1,6}\s/m)
    expect(text).toContain('雨夜的街道。') // ** 已去除
  })

  it('builds a complete html document with escaped content', async () => {
    await exportWork({
      format: 'html',
      includeMetadata: true,
      includeOutline: false,
      includeCharacters: false,
      title: '<尖>括号书名',
    })
    const [name, content] = downloadMock.mock.calls[0]
    expect(name).toBe('_尖_括号书名.html') // 非法字符替换
    const html = content as string
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('&lt;尖&gt;括号书名')
    expect(html).toContain('<h2>第一章</h2>')
  })

  it('throws when stories/ is empty', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_workspace_tree') {
        return { name: '', path: '', kind: 'dir', children: [] } as TreeItem
      }
      if (command === 'write_text') return undefined
      throw new Error('unexpected')
    })
    await expect(
      exportWork({ format: 'md', includeMetadata: false, includeOutline: false, includeCharacters: false }),
    ).rejects.toThrow()
  })
})
