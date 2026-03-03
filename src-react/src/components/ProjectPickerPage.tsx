import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { LaunchMode, ProjectItem, ProjectSource } from '../tauri'
import { AppIcon } from './icons/AppIcon'
import './ProjectPickerPage.css'

type ProjectPickerPageProps = {
  busy: boolean
  error: string | null
  defaultRoot: string
  defaultProjects: ProjectItem[]
  externalProjects: ProjectItem[]
  lastWorkspace: string | null
  launchMode: LaunchMode
  onSelectProject: (path: string, source: ProjectSource) => void
  onCreateProject: (name: string) => void
  onLoadExternalProject: () => void
  onForgetExternalProject: (path: string) => void
  onRefresh: () => void
  onLaunchModeChange: (mode: LaunchMode) => void
  manualPathEnabled?: boolean
  onOpenManualPath?: (path: string) => void
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onForget,
  t,
}: {
  project: ProjectItem
  busy: boolean
  onOpen: (path: string, source: ProjectSource) => void
  onForget?: (path: string) => void
  t: (key: string) => string
}) {
  return (
    <div className="project-card">
      <button className="project-card-main" disabled={busy} onClick={() => onOpen(project.path, project.source)}>
        <div className="project-card-title-row">
          <strong className="project-card-title">{project.name}</strong>
          <span className={`project-badge ${project.is_valid_workspace ? 'ok' : 'warn'}`}>
            {project.is_valid_workspace ? t('project.ready') : t('project.needsInit')}
          </span>
        </div>
        <div className="project-card-path" title={project.path}>
          {project.path}
        </div>
      </button>
      {onForget ? (
        <button
          className="project-card-forget"
          disabled={busy}
          onClick={() => onForget(project.path)}
          title={t('project.removeHint')}
        >
          {t('project.remove')}
        </button>
      ) : null}
    </div>
  )
}

export function ProjectPickerPage({
  busy,
  error,
  defaultRoot,
  defaultProjects,
  externalProjects,
  lastWorkspace,
  launchMode,
  onSelectProject,
  onCreateProject,
  onLoadExternalProject,
  onForgetExternalProject,
  onRefresh,
  onLaunchModeChange,
  manualPathEnabled = false,
  onOpenManualPath,
}: ProjectPickerPageProps) {
  const { t } = useI18n()
  const [manualPath, setManualPath] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const allProjectsCount = defaultProjects.length + externalProjects.length

  const groupedStats = useMemo(
    () => ({
      default: defaultProjects.length,
      external: externalProjects.length,
    }),
    [defaultProjects.length, externalProjects.length],
  )

  const canCreate = newProjectName.trim().length > 0 && !busy

  return (
    <div className="project-picker-page">
      <div className="project-picker-bg" aria-hidden="true" />
      <div className="project-picker-shell">
        <header className="project-picker-header">
          <div className="project-picker-heading">
            <div className="project-picker-brand">
              <span className="project-picker-brand-icon">
                <AppIcon name="projectSwitch" size={14} />
              </span>
              <span>{t('project.brand')}</span>
            </div>
            <h1>{t('project.title')}</h1>
            <p>{t('project.subtitle')}</p>
          </div>
          <div className="project-picker-header-actions">
            <button className="picker-button ghost" onClick={onRefresh} disabled={busy}>
              {t('project.refresh')}
            </button>
            <button className="picker-button primary" onClick={onLoadExternalProject} disabled={busy}>
              {t('project.importExternal')}
            </button>
          </div>
        </header>

        <section className="project-create-panel">
          <div className="project-create-left">
            <h2>{t('project.createNew')}</h2>
            <p>{t('project.createNewHint')}</p>
          </div>
          <div className="project-create-right">
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('project.newNamePlaceholder')}
              disabled={busy}
            />
            <button
              className="picker-button primary"
              disabled={!canCreate}
              onClick={() => {
                const name = newProjectName.trim()
                if (!name) return
                onCreateProject(name)
              }}
            >
              {t('project.createEnter')}
            </button>
          </div>
        </section>

        <section className="project-launch-mode">
          <label htmlFor="launch-mode">{t('project.launchBehavior')}</label>
          <select
            id="launch-mode"
            value={launchMode}
            disabled={busy}
            onChange={(e) => onLaunchModeChange(e.target.value as LaunchMode)}
          >
            <option value="picker">{t('project.launchPicker')}</option>
            <option value="auto_last">{t('project.launchAutoLast')}</option>
          </select>
          {lastWorkspace ? (
            <span className="project-last-workspace">{t('project.lastProject')}: {lastWorkspace}</span>
          ) : (
            <span className="project-last-workspace">{t('project.lastProject')}: {t('project.none')}</span>
          )}
        </section>

        <section className="project-summary-grid">
          <article>
            <h3>{t('project.defaultProjects')}</h3>
            <p>{groupedStats.default}</p>
          </article>
          <article>
            <h3>{t('project.externalProjects')}</h3>
            <p>{groupedStats.external}</p>
          </article>
          <article>
            <h3>{t('project.total')}</h3>
            <p>{allProjectsCount}</p>
          </article>
        </section>

        <section className="project-section">
          <div className="project-section-title-row">
            <h2>{t('project.localLibrary')}</h2>
            <span className="project-root" title={defaultRoot}>
              {defaultRoot}
            </span>
          </div>
          <div className="project-list">
            {defaultProjects.length === 0 ? (
              <div className="project-empty">{t('project.noProjects')}</div>
            ) : (
              defaultProjects.map((project) => (
                <ProjectCard key={project.path} project={project} busy={busy} onOpen={onSelectProject} t={t} />
              ))
            )}
          </div>
        </section>

        <section className="project-section">
          <div className="project-section-title-row">
            <h2>{t('project.externalTitle')}</h2>
            <span className="project-root">{t('project.externalHint')}</span>
          </div>
          <div className="project-list">
            {externalProjects.length === 0 ? (
              <div className="project-empty">{t('project.noExternal')}</div>
            ) : (
              externalProjects.map((project) => (
                <ProjectCard
                  key={project.path}
                  project={project}
                  busy={busy}
                  onOpen={onSelectProject}
                  onForget={onForgetExternalProject}
                  t={t}
                />
              ))
            )}
          </div>
        </section>

        {manualPathEnabled ? (
          <section className="project-section">
            <div className="project-section-title-row">
              <h2>{t('project.manualPath')}</h2>
            </div>
            <div className="project-manual-row">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder={t('project.manualPathPlaceholder')}
              />
              <button
                className="picker-button primary"
                disabled={busy || !manualPath.trim()}
                onClick={() => {
                  if (!onOpenManualPath) return
                  onOpenManualPath(manualPath.trim())
                }}
              >
                {t('project.open')}
              </button>
            </div>
          </section>
        ) : null}

        {error ? <div className="project-picker-error">{error}</div> : null}
      </div>
    </div>
  )
}
