/**
 * AI 写作工作流：模式化提示词构建 + 流式生成。
 * V1 内置四种模式：续写 / 大纲生成 / 细纲扩写 / 润色改写。
 * AI 输出走 useChat 同款 WS 流事件。
 */
import { subscribeEvent, type Unlisten } from './rpc'
import { chatGenerateStream, readText } from './backend'

export type WriteMode = 'continue' | 'outline' | 'chapter-outline' | 'polish'

export const WRITE_MODES: Array<{ id: WriteMode; label: string; hint: string }> = [
  { id: 'continue', label: '续写正文', hint: '基于已有章节继续向下写' },
  { id: 'outline', label: '生成大纲', hint: '根据简介/设定生成总纲' },
  { id: 'chapter-outline', label: '章节细纲', hint: '把大纲拆成下一章细纲' },
  { id: 'polish', label: '润色改写', hint: '对当前章节文字润色' },
]

type StreamPayload = { streamId?: string; stream_id?: string; token?: string; cancelled?: boolean }

function streamIdOf(p: StreamPayload): string | null {
  return typeof p.streamId === 'string' ? p.streamId : typeof p.stream_id === 'string' ? p.stream_id : null
}

function buildPrompt(mode: WriteMode, input: {
  chapterContent?: string
  chapterTitle?: string
  instruction?: string
  outlineText?: string
  charactersText?: string
  targetWords?: number
}): string {
  const { chapterContent, chapterTitle, instruction, outlineText, charactersText, targetWords } = input
  const ctx: string[] = []
  if (charactersText) ctx.push(`【人物设定】\n${charactersText}`)
  if (outlineText) ctx.push(`【大纲】\n${outlineText}`)
  const ctxText = ctx.length > 0 ? `${ctx.join('\n\n')}\n\n` : ''

  switch (mode) {
    case 'continue':
      return `${ctxText}【当前章节】${chapterTitle ?? ''}\n\n${chapterContent ?? ''}\n\n${instruction ? `【要求】${instruction}\n\n` : ''}请直接续写正文，${targetWords ? `目标 ${targetWords} 字左右，` : ''}保持文风与人物性格一致。只输出正文，不要解释。`
    case 'outline':
      return `${ctxText}${instruction ? `【需求】${instruction}\n\n` : ''}请生成小说总大纲：一句话简介、主线剧情 3-5 个情节点、支线设定、主要人物小传。输出 Markdown。`
    case 'chapter-outline':
      return `${ctxText}【章节】${chapterTitle ?? '下一章'}\n${chapterContent ? `【前情】\n${chapterContent.slice(-1500)}\n` : ''}${instruction ? `【要求】${instruction}\n\n` : ''}请给出本章细纲：场景清单（每场景：地点/人物/冲突/推进）、章末钩子。输出 Markdown。`
    case 'polish':
      return `${ctxText}【原文】\n${chapterContent ?? ''}\n\n${instruction ? `【要求】${instruction}\n\n` : ''}请润色以上正文：保持情节与信息量不变，提升文字表现力。只输出润色后的全文。`
  }
}

export type GenerateHandle = {
  promise: Promise<string>
  cancel: () => void
}

/** 发起流式生成；onToken 增量回调，resolve 完整文本。 */
export function generateStream(args: {
  mode: WriteMode
  promptInput: Parameters<typeof buildPrompt>[1]
  assistantId?: string | null
  providerId?: string | null
  onToken?: (fullText: string) => void
}): GenerateHandle {
  const streamId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let output = ''
  let cancelled = false
  const ups: Unlisten[] = []

  const promise = new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      for (const u of ups) u()
      fn()
    }

    ups.push(
      subscribeEvent('ai_stream_token', (raw) => {
        const p = (raw ?? {}) as StreamPayload
        if (streamIdOf(p) !== streamId) return
        const token = typeof p.token === 'string' ? p.token : ''
        if (!token) return
        output += token
        args.onToken?.(output)
      }),
      subscribeEvent('ai_stream_done', (raw) => {
        const p = (raw ?? {}) as StreamPayload
        if (streamIdOf(p) !== streamId) return
        if (cancelled || p.cancelled === true) {
          finish(() => resolve(output))
          return
        }
        if (!output.trim()) {
          finish(() => reject(new Error('未收到任何回复，请检查 Provider / API Key')))
          return
        }
        finish(() => resolve(output))
      }),
    )

    chatGenerateStream({
      streamId,
      messages: [{ role: 'user', content: buildPrompt(args.mode, args.promptInput) }],
      assistantId: args.assistantId ?? null,
      providerId: args.providerId ?? null,
    }).catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))))
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      // WS 优先（低延迟）；这里简化为直接调 RPC
      void import('./backend').then(({ chatCancelStream }) => chatCancelStream(streamId).catch(() => {}))
    },
  }
}

/** 读取作品上下文（人物卡 + 大纲目录前 2000 字）供提示词注入。 */
export async function loadWritingContext(): Promise<{ charactersText: string; outlineText: string }> {
  const files = ['concept/characters.md', 'outline/master-outline.md', 'outline/plotlines.md']
  const texts = await Promise.all(
    files.map((f) => readText(f).catch(() => '')),
  )
  return {
    charactersText: texts[0].slice(0, 3000),
    outlineText: `${texts[1]}\n${texts[2]}`.trim().slice(0, 3000),
  }
}
