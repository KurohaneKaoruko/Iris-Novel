import React from "react"
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TitleBar } from '../src/components/TitleBar'
import { I18nProvider } from '../src/i18n/I18nProvider'

describe('TitleBar', () => {
  it('浏览器端渲染品牌与上下文标题，不渲染窗口控制按钮', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <TitleBar title="测试小说" />
      </I18nProvider>,
    )
    expect(html).toContain('title-bar')
    expect(html).toContain('Iris-Novel')
    expect(html).toContain('测试小说')
    expect(html).not.toContain('title-bar-controls')
  })

  it('无标题时不渲染上下文节点', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <TitleBar title={null} />
      </I18nProvider>,
    )
    expect(html).not.toContain('title-bar-context')
  })
})
