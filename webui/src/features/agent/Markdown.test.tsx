// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

const html = (s: string) => renderToStaticMarkup(<Markdown content={s} />)

describe('Markdown 渲染器', () => {
  it('围栏代码块带复制头', () => {
    const out = html('```python\nprint(1)\n```')
    expect(out).toContain('md-codeblock')
    expect(out).toContain('python')
    expect(out).toContain('print(1)')
  })

  it('标题层级', () => {
    const out = html('# 一\n## 二\n### 三')
    expect(out).toContain('md-h1')
    expect(out).toContain('md-h2')
    expect(out).toContain('md-h3')
    expect(out).toContain('一')
  })

  it('行内格式：粗体/斜体/码/链接', () => {
    const out = html('**重要** 和 *次要* 与 `code` 及 [链接](https://x.y)')
    expect(out).toContain('<strong>重要</strong>')
    expect(out).toContain('<em>次要</em>')
    expect(out).toContain('md-code')
    expect(out).toContain('href="https://x.y"')
  })

  it('列表与表格', () => {
    const out = html('- 甲\n- 乙\n\n1. 一\n2. 二\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('md-ul')
    expect(out).toContain('md-ol')
    expect(out).toContain('md-table')
    expect(out).toContain('甲')
    expect(out).toContain('<td>2</td>')
  })

  it('引用与分隔线', () => {
    const out = html('> 引用文本\n\n---')
    expect(out).toContain('md-quote')
    expect(out).toContain('md-hr')
  })

  it('小说正文段落不被误吞（中文连续段落）', () => {
    const novel = '林晚秋推开广播室的门。\n\n台灯的光晕里，磁带还在转。\n\n「你听，」她说，「第七遍的时候，声音变了。」'
    const out = html(novel)
    expect((out.match(/md-p/g) ?? []).length).toBe(3)
    expect(out).toContain('林晚秋推开广播室的门。')
  })

  it('XSS：脚本标签转义', () => {
    const out = html('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('XSS：链接协议白名单（回归 javascript:/data: 注入）', () => {
    // javascript: 伪协议降级为 #，不再可执行
    const js = html('[点我](javascript:alert(1))')
    expect(js).not.toContain('javascript:')
    expect(js).toContain('href="#"')

    // data: URL 同样拦截
    const data = html('[点我](data:text/html;base64,PHNjcmlwdD4=)')
    expect(data).not.toContain('href="data:')

    // 相对路径无协议分隔符，保持原样（应用内锚点/文件链接）
    const rel = html('[说明](README.md)')
    expect(rel).toContain('href="README.md"')

    // 白名单协议正常保留
    expect(html('[官网](https://example.com)')).toContain('href="https://example.com"')
    expect(html('[邮箱](mailto:a@b.c)')).toContain('href="mailto:a@b.c"')

    // 大小写/空白混淆绕过也被拦截
    const obfuscated = html('[点我](  JaVaScRiPt:alert(1) )')
    expect(obfuscated).not.toContain('javascript:')
  })
})
