/**
 * 正文铁律体检（lint）：纯规则引擎，对齐 Novelist-Skills 的 novel-ai-lexicon 特征库。
 * 分级：error（一级套路，出现即改写）/ warn（二级限频，密度失控）/ info（句式模板与结构提示）。
 * 白名单词不报。结果带行号与上下文，供 UI 定位。
 */

export type LintLevel = 'error' | 'warn' | 'info'

export type LintIssue = {
  rule: string
  level: LintLevel
  /** 1-based 行号（编辑器把每行都渲染为一个段落，行号即段落序号，可直接定位） */
  line: number
  /** 命中文本（截断展示） */
  snippet: string
  /** 修改建议 */
  advice: string
  /** 词/模式本身（用于替换建议） */
  match?: string
  /** 二级限频：章内实际次数与上限 */
  count?: number
  limit?: number
}

// 一级套路词：出现即改写（零容忍）
const LEVEL1_PHRASES: Array<{ pattern: string; advice: string }> = [
  { pattern: '嘴角勾起', advice: '删脸写动作' },
  { pattern: '嘴角微微上扬', advice: '删脸写动作' },
  { pattern: '嘴角扬起', advice: '删脸写动作' },
  { pattern: '勾唇一笑', advice: '删脸写动作' },
  { pattern: '扯出一个笑', advice: '写具体动作' },
  { pattern: '脸上堆满了笑', advice: '写具体动作' },
  { pattern: '眼神深邃', advice: '眼神是结论，写在看什么' },
  { pattern: '眼神坚定', advice: '眼神是结论，写在看什么' },
  { pattern: '眼神锐利', advice: '眼神是结论，写在看什么' },
  { pattern: '目光扫过', advice: '写他在看什么' },
  { pattern: '眼中闪过', advice: '写看得见的行为' },
  { pattern: '眼底闪过', advice: '写看得见的行为' },
  { pattern: '眼中流露出', advice: '流露看不见，写看得见的' },
  { pattern: '眸光', advice: '写具体视线行为' },
  { pattern: '眸色暗了暗', advice: '写具体视线行为' },
  { pattern: '笑意不达眼底', advice: '写具体行为' },
  { pattern: '心中一凛', advice: '外化为专属动作' },
  { pattern: '心中一动', advice: '外化为专属动作' },
  { pattern: '心下了然', advice: '外化为专属动作' },
  { pattern: '心中一片平静', advice: '外化为专属动作' },
  { pattern: '心头一紧', advice: '外化为专属动作' },
  { pattern: '瞳孔骤缩', advice: '外化为专属动作' },
  { pattern: '倒吸一口凉气', advice: '外化为专属动作' },
  { pattern: '心脏漏跳一拍', advice: '外化为专属动作' },
  { pattern: '呼吸一滞', advice: '万能外化，换场景专属动作' },
  { pattern: '呼吸一窒', advice: '万能外化，换场景专属动作' },
  { pattern: '喉结滚动', advice: '万能外化，换场景专属动作' },
  { pattern: '后槽牙咬紧', advice: '万能外化，换场景专属动作' },
  { pattern: '几不可察地点头', advice: '直接写点头或写不点' },
  { pattern: '几不可闻地叹', advice: '直接写叹气行为' },
  { pattern: '指节泛白', advice: '外化为专属动作' },
  { pattern: '指节发白', advice: '外化为专属动作' },
  { pattern: '声音平静', advice: '删声音+形容词框架' },
  { pattern: '带着不容置疑', advice: '写让人感觉到的行为' },
]

