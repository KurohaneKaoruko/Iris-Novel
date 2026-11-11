import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeEvent, wsSend, type Unlisten } from '../api/rpc'
import { chatCancelStream, chatGenerateStream, type ChatMessagePayload } from '../api/backend'

/** 常见后端错误 → 中文用户话术；未命中时原样透传 */
const ERROR_I18N: Array<[RegExp, string]> = [
  [/no api key/i, '未配置 API Key——点击右上角「设置」添加密钥'],
  [/api key.*(invalid|incorrect|unauthorized)|401/i, 'API Key 无效或已过期——请到「设置」检查密钥'],
  [/workspace not set/i, '尚未打开作品目录'],
  [/insufficient (quota|balance)|quota exceeded|billing/i, 'Provider 额度或余额不足'],
  [/rate limit|429/i, '请求过于频繁（触发限速），稍后重试'],
  [/timed? out|timeout/i, '连接超时——检查网络或 Provider 地址'],
  [/request failed|network/i, '网络请求失败——检查网络连接或 Provider 地址'],
  [/http 4\d\d/i, '请求被拒绝（4xx）——检查模型名 / 参数 / 密钥'],
  [/http 5\d\d/i, 'Provider 服务端错误（5xx），稍后重试'],
  [/missing choices/i, 'Provider 返回格式异常——确认 base_url 指向 OpenAI 兼容接口'],
  [/decode failed/i, '响应解析失败——Provider 可能不支持流式返回'],
]

/** 错误中文化：命中映射输出中文话术并附原文摘录，未命中原样透传 */
export function localizeError(raw: string): string {
  for (const [re, msg] of ERROR_I18N) {
    if (re.test(raw)) return `${msg}（${raw.slice(0, 120)}）`
  }
  return raw
}

export type ChatRole = 'user' | 'assistant'

/** 一次工具调用步骤（Cline 式步骤卡数据） */
export type AgentStep = {
  actionId: string
  step: number
  tool: string
  phase: string
  ok?: boolean
  durationMs?: number
  inputPreview?: string
  observationPreview?: string
  /** fs_list_dir 的紧凑列表 */
  listItems?: Array<{ name: string; kind: string }>
  readPath?: string
  readLines?: number
  readChars?: number
  readPreview?: string
  writePath?: string
}

export type ChatItem = {
  id: string
  role: ChatRole
  content: string
  streaming?: boolean
  streamId?: string
  failed?: string
  /** 本条 assistant 消息期间的工具步骤 */
  steps?: AgentStep[]
}

export type ChatEventPayload = {
  streamId?: string
  stream_id?: string
  token?: string
  cancelled?: boolean
  phase?: string
  message?: string
  actionId?: string
  action_id?: string
  step?: number
  tool?: string
  ok?: boolean
  durationMs?: number
  inputPreview?: string
  observationPreview?: string
  listItems?: Array<{ name: string; kind: string }>
  readPath?: string
  readLines?: number
  readChars?: number
  readPreview?: string
  writePath?: string
}

function sid(p: ChatEventPayload): string | null {
  return typeof p.streamId === 'string' ? p.streamId : typeof p.stream_id === 'string' ? p.stream_id : null
}

let seq = 0
const newId = () => `m-${Date.now()}-${(seq += 1)}`

