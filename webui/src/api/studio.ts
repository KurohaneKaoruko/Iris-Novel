/**
 * 创作工坊（Studio）：一站式 AI 文本创作工具集。
 * 每个工具 = system 人设 + user 消息模板；走 studio_complete_stream 纯净补全
 * （无 ReAct 工具循环、不要求已打开作品目录）。
 */
import { subscribeStreamEvents, type Unlisten } from './rpc'
import { studioCompleteStream, chatCancelStream, type ChatMessagePayload } from './backend'

// ---- 工具目录 ----

export type StudioToolCategory = '构思' | '写作' | '润改' | '实用'

export type StudioTool = {
  id: string
  category: StudioToolCategory
  name: string
  desc: string
  icon: string
  /** 输入区占位提示 */
  placeholder: string
  /** 附加字段：风格 */
  styleField?: boolean
  /** 附加字段：目标字数 */
  wordsField?: boolean
  build: (input: StudioInput) => { system: string; user: string }
}

export type StudioInput = {
  text: string
  instruction?: string
  style?: string
  targetWords?: number
  /** 风格学习：从范文提取的文风指纹，注入所有文风相关工具 */
  fingerprint?: StyleFingerprint | null
}

/** 文风指纹：风格学习产物，五维概括 + 补充特征 */
export type StyleFingerprint = {
  /** 句式节奏 */
  rhythm: string
  /** 词汇偏好 */
  vocabulary: string
  /** 对话风格 */
  dialogue: string
  /** 意象与比喻倾向 */
  imagery: string
  /** 叙事人称与视角距离 */
  pov: string
  /** 其他显著特征 */
  extras: string
}

const STYLE_RULE = (style?: string, fingerprint?: StyleFingerprint | null) => {
  const parts: string[] = []
  if (style && style.trim()) parts.push(`预设文风：${style.trim()}`)
  const fp = fingerprintText(fingerprint)
  if (fp) parts.push(fp)
  return parts.length > 0 ? `\n\n【文风要求】${parts.join('；')}` : ''
}

/** 指纹 → prompt 片段（空指纹返回空串） */
export function fingerprintText(fp?: StyleFingerprint | null): string {
  if (!fp) return ''
  const dims: Array<[string, string]> = [
    ['句式节奏', fp.rhythm],
    ['词汇偏好', fp.vocabulary],
    ['对话风格', fp.dialogue],
    ['意象比喻', fp.imagery],
    ['叙事人称', fp.pov],
    ['其他特征', fp.extras],
  ]
  const hit = dims.filter(([, v]) => v && v.trim())
  return hit.length > 0 ? `仿照范文文风（${hit.map(([k, v]) => `${k}：${v.trim()}`).join('；')}）` : ''
}

/** 文风指纹提取提示词：要求严格 JSON 输出 */
export function buildFingerprintPrompt(sample: string): string {
  return [
    '你是文风分析家。分析以下范文的文风指纹，只输出 JSON 对象（不要任何解释或围栏），字段：',
    '- "rhythm": 句式节奏（平均句长、长短句交错模式、段落密度）',
    '- "vocabulary": 词汇偏好（书面语/口语、高频词类、术语与色彩）',
    '- "dialogue": 对话风格（占比、潜台词处理、标点习惯）',
    '- "imagery": 意象与比喻倾向（感官通道、喻体域）',
    '- "pov": 叙事人称与视角距离',
    '- "extras": 其他显著特征（口头禅、标点特色、段落开头模式等）',
    '每个字段不超过 40 字，写概括性特征而非复制原文句子。若某特征不显著写空字符串。',
    '',
    `【范文】\n${sample.slice(0, 6000)}`,
  ].join('\n')
}

const FINGERPRINT_SYSTEM =
  '你是中文文风分析专家，只输出 JSON 对象本身，不要解释、不要 Markdown 代码围栏。'

/**
 * 风格学习：范文 → 流式提取文风指纹。失败抛错由调用方提示。
 */
