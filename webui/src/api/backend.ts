/**
 * 后端命令绑定：类型化封装 rpc_dispatch 已有的命令。
 * 命名与 payload 与 src-tauri/src/server/rpc_dispatch.rs 一一对应。
 */
import { rpc } from './rpc'

// ---- 类型 ----

export type FsEntry = {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FsEntry[]
}

export type WorkspaceInfo = {
  root: string
  /** 其他随 set_workspace 返回的字段按需扩展 */
  [k: string]: unknown
}

export type ProjectItem = {
  name: string
  path: string
  description: string | null
  chapters_count: number
  total_words: number
  updated_at: number
  is_valid_workspace: boolean
  source: 'default' | 'external' | 'imported'
}

export type BookshelfState = {
  default_projects: ProjectItem[]
  external_projects: ProjectItem[]
  default_root: string
  last_workspace: string | null
  launch_mode: 'picker' | 'auto_last'
}

export type AppSettings = {
  active_provider_id: string
  active_agent_id: string
  active_writing_assistant_id: string
  agent_cli_write_mode?: 'review' | 'auto_apply'
  ai_edit_apply_mode?: 'review' | 'auto_apply'
  launch_mode: 'picker' | 'auto_last'
  output?: { use_markdown: boolean }
  providers: Provider[]
}

export type ProjectWritingSettings = {
  chapter_word_target: number
  auto_min_chars: number
  auto_max_chars: number
  auto_max_rounds: number
  auto_max_chapter_advances: number
  default_skill_id: string
}

export type Skill = {
  id: string
  name: string
  description: string
  prompt: string
  category: string
  enabled: boolean
}

export type Provider = {
  id: string
  name: string
  kind: 'OpenAI' | 'Anthropic' | 'OpenAICompatible'
  api_key: string
  base_url: string
  model_name: string
}

export type ProviderConnectivityResult = {
  ok: boolean
  message?: string
  [k: string]: unknown
}

export type RiskFinding = {
  category: string
  level: string
  excerpt: string
  suggestion?: string
  [k: string]: unknown
}

export type RiskScanResult = {
  summary: string
  overall_level: string
  findings: RiskFinding[]
  scanned_chars: number
}

export type ChatSessionSummary = {
  id: string
  title: string
  updated_at?: number
  [k: string]: unknown
}

export type ChatMessagePayload = {
  role: 'user' | 'assistant' | 'system'
  content: string
  [k: string]: unknown
}

export type ChatSession = {
  id: string
  title?: string
  messages: ChatMessagePayload[]
  [k: string]: unknown
}

// ---- workspace / bookshelf ----

export const setWorkspace = (path: string) => rpc<WorkspaceInfo>('set_workspace', { path })
export const getBookshelfState = () => rpc<BookshelfState>('get_bookshelf_state')
export const createNovelWork = (name: string, description?: string) =>
  rpc<ProjectItem>('create_novel_work', { name, description: description ?? null })
export const updateWorkDescription = (path: string, description: string) =>
  rpc<void>('update_work_description', { path, description })
/** 从书架移除记录（不删盘上文件） */
export const forgetWork = (path: string) => rpc<void>('forget_external_project', { path })
export const rememberExternalProject = (path: string) => rpc<void>('remember_external_project', { path })
export const browseDir = (path = '') => rpc<DirListing>('browse_dir', { path })
export const quickLocations = () => rpc<DirEntryInfo[]>('quick_locations')

export type DirEntryInfo = {
  name: string
  path: string
  is_workspace: boolean
}

export type DirListing = {
  path: string
  parent: string | null
  home: string
  entries: DirEntryInfo[]
}
export const getLastWorkspace = () => rpc<string | null>('get_last_workspace')

// ---- fs ----

export const listWorkspaceTree = (maxDepth = 6) => rpc<FsEntry>('list_workspace_tree', { maxDepth })
export const readText = (relativePath: string) => rpc<string>('read_text', { relativePath })
export const writeText = (relativePath: string, content: string) =>
  rpc<void>('write_text', { relativePath, content })
