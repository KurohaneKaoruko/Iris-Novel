import { useMemo, useState } from 'react'
import type { FsEntry } from '../tauri'
import { AppIcon } from './icons/AppIcon'
import './NovelStructurePanel.css'

type NovelStructurePanelProps = {
  workspaceRoot: string | null
  tree: FsEntry | null
  activePath: string | null
  busy: boolean
  error: string | null
  onRefresh: () => void
  onOpenPath: (path: string) => void
  onNewChapter: () => void
  onNewOutline: () => void
  onNewConceptNote: () => void
  onOpenMasterPlan: () => void
  onOpenProjectPicker: () => void
}

type SectionKey = 'chapters' | 'outline' | 'concept' | 'plans'

type SectionItem = {
  path: string
  label: string
}

type SectionCollection = Record<SectionKey, SectionItem[]>

type CollapsedState = Record<SectionKey, boolean>

function collectFiles(node: FsEntry | null): FsEntry[] {
  if (!node) return []
  if (node.kind === 'file') return [node]
  return node.children.flatMap((child) => collectFiles(child))
}

function findDir(node: FsEntry | null, name: string): FsEntry | null {
  if (!node || node.kind !== 'dir') return null
  return node.children.find((child) => child.kind === 'dir' && child.name === name) ?? null
}

function buildSectionItems(files: FsEntry[]): SectionItem[] {
  return files
    .filter((entry) => entry.kind === 'file')
    .map((entry) => ({
      path: entry.path,
      label: entry.name.replace(/\.[^.]+$/, ''),
    }))
}

function countLabel(visible: number, total: number, filtered: boolean): string {
  return filtered ? `${visible}/${total}` : String(total)
}

export function NovelStructurePanel({
  workspaceRoot,
  tree,
  activePath,
  busy,
  error,
  onRefresh,
  onOpenPath,
  onNewChapter,
  onNewOutline,
  onNewConceptNote,
  onOpenMasterPlan,
  onOpenProjectPicker,
}: NovelStructurePanelProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<CollapsedState>({
    chapters: false,
    outline: false,
    concept: false,
    plans: false,
  })

  const workspaceName = useMemo(() => {
    if (!workspaceRoot) return 'Novel'
    const parts = workspaceRoot.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? 'Novel'
  }, [workspaceRoot])

  const sections = useMemo<SectionCollection>(() => {
    const chapterFiles = collectFiles(findDir(tree, 'stories'))
    const outlineFiles = collectFiles(findDir(tree, 'outline'))
    const conceptFiles = collectFiles(findDir(tree, 'concept'))
    const planFiles = collectFiles(findDir(findDir(tree, '.novel'), 'plans'))

    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
    const sortItems = (items: SectionItem[]) => [...items].sort((a, b) => collator.compare(a.label, b.label))

    return {
      chapters: sortItems(buildSectionItems(chapterFiles)),
      outline: sortItems(buildSectionItems(outlineFiles)),
      concept: sortItems(buildSectionItems(conceptFiles)),
      plans: sortItems(buildSectionItems(planFiles)),
    }
  }, [tree])

  const activePathKey = useMemo(() => {
    if (!activePath) return null
    return activePath.replaceAll('\\', '/').toLowerCase()
  }, [activePath])

  const queryKey = useMemo(() => query.trim().toLowerCase(), [query])

  const filteredSections = useMemo<SectionCollection>(() => {
    if (!queryKey) return sections
    const filterItems = (items: SectionItem[]) =>
      items.filter((item) => item.label.toLowerCase().includes(queryKey) || item.path.toLowerCase().includes(queryKey))

    return {
      chapters: filterItems(sections.chapters),
      outline: filterItems(sections.outline),
      concept: filterItems(sections.concept),
      plans: filterItems(sections.plans),
    }
  }, [queryKey, sections])

  const filteredMode = queryKey.length > 0

  const isActiveItem = (path: string): boolean => {
    return activePathKey === path.replaceAll('\\', '/').toLowerCase()
  }

  const toggleSection = (key: SectionKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (!workspaceRoot) {
    return (
      <div className="novel-structure-panel">
        <div className="novel-structure-empty">
          <h3>No novel project is opened</h3>
          <p>Open or create a project first.</p>
          <button className="primary-button" onClick={onOpenProjectPicker}>
            Open Project Picker
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="novel-structure-panel">
      <div className="novel-structure-header">
        <div className="novel-structure-title">
          <span className="novel-structure-icon"><AppIcon name="chapters" size={14} /></span>
          <strong>{workspaceName}</strong>
        </div>
        <div className="novel-structure-actions">
          <button className="icon-button" disabled={busy} title="Refresh" onClick={onRefresh}>
            <AppIcon name="refresh" size={14} />
          </button>
          <button className="icon-button" disabled={busy} title="New Chapter" onClick={onNewChapter}>
            <AppIcon name="add" size={14} />
          </button>
        </div>
      </div>

      {error ? <div className="novel-structure-error">{error}</div> : null}

      <div className="novel-structure-search-row">
        <input
          className="novel-structure-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chapter / outline / note / plan"
        />
      </div>

      <div className="novel-structure-sections">
        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('chapters')} title="Collapse/Expand">
                {collapsed.chapters ? '+' : '-'}
              </button>
              <h4>Chapters</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.chapters.length, sections.chapters.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewChapter} disabled={busy} title="New Chapter">
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.chapters ? (
            <div className="novel-structure-list">
              {filteredSections.chapters.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.chapters.length === 0 ? 'No chapters yet.' : 'No chapter matches current search.'}
                </div>
              ) : (
                filteredSections.chapters.map((item, idx) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                  >
                    <span className="novel-structure-item-index">{idx + 1}</span>
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('outline')} title="Collapse/Expand">
                {collapsed.outline ? '+' : '-'}
              </button>
              <h4>Outline</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.outline.length, sections.outline.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewOutline} disabled={busy} title="New Outline File">
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.outline ? (
            <div className="novel-structure-list">
              {filteredSections.outline.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.outline.length === 0 ? 'No outline files yet.' : 'No outline file matches current search.'}
                </div>
              ) : (
                filteredSections.outline.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('concept')} title="Collapse/Expand">
                {collapsed.concept ? '+' : '-'}
              </button>
              <h4>Concept</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.concept.length, sections.concept.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewConceptNote} disabled={busy} title="New Concept Note">
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.concept ? (
            <div className="novel-structure-list">
              {filteredSections.concept.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.concept.length === 0 ? 'No concept notes yet.' : 'No concept note matches current search.'}
                </div>
              ) : (
                filteredSections.concept.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('plans')} title="Collapse/Expand">
                {collapsed.plans ? '+' : '-'}
              </button>
              <h4>Plans</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.plans.length, sections.plans.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onOpenMasterPlan} disabled={busy} title="Open Master Plan">
                <AppIcon name="preview" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.plans ? (
            <div className="novel-structure-list">
              {filteredSections.plans.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.plans.length === 0 ? 'No plan files yet.' : 'No plan file matches current search.'}
                </div>
              ) : (
                filteredSections.plans.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}