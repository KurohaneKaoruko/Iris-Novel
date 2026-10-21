import { isTauriApp, parseComposerDirective, type ComposerDirectiveParseResult } from '../tauri'

export type WriterModeLike = 'normal' | 'plan' | 'spec'
export type ComposerAutoAction = 'on' | 'off' | 'toggle' | null

export type ParsedComposerDirective = {
  requestedMode: WriterModeLike | null
  autoAction: ComposerAutoAction
  content: string
  matched: boolean
  /** `/skill <id> [正文]` 解析出的技能 id；无 /skill 指令时为 null */
  skillId: string | null
}

function parseLocally(input: string): ParsedComposerDirective {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { requestedMode: null, autoAction: null, content: trimmed, matched: false, skillId: null }
  }

  const match = trimmed.match(/^\/([^\s]+)\s*(.*)$/u)
  const command = (match?.[1] ?? '').toLowerCase()
  const rest = (match?.[2] ?? '').trim()

  if (command === 'auto') {
    const arg = (rest.split(/\s+/u)[0] ?? '').toLowerCase()
    const autoAction: ComposerAutoAction = arg === 'on' ? 'on' : arg === 'off' ? 'off' : 'toggle'
    return { requestedMode: null, autoAction, content: '', matched: true, skillId: null }
  }

  if (command === 'skill' || command === '技能') {
    const [skillToken, ...remaining] = rest.split(/\s+/u)
    const skillId = (skillToken ?? '').toLowerCase() || null
    return { requestedMode: null, autoAction: null, content: remaining.join(' ').trim(), matched: true, skillId }
  }

  const modeMap: Record<string, WriterModeLike> = {
    normal: 'normal',
    plan: 'plan',
    spec: 'spec',
    '普通': 'normal',
    '大纲': 'plan',
    '细纲': 'spec',
  }
  const requestedMode = modeMap[command] ?? null
  if (requestedMode) {
    return { requestedMode, autoAction: null, content: rest, matched: true, skillId: null }
  }

  return { requestedMode: null, autoAction: null, content: trimmed, matched: false, skillId: null }
}

function mapBackendResult(result: ComposerDirectiveParseResult): ParsedComposerDirective {
  return {
    requestedMode: result.requested_mode,
    autoAction: result.auto_action,
    content: result.content,
    matched: result.matched,
    skillId: null,
  }
}

export async function parseComposerInput(rawInput: string): Promise<ParsedComposerDirective> {
  const trimmed = rawInput.trim()
  if (!trimmed) return { requestedMode: null, autoAction: null, content: '', matched: false, skillId: null }
  if (!isTauriApp()) return parseLocally(trimmed)
  // /skill 指令仅前端解析（后端无需感知技能注入），先本地识别再走后端
  const local = parseLocally(trimmed)
  if (local.skillId !== null) return local
  try {
    const parsed = await parseComposerDirective(trimmed)
    return mapBackendResult(parsed)
  } catch {
    return parseLocally(trimmed)
  }
}

