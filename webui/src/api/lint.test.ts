import { describe, expect, it } from 'vitest'
import { lintChapter } from './lint'

describe('lintChapter（正文铁律体检）', () => {
  it('一级套路词报 error 并给行号', () => {
    const issues = lintChapter('第一行正常。\n他嘴角勾起一抹冷笑。\n第三行正常。')
    const hits = issues.filter(i => i.rule.includes('嘴角勾起'))
    expect(hits).toHaveLength(1)
    expect(hits[0].level).toBe('error')
    expect(hits[0].line).toBe(2)
    expect(hits[0].advice).toBeTruthy()
  })

  it('二级限频词超限报 warn 带计数', () => {
    const content = Array.from({ length: 4 }, (_, i) => `他顿时明白了第${i + 1}件事。`).join('\n')
    const issues = lintChapter(content)
    const hit = issues.find(i => i.rule === '限频：顿时')
    expect(hit).toBeDefined()
    expect(hit?.count).toBe(4)
    expect(hit?.limit).toBe(1)
    expect(hit?.level).toBe('warn')
  })

  it('限频内不报', () => {
    const issues = lintChapter('他顿时明白了。缓缓走到门前。')
    expect(issues.find(i => i.rule.startsWith('限频'))).toBeUndefined()
  })

  it('对话标签超限与道系合计', () => {
    const content = Array.from({ length: 3 }, (_, i) => `甲说道：「第${i + 1}句。」乙说道：「回${i + 1}。」`).join('\n')
    const issues = lintChapter(content)
    expect(issues.find(i => i.rule === '对话标签：说道')).toBeDefined()
    expect(issues.find(i => i.rule === '对话标签：道系合计')).toBeDefined()
  })

  it('句式模板与数字装具体', () => {
    const issues = lintChapter('他以一种冰冷的口吻说话。\n沉默了三秒，他开口。\n第无数次，她回到这里。')
    expect(issues.find(i => i.rule === '句式：以一种口吻')).toBeDefined()
    expect(issues.find(i => i.rule === '句式：数字计时')).toBeDefined()
    expect(issues.find(i => i.rule === '数字装具体')).toBeDefined()
  })

  it('段尾总结句连续出现报 info', () => {
    const content = '他知道这事没完。\n\n她知道不能回头。\n\n收尾停在动作上，把门摔上了。'
    const issues = lintChapter(content)
    expect(issues.find(i => i.rule === '段尾总结句')).toBeDefined()
  })

  it('干净文本零问题', () => {
    const content = '她把菜单拿反了。\n\n「随便你。」他把碗放下。\n\n门外，脚步声停了一下，又远了。'
    expect(lintChapter(content)).toEqual([])
  })
})
