/**
 * 书架（封面流版）：聚焦作品居中放大、两侧渐次缩小淡出的 3D 封面流；
 * 拖拽/滚轮/键盘丝滑导航 + 自动吸附；程序化封面零素材依赖。
 *
 * 功能语义与旧版一致：创建、导入、按路径打开、简介编辑、忘记外部作品、
 * 启动行为、刷新、有效性标记。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { LaunchMode, WorkItem, WorkSource } from '../tauri'
import { dialogConfirm } from '../transport'
import { coverFor, coverStyle } from '../utils/coverArt'
import { AppIcon } from './icons/AppIcon'
import { CoverflowShelf, type CoverflowEntry } from './CoverflowShelf'
import './ProjectPickerPage.css'

type BookshelfPageProps = {
  busy: boolean
  error: string | null
  defaultRoot: string
  recentWorks: WorkItem[]
  importedWorks: WorkItem[]
  lastWorkPath: string | null
  launchMode: LaunchMode
  onSelectProject: (path: string, source: WorkSource) => void
  onCreateProject: (name: string, description?: string) => void
  onLoadExternalProject: () => void
  onForgetExternalProject: (path: string) => void
  onUpdateWorkDescription?: (path: string, description: string) => Promise<void> | void
  onRefresh: () => void
  onLaunchModeChange: (mode: LaunchMode) => void
  manualPathEnabled?: boolean
  onOpenManualPath?: (path: string) => void
}

type ShelfEntry =
  | { kind: 'new' }
  | { kind: 'import' }
  | { kind: 'work'; work: WorkItem; external: boolean }

function formatTimestamp(seconds: number): string {
  try {
    return new Date(seconds * 1000).toLocaleDateString()
  } catch {
    return ''
  }
}

export function BookshelfPage({
  busy,
  error,
  defaultRoot,
  recentWorks,
  importedWorks,
  lastWorkPath,
  launchMode,
  onSelectProject,
  onCreateProject,
  onLoadExternalProject,
  onForgetExternalProject,
  onUpdateWorkDescription,
  onRefresh,
  onLaunchModeChange,
  manualPathEnabled = false,
  onOpenManualPath,
}: BookshelfPageProps) {
  const { t } = useI18n()
  const [activeIndex, setActiveIndex] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [descEditing, setDescEditing] = useState<WorkItem | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [descSaving, setDescSaving] = useState(false)
  const [manualPath, setManualPath] = useState('')

  const works = useMemo<ShelfEntry[]>(
    () => [
      ...recentWorks.map((work) => ({ kind: 'work' as const, work, external: false })),
      ...importedWorks.map((work) => ({ kind: 'work' as const, work, external: true })),
    ],
    [recentWorks, importedWorks],
  )

  const entries = useMemo<ShelfEntry[]>(
    () => [{ kind: 'new' }, ...works, { kind: 'import' }],
    [works],
  )

  useEffect(() => {
    setActiveIndex((prev) => Math.min(Math.max(0, prev), entries.length - 1))
  }, [entries.length])

  const activeEntry = entries[Math.min(activeIndex, entries.length - 1)] ?? entries[0]
  const activeWork = activeEntry?.kind === 'work' ? activeEntry.work : null
  const activeArt = activeWork ? coverFor(activeWork.name) : null

  const activate = useCallback(
    (index: number) => {
      const entry = entries[index]
      if (!entry) return
      if (entry.kind === 'work') {
        if (!busy) onSelectProject(entry.work.path, entry.work.source)
      } else if (entry.kind === 'new') {
        setCreateOpen(true)
      } else {
        if (manualPathEnabled) setImportOpen(true)
        else if (!busy) onLoadExternalProject()
      }
    },
    [busy, entries, manualPathEnabled, onLoadExternalProject, onSelectProject],
  )

  const coverEntries: CoverflowEntry[] = useMemo(
    () =>
      entries.map((entry, index) => {
        if (entry.kind === 'new') {
          return {
            key: '__new__',
            content: (
              <button type="button" className="shelf-action-card" disabled={busy} onClick={() => setCreateOpen(true)}>
                <span className="shelf-action-icon">
                  <AppIcon name="add" size={22} />
                </span>
                <span>{t('project.createNew')}</span>
                <span className="shelf-card-meta">{t('project.createNewHint')}</span>
              </button>
            ),
          }
        }
        if (entry.kind === 'import') {
          return {
            key: '__import__',
            content: (
              <button
                type="button"
                className="shelf-action-card"
                disabled={busy}
                onClick={() => {
                  if (manualPathEnabled) setImportOpen(true)
                  else onLoadExternalProject()
                }}
              >
                <span className="shelf-action-icon">
                  <AppIcon name="folderOpen" size={22} />
                </span>
                <span>{t('project.importExternal')}</span>
                <span className="shelf-card-meta">{t('project.importCardHint')}</span>
              </button>
            ),
          }
        }
        const work = entry.work
        const art = coverFor(work.name)
        const metaParts: string[] = []
        if (work.chapters_count > 0) {
          metaParts.push(
            t('project.cardMeta', {
              chapters: work.chapters_count,
              words: work.total_words.toLocaleString(),
            }),
          )
        }
        if (work.updated_at) {
          metaParts.push(t('project.updatedAt', { time: formatTimestamp(work.updated_at) }))
        }
        const isActive = index === Math.min(activeIndex, entries.length - 1)
        return {
          key: work.path || `__work_${index}`,
          content: (
            <div
              className="shelf-card"
              role="presentation"
              onClick={() => {
                if (!isActive) setActiveIndex(index)
                else activate(index)
              }}
            >
              <div
                className="shelf-cover"
                style={{
                  ...coverStyle(art),
                  ['--cover-glow-a' as string]: art.glowA,
                  ['--cover-glow-b' as string]: art.glowB,
                }}
              >
                <span className="shelf-cover-veil" />
                <span className="shelf-cover-initials">{art.initials}</span>
                <span className={`shelf-cover-badge ${work.is_valid_workspace ? '' : 'warn'}`}>
                  {work.is_valid_workspace
                    ? entry.external ? t('project.externalProjects') : t('project.ready')
                    : t('project.needsInit')}
                </span>
                <button
                  type="button"
                  className="shelf-cover-action"
                  disabled={busy}
                  title={t('project.openWork')}
                  onClick={(e) => {
                    e.stopPropagation()
                    activate(index)
                  }}
                >
                  +
                </button>
              </div>
              <div className="shelf-card-info">
                <span className="shelf-card-title" title={work.name}>
                  {work.name}
                </span>
                {work.description ? (
                  <span className="shelf-card-desc" title={work.description}>
                    {work.description}
                  </span>
                ) : null}
                {metaParts.length > 0 ? (
                  <span className="shelf-card-meta">{metaParts.join(' · ')}</span>
                ) : null}
              </div>
            </div>
          ),
        }
      }),
    [activate, activeIndex, busy, entries, manualPathEnabled, onLoadExternalProject, t],
  )

  const canCreate = newProjectName.trim().length > 0 && !busy

  const submitNewProject = useCallback(() => {
    const name = newProjectName.trim()
    if (!name) return
    onCreateProject(name, newProjectDescription.trim() || undefined)
    setNewProjectName('')
    setNewProjectDescription('')
    setCreateOpen(false)
  }, [newProjectDescription, newProjectName, onCreateProject])

  return (
    <div className="shelf-page">
      <div
        className="shelf-ambient"
        aria-hidden="true"
        style={
          activeArt
            ? ({
                ['--amb-a' as string]: activeArt.glowA,
                ['--amb-b' as string]: activeArt.glowB,
              } as React.CSSProperties)
            : undefined
        }
      />
      <header className="shelf-header">
        <div className="shelf-header-left">
          <span className="shelf-brand">
            <span className="shelf-brand-mark">
              <AppIcon name="projectSwitch" size={13} />
            </span>
            <span>{t('project.localLibrary')}</span>
          </span>
          <h1 className="shelf-title">
            {activeWork ? activeWork.name : t('project.title')}
          </h1>
          <p className="shelf-subtitle" title={activeWork?.path || defaultRoot}>
            {activeWork
              ? activeWork.description || activeWork.path
              : t('project.subtitle')}
          </p>
        </div>
        <div className="shelf-header-right">
          <label className="shelf-launch" title={lastWorkPath ? `${t('project.lastProject')}: ${lastWorkPath}` : t('project.lastProject')}>
            <select
              value={launchMode}
              disabled={busy}
              onChange={(e) => onLaunchModeChange(e.target.value as LaunchMode)}
            >
              <option value="picker">{t('project.launchPicker')}</option>
              <option value="auto_last">{t('project.launchAutoLast')}</option>
            </select>
          </label>
          <button className="shelf-icon-button" onClick={onRefresh} disabled={busy} title={t('project.refresh')}>
            <AppIcon name="refresh" size={15} />
          </button>
        </div>
      </header>

      <CoverflowShelf
        entries={coverEntries}
        activeIndex={Math.min(activeIndex, entries.length - 1)}
        onActiveIndexChange={setActiveIndex}
        onActivate={activate}
        ariaLabel={t('project.localLibrary')}
      />

      <div className="shelf-dock glass-float">
        {activeEntry?.kind === 'work' ? (
          <>
            <span className="shelf-dock-meta">
              {activeEntry.work.is_valid_workspace ? t('project.ready') : t('project.needsInit')}
              {activeEntry.work.chapters_count > 0
                ? ` · ${t('project.cardMeta', {
                    chapters: activeEntry.work.chapters_count,
                    words: activeEntry.work.total_words.toLocaleString(),
                  })}`
                : ''}
            </span>
            <div className="shelf-dock-actions">
              <button className="picker-button primary" disabled={busy} onClick={() => activate(activeIndex)}>
                {t('project.openWork')}
              </button>
              {onUpdateWorkDescription ? (
                <button
                  className="picker-button ghost"
                  disabled={busy}
                  onClick={() => {
                    if (activeEntry.kind !== 'work') return
                    setDescDraft(activeEntry.work.description ?? '')
                    setDescEditing(activeEntry.work)
                  }}
                >
                  {t('project.editDescription')}
                </button>
              ) : null}
              {activeEntry.kind === 'work' && activeEntry.external ? (
                <button
                  className="picker-button ghost danger"
                  disabled={busy}
                  onClick={() => {
                    if (activeEntry.kind !== 'work') return
                    void (async () => {
                      const ok = await dialogConfirm(
                        t('project.removeConfirm', { name: activeEntry.work.name }),
                      )
                      if (ok) onForgetExternalProject(activeEntry.work.path)
                    })()
                  }}
                >
                  {t('project.remove')}
                </button>
              ) : null}
            </div>
          </>
        ) : activeEntry?.kind === 'new' ? (
          <>
            <span className="shelf-dock-meta">{t('project.createNewHint')}</span>
            <div className="shelf-dock-actions">
              <button className="picker-button primary" disabled={busy} onClick={() => setCreateOpen(true)}>
                {t('project.createNew')}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="shelf-dock-meta">{t('project.externalHint')}</span>
            <div className="shelf-dock-actions">
              <button
                className="picker-button primary"
                disabled={busy}
                onClick={() => {
                  if (manualPathEnabled) setImportOpen(true)
                  else onLoadExternalProject()
                }}
              >
                {t('project.importExternal')}
              </button>
            </div>
          </>
        )}
      </div>

      <span className="shelf-hint">{t('project.focusHint')}</span>
      {error ? <div className="shelf-error glass-float">{error}</div> : null}

      {createOpen ? (
        <div className="shelf-overlay" onClick={() => setCreateOpen(false)}>
          <div className="shelf-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{t('project.createNew')}</h2>
            <p className="shelf-dialog-hint">{t('project.createNewHint')}</p>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('project.newNamePlaceholder')}
              disabled={busy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) submitNewProject()
              }}
            />
            <textarea
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              placeholder={t('project.descriptionPlaceholder')}
              rows={2}
              disabled={busy}
            />
            <div className="shelf-dialog-actions">
              <button className="picker-button ghost" disabled={busy} onClick={() => setCreateOpen(false)}>
                {t('project.descriptionCancel')}
              </button>
              <button className="picker-button primary" disabled={!canCreate} onClick={submitNewProject}>
                {t('project.createEnter')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div className="shelf-overlay" onClick={() => setImportOpen(false)}>
          <div className="shelf-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{t('project.importExternal')}</h2>
            <p className="shelf-dialog-hint">{t('project.externalHint')}</p>
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder={t('project.manualPathPlaceholder')}
              disabled={busy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualPath.trim() && onOpenManualPath) {
                  onOpenManualPath(manualPath.trim())
                  setImportOpen(false)
                }
              }}
            />
            <div className="shelf-dialog-actions">
              <button className="picker-button ghost" disabled={busy} onClick={() => setImportOpen(false)}>
                {t('project.descriptionCancel')}
              </button>
              <button
                className="picker-button primary"
                disabled={busy || !manualPath.trim() || !onOpenManualPath}
                onClick={() => {
                  if (!onOpenManualPath) return
                  onOpenManualPath(manualPath.trim())
                  setImportOpen(false)
                }}
              >
                {t('project.open')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {descEditing ? (
        <div className="shelf-overlay" onClick={() => setDescEditing(null)}>
          <div className="shelf-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{t('project.editDescription')}</h2>
            <p className="shelf-dialog-hint" title={descEditing.path}>
              {descEditing.name}
            </p>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder={t('project.descriptionPlaceholder')}
              rows={3}
              disabled={descSaving}
              autoFocus
            />
            <div className="shelf-dialog-actions">
              <button
                className="picker-button ghost"
                disabled={descSaving}
                onClick={() => setDescEditing(null)}
              >
                {t('project.descriptionCancel')}
              </button>
              <button
                className="picker-button primary"
                disabled={descSaving || !onUpdateWorkDescription}
                onClick={() => {
                  if (!onUpdateWorkDescription) return
                  setDescSaving(true)
                  void (async () => {
                    try {
                      await onUpdateWorkDescription(descEditing.path, descDraft.trim())
                      setDescEditing(null)
                    } finally {
                      setDescSaving(false)
                    }
                  })()
                }}
              >
                {t('project.descriptionSave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 兼容旧引用名 */
export const ProjectPickerPage = BookshelfPage