// 二级限频词：同章超限报 warn
const LEVEL2_LIMITS: Array<{ word: string; limit: number }> = [
  // 时间与转折副词
  { word: '顿时', limit: 1 }, { word: '瞬间', limit: 2 }, { word: '立刻', limit: 2 },
  { word: '连忙', limit: 1 }, { word: '此刻', limit: 2 }, { word: '这一刻', limit: 1 },
  { word: '一时间', limit: 1 }, { word: '渐渐', limit: 2 }, { word: '果然', limit: 2 },
  { word: '显然', limit: 1 }, { word: '下一秒', limit: 1 }, { word: '随即', limit: 1 },
  { word: '旋即', limit: 1 }, { word: '半晌', limit: 1 }, { word: '片刻后', limit: 1 },
  // 动作与状态
  { word: '缓缓', limit: 2 }, { word: '微微', limit: 2 }, { word: '轻轻', limit: 2 },
  { word: '猛地', limit: 2 }, { word: '突然', limit: 2 }, { word: '忽然', limit: 2 },
  { word: '不禁', limit: 1 }, { word: '小心翼翼', limit: 1 }, { word: '不动声色', limit: 1 },
  { word: '深吸一口气', limit: 1 }, { word: '淡淡', limit: 2 }, { word: '顿了顿', limit: 2 },
  { word: '沉默', limit: 3 }, { word: '愣了愣', limit: 1 }, { word: '怔住', limit: 1 },
  { word: '苦笑', limit: 2 }, { word: '无奈', limit: 2 }, { word: '攥紧', limit: 1 },
  // 转述与视线
  { word: '闻言', limit: 1 }, { word: '见状', limit: 1 }, { word: '听罢', limit: 1 },
  { word: '注视', limit: 1 }, { word: '凝视', limit: 1 }, { word: '若有所思', limit: 1 },
  { word: '似笑非笑', limit: 1 },
  // 模糊限制词
  { word: '似乎', limit: 3 }, { word: '仿佛', limit: 3 }, { word: '像是', limit: 2 },
  // 心理动词 tell
  { word: '意识到', limit: 2 }, { word: '察觉到', limit: 1 },
  // 万能量词
  { word: '一丝', limit: 2 }, { word: '一抹', limit: 2 }, { word: '一股', limit: 2 },
  { word: '几分', limit: 2 }, { word: '些许', limit: 2 },
]

// 对话标签：同一标签 ≤2，「道」系合计 ≤4
const DIALOGUE_TAGS = ['说道', '问道', '答道', '开口道', '开口说道', '沉声道', '冷声道', '淡淡道', '低声道', '轻声道', '缓缓开口', '应道', '笑道', '叹道', '应了一声']
const DAO_TAG_LIMIT = 4

// 白名单：这些词的子串不计入（防误伤，如「知道」白名单，「意识到」仍查）
const WHITELIST = ['可能', '或许', '虽然', '几乎', '确实', '知道', '认为', '充满', '不断', '巨大', '这次']

/** 白名单遮蔽：把正文中的白名单词替换为等长占位符，使其内部出现的限频词命中不计入 */
export function maskWhitelistWords(text: string): string {
  return WHITELIST.reduce((acc, w) => acc.split(w).join('\u0000'.repeat(w.length)), text)
}

// 句式模板（结构正则）
const SENTENCE_PATTERNS: Array<{ name: string; re: RegExp; advice: string }> = [
  { name: '声音框架', re: /声音(不大|轻细)，却/g, advice: '删框架，台词+动作直给' },
  { name: '以一种口吻', re: /以一种[^，。]{0,12}的(口吻|姿态|语气)/g, advice: '删「以一种」，直接写他在做什么' },
  { name: '带着寒意', re: /带着[^，。]{0,8}的(寒意|笑意|杀意|怒意)/g, advice: '写让人感觉到它的具体行为' },
  { name: '显得', re: /显得(更加|有些|异常)/g, advice: '「显得」是弱动词，直接陈述' },
  { name: '数字计时', re: /(沉默|停顿|过了)了?(三秒|几秒|三分钟|几分钟后)/g, advice: '行为计时替代（烟燃到一半、水壶响了才接话）' },
  { name: '像是想到', re: /像是(想到了什么|确认什么|想起了什么)/g, advice: '直接写他想到什么、做了什么' },
  { name: '章末模板钩', re: /(这一切才刚刚开始|夜，?深了|故事才刚刚开始)/g, advice: '钩子换成具体事件或台词' },
]

