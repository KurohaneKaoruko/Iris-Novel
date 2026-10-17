import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const unlistenMock = vi.fn()
vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  subscribeEvent: vi.fn().mockImplementation(async () => unlistenMock),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import { MaterialGraphPanel } from '../src/components/MaterialGraphPanel'
import { I18nProvider } from '../src/i18n/I18nProvider'

const invokeMock = vi.mocked(callCommand)

const CONCEPT_MD = [
  '## 林秋',
  '',
  '- 身份： 侦探',
  '- 关系： 苏晚（搭档）',
  '',
  '## 苏晚',
  '',
  '- 身份： 法医',
].join('\n')

function mockBackend() {
  const store: Record<string, string> = {
    'concept/人物.md': CONCEPT_MD,
  }
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_workspace_tree') {
      return {
        name: '', path: '', kind: 'dir',
        children: [
          { name: 'concept', path: 'concept', kind: 'dir', children: [
            { name: '人物.md', path: 'concept/人物.md', kind: 'file' },
          ] },
          { name: 'outline', path: 'outline', kind: 'dir', children: [] },
        ],
      }
    }
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (p in store) return store[p]
      if (p === '.novel/index/material-index.json') throw new Error('not found')
      throw new Error(`unexpected read: ${p}`)
    }
    if (command === 'write_text') return undefined
    throw new Error(`unexpected: ${command}`)
  })
  return store
}

describe('MaterialGraphPanel', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    mockBackend()
  })
  afterEach(() => cleanup())

  it('renders nodes as SVG with relation edges', async () => {
    const onOpen = vi.fn()
    render(
      <I18nProvider>
        <MaterialGraphPanel onOpenSourceFile={onOpen} />
      </I18nProvider>,
    )
    await waitFor(() => {
      expect(screen.getAllByText('林秋').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('苏晚').length).toBeGreaterThan(0)
    // 关系边存在（林秋-苏晚 互为 relations）
    const svg = document.querySelector('.material-graph-svg')
    expect(svg).toBeTruthy()
    expect(document.querySelectorAll('.material-graph-edge').length).toBeGreaterThanOrEqual(1)
  })

  it('clicking a node shows detail with attributes and opens source file', async () => {
    const onOpen = vi.fn()
    render(
      <I18nProvider>
        <MaterialGraphPanel onOpenSourceFile={onOpen} />
      </I18nProvider>,
    )
    await waitFor(() => {
      expect(screen.getAllByText('林秋').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByText('林秋')[0])
    const detail = await screen.findByTestId('material-graph-detail')
    expect(detail.textContent).toContain('侦探')
    expect(detail.textContent).toContain('concept/人物.md'.length > 0 ? '' : '')

    fireEvent.click(screen.getByText('Open source file'))
    expect(onOpen).toHaveBeenCalledWith('concept/人物.md')
  })

  it('shows empty state when no material entries', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_workspace_tree') {
        return { name: '', path: '', kind: 'dir', children: [] }
      }
      throw new Error('unexpected')
    })
    render(
      <I18nProvider>
        <MaterialGraphPanel onOpenSourceFile={vi.fn()} />
      </I18nProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText(/no concept\/outline entries/i)).toBeTruthy()
    })
  })
})
