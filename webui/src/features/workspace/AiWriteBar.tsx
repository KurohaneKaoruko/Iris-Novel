import { useCallback, useEffect, useRef, useState } from 'react'
import { generateStream, loadWritingContext, WRITE_MODES, type WriteMode } from '../../api/writing'
import { readText } from '../../api/backend'
import './AiWriteBar.css'

type Props = {
  activePath: string
  assistantId: string | null
  targetWords?: number
  /** 与 EditorPane 共享：ai-replace/ai-append/ai-selection 信号由 EditorPane 消费 */
  contentRef: React.MutableRefObject<Map<string, string>>
  onError: (msg: string | null) => void
  /** EditorPane 上报的选区状态 */
  selection?: { has: boolean; text: string } | null
}

/**
 * 章节 AI 工具栏：续写正文 / 生成大纲 / 章节细纲 / 润色本章 / 选段润色·扩写·缩写。
 * 细纲输出到预览；续写与润色可直接替换编辑器内容（覆盖前确认）；
 * 选段模式只作用于选中文字（替换选区）。
 */
export function AiWriteBar({ activePath, assistantId, targetWords, contentRef, onError, selection }: Props) {
  const [mode, setMode] = useState<WriteMode | 'selection'>('continue')
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [showOutput, setShowOutput] = useState(false)
  const handleRef = useRef<ReturnType<typeof generateStream> | null>(null)

  // 选区模式：有选中文字时自动可用的三种选段操作
  const selectionModes = [
    { id: 'sel-polish', label: '润色选段' },
    { id: 'sel-expand', label: '扩写选段' },
    { id: 'sel-condense', label: '缩写选段' },
  ] as const
  type SelMode = (typeof selectionModes)[number]['id']
  const [selMode, setSelMode] = useState<SelMode>('sel-polish')
  const selTextRef = useRef('')

  // 捕获最新非空选区文本（点击工具栏会导致选区丢失，所以有选区时缓存）
  useEffect(() => {
    if (selection?.has && selection.text.trim()) selTextRef.current = selection.text
  }, [selection])

  const selPrompt = useCallback((m: SelMode, text: string, extra?: string): string => {
    const req = extra ? `\n\n【要求】${extra}` : ''
    if (m === 'sel-expand') return `【原文】\n${text}${req}\n\n请扩写以上片段：丰富细节、感官与心理描写，篇幅约为原文 2-3 倍。只输出扩写后的文字。`
    if (m === 'sel-condense') return `【原文】\n${text}${req}\n\n请缩写以上片段：保留核心信息与情节点，篇幅约为原文一半。只输出缩写后的文字。`
    return `【原文】\n${text}${req}\n\n请润色以上片段：保持情节与信息量不变，提升文字表现力。只输出润色后的文字。`
  }, [])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setShowOutput(true)
    setOutput('')
    try {
      const chapterContent = await readText(activePath).catch(() => '')
      const ctx = await loadWritingContext()
      const title = activePath.split('/').pop()?.replace(/\.(md|txt)$/i, '') ?? ''

      // 选段模式：只处理选中文字，上下文用整章前后文
      if (mode === 'selection') {
        const text = selTextRef.current.trim()
        if (!text) {
          onError('请先在编辑器中选中一段文字')
          return
        }
        handleRef.current = generateStream({
          mode: 'polish',
          promptInput: {
            chapterContent: selPrompt(selMode, text, instruction.trim() || undefined),
            chapterTitle: title,
            charactersText: ctx.charactersText,
            outlineText: ctx.outlineText,
          },
          assistantId,
          onToken: (t) => setOutput(t),
        })
        await handleRef.current.promise
        return
      }

      handleRef.current = generateStream({
        mode,
        promptInput: {
          chapterContent,
          chapterTitle: title,
          instruction: instruction.trim() || undefined,
          charactersText: ctx.charactersText,
          outlineText: ctx.outlineText,
          targetWords: mode === 'continue' ? targetWords : undefined,
        },
        assistantId,
        onToken: (t) => setOutput(t),
      })
      await handleRef.current.promise
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      handleRef.current = null
    }
  }, [activePath, assistantId, instruction, mode, onError, running, selMode, selPrompt, targetWords])

  const cancel = useCallback(() => {
    handleRef.current?.cancel()
    setRunning(false)
  }, [])

  const applyToEditor = useCallback(() => {
    if (!output.trim()) return
    if (mode === 'selection') {
      contentRef.current.set('ai-selection', output)
      setShowOutput(false)
      setOutput('')
      return
    }
    if (mode === 'polish') {
      if (!window.confirm('润色将替换当前章节全部内容，确认？')) return
      contentRef.current.set('ai-replace', output)
    } else if (mode === 'continue') {
      if (!window.confirm('将把续写内容追加到当前章节末尾，确认？')) return
      contentRef.current.set('ai-append', output)
    }
    setShowOutput(false)
    setOutput('')
  }, [contentRef, mode, output])

  const isSelection = mode === 'selection'
  const modeLabel = isSelection
    ? selectionModes.find((m) => m.id === selMode)?.label ?? '选段处理'
    : WRITE_MODES.find((m) => m.id === mode)?.label ?? ''

  return (
    <div className="ai-write-bar">
      <div className="ai-write-row">
        <select value={mode} onChange={(e) => setMode(e.target.value as WriteMode | 'selection')} disabled={running}>
          {WRITE_MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.hint}>
              {m.label}
            </option>
          ))}
          <option value="selection" disabled={!selection?.has}>
            选段处理{selection?.has ? '' : '（先选中文字）'}
          </option>
        </select>
        {isSelection ? (
          <select value={selMode} onChange={(e) => setSelMode(e.target.value as SelMode)} disabled={running}>
            {selectionModes.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        ) : null}
        <input
          className="ai-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="补充要求（可选）：如「加强冲突」「本段写雨夜追逐」"
          disabled={running}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running) void run()
          }}
        />
        {running ? (
          <button className="ai-stop" onClick={cancel}>停止</button>
        ) : (
          <button className="ai-run" onClick={() => void run()}>生成</button>
        )}
      </div>

      {showOutput ? (
        <div className="ai-output">
          <div className="ai-output-head">
            <span>{modeLabel}结果{running ? '（生成中…）' : ''}</span>
            <span className="ai-output-actions">
              {!running && output.trim() && (isSelection || (mode !== 'chapter-outline' && mode !== 'outline')) ? (
                <button onClick={applyToEditor}>
                  {isSelection ? '替换选段' : mode === 'polish' ? '替换正文' : '追加到章节'}
                </button>
              ) : null}
              <button onClick={() => { if (!running) setShowOutput(false) }}>
                {running ? '隐藏' : '关闭'}
              </button>
            </span>
          </div>
          <pre className="ai-output-body">{output || (running ? '' : '（无输出）')}</pre>
        </div>
      ) : null}
    </div>
  )
}