export const createFile = (relativePath: string) => rpc<void>('create_file', { relativePath })
export const createDir = (relativePath: string) => rpc<void>('create_dir', { relativePath })
export const deleteEntry = (relativePath: string) => rpc<void>('delete_entry', { relativePath })
export const renameEntry = (fromPath: string, toPath: string) =>
  rpc<void>('rename_entry', { fromRelativePath: fromPath, toRelativePath: toPath })

// ---- settings / skills ----

export const getAppSettings = () => rpc<AppSettings>('get_app_settings')
export const setAppSettings = (settings: AppSettings) => rpc<void>('set_app_settings', { settings })
export const getProjectWritingSettings = () => rpc<ProjectWritingSettings>('get_project_writing_settings')
export const setProjectWritingSettings = (settings: ProjectWritingSettings) =>
  rpc<void>('set_project_writing_settings', { settings })
export const getSkills = () => rpc<Skill[]>('get_skills')

// ---- chat ----

export const listChatSessions = (workspaceRoot?: string | null) =>
  rpc<ChatSessionSummary[]>('list_chat_sessions', { workspaceRoot: workspaceRoot ?? null })
export const getChatSession = (id: string) => rpc<ChatSession>('get_chat_session', { id })
export const saveChatSession = (session: ChatSession) => rpc<void>('save_chat_session', { session })

/** 发起 AI 流式生成；token 经 WS ai_stream_token 事件到达。 */
export const chatGenerateStream = (args: {
  streamId: string
  messages: ChatMessagePayload[]
  assistantId?: string | null
  providerId?: string | null
}) =>
  rpc<void>('chat_generate_stream', {
    streamId: args.streamId,
    messages: args.messages,
    useMarkdown: true,
    agentId: args.assistantId ?? null,
    providerId: args.providerId ?? null,
  })

export const chatCancelStream = (streamId: string) => rpc<void>('chat_cancel_stream', { streamId })

// ---- provider / key ----

export const getApiKeyStatus = (providerId: string) => rpc<boolean>('get_api_key_status', { providerId })
export const setApiKey = (providerId: string, apiKey: string) =>
  rpc<void>('set_api_key', { providerId, apiKey })
export const testProviderConnectivity = (provider: Provider, apiKey?: string) =>
  rpc<ProviderConnectivityResult>('test_provider_connectivity', { provider, apiKey: apiKey ?? null })

// ---- risk scan ----

export const riskScanContent = (filePath: string | null, content: string) =>
  rpc<RiskScanResult>('risk_scan_content', { filePath: filePath ?? null, content })

// ---- history（版本快照）----

export type HistoryEntry = {
  id: string
  file_path: string
  created_at: number
  reason: string
  word_count: number
  char_count: number
  summary: string
}

export const listHistoryEntries = (max = 120) => rpc<HistoryEntry[]>('list_history_entries', { max })
export const createHistorySnapshot = (relativePath: string, label?: string) =>
  rpc<HistoryEntry>('create_history_snapshot', { relativePath: relativePath, label: label ?? null })
export const readHistorySnapshot = (id: string) => rpc<string>('read_history_snapshot', { id })
export const restoreHistorySnapshot = (id: string) => rpc<void>('restore_history_snapshot', { id })

// ---- book analysis（拆书）----

export type BookAct = { id: number; name: string; chapters: number[]; description: string }
export type BookPlotLine = { name: string; main: boolean; chapters: number[]; description: string }
export type BookCharacter = { [k: string]: unknown }
export type BookTechnique = { [k: string]: unknown }

export type BookAnalysisResult = {
  title: string
  author: string | null
  source: string
  structure: { type: string; acts: BookAct[]; pacing: string; audience: string }
  plot_arcs: BookPlotLine[]
  rhythm: { [k: string]: unknown }
  climax_points: Array<{ [k: string]: unknown }>
  power_moments: Array<{ [k: string]: unknown }>
  characters: BookCharacter[]
  character_relationships: Array<{ [k: string]: unknown }>
  world_settings: Array<{ [k: string]: unknown }>
  power_system: Array<{ [k: string]: unknown }>
  techniques: BookTechnique[]
  summary: string
  learnable_points: string[]
}

export const bookAnalyze = (content: string, title: string) =>
  rpc<BookAnalysisResult>('book_analyze', { content, title })
