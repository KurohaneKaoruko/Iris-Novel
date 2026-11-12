/**
 * Web RPC 客户端：POST /api/rpc/{command}，返回体 {ok}|{err}。
 * 与 iris-creation-server 的 rpc_dispatch 契约对齐（camelCase/snake_case 均可）。
 */

const BASE = (import.meta.env?.VITE_IRIS_CREATION_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export class RpcError extends Error {
  readonly command: string
  constructor(command: string, message: string) {
    super(message)
    this.command = command
  }
}

export async function rpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/api/rpc/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  })
  if (!res.ok && res.status === 403) {
    throw new RpcError(command, 'forbidden origin: 请从本机地址访问服务')
  }
  if (!res.ok) {
    throw new RpcError(command, `http ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { ok?: unknown; err?: string }
  if (typeof data.err === 'string') {
    throw new RpcError(command, data.err)
  }
  return data.ok as T
}

/**
 * WS 事件订阅（/ws，自动重连）。返回取消订阅函数。
 * iris-creation-server 把 ai_stream_* / fs_changed 等事件统一经 WS 广播。
 */
export type Unlisten = () => void

export function subscribeEvent(event: string, handler: (payload: unknown) => void): Unlisten {
  let closed = false
  let ws: WebSocket | null = null
  let retryTimer: number | null = null
  let attempts = 0

  const connect = () => {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => {
      attempts = 0
    }
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as { event?: string; payload?: unknown }
        if (data.event === event) {
          handler(data.payload)
        }
      } catch {
        // 忽略非 JSON 帧
      }
    }
    ws.onclose = () => {
      if (closed) return
      attempts += 1
      const delay = Math.min(1000 * 2 ** attempts, 15000)
      retryTimer = window.setTimeout(connect, delay)
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()
  return () => {
    closed = true
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    ws?.close()
  }
}

/** 发送 WS 指令（如取消流：{type:'cancel', streamId}）。失败返回 false（由调用方回退 HTTP）。 */
export function wsSend(message: Record<string, unknown>): boolean {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  // 简单起见每次新建短连接发送（低频指令），避免全局单例生命周期管理
  try {
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => {
      ws.send(JSON.stringify(message))
      ws.close()
    }
    return true
  } catch {
    return false
  }
}

/* ============ 流式事件共享连接 ============ *
 * ai_stream_* 事件高频且并发（多稿对照同时 2-4 条流）。每流各开 WS 会在
 * 服务端 subscribe() 前漏掉先广播的事件（快 Provider 下必现）。改为全局
 * 一条共享连接：首个订阅者触发建立，之后新流零握手直接挂上，按 streamId
 * 自行过滤。最后一个订阅者取消后关闭连接。 */

type StreamEvtHandler = (event: string, payload: unknown) => void

const streamSubs = new Set<StreamEvtHandler>()
let streamWs: WebSocket | null = null
let streamWsReady = false
let streamRetryTimer: number | null = null

function ensureStreamWs(): void {
  if (streamWs) return
  streamWsReady = false
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  streamWs = ws
  ws.onopen = () => {
    if (streamWs === ws) streamWsReady = true
  }
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data as string) as { event?: string; payload?: unknown }
      if (!data.event) return
      for (const h of streamSubs) h(data.event, data.payload)
    } catch {
      // 忽略非 JSON 帧
    }
  }
  ws.onclose = () => {
    if (streamWs !== ws) return
    streamWs = null
    streamWsReady = false
    // 还有订阅者（页面未关）时自动重连
    if (streamSubs.size > 0 && streamRetryTimer === null) {
      streamRetryTimer = window.setTimeout(() => {
        streamRetryTimer = null
        ensureStreamWs()
      }, 1000)
    }
  }
  ws.onerror = () => {
    ws.close()
  }
}

/** 订阅流式事件（共享 WS）。返回 {unlisten, waitReady}；连接已就绪时 waitReady 立即 resolve。 */
export function subscribeStreamEvents(handler: StreamEvtHandler): {
  unlisten: Unlisten
  waitReady: () => Promise<void>
} {
  streamSubs.add(handler)
  ensureStreamWs()
  let cancelled = false
  const waitReady = () =>
    new Promise<void>((resolve) => {
      if (cancelled) return resolve()
      if (streamWsReady) return resolve()
      const t = window.setInterval(() => {
        if (cancelled || streamWsReady) {
          window.clearInterval(t)
          resolve()
        }
      }, 30)
      // 最多等 2 秒：WS 不可用时不能永远卡住，RPC 错误会自然浮出
      window.setTimeout(() => {
        window.clearInterval(t)
        resolve()
      }, 2000)
    })
  return {
    unlisten: () => {
      cancelled = true
      streamSubs.delete(handler)
      if (streamSubs.size === 0 && streamWs) {
        const ws = streamWs
        streamWs = null
        streamWsReady = false
        ws.close()
      }
    },
    waitReady,
  }
}
