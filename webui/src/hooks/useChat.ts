import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeEvent, wsSend, type Unlisten } from '../api/rpc'
import { chatCancelStream, chatGenerateStream } from '../api/backend'

export type ChatRole = 'user' | 'assistant'

export type ChatItem = {
  id: string
  role: ChatRole
  content: string
  streaming?: boolean
  streamId?: string
  failed?: string
}

/** 事件 payload 形状（iris-creation-server WS 广播） */
type StreamPayload = {
  streamId?: string
  stream_id?: string
  token?: string
  cancelled?: boolean
  phase?: string
}

function streamIdOf(p: StreamPayload): string | null {
  return typeof p.streamId === 'string' ? p.streamId : typeof p.stream_id === 'string' ? p.stream_id : null
}

let seq = 0
const newId = () => `m-${Date.now()}-${(seq += 1)}`

export function useChat() {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const streamOutputRef = useRef(new Map<string, string>())
  const unlistenersRef = useRef<Unlisten[]>([])
  const [subscribedStreamId, setSubscribedStreamId] = useState<string | null>(null)

  // WS 事件订阅：跟随当前活跃 streamId 重挂载（避免闭包过期）
  useEffect(() => {
    if (!subscribedStreamId) return
    const ups: Unlisten[] = []

    ups.push(
      subscribeEvent('ai_stream_token', (raw) => {
        const p = (raw ?? {}) as StreamPayload
        if (streamIdOf(p) !== subscribedStreamId) return
        const token = typeof p.token === 'string' ? p.token : ''
        if (!token) return
        const prev = streamOutputRef.current.get(subscribedStreamId) ?? ''
        streamOutputRef.current.set(subscribedStreamId, prev + token)
        const text = streamOutputRef.current.get(subscribedStreamId) ?? ''
        setMessages((ms) =>
          ms.map((m) => (m.streamId === subscribedStreamId ? { ...m, content: text } : m)),
        )
      }),
    )

    ups.push(
      subscribeEvent('ai_stream_done', (raw) => {
        const p = (raw ?? {}) as StreamPayload
        if (streamIdOf(p) !== subscribedStreamId) return
        const text = streamOutputRef.current.get(subscribedStreamId) ?? ''
        setMessages((ms) =>
          ms.map((m) =>
            m.streamId === subscribedStreamId
              ? {
                  ...m,
                  content: text,
                  streaming: false,
                  failed: text.trim() ? undefined : '未收到任何回复，请检查 Provider / API Key 配置',
                }
              : m,
          ),
        )
        setBusy(false)
        setSubscribedStreamId(null)
      }),
    )

    unlistenersRef.current = ups
    return () => {
      for (const u of unlistenersRef.current) u()
      unlistenersRef.current = []
    }
  }, [subscribedStreamId])

  const send = useCallback(
    async (userText: string, opts?: { assistantId?: string | null; providerId?: string | null; systemPrompt?: string }) => {
      const text = userText.trim()
      if (!text || busy) return
      setBusy(true)

      const streamId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      streamOutputRef.current.set(streamId, '')

      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'user', content: text },
        { id: newId(), role: 'assistant', content: '', streaming: true, streamId },
      ])
      setSubscribedStreamId(streamId)

      try {
        const history = messages.map((m) => ({ role: m.role, content: m.content }))
        await chatGenerateStream({
          streamId,
          messages: [...history, { role: 'user', content: text }],
          assistantId: opts?.assistantId ?? null,
          providerId: opts?.providerId ?? null,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setMessages((ms) =>
          ms.map((m) => (m.streamId === streamId ? { ...m, streaming: false, failed: msg } : m)),
        )
        setBusy(false)
        setSubscribedStreamId(null)
      }
    },
    [busy, messages],
  )

  const cancel = useCallback(() => {
    if (!subscribedStreamId) return
    // 优先 WS 指令（低延迟），失败回退 HTTP RPC
    if (!wsSend({ type: 'cancel', streamId: subscribedStreamId })) {
      void chatCancelStream(subscribedStreamId).catch(() => {})
    }
  }, [subscribedStreamId])

  const clear = useCallback(() => {
    cancel()
    setMessages([])
    streamOutputRef.current.clear()
  }, [cancel])

  return { messages, busy, send, cancel, clear }
}