/** 对单章正文跑体检 */
export function lintChapter(content: string): LintIssue[] {
  const issues: LintIssue[] = []
  const lines = content.split('\n')

  // 一级套路：逐行找
  for (let i = 0; i < lines.length; i++) {
    for (const p of LEVEL1_PHRASES) {
      const idx = lines[i].indexOf(p.pattern)
      if (idx >= 0) {
        issues.push({
          rule: `一级套路：${p.pattern}`,
          level: 'error',
          line: i + 1,
          snippet: lines[i].trim().slice(0, 50),
          advice: p.advice,
          match: p.pattern,
        })
      }
    }
    for (const sp of SENTENCE_PATTERNS) {
      sp.re.lastIndex = 0
      const m = sp.re.exec(lines[i])
      if (m) {
        issues.push({
          rule: `句式：${sp.name}`,
          level: 'info',
          line: i + 1,
          snippet: lines[i].trim().slice(0, 50),
          advice: sp.advice,
          match: m[0],
        })
      }
    }
  }

  // 二级限频：章内计数（白名单词先遮蔽为等长占位，其内部出现的限频词命中不计入）
  const full = content
  const masked = maskWhitelistWords(full)
  for (const { word, limit } of LEVEL2_LIMITS) {
    const count = countOccurrences(masked, word)
    if (count > limit) {
      const line = firstLineOf(lines, word)
      issues.push({
        rule: `限频：${word}`,
        level: 'warn',
        line,
        snippet: lines[line - 1]?.trim().slice(0, 50) ?? '',
        advice: `「${word}」全章 ${count} 次，上限 ${limit}；能删则删或换写法`,
        match: word,
        count,
        limit,
      })
    }
  }

  // 对话标签
  const tagCounts = DIALOGUE_TAGS.map((t) => ({ tag: t, count: countOccurrences(full, t) }))
  for (const { tag, count } of tagCounts) {
    if (count > 2) {
      const line = firstLineOf(lines, tag)
      issues.push({
        rule: `对话标签：${tag}`,
        level: 'warn',
        line,
        snippet: lines[line - 1]?.trim().slice(0, 50) ?? '',
        advice: `同标签一章 ≤2，当前 ${count}；前后文能认出说话人就删标签，或用动作行代替`,
        match: tag,
        count,
        limit: 2,
      })
    }
  }
  const daoTotal = tagCounts.filter((t) => t.tag.endsWith('道')).reduce((s, t) => s + t.count, 0)
  if (daoTotal > DAO_TAG_LIMIT) {
    issues.push({
      rule: '对话标签：道系合计',
      level: 'warn',
      line: 1,
      snippet: '',
      advice: `「道」系标签全章 ${daoTotal} 次，上限 ${DAO_TAG_LIMIT}；优先用动作行代替`,
      count: daoTotal,
      limit: DAO_TAG_LIMIT,
    })
  }

  // 结构层：段尾总结句（连续 2 段末句都是「他知道」类收束即提示）
  const paraEnds = collectParagraphEndings(lines)
  let streak = 0
  for (const pe of paraEnds) {
    const isSummary = /^(他知道|她知道|我知道|这一次，?他没有|他知道，)/.test(pe.text)
    streak = isSummary ? streak + 1 : 0
    if (streak >= 2) {
      issues.push({
        rule: '段尾总结句',
        level: 'info',
        line: pe.line,
        snippet: pe.text.slice(0, 50),
        advice: '删总结收束，停在动作或台词上',
      })
      streak = 0
    }
  }

  // 数字装具体：沉默了三秒类 + 第无数次
  const nthRe = /第[无数\d]+次/g
  for (let i = 0; i < lines.length; i++) {
    nthRe.lastIndex = 0
    if (nthRe.test(lines[i])) {
      issues.push({
        rule: '数字装具体',
        level: 'info',
        line: i + 1,
        snippet: lines[i].trim().slice(0, 50),
        advice: '「第 N 次类」数字装具体，换具体行为节拍',
      })
    }
  }

  return issues
}

function countOccurrences(text: string, word: string): number {
  if (!word) return 0
  let count = 0
  let idx = text.indexOf(word)
  while (idx >= 0) {
    count += 1
    idx = text.indexOf(word, idx + word.length)
  }
  return count
}

function firstLineOf(lines: string[], word: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(word)) return i + 1
  }
  return 1
}

/** 收集各段落末行（行号为 1-based，与其他 issue 定位约定一致） */
function collectParagraphEndings(lines: string[]): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  let buf: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t) {
      buf.push(t)
    } else if (buf.length > 0) {
      out.push({ line: i, text: buf[buf.length - 1] })
      buf = []
    }
  }
  if (buf.length > 0) out.push({ line: lines.length, text: buf[buf.length - 1] })
  return out
}
