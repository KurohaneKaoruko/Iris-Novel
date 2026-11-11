import { useMemo } from 'react'

type MdViewProps = {
  content: string
}

/**
 * 轻量 Markdown 渲染：标题/列表/引用/代码块/粗斜体/分隔线。
 * 小说正文以段落为主，无需重型 md 库；渲染结果为纯只读视图。
 */
export function MarkdownView({ content }: MdViewProps) {
  const blocks = useMemo(() => parse(content), [content])
  return <div className="mdv">{blocks}</div>
}

function parse(content: string): JSX.Element[] {
  const lines = content.split('\n')
  const out: JSX.Element[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      out.push(
        <pre key={out.length} className="mdv-code">
          <code>{buf.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      const Tag = (`h${Math.min(lvl, 6)}` as unknown) as 'h1'
      out.push(<Tag key={out.length} className={`mdv-h mdv-h${lvl}`}>{inline(h[2])}</Tag>)
      i += 1
      continue
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={out.length} className="mdv-hr" />)
      i += 1
      continue
    }

    // 引用
    if (line.trimStart().startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(<blockquote key={out.length} className="mdv-quote">{inline(buf.join(' '))}</blockquote>)
      continue
    }

    // 列表
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))
        i += 1
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List key={out.length} className="mdv-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </List>,
      )
      continue
    }

    // 空行
    if (!line.trim()) {
      i += 1
      continue
    }

    // 段落（连续非空非结构行）
    const buf: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('>') &&
      !lines[i].trimStart().startsWith('```')
    ) {
      buf.push(lines[i])
      i += 1
    }
    out.push(<p key={out.length} className="mdv-p">{inline(buf.join('\n'))}</p>)
  }
  return out
}

/** 行内格式：**粗** *斜* `码` */
function inline(text: string) {
  const parts: Array<string | JSX.Element> = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<strong key={k++}>{m[2]}</strong>)
    else if (m[3]) parts.push(<em key={k++}>{m[3]}</em>)
    else if (m[4]) parts.push(<code key={k++} className="mdv-inline-code">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
