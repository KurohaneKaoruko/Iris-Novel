import { describe, expect, it } from 'vitest'
import { lintChapter, maskWhitelistWords } from './lint'

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

  it('段尾总结句行号为 1-based（回归：文件无尾部空行时行号偏差）', () => {
    // 两段连续总结句、无尾部空行：第 2 段末行是全文第 3 行
    const content = '他知道这事没完。\n\n她知道不能回头。'
    const issues = lintChapter(content)
    const hit = issues.find(i => i.rule === '段尾总结句')
    expect(hit).toBeDefined()
    expect(hit?.line).toBe(3)
  })

  it('白名单遮蔽：白名单词内部的限频命中不计入（回归：白名单恒不生效）', () => {
    // 词表组合演示：白名单「不断」内部不再参与限频统计（等长占位保证行内偏移不变）
    const masked = maskWhitelistWords('他不断顿顿时时。')
    expect(masked).toContain('顿时') // 占位符区域之外不受影响
    expect(masked).not.toContain('不断')

    // 行为级：白名单词被替换为等长占位符，其内部文本不再参与限频统计
    expect(maskWhitelistWords('顿时')).toBe('顿时')
    expect(maskWhitelistWords('知道顿时知道')).toBe('\u0000\u0000顿时\u0000\u0000')
  })

  it('白名单遮蔽不改变其他限频词的正常计数', () => {
    const content = Array.from({ length: 4 }, (_, i) => `他顿时明白了第${i + 1}件事，确实如此。`).join('\n')
    const issues = lintChapter(content)
    const hit = issues.find(i => i.rule === '限频：顿时')
    // 白名单「确实」遮蔽不得影响「顿时」的正常计数
    expect(hit?.count).toBe(4)
  })

  it('干净文本零问题', () => {
    const content = '她把菜单拿反了。\n\n「随便你。」他把碗放下。\n\n门外，脚步声停了一下，又远了。'
    expect(lintChapter(content)).toEqual([])
  })
})
