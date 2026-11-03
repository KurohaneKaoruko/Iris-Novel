import { useCallback, useRef, useState } from 'react'
import { generateStream, loadWritingContext, WRITE_MODES, type WriteMode } from '../../api/writing'
import { readText } from '../../api/backend'
import './AiWriteBar.css'

type Props = {
  activePath: string
  assistantId: string | null
  targetWords?: number
  /** 与 EditorPane 共享：ai-replace 信号由 EditorPane 消费 */
  contentRef: React.MutableRefObject<Map<string, string>>
  onApply: (content: string) => void
  onError: (msg: string | null) => void
}

/**
 * 章节 AI 工具栏：续写正文 / 生成章节细纲 / 润色本章。
 * 细纲输出到预览；续写与润色可直接替换编辑器内容（覆盖前确认）。
 */
export function AiWriteBar({ activePath, assistantId, targetWords, contentRef, onError }: Props) {
  const [mode, setMode] = useState<WriteMode>('continue')
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [showOutput, setShowOutput] = useState(false)
  const handleRef = useRef<ReturnType<typeof generateStream> | null>(null)

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setShowOutput(true)
    setOutput('')
    try {
      const chapterContent = await readText(activePath).catch(() => '')
      const ctx = await loadWritingContext()
      const title = activePath.split('/').pop()?.replace(/\.(md|txt)$/i, '') ?? ''
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
  }, [activePath, assistantId, instruction, mode, onError, running, targetWords])

  const cancel = useCallback(() => {
    handleRef.current?.cancel()
    setRunning(false)
  }, [])

  const applyToEditor = useCallback(() => {
    if (!output.trim()) return
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

  return (
    <div className="ai-write-bar">
      <div className="ai-write-row">
        <select value={mode} onChange={(e) => setMode(e.target.value as WriteMode)} disabled={running}>
          {WRITE_MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
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
            <span>{WRITE_MODES.find((m) => m.id === mode)?.label}结果{running ? '（生成中…）' : ''}</span>
            <span className="ai-output-actions">
              {!running && output.trim() && mode !== 'chapter-outline' && mode !== 'outline' ? (
                <button onClick={applyToEditor}>
                  {mode === 'polish' ? '替换正文' : '追加到章节'}
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