export function learnStyleFingerprint(args: {
  sample: string
  providerId?: string | null
  onToken?: (full: string) => void
}): StudioHandle {
  return streamStudio({
    system: FINGERPRINT_SYSTEM,
    user: buildFingerprintPrompt(args.sample),
    providerId: args.providerId,
    onToken: args.onToken,
  })
}

/** 解析 AI 输出的文风指纹：容忍围栏与杂文本，字段严格清洗（空值丢弃） */
export function parseStyleFingerprint(raw: string): StyleFingerprint | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = (fenced ? fenced[1] : raw).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const str = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 80) : '')
    const fp: StyleFingerprint = {
      rhythm: str(v.rhythm),
      vocabulary: str(v.vocabulary),
      dialogue: str(v.dialogue),
      imagery: str(v.imagery),
      pov: str(v.pov),
      extras: str(v.extras),
    }
    const any = Object.values(fp).some((s) => s)
    return any ? fp : null
  } catch {
    return null
  }
}

const WORDS_RULE = (n?: number) => (n && n > 0 ? `\n\n【篇幅】目标 ${n} 字左右。` : '')

const baseSystem =
  '你是 Iris-Creation 创作工坊里的专业中文文本创作引擎，为用户直接产出高质量成品文本。' +
  '只输出成品内容本身，不要解释、不要前言结语、不要 Markdown 代码围栏；遵守用户的格式要求。'

function instruction(instruction?: string): string {
  const t = instruction?.trim()
  return t ? `\n\n【附加要求】${t}` : ''
}

