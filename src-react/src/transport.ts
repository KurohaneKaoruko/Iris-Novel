/**
 * 传输适配层：在 Tauri IPC 与本地 HTTP/WS 服务之间透明切换。
 *
 * - Tauri 环境（桌面端）：invoke 走 IPC，事件走 Tauri event API。
 * - 浏览器环境（Web 部署模式）：invoke 走 POST /api/rpc/{command}，
 *   事件走 /ws WebSocket（自动重连），对话框降级为 window.confirm/alert。
 *
 * 业务代码（tauri.ts 及各服务）只依赖本模块导出的 callCommand / subscribeEvents /
 * dialog 系列，不感知通道差异。
 */

export type UnlistenFn = () => void

const isBrowser = typeof window !== 'undefined'

export function isTauriApp(): boolean {
  return isBrowser && '__TAURI_INTERNALS__' in window
}

function baseUrl(): string {
  // 同源部署（静态文件由 nice-server 托管）；开发模式走 Vite 代理或显式指定。
  const explicit = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_NICE_API_BASE
  if (explicit) return explicit.replace(/\/$/, '')
  return ''
}

// ---- invoke 双通道 ----

async function invokeHttp<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/rpc/${command}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  })
  if (!res.ok && res.status === 403) {
    throw new Error('forbidden origin: 请从本机地址访问服务')
  }
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { ok?: unknown; err?: string }
  if (typeof data.err === 'string') {
    throw new Error(data.err)
  }
  return data.ok as T
}

/**
 * 统一命令调用：Tauri 环境走 IPC，浏览器走 HTTP RPC。
 * 参数在 Tauri 通道保持原样传递（Tauri 自动做 camelCase 适配）；
 * HTTP 通道原样 JSON 序列化（服务端 rpc_dispatch 兼容两种命名）。
 */
export async function callCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriApp()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(command, args)
  }
  return invokeHttp<T>(command, args)
}

// ---- 事件订阅双通道 ----

type EventHandler = (payload: unknown) => void

/** 浏览器端共享 WS 连接（事件广播 + 重连）。 */
class WsEventBus {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private reconnectTimer: number | null = null
  private closed = false

  private connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = baseUrl() ? `${proto}://${baseUrl().replace(/^https?:\/\//, '')}/ws` : `${proto}://${location.host}/ws`
    try {
      this.ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as { event: string; payload: unknown }
        this.handlers.get(data.event)?.forEach((h) => h(data.payload))
      } catch {
        // 非 JSON 帧忽略
      }
    }
    this.ws.onclose = () => {
      this.ws = null
      if (!this.closed) this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.closed) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }

  subscribe(event: string, handler: EventHandler): UnlistenFn {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    this.connect()
    return () => {
      set?.delete(handler)
    }
  }

  /** 发送客户端指令（如取消流）。 */
  send(message: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
      return true
    }
    return false
  }
}

let wsBus: WsEventBus | null = null
function getWsBus(): WsEventBus {
  if (!wsBus) wsBus = new WsEventBus()
  return wsBus
}

/**
 * 统一事件订阅：Tauri 环境走 Tauri event API，浏览器走共享 WS。
 * 返回取消订阅函数。
 */
export async function subscribeEvent(event: string, handler: EventHandler): Promise<UnlistenFn> {
  if (isTauriApp()) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen(event, (e) => handler(e.payload))
  }
  return getWsBus().subscribe(event, handler)
}

/** 取消一个流任务（浏览器端经 WS 发指令，失败回退 HTTP RPC）。 */
export async function cancelStream(streamId: string): Promise<void> {
  if (isTauriApp()) {
    return callCommand<void>('chat_cancel_stream', { streamId })
  }
  if (!getWsBus().send({ type: 'cancel', streamId })) {
    await callCommand<void>('chat_cancel_stream', { streamId })
  }
}

// ---- 对话框降级 ----

export type DialogOptions = {
  title?: string
  kind?: 'info' | 'warning' | 'error'
  okLabel?: string
  cancelLabel?: string
}

function formatDialog(message: string, options?: DialogOptions): string {
  const parts: string[] = []
  if (options?.title) parts.push(options.title)
  parts.push(message)
  return parts.join('\n\n')
}

export async function dialogConfirm(message: string, options?: DialogOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { title: options } : options
  if (isTauriApp()) {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    return confirm(message, {
      title: opts?.title,
      kind: opts?.kind,
      okLabel: opts?.okLabel,
      cancelLabel: opts?.cancelLabel,
    })
  }
  return window.confirm(formatDialog(message, opts))
}

export async function dialogMessage(message: string, options?: DialogOptions | string): Promise<void> {
  const opts = typeof options === 'string' ? { title: options } : options
  if (isTauriApp()) {
    const { message: msg } = await import('@tauri-apps/plugin-dialog')
    await msg(message, { title: opts?.title, kind: opts?.kind })
    return
  }
  window.alert(formatDialog(message, opts))
}

/**
 * 目录/文件选择：浏览器端无法枚举本地路径，返回 null 并由调用方提示
 * （Web 模式的作品管理经由服务端文件系统完成，不走本地选择器）。
 */
export async function dialogOpenDirectory(): Promise<string | null> {
  if (isTauriApp()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, multiple: false })
    return typeof selected === 'string' ? selected : null
  }
  return null
}

/**
 * 文件保存/下载：浏览器端触发下载。
 */
export function saveFileBrowser(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
