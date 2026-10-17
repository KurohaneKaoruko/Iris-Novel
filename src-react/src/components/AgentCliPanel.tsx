/**
 * 外部 Agent CLI 面板：检测可用 CLI（Claude Code / Codex CLI / DeepSeek Harness）、
 * 发起写作任务、实时查看输出、审阅变更集（逐文件接受/回滚）、取消任务。
 *
 * 双端可用（桌面 IPC / 浏览器 HTTP+WS，经 transport 层透明切换）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { AppIcon } from './icons/AppIcon'
import {
  agentCliCancelTask,
  agentCliDecideChange,
  agentCliDetect,
  agentCliGetTask,
  agentCliRunTask,
  type AgentCliInfo,
  type AgentCliTaskStatus,
} from '../tauri'
import { subscribeEvent } from '../transport'
import './AgentCliPanel.css'

type Props = {
  workspaceRoot: string | null
}

export function AgentCliPanel({ workspaceRoot }: Props) {
  const { t } = useI18n()
  const [cliInfos, setCliInfos] = useState<AgentCliInfo[]>([])
  const [detecting, setDetecting] = useState(false)
  const [selectedCli, setSelectedCli] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [writeMode, setWriteMode] = useState<'review' | 'direct'>('review')
  const [task, setTask] = useState<AgentCliTaskStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)

  // ---- CLI 检测 ----
  const refreshDetection = useCallback(async () => {
    setDetecting(true)
    try {
      const infos = await agentCliDetect()
      setCliInfos(infos)
      setSelectedCli((prev) => {
        if (prev && infos.some((i) => i.id === prev && i.available)) return prev
        const first = infos.find((i) => i.available)
        return first ? first.id : ''
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])

  // ---- 事件订阅（输出增量 / 任务结束）----
  const activeTaskIdRef = useRef<string | null>(null)
  activeTaskIdRef.current = task?.task_id ?? null

  useEffect(() => {
    const unlistenFns: Array<() => void> = []
    let disposed = false
    void subscribeEvent('agent_cli_output', (payload: unknown) => {
      const p = payload as { taskId?: string; chunk?: string }
      if (!p?.chunk) return
      if (activeTaskIdRef.current && p.taskId && p.taskId !== activeTaskIdRef.current) return
      setOutput((prev) => {
        const next = prev + p.chunk
        const len = next.length
        return len > 60_000 ? next.slice(len - 60_000) : next
      })
    }).then((u) => {
      if (disposed) u()
      else unlistenFns.push(u)
    })
    void subscribeEvent('agent_cli_finished', (payload: unknown) => {
      const p = payload as { taskId?: string }
      if (!p?.taskId) return
      if (activeTaskIdRef.current && p.taskId !== activeTaskIdRef.current) return
      void agentCliGetTask(p.taskId)
        .then((status) => {
          setTask(status)
          setRunning(status.state === 'running')
        })
        .catch(() => {})
    }).then((u) => {
      if (disposed) u()
      else unlistenFns.push(u)
    })
    return () => {
      disposed = true
      unlistenFns.forEach((u) => u())
    }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  // ---- 发起任务 ----
  const startTask = useCallback(async () => {
    if (!workspaceRoot) {
      setError(t('agentCli.noWorkspace'))
      return
    }
    if (!selectedCli) {
      setError(t('agentCli.noCliSelected'))
      return
    }
    const text = prompt.trim()
    if (!text) {
      setError(t('agentCli.emptyPrompt'))
      return
    }
    setError(null)
    setOutput('')
    setRunning(true)
    try {
      const taskId = await agentCliRunTask({
        cliId: selectedCli,
        workspaceRoot,
        prompt: text,
        writeMode,
      })
      setTask({
        task_id: taskId,
        cli_id: selectedCli,
        workspace_root: workspaceRoot,
        state: 'running',
        started_at: Date.now(),
        finished_at: null,
        exit_code: null,
        output_tail: '',
        change_set: null,
        error: null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRunning(false)
    }
  }, [workspaceRoot, selectedCli, prompt, writeMode, t])

  const cancelTask = useCallback(async () => {
    if (!task) return
    try {
      await agentCliCancelTask(task.task_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [task])

  // ---- 变更决策 ----
  const decide = useCallback(async (path: string, accept: boolean) => {
    if (!task) return
    try {
      await agentCliDecideChange({ taskId: task.task_id, path, accept })
      const status = await agentCliGetTask(task.task_id)
      setTask(status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [task])

  const pendingEntries = useMemo(() => {
    const entries = task?.change_set?.entries ?? []
    return entries.filter((e) => e.decision === 'pending')
  }, [task])

  const decidedCount = useMemo(() => {
    const entries = task?.change_set?.entries ?? []
    return entries.length - pendingEntries.length
  }, [task, pendingEntries])

  const sortedInfos = useMemo(() => {
    const order: Record<string, number> = {
      'claude-code': 0,
      codex: 1,
      'deepseek-harness': 2,
    }
    return [...cliInfos].sort(
      (a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99),
    )
  }, [cliInfos])

  return (
    <div className="agent-cli-panel">
      <div className="agent-cli-header">
        <div className="agent-cli-title">
          <span className="agent-cli-title-icon">
            <AppIcon name="terminal" size={13} />
          </span>
          <span>{t('agentCli.title')}</span>
        </div>
        <button
          type="button"
          className="agent-cli-btn"
          onClick={() => void refreshDetection()}
          disabled={detecting}
          title={t('agentCli.refresh')}
        >
          <AppIcon name="refresh" size={13} />
        </button>
      </div>

      {/* CLI 可用状态 */}
      <div className="agent-cli-section">
        {sortedInfos.map((info) => (
          <button
            key={info.id}
            type="button"
            className={`agent-cli-item ${selectedCli === info.id ? 'selected' : ''} ${info.available ? '' : 'unavailable'}`}
            onClick={() => info.available && setSelectedCli(info.id)}
            title={info.error ?? info.version ?? ''}
          >
            <span className={`agent-cli-dot ${info.available ? 'on' : 'off'}`} />
            <span className="agent-cli-item-name">{info.name}</span>
            {info.version ? (
              <span className="agent-cli-version">{info.version}</span>
            ) : null}
          </button>
        ))}
        {sortedInfos.length === 0 && !detecting ? (
          <div className="agent-cli-empty">{t('agentCli.noneAvailable')}</div>
        ) : null}
      </div>

      {/* 任务表单 */}
      <div className="agent-cli-section">
        <textarea
          className="agent-cli-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('agentCli.promptPlaceholder')}
          disabled={running}
          rows={4}
        />
        <div className="agent-cli-mode-row">
          <label className="agent-cli-mode">
            <input
              type="radio"
              name="agent-cli-write-mode"
              checked={writeMode === 'review'}
              onChange={() => setWriteMode('review')}
              disabled={running}
            />
            <span>{t('agentCli.modeReview')}</span>
          </label>
          <label className="agent-cli-mode">
            <input
              type="radio"
              name="agent-cli-write-mode"
              checked={writeMode === 'direct'}
              onChange={() => setWriteMode('direct')}
              disabled={running}
            />
            <span>{t('agentCli.modeDirect')}</span>
          </label>
        </div>
        <div className="agent-cli-actions">
          {running ? (
            <button
              type="button"
              className="agent-cli-btn primary danger"
              onClick={() => void cancelTask()}
            >
              <AppIcon name="stop" size={13} />
              <span>{t('agentCli.cancel')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="agent-cli-btn primary"
              onClick={() => void startTask()}
              disabled={!selectedCli || !workspaceRoot}
            >
              <AppIcon name="add" size={13} />
              <span>{t('agentCli.run')}</span>
            </button>
          )}
        </div>
        {!workspaceRoot ? (
          <div className="agent-cli-hint">{t('agentCli.noWorkspace')}</div>
        ) : null}
        {error ? <div className="agent-cli-error">{error}</div> : null}
      </div>

      {/* 实时输出 */}
      {running || output ? (
        <div className="agent-cli-section grow">
          <div className="agent-cli-subsection-title">
            {t('agentCli.output')}
            {running ? <span className="agent-cli-spinner" /> : null}
          </div>
          <div className="agent-cli-terminal" ref={outputRef}>
            <pre>{output || (running ? t('agentCli.waiting') : '')}</pre>
          </div>
        </div>
      ) : null}

      {/* 变更集审阅 */}
      {task?.change_set && task.change_set.entries.length > 0 ? (
        <div className="agent-cli-section">
          <div className="agent-cli-subsection-title">
            {t('agentCli.changeSet')}
            <span className="agent-cli-count">
              {decidedCount}/{task.change_set.entries.length}
            </span>
          </div>
          <div className="agent-cli-changes">
            {task.change_set.entries.map((entry) => (
              <div key={entry.path} className="agent-cli-change">
                <div className="agent-cli-change-head">
                  <span
                    className={`agent-cli-change-type ${entry.change_type}`}
                  >
                    {t(`agentCli.change.${entry.change_type}`)}
                  </span>
                  <span className="agent-cli-change-path" title={entry.path}>
                    {entry.path}
                  </span>
                  {entry.decision !== 'pending' ? (
                    <span className={`agent-cli-decision ${entry.decision}`}>
                      {t(`agentCli.decision.${entry.decision}`)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="agent-cli-btn small"
                    onClick={() =>
                      setExpandedEntry(
                        expandedEntry === entry.path ? null : entry.path,
                      )
                    }
                  >
                    {expandedEntry === entry.path
                      ? t('agentCli.diffHide')
                      : t('agentCli.diffShow')}
                  </button>
                  {entry.decision === 'pending' ? (
                    <span className="agent-cli-change-actions">
                      <button
                        type="button"
                        className="agent-cli-btn small ok"
                        onClick={() => void decide(entry.path, true)}
                      >
                        {t('agentCli.accept')}
                      </button>
                      <button
                        type="button"
                        className="agent-cli-btn small danger"
                        onClick={() => void decide(entry.path, false)}
                      >
                        {t('agentCli.revert')}
                      </button>
                    </span>
                  ) : null}
                </div>
                {expandedEntry === entry.path ? (
                  <pre className="agent-cli-diff">
                    {entry.change_type === 'added'
                      ? (entry.new_text ?? '')
                      : entry.change_type === 'deleted'
                        ? (entry.old_text ?? '')
                        : (entry.unified_diff ??
                          `${entry.old_text ?? ''}\n---\n${entry.new_text ?? ''}`)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 任务错误 */}
      {task?.error ? (
        <div className="agent-cli-section">
          <div className="agent-cli-error">
            {task.state === 'failed' ? `${t('agentCli.failed')}：` : ''}
            {task.error}
          </div>
        </div>
      ) : null}
    </div>
  )
}
