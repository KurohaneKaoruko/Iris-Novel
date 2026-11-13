import { useCallback, useEffect, useState } from 'react'
import {
  listChapters,
  listCharacters,
  listCodex,
  listPlotLines,
  loadChapterContents,
  type Chapter,
} from '../../api/novel'
import { exportWork, writeText, createDir } from '../../api/backend'
import { assembleBookTxt, assembleDossier, buildExportFilename } from '../../api/exportCenter'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'
import { useProject } from '../../state/ProjectContext'
import './ExportTab.css'

type ExportKind = 'book-txt' | 'book-md' | 'dossier'

/** 导出目标选择卡片 */
const KINDS: Array<{ id: ExportKind; icon: IconName; title: string; desc: string }> = [
  { id: 'book-txt', icon: 'file-text', title: '整本 TXT', desc: '章节标题独立行，去 Markdown 语法，纯文本阅读稿' },
  { id: 'book-md', icon: 'book-open', title: '整本 Markdown', desc: '按章序合并 stories/ 全部章节，剥 frontmatter 与重复标题' },
  { id: 'dossier', icon: 'package', title: '资料册', desc: '人物卡 / 设定集 / 情节线合并导出，可勾选区块' },
]

/** exports/ 目录存在则幂等跳过；write_text 不自动建父目录，必须先建 */
async function ensureExportsDir(): Promise<void> {
  await createDir('exports').catch(() => {})
}

/** 把导出内容写到 exports/<文件名>，返回落盘相对路径 */
async function saveToExports(filename: string, content: string): Promise<string> {
  const relPath = `exports/${filename}`
  await writeText(relPath, content)
  return relPath
}

/**
 * 「导出」页签：作品内容三式导出，统一落盘到作品目录 exports/。
 * 组装纯函数在 api/exportCenter.ts（带单测）；此处只做 IO 与状态。
 */
export function ExportTab() {
  const { workName } = useProject()
  const [selected, setSelected] = useState<ExportKind>('book-txt')
  const [sections, setSections] = useState({ characters: true, codex: true, plotLines: true })
  const [chapterCount, setChapterCount] = useState(0)
  const [counts, setCounts] = useState({ characters: 0, codex: 0, plotLines: 0 })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      const [chapters, characters, codex, plotLines] = await Promise.all([
        listChapters().catch(() => [] as Chapter[]),
        listCharacters().catch(() => []),
        listCodex().catch(() => []),
        listPlotLines().catch(() => []),
      ])
      setChapterCount(chapters.length)
      setCounts({ characters: characters.length, codex: codex.length, plotLines: plotLines.length })
    })()
  }, [])

  const dossierReady = counts.characters + counts.codex + counts.plotLines > 0

  const run = useCallback(async () => {
    const name = workName || '未命名作品'
    setBusy(true)
    setErr('')
    setDone('')
    try {
      await ensureExportsDir()
      let relPath: string
      if (selected === 'book-md') {
        // 复用后端合并通道（export_work：剥 frontmatter 与首个标题防重复）
        const { content } = await exportWork('md')
        relPath = await saveToExports(buildExportFilename(name, 'book', 'md'), content)
      } else if (selected === 'book-txt') {
        // 前端组装：章节标题独立行 + 去 Markdown 语法（后端 txt 不做语法清理）
        const [chapters, meta] = await Promise.all([loadChapterContents(), listChapters()])
        if (chapters.length === 0) throw new Error('stories/ 下没有可导出的章节')
        const orderOf = new Map(meta.map((m) => [m.filePath, m.order]))
        ;[...chapters].sort((a, b) => (orderOf.get(a.path) ?? 0) - (orderOf.get(b.path) ?? 0))
        const txt = assembleBookTxt(
          chapters.map((c) => ({ title: c.title, content: c.content })),
          name,
        )
        relPath = await saveToExports(buildExportFilename(name, 'book', 'txt'), txt)
      } else {
        // 资料册：按勾选合并三区，全空时报错
        const [characters, codex, plotLines] = await Promise.all([
          sections.characters ? listCharacters().catch(() => []) : Promise.resolve([]),
          sections.codex ? listCodex().catch(() => []) : Promise.resolve([]),
          sections.plotLines ? listPlotLines().catch(() => []) : Promise.resolve([]),
        ])
        const md = assembleDossier({ workName: name, characters, codex, plotLines })
        if (!md.includes('## ')) throw new Error('勾选的资料区块都为空，没有可导出内容')
        relPath = await saveToExports(buildExportFilename(name, 'dossier', 'md'), md)
      }
      setDone(relPath)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [selected, sections, workName])

  return (
    <div className="expt">
      <div className="exp-kinds">
        {KINDS.map((k) => (
          <button
            key={k.id}
            className={`exp-kind ${selected === k.id ? 'on' : ''}`}
            onClick={() => { setSelected(k.id); setDone(''); setErr('') }}
          >
            <Icon name={k.icon} size={16} />
            <span className="exp-kind-title">{k.title}</span>
          </button>
        ))}
      </div>

      {selected === 'dossier' ? (
        <div className="exp-sections">
          <span className="srch-filter-label">包含区块</span>
          {([
            ['characters', '人物卡', counts.characters],
            ['codex', '设定集', counts.codex],
            ['plotLines', '情节线', counts.plotLines],
          ] as const).map(([key, zh, n]) => (
            <button
              key={key}
              className={`srch-chip ${sections[key] ? 'on' : ''}`}
              onClick={() => setSections((s) => ({ ...s, [key]: !s[key] }))}
              disabled={n === 0}
              title={n === 0 ? `暂无${zh}数据` : undefined}
            >
              {zh}{n > 0 ? ` ${n}` : ''}
            </button>
          ))}
        </div>
      ) : null}

      <div className="exp-actions">
        <button
          className="tools-run primary"
          disabled={busy || (selected === 'book-txt' ? chapterCount === 0 : selected === 'dossier' && !dossierReady)}
          onClick={() => void run()}
        >
          {busy ? '导出中…' : <><Icon name="download" size={14} />导出到 exports/</>}
        </button>
        <span className="tools-run-hint">{kindHint(selected, chapterCount, counts)}</span>
      </div>

      {done ? (
        <div className="tools-ok">
          <Icon name="check-circle" size={14} /> 已导出到作品目录：<code className="exp-path">{done}</code>
        </div>
      ) : null}
      {err ? <div className="tools-err">{err}</div> : null}

      <div className="exp-kind-desc">文件名自动带时间戳（防覆盖旧导出）。</div>
    </div>
  )
}

/** 各导出式的按钮旁提示 */
function kindHint(
  kind: ExportKind,
  chapterCount: number,
  counts: { characters: number; codex: number; plotLines: number },
): string {
  if (kind === 'book-txt') return chapterCount > 0 ? `当前 ${chapterCount} 章可导出` : 'stories/ 下暂无章节'
  if (kind === 'book-md') return chapterCount > 0 ? `合并 stories/ 全部 ${chapterCount} 章` : 'stories/ 下暂无章节'
  const total = counts.characters + counts.codex + counts.plotLines
  return total > 0 ? `人物 ${counts.characters} · 设定 ${counts.codex} · 情节线 ${counts.plotLines}` : '暂无人物/设定/情节线数据'
}