export function useChat() {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const streamOutputRef = useRef(new Map<string, string>())
  /**
   * 当前活跃流 ID。必须在发出 RPC **之前**设置：
   * 事件订阅在组件挂载时就已建立（下面的 effect 只跑一次），
   * 用 ref 过滤事件即可，不存在"订阅晚于事件"的竞态。
   */
  const activeStreamIdRef = useRef<string | null>(null)
  /** 最新消息列表镜像（供 resendFrom 读取，避免闭包过期） */
  const messagesRef = useRef<ChatItem[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const finishStream = useCallback((streamId: string, patch: Partial<ChatItem>) => {
    if (activeStreamIdRef.current === streamId) {
      activeStreamIdRef.current = null
      setBusy(false)
    }
    setMessages((ms) => ms.map((m) => (m.streamId === streamId ? { ...m, streaming: false, ...patch } : m)))
  }, [])

  useEffect(() => {
    const ups: Unlisten[] = []

    ups.push(
      subscribeEvent('ai_stream_token', (raw) => {
        const p = (raw ?? {}) as ChatEventPayload
        const id = sid(p)
        if (!id || id !== activeStreamIdRef.current) return
        const token = typeof p.token === 'string' ? p.token : ''
        if (!token) return
        const prev = streamOutputRef.current.get(id) ?? ''
        streamOutputRef.current.set(id, prev + token)
        const text = streamOutputRef.current.get(id) ?? ''
        setMessages((ms) => ms.map((m) => (m.streamId === id ? { ...m, content: text } : m)))
      }),
    )

    // 工具步骤事件（ReAct 循环）：追加/更新到当前 assistant 消息的 steps
    ups.push(
      subscribeEvent('ai_agent_step', (raw) => {
        const p = (raw ?? {}) as ChatEventPayload
        const id = sid(p)
        if (!id || id !== activeStreamIdRef.current) return
        const actionId = p.actionId ?? `s-${p.step ?? 0}`
        setMessages((ms) => {
          const idx = ms.findIndex((m) => m.streamId === id)
          if (idx < 0) return ms
          const target = ms[idx]
          const steps = [...(target.steps ?? [])]
          const existing = steps.findIndex((s) => s.actionId === actionId)
          const incoming: AgentStep = {
            actionId,
            step: p.step ?? steps.length + 1,
            tool: p.tool ?? 'tool',
            phase: p.phase ?? 'start',
            ok: p.ok,
            durationMs: p.durationMs,
            inputPreview: p.inputPreview,
            observationPreview: p.observationPreview,
            listItems: p.listItems,
            readPath: p.readPath,
            readLines: p.readLines,
            readChars: p.readChars,
            readPreview: p.readPreview,
            writePath: p.writePath,
          }
          if (existing >= 0) steps[existing] = incoming
          else steps.push(incoming)
          ms[idx] = { ...target, steps }
          return [...ms]
        })
      }),
    )

    // 错误：后端 ai_error 后不一定跟 ai_stream_done，必须自行终止流
    ups.push(
      subscribeEvent('ai_error', (raw) => {
        const p = (raw ?? {}) as ChatEventPayload
        const id = sid(p)
        if (!id || id !== activeStreamIdRef.current) return
        const msg = typeof p.message === 'string' && p.message ? p.message : '生成失败（Provider 未配置或网络错误）'
        finishStream(id, { failed: localizeError(msg) })
      }),
    )

    ups.push(
      subscribeEvent('ai_stream_done', (raw) => {
        const p = (raw ?? {}) as ChatEventPayload
        const id = sid(p)
        if (!id || id !== activeStreamIdRef.current) return
        const text = streamOutputRef.current.get(id) ?? ''
        finishStream(id, {
          content: text,
          failed: text.trim() ? undefined : '未收到任何回复，请检查 Provider / API Key 配置',
        })
      }),
    )

    return () => {
      for (const u of ups) u()
    }
  }, [finishStream])

  const startStream = useCallback(
    (userText: string, history: ChatMessagePayload[], opts?: { systemPrompt?: string; assistantId?: string | null; providerId?: string | null }) => {
      const streamId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      streamOutputRef.current.set(streamId, '')
      // 先挂 ref 再发 RPC；订阅自挂载起一直在线，事件不会丢
      activeStreamIdRef.current = streamId
      setBusy(true)
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'user', content: userText },
        { id: newId(), role: 'assistant', content: '', streaming: true, streamId, steps: [] },
      ])

      const withSys: ChatMessagePayload[] = [...history, { role: 'user', content: userText }]
      if (opts?.systemPrompt) withSys.unshift({ role: 'system', content: opts.systemPrompt })
      void chatGenerateStream({
        streamId,
        messages: withSys,
        assistantId: opts?.assistantId ?? null,
        providerId: opts?.providerId ?? null,
      }).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        finishStream(streamId, { failed: localizeError(msg) })
      })
    },
    [finishStream],
  )

  const send = useCallback(
    async (userText: string, opts?: { assistantId?: string | null; providerId?: string | null; systemPrompt?: string; useMarkdown?: boolean }) => {
      const text = userText.trim()
      if (!text || busy) return
      const history: ChatMessagePayload[] = messagesRef.current.map((m) => ({ role: m.role, content: m.content }))
      startStream(text, history, opts)
    },
    [busy, startStream],
  )

  const cancel = useCallback(() => {
    const id = activeStreamIdRef.current
    if (!id) return
    if (!wsSend({ type: 'cancel', streamId: id })) {
      void chatCancelStream(id).catch(() => {})
    }
  }, [])

  const clear = useCallback(() => {
    cancel()
    activeStreamIdRef.current = null
    setBusy(false)
    setMessages([])
    streamOutputRef.current.clear()
  }, [cancel])

  const restore = useCallback(
    (msgs: Array<{ role: ChatRole; content: string }>) => {
      cancel()
      activeStreamIdRef.current = null
      setBusy(false)
      streamOutputRef.current.clear()
      setMessages(msgs.map((m) => ({ id: newId(), role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: String(m.content ?? '') })))
    },
    [cancel],
  )

  /** 以最后一条用户消息重发（重新生成）：丢弃其后的全部消息 */
  const resendFrom = useCallback(
    (userText: string, opts?: { systemPrompt?: string }) => {
      cancel()
      streamOutputRef.current.clear()
      const ms = messagesRef.current
      const idx = ms.map((m) => m.role).lastIndexOf('user')
      const keptHist = (idx >= 0 ? ms.slice(0, idx) : []).map((m) => ({ role: m.role, content: m.content }) as ChatMessagePayload)
      setMessages(keptHist.map((m) => ({ id: newId(), role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })))
      startStream(userText, keptHist, opts)
    },
    [cancel, startStream],
  )

  return { messages, busy, send, cancel, clear, restore, resendFrom }
}
