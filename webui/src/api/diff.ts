/**
 * 行级 diff（零依赖，LCS 算法，够用即可——文件粒度几百行内性能无忧）。
 * 返回逐行差异用于「变更预览」视图。
 */

export type DiffLine = {
  type: 'same' | 'add' | 'del'
  /** 旧文件行号（del/same 有效，1-based） */
  oldNo?: number
  /** 新文件行号（add/same 有效，1-based） */
  newNo?: number
  text: string
}

/** LCS 长度表 */
function lcsLengths(a: string[], b: string[]): Uint32Array[] {
  const width = b.length + 1
  const rows: Uint32Array[] = [new Uint32Array(width)]
  for (let i = 1; i <= a.length; i++) {
    const prev = rows[i - 1]
    const curr = new Uint32Array(width)
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    rows.push(curr)
  }
  return rows
}

/** 对比两份文本，产出行级差异（same/add/del，带行号） */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, '\n').split('\n')
  const b = newText.replace(/\r\n/g, '\n').split('\n')
  const rows = lcsLengths(a, b)
  const out: DiffLine[] = []
  let i = a.length
  let j = b.length
  // 回溯
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.push({ type: 'same', oldNo: i, newNo: j, text: a[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || rows[i][j] === rows[i][j - 1])) {
      out.push({ type: 'add', newNo: j, text: b[j - 1] })
      j -= 1
    } else {
      out.push({ type: 'del', oldNo: i, text: a[i - 1] })
      i -= 1
    }
  }
  out.reverse()
  return out
}

/** diff 结果统计 */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added += 1
    else if (l.type === 'del') removed += 1
  }
  return { added, removed }
}

/** 压缩 same 段为 context 标记（超过 pad 行的折叠为「… N 行相同 …」） */
export function collapseDiff(lines: DiffLine[], pad = 3): Array<DiffLine | { type: 'gap'; count: number }> {
  const out: Array<DiffLine | { type: 'gap'; count: number }> = []
  let sameRun = 0
  let runStart = -1
  const flushRun = (isLast: boolean) => {
    if (sameRun <= pad * 2 + (isLast ? pad : 0) + (runStart === 0 ? pad : 0)) {
      for (let k = runStart; k < runStart + sameRun; k++) out.push(lines[k])
    } else {
      for (let k = runStart; k < runStart + pad; k++) out.push(lines[k])
      out.push({ type: 'gap', count: sameRun - pad * 2 })
      for (let k = runStart + sameRun - pad; k < runStart + sameRun; k++) out.push(lines[k])
    }
    sameRun = 0
    runStart = -1
  }
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx]
    if (l.type === 'same') {
      if (runStart < 0) runStart = idx
      sameRun += 1
    } else {
      flushRun(false)
      out.push(l)
    }
  }
  if (sameRun > 0) flushRun(true)
  return out
}
