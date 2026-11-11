// @vitest-environment jsdom
/**
 * useChat 事件协议测试（零新依赖：react-dom/test-utils 的 act + 自建挂载壳）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react' // React 18: act 从 react 导出（react-dom/test-utils 已弃用路径在 18.3 仍可用，但 react 直接导出最稳）
import { useChat } from './useChat'

type HookApi = ReturnType<typeof useChat>

// ---- mock rpc / backend ----
type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
let mockGenResult: Promise<unknown> = Promise.resolve()

vi.mock('../api/rpc', () => ({
  subscribeEvent: vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? []
    list.push(handler)
    handlers.set(event, list)
    return () => {
      const l = handlers.get(event) ?? []
      handlers.set(event, l.filter((h) => h !== handler))
    }
  }),
  wsSend: vi.fn(() => true),
}))

vi.mock('../api/backend', () => ({
  chatGenerateStream: vi.fn(() => mockGenResult),
  chatCancelStream: vi.fn(() => Promise.resolve()),
}))

function emit(event: string, payload: unknown) {
  for (const h of handlers.get(event) ?? []) h(payload)
}

/** 极简 hook 挂载壳 */
function mountHook(use: () => HookApi): { api: HookApi; unmount: () => void } {
  let captured: HookApi | null = null
  function Probe(): ReactElement {
    captured = use()
    return createElement('div')
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(createElement(Probe))
  })
  return {
    get api() {
      if (!captured) throw new Error('hook not rendered')
      return captured
    },
    unmount: () => act(() => root.unmount()),
  }
}

beforeEach(() => {
  handlers.clear()
  mockGenResult = Promise.resolve()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useChat 事件协议', () => {
  it('token 累积 + done 收尾，content 干净落地', async () => {
    const h = mountHook(useChat)
    expect(handlers.get('ai_stream_token')?.length).toBeGreaterThan(0)

    await act(async () => {
      await h.api.send('你好', {})
    })
    const sid = h.api.messages.at(-1)?.streamId
    expect(sid).toBeTruthy()
    expect(h.api.busy).toBe(true)

    act(() => emit('ai_stream_token', { streamId: sid, token: '第一段。' }))
    act(() => emit('ai_stream_token', { streamId: sid, token: '第二段。' }))
    expect(h.api.messages.at(-1)?.content).toBe('第一段。第二段。')

    act(() => emit('ai_stream_done', { streamId: sid }))
    expect(h.api.busy).toBe(false)
    expect(h.api.messages.at(-1)?.streaming).toBe(false)
    expect(h.api.messages.at(-1)?.content).toBe('第一段。第二段。')
    expect(h.api.messages.at(-1)?.failed).toBeUndefined()
    h.unmount()
  })

  it('ai_error 立即终止流（无 done 也能收尾）', async () => {
    const h = mountHook(useChat)
    await act(async () => {
      await h.api.send('hi', {})
    })
    const sid = h.api.messages.at(-1)?.streamId
    act(() => emit('ai_error', { streamId: sid, message: 'no API key configured' }))
    expect(h.api.busy).toBe(false)
    expect(h.api.messages.at(-1)?.failed).toBe('no API key configured')
    h.unmount()
  })

  it('其它 streamId 的事件不串流', async () => {
    const h = mountHook(useChat)
    await act(async () => {
      await h.api.send('q', {})
    })
    act(() => emit('ai_stream_token', { streamId: 'other', token: '污染' }))
    expect(h.api.messages.at(-1)?.content).toBe('')
    act(() => emit('ai_stream_done', { streamId: h.api.messages.at(-1)?.streamId }))
    expect(h.api.busy).toBe(false)
    h.unmount()
  })

  it('RPC reject 也会终止流', async () => {
    mockGenResult = Promise.reject(new Error('network down'))
    const h = mountHook(useChat)
    await act(async () => {
      await h.api.send('hi', {})
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(h.api.busy).toBe(false)
    expect(h.api.messages.at(-1)?.failed).toBe('network down')
    h.unmount()
  })

  it('空文本不发送', async () => {
    const h = mountHook(useChat)
    await act(async () => {
      await h.api.send('   ', {})
    })
    expect(h.api.messages.length).toBe(0)
    h.unmount()
  })

  it('clear 复位 busy 并清空消息', async () => {
    const h = mountHook(useChat)
    await act(async () => {
      await h.api.send('q', {})
    })
    act(() => {
      h.api.clear()
    })
    expect(h.api.messages.length).toBe(0)
    expect(h.api.busy).toBe(false)
    h.unmount()
  })

  it('restore 载入历史会话', () => {
    const h = mountHook(useChat)
    act(() => {
      h.api.restore([
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
      ])
    })
    expect(h.api.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(h.api.messages[0].content).toBe('旧问题')
    h.unmount()
  })
})
