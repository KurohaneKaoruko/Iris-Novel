import { useMemo, type ReactNode } from 'react'

/**
 * 够用的 Markdown 渲染器（零依赖）：
 * 围栏代码块（带复制按钮）/ 标题 / 有序无序列表 / 引用 / 分隔线 /
 * 行内：**粗** *斜* `码` [链接](url)
 */
export function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content])
  return <div className="md">{blocks}</div>
}

function parseBlocks(content: string): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    const fence = line.match(/^\s*```(\w*)/)
    if (fence) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      out.push(<CodeBlock key={key++} code={buf.join('\n')} lang={fence[1] || ''} />)
      continue
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      out.push(heading(lvl, inline(h[2]), key++))
      i += 1
      continue
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="md-hr" />)
      i += 1
      continue
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(
        <blockquote key={key++} className="md-quote">
          {inline(buf.join(' '))}
        </blockquote>,
      )
      continue
    }

    // 无序列表（含嵌套一层）
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i += 1
      }
      out.push(
        <ul key={key++} className="md-ul">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      out.push(
        <ol key={key++} className="md-ol">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // 表格（| a | b | 形式）
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l: string) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(cells(lines[i]))
        i += 1
      }
      out.push(
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 空行
    if (!line.trim()) {
      i += 1
      continue
    }

    // 段落
    const buf: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*\|.+\|\s*$/.test(lines[i])
    ) {
      buf.push(lines[i])
      i += 1
    }
    out.push(<p key={key++} className="md-p">{inline(buf.join('\n'))}</p>)
  }
  return out
}

function heading(lvl: number, children: ReactNode, key: number): ReactNode {
  switch (lvl) {
    case 1: return <h1 key={key} className="md-h1">{children}</h1>
    case 2: return <h2 key={key} className="md-h2">{children}</h2>
    case 3: return <h3 key={key} className="md-h3">{children}</h3>
    default: return <h4 key={key} className="md-h4">{children}</h4>
  }
}

/** 行内格式 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<strong key={k++}>{m[2]}</strong>)
    else if (m[3]) parts.push(<em key={k++}>{m[3]}</em>)
    else if (m[4]) parts.push(<code key={k++} className="md-code">{m[4]}</code>)
    else if (m[5]) parts.push(<a key={k++} className="md-link" href={m[6]} target="_blank" rel="noreferrer">{m[5]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const copy = () => void navigator.clipboard.writeText(code)
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span>{lang || 'text'}</span>
        <button onClick={copy} title="复制">复制</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
