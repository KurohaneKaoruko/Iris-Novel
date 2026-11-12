import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STUDIO_TOOLS,
  STUDIO_CATEGORIES,
  STUDIO_STYLES,
  runStudioTool,
  studioResultToMarkdown,
  type StudioHandle,
} from '../../api/studio'
import { getAppSettings, createDir, writeText } from '../../api/backend'
import { MarkdownView } from './MarkdownView'
import { Icon, type IconName } from '../../components/Icon'
import './StudioDialog.css'

type Props = {
  initialToolId?: string
  /** 当前编辑器打开的文件路径；「插入」按钮依赖它 */
  activePath: string | null
  /** 当前编辑器内容 */
  activeContent: string
  /** 追加到编辑器草稿（插入结果） */
  onInsertToEditor: (text: string) => void
  onClose: () => void
}

type RunState = 'idle' | 'running' | 'done' | 'error'

/** 创作工坊：一站式 AI 文本创作工具集（构思 / 写作 / 润改 / 实用） */
export function StudioDialog({ initialToolId, activePath, activeContent, onInsertToEditor, onClose }: Props) {
  const [toolId, setToolId] = useState(initialToolId ?? STUDIO_TOOLS[0].id)
  const tool = useMemo(
    () => STUDIO_TOOLS.find((t) => t.id === toolId) ?? STUDIO_TOOLS[0],
    [toolId],
  )

  const [inputText, setInputText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [style, setStyle] = useState('')
  const [targetWords, setTargetWords] = useState('')
  const [providerId, setProviderId] = useState<string>('')
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])

  const [runState, setRunState] = useState<RunState>('idle')
  const [result, setResult] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const handleRef = useRef<StudioHandle | null>(null)
  const resultBodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void getAppSettings()
      .then((s) => {
        const ps = s.providers ?? []
        setProviders(ps.map((p) => ({ id: p.id, name: p.name || p.id })))
        if (ps.length > 0) setProviderId((v) => v || ps[0].id)
      })
      .catch(() => {})
  }, [])

  // 工具切换：保留通用输入，重置结果
  const switchTool = useCallback((id: string) => {
    setToolId(id)
    setRunState('idle')
    setResult('')
    setErrMsg('')
  }, [])

  const onToken = useCallback((full: string) => {
    setResult(full)
    const el = resultBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const run = useCallback(() => {
    if (!inputText.trim() || runState === 'running') return
    setRunState('running')
    setResult('')
    setErrMsg('')
    handleRef.current = runStudioTool({
      tool,
      input: {
        text: inputText,
        instruction,
        style,
        targetWords: targetWords ? Number(targetWords) : undefined,
      },
      providerId: providerId || null,
      onToken,
    })
    handleRef.current.promise
      .then((out) => {
        setResult(out)
        setRunState('done')
      })
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : String(e))
        setRunState('error')
      })
  }, [inputText, runState, tool, instruction, style, targetWords, providerId, onToken])

  const cancel = useCallback(() => {
    handleRef.current?.cancel()
    setRunState('idle')
  }, [])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyResult = useCallback(() => {
    void navigator.clipboard.writeText(result).catch(() => {})
  }, [result])

  const saveAsFile = useCallback(async () => {
    if (!result.trim()) return
    const name = `studio/${tool.id}-${Date.now()}.md`
    try {
      // 确保目录存在（首存时 studio/ 尚不存在）
      try {
        await createDir('studio')
      } catch { /* 已存在 */ }
      await writeText(name, studioResultToMarkdown(tool, {
        text: inputText,
        instruction,
        style,
        targetWords: targetWords ? Number(targetWords) : undefined,
      }, result))
    } catch (e) {
      setErrMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`)
      setRunState('error')
    }
  }, [result, tool, inputText, instruction, style, targetWords])

  const insertToEditor = useCallback(() => {
    if (!result.trim() || !activePath) return
    onInsertToEditor(result)
    onClose()
  }, [result, activePath, onInsertToEditor, onClose])

  const running = runState === 'running'
  const hasResult = result.trim().length > 0

  return (
    <div className="studio-overlay" onClick={onClose}>
      <div className="studio-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="studio-head">
          <div className="studio-title">
            <Icon name="sparkles" size={15} />
            创作工坊
          </div>
          <button className="studio-x" onClick={onClose} title="关闭"><Icon name="x" size={16} /></button>
        </div>

        <div className="studio-layout">
          <nav className="studio-nav">
            {STUDIO_CATEGORIES.map((cat) => (
              <div key={cat}>
                <div className="studio-cat">{cat}</div>
                {STUDIO_TOOLS.filter((t) => t.category === cat).map((t) => (
                  <button
                    key={t.id}
                    className={`studio-navitem${toolId === t.id ? ' active' : ''}`}
                    onClick={() => switchTool(t.id)}
                  >
                    <Icon name={t.icon as IconName} size={14} />
                    {t.name}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="studio-main">
            <div className="studio-toolhead">
              <div className="studio-toolname">{tool.name}</div>
              <div className="studio-tooldesc">{tool.desc}</div>
            </div>

            <div className="studio-fields">
              <textarea
                className="studio-input"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={tool.placeholder}
                spellCheck={false}
              />
              <div className="studio-fieldrow">
                <label className="studio-field">
                  <span className="studio-label">附加要求（可选）</span>
                  <input
                    className="studio-input"
                    style={{ minHeight: 0 }}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例如：第一人称 / 避免成语 / 面向青少年读者"
                    spellCheck={false}
                  />
                </label>
                <label className="studio-field" style={{ maxWidth: 150 }}>
                  <span className="studio-label">模型</span>
                  <select className="studio-select" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                    {providers.length === 0 ? <option value="">默认 Provider</option> : null}
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="studio-fieldrow">
                {tool.styleField ? (
                  <label className="studio-field" style={{ maxWidth: 150 }}>
                    <span className="studio-label">文风</span>
                    <select className="studio-select" value={style} onChange={(e) => setStyle(e.target.value)}>
                      <option value="">不指定</option>
                      {STUDIO_STYLES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {tool.wordsField ? (
                  <label className="studio-field" style={{ maxWidth: 150 }}>
                    <span className="studio-label">目标字数</span>
                    <input
                      className="studio-num"
                      type="number"
                      min={50}
                      step={100}
                      value={targetWords}
                      onChange={(e) => setTargetWords(e.target.value)}
                      placeholder="如 800"
                    />
                  </label>
                ) : null}
                <label className="studio-field">
                  <span className="studio-label">使用当前编辑器内容</span>
                  <button
                    type="button"
                    className="studio-stop"
                    style={{ justifyContent: 'flex-start' }}
                    disabled={!activePath || !activeContent.trim()}
                    onClick={() => setInputText(activeContent.slice(0, 12000))}
                    title={activePath ? `从 ${activePath} 填入` : '先在右侧面板打开一个文件'}
                  >
                    <Icon name="file" size={13} />
                    {activePath ? '填入当前文件' : '未打开文件'}
                  </button>
                </label>
              </div>
            </div>

            <div className="studio-actions">
              {running ? (
                <button className="studio-stop" onClick={cancel}>
                  <Icon name="x" size={13} />
                  停止
                </button>
              ) : (
                <button className="studio-run" onClick={run} disabled={!inputText.trim()}>
                  <Icon name="sparkles" size={14} />
                  生成
                </button>
              )}
              {runState === 'running' ? <span className="studio-status">生成中……</span> : null}
              {runState === 'error' ? <span className="studio-status err">{errMsg}</span> : null}
              {runState === 'done' ? <span className="studio-status">完成 · {result.length} 字</span> : null}
            </div>

            <div className="studio-result">
              <div className="studio-resultbar">
                <span className="studio-resulttag">
                  <Icon name="file-text" size={12} />
                  结果
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="ok" onClick={copyResult} disabled={!hasResult || running}>
                    <Icon name="check" size={12} />
                    复制
                  </button>
                  <button className="ok" onClick={() => void saveAsFile()} disabled={!hasResult || running} title="保存到 studio/ 目录">
                    <Icon name="download" size={12} />
                    存为文件
                  </button>
                  <button
                    className="ok"
                    onClick={insertToEditor}
                    disabled={!hasResult || running || !activePath}
                    title={activePath ? `插入到 ${activePath}` : '先在右侧面板打开一个文件'}
                  >
                    <Icon name="arrow-right" size={12} />
                    插入编辑器
                  </button>
                </div>
              </div>
              <div className="studio-resultbody" ref={resultBodyRef}>
                {hasResult ? (
                  running ? (
                    <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>
                      {result}
                      <span className="studio-caret" />
                    </pre>
                  ) : (
                    <MarkdownView content={result} />
                  )
                ) : (
                  <div className="studio-empty">
                    <Icon name="sparkles" size={22} />
                    {runState === 'running' ? '正在生成……' : '在上方输入内容，点击「生成」开始创作'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
