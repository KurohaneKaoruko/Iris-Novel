import { useCallback, useEffect, useState } from 'react'
import { listChapters, markChapterStatus, reorderChapters, type Chapter, type ChapterStatus } from '../../api/novel'

const STATUS_CYCLE: ChapterStatus[] = ['draft', 'revising', 'completed']

const STATUS_META: Record<ChapterStatus, { label: string; icon: string }> = {
  draft: { label: '草稿', icon: '○' },
  revising: { label: '修稿', icon: '◐' },
  completed: { label: '完结', icon: '●' },
}

type Props = {
  activePath: string | null
  onOpen: (path: string) => void
  onNewChapter: () => void
  onImport: () => void
}

/** 右栏「章节」页签：小说视角的章节导航（字数/状态/点击预览/新建/拖拽排序） */
export function ChaptersPanel({ activePath, onOpen, onNewChapter, onImport }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [overPath, setOverPath] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setChapters((await listChapters()).sort((a, b) => a.order - b.order))
    } catch {
      setChapters([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, activePath])

  const cycleStatus = useCallback(
    async (c: Chapter) => {
      const idx = STATUS_CYCLE.indexOf(c.status)
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
      // 乐观更新
      setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, status: next } : x)))
      try {
        await markChapterStatus(c.filePath, next)
      } catch {
        void refresh()
      }
    },
    [refresh],
  )

  /** 拖拽落点：把 dragPath 移到 overPath 的位置（乐观更新 + reorderChapters 落盘） */
  const onDrop = useCallback(
    async (target: Chapter) => {
      const from = dragPath
      setDragPath(null)
      setOverPath(null)
      if (!from || from === target.filePath) return
      const fromIdx = chapters.findIndex((c) => c.filePath === from)
      const toIdx = chapters.findIndex((c) => c.filePath === target.filePath)
      if (fromIdx < 0 || toIdx < 0) return
      // 乐观重排
      const next = [...chapters]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      setChapters(next.map((c, i) => ({ ...c, order: i })))
      try {
        await reorderChapters(from, target.filePath)
      } catch {
        void refresh()
        return
      }
      void refresh()
    },
    [chapters, dragPath, refresh],
  )

  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0)
  const maxWords = Math.max(...chapters.map((c) => c.wordCount), 1)

  if (loading) return <div className="agw-empty">加载中…</div>

  return (
    <div className="chp">
      <div className="chp-toolbar">
        <span className="chp-total">{chapters.length} 章 · {totalWords.toLocaleString()} 字</span>
        <span className="chp-actions">
          <button className="agw-btn" onClick={onImport} title="从全文导入章节">导入</button>
          <button className="agw-btn primary" onClick={onNewChapter} title="新建章节">＋章</button>
        </span>
      </div>

      {chapters.length === 0 ? (
        <div className="agw-empty">
          还没有章节。
          <br />
          用「＋章」新建，或「导入」切分存量全文。
        </div>
      ) : (
        <div className="chp-list">
          {chapters.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft
            return (
              <div
                key={c.id}
                className={`chp-row ${activePath === c.filePath ? 'active' : ''} ${dragPath === c.filePath ? 'dragging' : ''} ${overPath === c.filePath && dragPath !== c.filePath ? 'drop-target' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragPath(c.filePath)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overPath !== c.filePath) setOverPath(c.filePath)
                }}
                onDragLeave={() => setOverPath((p) => (p === c.filePath ? null : p))}
                onDrop={(e) => {
                  e.preventDefault()
                  void onDrop(c)
                }}
                onDragEnd={() => {
                  setDragPath(null)
                  setOverPath(null)
                }}
              >
                <span className="chp-grip" title="拖拽排序">⋮⋮</span>
                <button className="chp-main" onClick={() => onOpen(c.filePath)}>
                  <span className="chp-order">#{c.order + 1}</span>
                  <span className="chp-title">{c.title}</span>
                  <span className="chp-bars" title={`本章 ${c.wordCount} 字（最长章 ${maxWords} 字）`}>
                    {chapters.length > 1 ? (
                      <span className="chp-bar" style={{ width: `${Math.max(8, Math.round((c.wordCount / maxWords) * 100))}%` }} />
                    ) : null}
                  </span>
                  <span className="chp-words">{c.wordCount > 0 ? `${c.wordCount.toLocaleString()} 字` : ''}</span>
                </button>
                <button
                  className={`chp-status ${c.status}`}
                  title={`点击切换状态（当前：${meta.label}）`}
                  onClick={() => void cycleStatus(c)}
                >
                  {meta.icon} {meta.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
