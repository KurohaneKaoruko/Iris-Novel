import { invoke } from '@tauri-apps/api/core'

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export async function chatGenerateStream(args: {
  streamId: string
  messages: ChatMessage[]
  useMarkdown: boolean
  agentId?: string | null
}): Promise<void> {
  return invoke<void>('chat_generate_stream', {
    stream_id: args.streamId,
    messages: args.messages,
    use_markdown: args.useMarkdown,
    agent_id: args.agentId ?? null,
  })
}
