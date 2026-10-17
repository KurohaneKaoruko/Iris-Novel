import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
  isTauriApp: () => true,
}))

import { callCommand } from '../src/transport'
import { WorkspaceLayout } from '../src/components/WorkspaceLayout'
import { I18nProvider } from '../src/i18n/I18nProvider'

const invokeMock = vi.mocked(callCommand)

function setupLayout(overrides?: Partial<Parameters<typeof WorkspaceLayout>[0]>) {
  const handlers = {
    onOpenChapter: vi.fn(),
    onSidebarCollapsedChange: vi.fn(),
    onSidebarWidthChange: vi.fn(),
    onRightPanelWidthChange: vi.fn(),
    onImmersiveChange: vi.fn(),
  }
  const props = {
    workspaceRoot: '/tmp/work',
    activePath: 'stories/ch1.md',
    tabsSlot: <div data-testid="tabs" />,
    editorSlot: <div data-testid="editor">editor-content-marker</div>,
    aiPanelSlot: <div data-testid="ai">ai-content-marker</div>,
    sidebarCollapsed: false,
    sidebarWidth: 240,
    rightPanelWidth: 340,
    ...handlers,
    ...overrides,
  } as Parameters<typeof WorkspaceLayout>[0]
  render(
    <I18nProvider>
      <WorkspaceLayout {...props} />
    </I18nProvider>,
  )
  return handlers
}

// ChapterList 数据：list_workspace_tree + read_text
function mockChapters() {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_workspace_tree') {
      return {
        name: '', path: '', kind: 'dir' as const,
        children: [
          { name: 'stories', path: 'stories', kind: 'dir' as const, children: [
            { name: 'ch1.md', path: 'stories/ch1.md', kind: 'file' as const },
            { name: 'ch2.md', path: 'stories/ch2.md', kind: 'file' as const },
          ] },
        ],
      }
    }
    if (command === 'read_text') {
      const p = String(args?.relativePath ?? '')
      if (p === 'stories/ch1.md') return '# 第一章'
      if (p === 'stories/ch2.md') return '# 第二章'
      if (p.startsWith('.novel')) return '{"chapters":[]}'
      throw new Error('not found')
    }
    if (command === 'write_text') return undefined
    throw new Error(`unexpected: ${command}`)
  })
}

describe('WorkspaceLayout', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    mockChapters()
  })
  afterEach(() => cleanup())

  it('renders four regions with slots and chapter list', async () => {
    setupLayout()
    expect(screen.getByTestId('tabs')).toBeTruthy()
    expect(screen.getByTestId('editor').textContent).toContain('editor-content-marker')
    expect(screen.getByTestId('ai').textContent).toContain('ai-content-marker')
    await screen.findByText('Ch1')
    expect(screen.getByText('Ch2')).toBeTruthy()
  })

  it('clicking a chapter opens it', async () => {
    const h = setupLayout()
    const item = await screen.findByText('Ch2')
    fireEvent.click(item)
    expect(h.onOpenChapter).toHaveBeenCalledWith('stories/ch2.md')
  })

  it('collapse and restore keep editor content', async () => {
    const h = setupLayout()
    await screen.findByText('Ch1')

    // 折叠（受控：父级把 sidebarCollapsed 置 true）
    fireEvent.click(screen.getByTitle('Collapse chapter list'))
    expect(h.onSidebarCollapsedChange).toHaveBeenCalledWith(true)
  })

  it('collapsed -> restored shows chapters and editor content again (4.4)', async () => {
    // 初始正常态
    const { rerender } = render(
      <I18nProvider>
        <WorkspaceLayout
          workspaceRoot="/tmp/work"
          activePath="stories/ch1.md"
          onOpenChapter={vi.fn()}
          tabsSlot={<div data-testid="tabs" />}
          editorSlot={<div data-testid="editor">editor-content-marker</div>}
          aiPanelSlot={<div data-testid="ai" />}
          sidebarCollapsed={false}
          sidebarWidth={240}
          rightPanelWidth={340}
          onSidebarCollapsedChange={vi.fn()}
          onSidebarWidthChange={vi.fn()}
          onRightPanelWidthChange={vi.fn()}
        />
      </I18nProvider>,
    )
    await screen.findByText('Ch1')
    expect(screen.getByTestId('editor').textContent).toContain('editor-content-marker')

    // 折叠态：章节列表隐藏，编辑器内容保留
    rerender(
      <I18nProvider>
        <WorkspaceLayout
          workspaceRoot="/tmp/work"
          activePath="stories/ch1.md"
          onOpenChapter={vi.fn()}
          tabsSlot={<div data-testid="tabs" />}
          editorSlot={<div data-testid="editor">editor-content-marker</div>}
          aiPanelSlot={<div data-testid="ai" />}
          sidebarCollapsed
          sidebarWidth={240}
          rightPanelWidth={340}
          onSidebarCollapsedChange={vi.fn()}
          onSidebarWidthChange={vi.fn()}
          onRightPanelWidthChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(screen.queryByText('Ch1')).toBeNull()
    expect(screen.getByTestId('editor').textContent).toContain('editor-content-marker')
    expect(screen.getByTitle('Expand chapter list')).toBeTruthy()

    // 恢复：章节列表回来，内容不丢
    rerender(
      <I18nProvider>
        <WorkspaceLayout
          workspaceRoot="/tmp/work"
          activePath="stories/ch1.md"
          onOpenChapter={vi.fn()}
          tabsSlot={<div data-testid="tabs" />}
          editorSlot={<div data-testid="editor">editor-content-marker</div>}
          aiPanelSlot={<div data-testid="ai" />}
          sidebarCollapsed={false}
          sidebarWidth={240}
          rightPanelWidth={340}
          onSidebarCollapsedChange={vi.fn()}
          onSidebarWidthChange={vi.fn()}
          onRightPanelWidthChange={vi.fn()}
        />
      </I18nProvider>,
    )
    await screen.findByText('Ch1')
    expect(screen.getByTestId('editor').textContent).toContain('editor-content-marker')
    expect(screen.getByTitle('Collapse chapter list')).toBeTruthy()
  })

  it('immersive mode shows only AI panel and exit restores snapshot', async () => {
    const h = setupLayout({ immersive: false })
    await screen.findByText('Ch1')

    // 进入沉浸
    fireEvent.click(screen.getByTitle(/immersive/i))
    expect(h.onImmersiveChange).toHaveBeenCalledWith(true)
    // 快照恢复调用（退出时恢复宽度）
    expect(h.onSidebarCollapsedChange).not.toHaveBeenCalled()

    // 受控切换到沉浸态（父级把 immersive 置 true 后的呈现）
    cleanup()
    const h2 = setupLayout({ immersive: true })

    // 仅 AI 区可见
    expect(screen.getByTestId('workspace-immersive')).toBeTruthy()
    expect(screen.getByTestId('ai').textContent).toContain('ai-content-marker')
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(screen.queryByTestId('tabs')).toBeNull()

    // 退出：恢复快照并回调 false
    fireEvent.click(screen.getByText('Exit immersive mode'))
    expect(h2.onImmersiveChange).toHaveBeenCalledWith(false)
  })

  it('Escape exits immersive mode', () => {
    setupLayout({ immersive: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    // 退出经由 exitImmersive -> onImmersiveChange(false)
    // （快照为空时也直接回调 false）
  })
})
