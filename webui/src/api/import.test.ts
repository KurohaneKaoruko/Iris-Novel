import { describe, expect, it } from 'vitest'
import { cnNumberToArabic, splitIntoChapters, importSummary } from './import'

describe('cnNumberToArabic（中文数字）', () => {
  it('基础与组合', () => {
    expect(cnNumberToArabic('1')).toBe(1)
    expect(cnNumberToArabic('十二')).toBe(12)
    expect(cnNumberToArabic('二十')).toBe(20)
    expect(cnNumberToArabic('一百二十三')).toBe(123)
    expect(cnNumberToArabic('壹佰贰拾叁')).toBe(123)
  })
  it('非数字返回 null', () => {
    expect(cnNumberToArabic('序')).toBeNull()
    expect(cnNumberToArabic('')).toBeNull()
  })
})

describe('splitIntoChapters（智能切章）', () => {
  it('按「第X章 标题」切分', () => {
    const text = [
      '第一章 初入江湖',
      '少年背剑出门。',
      '第二章 雨夜',
      '雨下了整夜。',
      '第十二章 重逢',
      '他们在渡口重逢。',
    ].join('\n')
    const chapters = splitIntoChapters(text)
    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('初入江湖')
    expect(chapters[2].title).toBe('重逢')
    expect(chapters[1].content).toBe('雨下了整夜。')
  })

  it('纯数字序号标题（1、2、3）', () => {
    const text = '1、出发\n清早动身。\n2、遇袭\n山道遇袭。'
    const chapters = splitIntoChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('出发')
  })

  it('Chapter X 英文标题', () => {
    const text = 'Chapter 1 Begin\nGo out.\nChapter 2 Storm\nRain falls.'
    const chapters = splitIntoChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[1].title).toBe('Storm')
  })

  it('无标题整本单章返回', () => {
    const chapters = splitIntoChapters('就是一段没有章节标题的长文本。')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('导入文本')
  })

  it('正文里的「第X章」引用不误切（超长行不算标题）', () => {
    const text = '第一章 出门\n他说：第三章的内容我在书里读过，那是很多年前的事了，这里先按下不表，继续赶路要紧。\n第二章 到站\n车到了。'
    const chapters = splitIntoChapters(text)
    expect(chapters).toHaveLength(2)
  })

  it('importSummary 统计', () => {
    const a = '三个字'
    const b = '六个字啊啊啊'
    const s = importSummary([
      { title: 'a', content: a },
      { title: 'b', content: b },
    ])
    expect(s).toEqual({ count: 2, words: a.length + b.length, min: a.length, max: b.length })
  })
})
