// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readDeepLink, writeDeepLink } from './deeplink'

// jsdom-like 环境：直接操作 location.hash
function setHash(h: string) {
  window.location.hash = h
}

describe('deeplink（hash 深链）', () => {
  it('无 hash 时返回空', () => {
    setHash('')
    expect(readDeepLink()).toEqual({ work: null, chapter: null })
  })

  it('写入后可读回（含中文与特殊字符编码）', () => {
    writeDeepLink('/works/测试小说', 'stories/chapter-0001.md')
    const link = readDeepLink()
    expect(link.work).toBe('/works/测试小说')
    expect(link.chapter).toBe('stories/chapter-0001.md')
  })

  it('只有 work 没有 chapter', () => {
    writeDeepLink('/works/a', null)
    expect(readDeepLink()).toEqual({ work: '/works/a', chapter: null })
  })

  it('work 为 null 时清空 hash（回书架）', () => {
    writeDeepLink('/works/a', 'x.md')
    writeDeepLink(null)
    expect(readDeepLink()).toEqual({ work: null, chapter: null })
    expect(window.location.hash).toBe('')
  })
})
