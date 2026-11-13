import { describe, expect, it } from 'vitest'
import { findHits, nextHit } from './editorFind'

describe('findHits（命中位置序列）', () => {
  it('中文文本全部命中且位置正确', () => {
    expect(findHits('剑起江湖恩怨，剑落恩怨消。', '恩怨')).toEqual([
      { start: 4, end: 6 },
      { start: 9, end: 11 },
    ])
  })

  it('空 needle 返回空序列', () => {
    expect(findHits('abc', '')).toEqual([])
    expect(findHits('', 'a')).toEqual([])
  })

  it('无命中返回空序列', () => {
    expect(findHits('abc', 'zz')).toEqual([])
  })

  it('重叠命中逐一列出（步进 1）', () => {
    expect(findHits('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
      { start: 2, end: 4 },
    ])
  })

  it('默认大小写不敏感；caseSensitive=true 时区分', () => {
    expect(findHits('Word word WORD', 'word')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ])
    expect(findHits('Word word WORD', 'word', true)).toEqual([{ start: 5, end: 9 }])
  })

  it('命中宽度取原始 needle 长度（大小写折叠不改中文/ASCII 长度）', () => {
    const hits = findHits('AB ab', 'ab', false)
    expect(hits).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ])
  })
})

describe('nextHit（循环导航）', () => {
  const hits = [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
    { start: 10, end: 12 },
  ]

  it('取光标之后的首个命中', () => {
    expect(nextHit(hits, 3, true)).toEqual({ start: 5, end: 7 })
    expect(nextHit(hits, 0, true)).toEqual({ start: 0, end: 2 })
  })

  it('之后没有则回绕到首个', () => {
    expect(nextHit(hits, 10, true)).toEqual({ start: 10, end: 12 })
    expect(nextHit(hits, 11, true)).toEqual({ start: 0, end: 2 })
  })

  it('上一个取光标之前（严格小于）的最后一个命中', () => {
    // 实际 UI 中 current = 当前命中 selectionStart（=hit.start）
    expect(nextHit(hits, 5, false)).toEqual({ start: 0, end: 2 })
    expect(nextHit(hits, 10, false)).toEqual({ start: 5, end: 7 })
  })

  it('之前没有则回绕到最后一个', () => {
    expect(nextHit(hits, 0, false)).toEqual({ start: 10, end: 12 })
    expect(nextHit(hits, 1, false)).toEqual({ start: 0, end: 2 })
  })

  it('空命中序列返回 null', () => {
    expect(nextHit([], 0, true)).toBeNull()
    expect(nextHit([], 0, false)).toBeNull()
  })
})
