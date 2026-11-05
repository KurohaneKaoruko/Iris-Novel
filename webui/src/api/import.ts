/**
 * 存量作品导入：粘贴文本或读已有文件 → 按「第X章」标题智能切分 → 预览 → 批量建章。
 * 兼容格式：第X章 / 第X回 / 第X节 / Chapter X / 数字序号标题（壹贰叁 中文数字支持）。
 */

export type ParsedChapter = { title: string; content: string }

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9 }

/** 中文数字 → 阿拉伯数字（支持 十/百/千 组合，含大写 壹拾佰仟） */
export function cnNumberToArabic(s: string): number | null {
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  // 统一大小写：壹贰叁… → 一二三…，佰仟 → 百千
  const norm = s.replace(/[壹贰叁肆伍陆柒捌玖]/g, (c) => '一二三四五六七八九'['壹贰叁肆伍陆柒捌玖'.indexOf(c)]).replace(/[佰仟拾]/g, (c) => ({ 佰: '百', 仟: '千', 拾: '十' })[c] ?? c)
  let total = 0
  let current = 0
  let hasDigit = false
  for (const ch of norm) {
    const d = CN_NUM[ch]
    if (d !== undefined) {
      current = current * 10 + d
      hasDigit = true
    } else if (ch === '十') {
      total += (current === 0 ? 1 : current) * 10
      current = 0
      hasDigit = true
    } else if (ch === '百') {
      total += (current === 0 ? 1 : current) * 100
      current = 0
      hasDigit = true
    } else if (ch === '千') {
      total += (current === 0 ? 1 : current) * 1000
      current = 0
      hasDigit = true
    } else {
      return null
    }
  }
  if (!hasDigit) return null
  return total + current
}

const TITLE_RE =
  /^\s*(?:#+\s*)?(?:(第|Chapter|CHAPTER|chap\.?)\s*([0-9一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖]+)\s*(章|回|节|话)?|([0-9]{1,4})[、.．:：\s])\s*[:：]?\s*(.*?)(?:\s*)$/

/**
 * 把整本文本切成章节列表。连续行匹配标题模式才算切点；
 * 无任何标题时整个文本作为单章返回（调用方提示用户手动分）。
 */
export function splitIntoChapters(text: string): ParsedChapter[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const marks: Array<{ line: number; title: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    const m = t.match(TITLE_RE)
    if (!m) continue
    // 标题行不应过长（>60 字符更像正文）
    if (t.length > 60) continue
    // 第X章要求序号真实可解析
    if ((m[1] === '第' || /chapter/i.test(m[1] ?? '')) && m[2] !== undefined) {
      if (cnNumberToArabic(m[2]) === null) continue
    }
    const name = m[5]?.trim() ?? ''
    const num = m[2] ?? m[4] ?? ''
    marks.push({ line: i, title: name ? `${name}` : `第 ${num} 章` })
  }
  if (marks.length === 0) {
    return [{ title: '导入文本', content: normalized.trim() }]
  }
  // 过滤连续假信号： marks 间距 <2 行且内容为空的跳过
  const out: ParsedChapter[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].line
    const end = i + 1 < marks.length ? marks[i + 1].line : lines.length
    const body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim()
    out.push({ title: marks[i].title, content: body })
  }
  return out.filter((c) => c.title && (c.content.length > 0 || marks.length === 1))
}

/** 切分统计（预览用） */
export function importSummary(chapters: ParsedChapter[]): { count: number; words: number; min: number; max: number } {
  const words = chapters.map((c) => c.content.replace(/\s/g, '').length)
  return {
    count: chapters.length,
    words: words.reduce((s, w) => s + w, 0),
    min: words.length ? Math.min(...words) : 0,
    max: words.length ? Math.max(...words) : 0,
  }
}

/** 章节序号 → 文件名（与 createChapterFile 命名一致） */
export function chapterFileName(index: number): string {
  const num = String(index).padStart(4, '0')
  return `stories/chapter-${num}.md`
}
