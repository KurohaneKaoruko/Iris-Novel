/**
 * 章节列表（四区布局左区）：数据源 ChapterService，点击打开章节。
 * 轻量只读视图——编辑/排序等重操作仍由既有 ChapterManager 侧栏承载。
 */

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { chapterService, type Chapter } from '../services/ChapterService'
import { AppIcon } from './icons/AppIcon'
import './ChapterList.css'

type Props = {
  workspaceRoot: string | null
  activePath: string | null
  onOpenChapter: (filePath: string) => void
}

export function ChapterList({ workspaceRoot, activePath, onOpenChapter }: Props) {
  const { t } = useI18n()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceRoot) {
      setChapters([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await chapterService.listChapters()
      setChapters(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="chapter-list">
      <div className="chapter-list-header">
        <span className="chapter-list-title">
          <AppIcon name="chapters" size={13} />
          <span>{t('chapterList.title')}</span>
        </span>
        <button
          type="button"
          className="chapter-list-reload"
          onClick={() => void reload()}
          disabled={loading}
          title={t('chapterList.reload')}
        >
          <AppIcon name="refresh" size={13} />
        </button>
      </div>
      <div className="chapter-list-body">
        {error ? <div className="chapter-list-error">{error}</div> : null}
        {!error && !loading && chapters.length === 0 ? (
          <div className="chapter-list-empty">{t('chapterList.empty')}</div>
        ) : null}
        {chapters.map((ch, index) => {
          const active = ch.filePath === activePath
          return (
            <button
              key={ch.id}
              type="button"
              className={`chapter-list-item ${active ? 'active' : ''}`}
              onClick={() => onOpenChapter(ch.filePath)}
              title={ch.filePath}
            >
              <span className="chapter-list-index">{index + 1}</span>
              <span className="chapter-list-name">{ch.title}</span>
              <span className="chapter-list-words">
                {ch.wordCount > 0 ? t('chapterList.words', { count: ch.wordCount }) : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
