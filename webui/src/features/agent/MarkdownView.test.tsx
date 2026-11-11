// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView, extractToc } from './MarkdownView'

describe('extractToc', () => {
  it('提取 h1-h3 并生成去重锚点', () => {
    const toc = extractToc('# 第一章\n\n## 场景 A\n\n### 细节\n\n## 场景 A')
    expect(toc.map((t) => t.lvl)).toEqual([1, 2, 3, 2])
    expect(toc[0].id).toBe('mdv-toc-第一章')
    expect(toc[3].id).toBe('mdv-toc-场景 A-1') // 重复标题去重
  })

  it('跳过代码块内的 # 注释与 fence 标记', () => {
    const toc = extractToc('# 正文标题\n\n```bash\n# 这不是标题\n```\n\n## 第二章')
    expect(toc.map((t) => t.text)).toEqual(['正文标题', '第二章'])
  })

  it('剥离行内标记字符', () => {
    const toc = extractToc('## **加粗** 与 `码`')
    expect(toc[0].text).toBe('加粗 与 码')
  })
})

describe('MarkdownView 锚点渲染', () => {
  it('标题带 id 供 TOC 跳转', () => {
    const html = renderToStaticMarkup(<MarkdownView content={'# 第一章\n\n正文'} />)
    expect(html).toContain('id="mdv-toc-第一章"')
    expect(html).toContain('mdv-h1')
  })
})
