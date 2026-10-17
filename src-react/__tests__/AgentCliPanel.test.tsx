import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ---- mock transport（AgentCliPanel 经 tauri.ts -> callCommand / subscribeEvent）----
const unlistenMock = vi.fn()
vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  subscribeEvent: vi.fn().mockImplementation(async () => unlistenMock),
  isTauriApp: () => true,
}))

import { callCommand, subscribeEvent } from '../src/transport'
import { AgentCliPanel } from '../src/components/AgentCliPanel'
import { I18nProvider } from '../src/i18n/I18nProvider'

function renderPanel(props: { workspaceRoot: string | null }) {
  return render(
    <I18nProvider>
      <AgentCliPanel workspaceRoot={props.workspaceRoot} />
    </I18nProvider>,
  )
}

const invokeMock = vi.mocked(callCommand)
const subscribeMock = vi.mocked(subscribeEvent)

function mockCliDetect(infos: Array<{ id: string; name: string; available: boolean }>) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'agent_cli_detect') {
      return infos.map((i) => ({
        id: i.id,
        name: i.name,
        available: i.available,
        version: i.available ? '1.0.0' : null,
        error: i.available ? null : 'not found',
      }))
    }
    if (command === 'agent_cli_run_task') return 'task-1'
    if (command === 'agent_cli_get_task') {
      return {
        task_id: 'task-1',
        cli_id: 'claude-code',
        workspace_root: '/tmp/work',
        state: 'finished',
        started_at: 1,
        finished_at: 2,
        exit_code: 0,
        output_tail: '',
        change_set: {
          task_id: 'task-1',
          workspace_root: '/tmp/work',
          entries: [
            {
              path: 'stories/ch3.md',
              change_type: 'modified',
              old_text: 'old',
              new_text: 'new',
              unified_diff: '@@ -1 +1 @@',
              decision: 'pending',
            },
          ],
          created_at: 2,
        },
        error: null,
      }
    }
    throw new Error(`unexpected command: ${command}`)
  })
}

describe('AgentCliPanel', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    subscribeMock.mockClear()
    unlistenMock.mockClear()
  })
  afterEach(() => cleanup())

  it('renders detected CLIs with availability and selects the first available', async () => {
    mockCliDetect([
      { id: 'claude-code', name: 'Claude Code', available: false },
      { id: 'codex', name: 'Codex CLI', available: true },
      { id: 'deepseek-harness', name: 'DeepSeek Harness', available: true },
    ])
    renderPanel({ workspaceRoot: "/tmp/work" })

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeTruthy()
    })
    const codexItem = screen.getByText('Codex CLI').closest('button')
    expect(codexItem?.classList.contains('selected')).toBe(true)
    expect(codexItem?.classList.contains('unavailable')).toBe(false)
    expect(screen.getByText('Claude Code').closest('button')?.classList.contains('unavailable')).toBe(true)
  })

  it('shows empty hint when no CLI is available', async () => {
    mockCliDetect([])
    renderPanel({ workspaceRoot: "/tmp/work" })
    await waitFor(() => {
      expect(screen.getByText(/no CLI detected/i)).toBeTruthy()
    })
  })

  it('runs a task and renders the change set for review', async () => {
    mockCliDetect([{ id: 'claude-code', name: 'Claude Code', available: true }])
    renderPanel({ workspaceRoot: "/tmp/work" })

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeTruthy()
    })
    const textarea = screen.getByPlaceholderText(/chapter 3/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'write chapter 3' } })
    fireEvent.click(screen.getByText('Run task'))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('agent_cli_run_task', {
        cliId: 'claude-code',
        workspaceRoot: '/tmp/work',
        prompt: 'write chapter 3',
        writeMode: 'review',
      })
    })

    // 手动触发 finished 事件，模拟任务结束拉取状态
    const finishedCall = subscribeMock.mock.calls.find((c) => c[0] === 'agent_cli_finished')
    expect(finishedCall).toBeTruthy()
    const handler = finishedCall![1] as (payload: unknown) => void
    handler({ taskId: 'task-1' })

    await waitFor(() => {
      expect(screen.getByText('stories/ch3.md')).toBeTruthy()
    })
    expect(screen.getByText('Accept')).toBeTruthy()
    expect(screen.getByText('Revert')).toBeTruthy()

    // 接受变更
    fireEvent.click(screen.getByText('Accept'))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('agent_cli_decide_change', {
        taskId: 'task-1',
        path: 'stories/ch3.md',
        accept: true,
      })
    })
  })

  it('filters output events by active task id', async () => {
    mockCliDetect([{ id: 'codex', name: 'Codex CLI', available: true }])
    renderPanel({ workspaceRoot: "/tmp/work" })
    await waitFor(() => {
      expect(screen.getByText('Codex CLI')).toBeTruthy()
    })

    const outputCall = subscribeMock.mock.calls.find((c) => c[0] === 'agent_cli_output')
    expect(outputCall).toBeTruthy()
    const onOutput = outputCall![1] as (payload: unknown) => void
    // 无活动任务时忽略
    onOutput({ taskId: 'other', chunk: 'noise' })
    const textarea = screen.getByPlaceholderText(/chapter 3/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'write ch3' } })
    fireEvent.click(screen.getByText('Run task'))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'agent_cli_run_task',
        expect.objectContaining({ cliId: 'codex' }),
      )
    })
    // React 状态更新（task task-1 生效）后再注入输出
    await waitFor(() => {
      expect(screen.getByText(/Live output/)).toBeTruthy()
    })
    // 活动任务为 task-1，其他任务输出被过滤
    onOutput({ taskId: 'other', chunk: 'noise' })
    onOutput({ taskId: 'task-1', chunk: 'hello from cli' })
    await waitFor(() => {
      expect(screen.getByText(/hello from cli/)).toBeTruthy()
    })
    expect(screen.queryByText(/^noise$/)).toBeNull()
  })
})
