import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, act, renderHook, waitFor } from '@testing-library/react'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import { useWorkspaceTabs } from '../src/hooks/useWorkspaceTabs'

const invokeMock = vi.mocked(callCommand)

function setup() {
  const onError = vi.fn()
  const onBusyChange = vi.fn()
  const hook = renderHook(() => useWorkspaceTabs({ onError, onBusyChange }))
  return { ...hook, onError, onBusyChange }
}

describe('useWorkspaceTabs', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'read_text') {
        const p = String(args?.relativePath ?? '')
        if (p === 'stories/ch1.md') return '# one'
        if (p === 'stories/ch2.md') return '# two'
        throw new Error('not found')
      }
      throw new Error(`unexpected: ${command}`)
    })
  })
  afterEach(() => cleanup())

  it('opens a file, sets active path, and reuses an already-open tab', async () => {
    const h = setup()
    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md') })
    expect(h.result.current.activePath).toBe('stories/ch1.md')
    expect(h.result.current.activeFile?.name).toBe('ch1.md')
    expect(h.result.current.activeFile?.dirty).toBe(false)

    // 再次打开同一路径：不重新读文件
    const callsBefore = invokeMock.mock.calls.length
    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md') })
    expect(invokeMock.mock.calls.length).toBe(callsBefore)
    expect(h.result.current.openFiles).toHaveLength(1)
  })

  it('forceReload re-reads content from disk', async () => {
    const h = setup()
    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md') })
    invokeMock.mockImplementation(async () => '# one updated')

    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md', { forceReload: true }) })
    expect(h.result.current.activeFile?.content).toBe('# one updated')
    expect(h.result.current.openFiles).toHaveLength(1)
  })

  it('closeActiveTab removes the file and focuses the neighbor', async () => {
    const h = setup()
    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md') })
    await act(async () => { await h.result.current.onOpenByPath('stories/ch2.md') })
    expect(h.result.current.openFiles).toHaveLength(2)

    act(() => { h.result.current.closeActiveTab() })
    expect(h.result.current.openFiles.map((f) => f.path)).toEqual(['stories/ch1.md'])
    expect(h.result.current.activePath).toBe('stories/ch1.md')

    act(() => { h.result.current.closeActiveTab() })
    expect(h.result.current.openFiles).toHaveLength(0)
    expect(h.result.current.activePath).toBeNull()
  })

  it('focusNeighborTab cycles across tabs', async () => {
    const h = setup()
    await act(async () => { await h.result.current.onOpenByPath('stories/ch1.md') })
    await act(async () => { await h.result.current.onOpenByPath('stories/ch2.md') })

    act(() => { h.result.current.focusNeighborTab('prev') })
    expect(h.result.current.activePath).toBe('stories/ch1.md')
    act(() => { h.result.current.focusNeighborTab('prev') })
    expect(h.result.current.activePath).toBe('stories/ch2.md')
    act(() => { h.result.current.focusNeighborTab('next') })
    expect(h.result.current.activePath).toBe('stories/ch1.md')
  })

  it('reports read failure via onError and clears busy', async () => {
    const h = setup()
    await act(async () => { await h.result.current.onOpenByPath('stories/missing.md') })
    expect(h.onError).toHaveBeenCalledWith(expect.stringContaining('not found'))
    expect(h.onBusyChange).toHaveBeenLastCalledWith(false)
    expect(h.result.current.openFiles).toHaveLength(0)
  })
})