export const STUDIO_TOOLS: StudioTool[] = [
  // ---- 构思 ----
  {
    id: 'brainstorm',
    category: '构思',
    name: '头脑风暴',
    desc: '围绕主题发散创意点子',
    icon: 'sparkles',
    placeholder: '想 brainstorm 的主题或方向，例如「赛博朋克 + 美食」',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请围绕以下主题进行头脑风暴，给出 8-12 个有差异化的创意点子，每个点子用「一句话概括 + 两三句展开」的格式，按新颖程度排序。\n\n【主题】${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'premise',
    category: '构思',
    name: '故事内核',
    desc: '从一句话扩展出完整故事前提',
    icon: 'package',
    placeholder: '一句话雏形，例如「外卖员捡到能听见城市记忆的耳机」',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请把下面这句话扩展为一个完整的故事前提（Premise），包含：高概念一句话、核心冲突、主角目标与障碍、独特卖点、类型定位、潜在的系列化空间。\n\n【雏形】${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'worldbuild',
    category: '构思',
    name: '世界观构建',
    desc: '体系化生成世界观设定',
    icon: 'map-pin',
    placeholder: '世界观核心概念，例如「修炼体系以声音为根骨」',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请构建一个世界观设定文档，输出 Markdown，包含：核心概念、力量/规则体系（含等级与代价）、地理与势力、社会结构与日常细节、历史大事件时间线、可与故事冲突挂钩的 3 个制度性矛盾。\n\n【核心概念】${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'character',
    category: '构思',
    name: '人物塑造',
    desc: '立体人物卡：欲望、伤疤与弧光',
    icon: 'user',
    placeholder: '人物雏形，例如「退休法医开面馆」',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请为以下人物完成立体塑造卡，输出 Markdown，包含：基本档案（姓名/年龄/职业/外形一句话）、表层欲望与深层需求、内心伤疤（Ghost）、性格矛盾点、说话习惯与小动作、人物弧光（从哪里到哪里）、与其他角色类型的适配关系、3 个能立即展示其性格的场景点子。\n\n【人物雏形】${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'plot',
    category: '构思',
    name: '情节生成',
    desc: '生成完整情节线与转折设计',
    icon: 'git-branch',
    placeholder: '情节种子，例如「双胞胎互换身份调查母亲之死」',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请设计一条完整情节线，输出 Markdown，包含：三幕结构划分、每一幕的关键节拍（含转折点与中点）、开场钩子、递进危机清单、结局方案（给正反两个版本）、伏笔 planted/payoff 对照表。\n\n【情节种子】${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  // ---- 写作 ----
  {
    id: 'write-scene',
    category: '写作',
    name: '场景写作',
    desc: '按镜头感写一个具体场景',
    icon: 'pen-line',
    placeholder: '场景描述，例如「深夜便利店，店员发现监控里的自己抬头看向镜头」',
    styleField: true,
    wordsField: true,
    build: ({ text, instruction: ins, style, targetWords, fingerprint }) => ({
      system: baseSystem,
      user: `请把以下场景写成正文片段：以具体感官细节开场，用「展示而非解释」的方式呈现人物与冲突，对话要有潜台词，结尾留钩子。只输出正文。\n\n【场景】${text}${STYLE_RULE(style, fingerprint)}${WORDS_RULE(targetWords)}${instruction(ins)}`,
    }),
  },
  {
    id: 'write-dialogue',
    category: '写作',
    name: '对话生成',
    desc: '有潜台词与张力的对话戏',
    icon: 'message',
    placeholder: '对话情境，例如「师徒决裂，徒弟第一次直呼其名」',
    styleField: true,
    wordsField: true,
    build: ({ text, instruction: ins, style, targetWords, fingerprint }) => ({
      system: baseSystem,
      user: `请写一段对话戏：人物目的错位形成张力，每句话都有潜台词，穿插动作与微表情打断对话节奏，避免信息倾倒式对白。只输出正文（对话与叙述混合）。\n\n【情境】${text}${STYLE_RULE(style, fingerprint)}${WORDS_RULE(targetWords)}${instruction(ins)}`,
    }),
  },
  {
    id: 'write-opening',
    category: '写作',
    name: '开篇生成',
    desc: '黄金三章级的开头',
    icon: 'book-open',
    placeholder: '作品类型与卖点，例如「都市异能，爽点快节奏」',
    styleField: true,
    wordsField: true,
    build: ({ text, instruction: ins, style, targetWords, fingerprint }) => ({
      system: baseSystem,
      user: `请为以下作品写一个开篇（第一章开头）：第一段制造钩子，尽快给出主角困境与期待感，信息随行动释放而非设定倾倒。只输出正文。\n\n【作品】${text}${STYLE_RULE(style, fingerprint)}${WORDS_RULE(targetWords)}${instruction(ins)}`,
    }),
  },
  {
    id: 'continue',
    category: '写作',
    name: '续写文本',
    desc: '无缝续写已有内容',
    icon: 'square-pen',
    placeholder: '粘贴要续写的正文结尾部分……',
    styleField: true,
    wordsField: true,
    build: ({ text, instruction: ins, style, targetWords, fingerprint }) => ({
      system: baseSystem,
      user: `请无缝续写以下文本：延续既有文风、人称与节奏，不重复已有内容，从第一个未完成的动作/情绪处继续推进。只输出续写部分。\n\n【已有文本】\n${text}${STYLE_RULE(style, fingerprint)}${WORDS_RULE(targetWords)}${instruction(ins)}`,
    }),
  },
  // ---- 润改 ----
  {
    id: 'polish',
    category: '润改',
    name: '润色文本',
    desc: '提升表现力，不改信息量',
    icon: 'pencil',
    placeholder: '粘贴要润色的文本……',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请润色以下文本：保持情节、信息量与篇幅基本不变，替换平庸表达、消除冗余、强化画面感与节奏。只输出润色后的全文。\n\n【原文】\n${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'expand',
    category: '润改',
    name: '扩写文本',
    desc: '扩充细节与心理描写',
    icon: 'chevrons-right',
    placeholder: '粘贴要扩写的文本……',
    styleField: true,
    wordsField: true,
    build: ({ text, instruction: ins, style, targetWords, fingerprint }) => ({
      system: baseSystem,
      user: `请扩写以下文本：补充感官细节、人物心理与微反应，把概述性叙述展开为具体场景，不改变原有情节走向。只输出扩写后的全文。\n\n【原文】\n${text}${STYLE_RULE(style, fingerprint)}${WORDS_RULE(targetWords)}${instruction(ins)}`,
    }),
  },
  {
    id: 'rewrite-style',
    category: '润改',
    name: '风格改写',
    desc: '同一内容换文风重写',
    icon: 'refresh',
    placeholder: '粘贴要改写风格的文本……',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请按指定文风重写以下文本：保留全部关键情节与信息点，重塑句式、词汇与节奏以贴合目标文风。只输出改写后的全文。\n\n【原文】\n${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
  {
    id: 'condense',
    category: '润改',
    name: '缩写精简',
    desc: '压缩篇幅，保留核心',
    icon: 'chevrons-left',
    placeholder: '粘贴要精简的文本……',
    build: ({ text, instruction: ins }) => ({
      system: baseSystem,
      user: `请精简以下文本：删除冗余修饰与重复信息，合并可压缩的段落，保留全部关键情节、人物动作与转折。只输出精简后的全文。\n\n【原文】\n${text}${instruction(ins)}`,
    }),
  },
  // ---- 实用 ----
  {
    id: 'critique',
    category: '实用',
    name: '专业评审',
    desc: '编辑视角的问题清单与改法',
    icon: 'search',
    placeholder: '粘贴要评审的文本……',
    build: ({ text, instruction: ins }) => ({
      system: '你是资深文学编辑，审稿直接、具体、可执行，不空泛表扬。只输出评审结果。',
      user: `请以编辑视角评审以下文本，输出 Markdown：先用一句话定位文本水平，然后列出 5-8 个具体问题（每条：问题描述 + 原文摘录 + 可操作的修改建议），最后给出「最有价值的一个改动」。不要重写全文。\n\n【文本】\n${text}${instruction(ins)}`,
    }),
  },
  {
    id: 'summary',
    category: '实用',
    name: '摘要提炼',
    desc: '提取要点与结构化摘要',
    icon: 'file-text',
    placeholder: '粘贴要摘要的文本……',
    build: ({ text, instruction: ins }) => ({
      system: baseSystem,
      user: `请为以下文本输出结构化摘要，输出 Markdown：一句话核心、3-5 个要点、关键实体清单（人物/地点/物品）、未解决的悬念或问题。忠实原文，不添加推测。\n\n【文本】\n${text}${instruction(ins)}`,
    }),
  },
  {
    id: 'translate',
    category: '实用',
    name: '翻译润色',
    desc: '文学性中英互译',
    icon: 'arrow-right',
    placeholder: '粘贴要翻译的文本（自动识别语言方向）……',
    styleField: true,
    build: ({ text, instruction: ins, style, fingerprint }) => ({
      system: baseSystem,
      user: `请翻译以下文本：中文译英文、其他语言译中文；文学性文本要保留语气与节奏，不逐词直译。人名与专有名词首次出现时在括号内附原文。只输出译文。\n\n【文本】\n${text}${STYLE_RULE(style, fingerprint)}${instruction(ins)}`,
    }),
  },
]

export const STUDIO_CATEGORIES: StudioToolCategory[] = ['构思', '写作', '润改', '实用']

export const STUDIO_STYLES = [
  '热血爽感',
  '轻松幽默',
  '悬疑冷峻',
  '细腻言情',
  '硬核科幻',
  '仙侠古韵',
  '现实主义',
  '意识流',
]

// ---- 流式执行 ----

type StreamPayload = { streamId?: string; stream_id?: string; token?: string; cancelled?: boolean }

function streamIdOf(p: StreamPayload): string | null {
  return typeof p.streamId === 'string' ? p.streamId : typeof p.stream_id === 'string' ? p.stream_id : null
}

export type StudioHandle = {
  promise: Promise<string>
  cancel: () => void
}

export function runStudioTool(args: {
  tool: StudioTool
  input: StudioInput
  providerId?: string | null
  onToken?: (fullText: string) => void
}): StudioHandle {
  const { system, user } = args.tool.build(args.input)
  return streamStudio({
    system,
    user,
    providerId: args.providerId,
    onToken: args.onToken,
  })
}

/**
 * 多稿生成：同一输入并行产生 n 稿（每稿注入视角指令与 VARIANT_INDEX 标记）。
 * 逐稿完成即回调 onVariant（保持序号）；全部结束后 resolve。
 */
export async function generateVariants(args: {
  tool: StudioTool
  input: StudioInput
  count: number
  providerId?: string | null
  onVariant?: (index: number, text: string, done: boolean) => void
  /** 传入数组，生成期间每个流的 StudioHandle 会填入其中（供外部 cancel） */
  handlesOut?: StudioHandle[]
}): Promise<string[]> {
  const { system, user } = args.tool.build(args.input)
  const n = Math.max(2, Math.min(4, args.count))
  const handles: StudioHandle[] = args.handlesOut ?? []
  handles.length = 0
  const results: string[] = new Array(n).fill('')
  for (let i = 0; i < n; i++) {
    const angle = VARIANT_ANGLES[i % VARIANT_ANGLES.length]
    const markedUser = `【第 ${i + 1} 稿视角要求】${angle}\n\nVARIANT_INDEX: ${i}\n\n${user}`
    let acc = ''
    const h = streamStudio({
      system,
      user: markedUser,
      providerId: args.providerId,
      onToken: (full) => {
        acc = full
        args.onVariant?.(i, full, false)
      },
    })
    handles.push(h)
    h.promise
      .then((text) => {
        results[i] = text
        args.onVariant?.(i, text, true)
      })
      .catch(() => {
        results[i] = acc || `（第 ${i + 1} 稿生成失败）`
        args.onVariant?.(i, results[i], true)
      })
  }
  await Promise.all(handles.map((h) => h.promise))
  return results
}

const VARIANT_ANGLES = [
  '侧重悬疑冷峻的氛围与克制表达',
  '侧重人物内心与细腻心理描写',
  '侧重快节奏、强冲突与对话张力',
  '侧重感官细节与画面感',
]

/** 纯净补全底层：system+user → 流式完整文本。 */
export function streamStudio(args: {
  system: string
  user: string
  providerId?: string | null
  onToken?: (fullText: string) => void
}): StudioHandle {
  const streamId = `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let output = ''
  let cancelled = false
  let sub: { unlisten: Unlisten } | null = null

  const promise = new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      sub?.unlisten()
      fn()
    }

    // 共享 WS 事件连接：所有流复用一条连接，按 streamId 过滤。
    // 连接就绪后才发 RPC——保证 token/done 不会在订阅生效前广播出去。
    const tokenSub = subscribeStreamEvents((event, raw) => {
      const p = (raw ?? {}) as StreamPayload
      if (streamIdOf(p) !== streamId) return
      if (event === 'ai_stream_token') {
        const token = typeof p.token === 'string' ? p.token : ''
        if (!token) return
        output += token
        args.onToken?.(output)
      } else if (event === 'ai_stream_done') {
        if (cancelled || p.cancelled === true) {
          finish(() => resolve(output))
          return
        }
        if (!output.trim()) {
          finish(() => reject(new Error('未收到任何回复，请检查 Provider / API Key')))
          return
        }
        finish(() => resolve(output))
      }
    })
    sub = tokenSub

    const messages: ChatMessagePayload[] = [{ role: 'user', content: args.user }]
    const start = () =>
      studioCompleteStream({
        streamId,
        system: args.system,
        messages,
        temperature: null,
        providerId: args.providerId ?? null,
      }).catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))))

    void tokenSub.waitReady().then(start)
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      void chatCancelStream(streamId).catch(() => {})
    },
  }
}

/** 工具结果落盘为 Markdown 文件（无打开工程时报错由调用方处理）。 */
export function studioResultToMarkdown(tool: StudioTool, input: StudioInput, result: string): string {
  const ts = new Date().toLocaleString('zh-CN')
  const meta = [
    `- 工具：${tool.name}`,
    input.style ? `- 文风：${input.style}` : null,
    input.targetWords ? `- 目标字数：${input.targetWords}` : null,
    `- 生成时间：${ts}`,
  ]
    .filter(Boolean)
    .join('\n')
  return `# ${tool.name} · 创作工坊\n\n${meta}\n\n## 输入\n\n${input.text}\n\n## 输出\n\n${result}\n`
}
