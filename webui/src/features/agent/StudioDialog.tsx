import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STUDIO_TOOLS,
  STUDIO_CATEGORIES,
  STUDIO_STYLES,
  runStudioTool,
  generateVariants,
  studioResultToMarkdown,
  type StudioHandle,
} from '../../api/studio'
import { getAppSettings, createDir, writeText } from '../../api/backend'
import { chapterBodyFromResult, createChapterWithContent } from '../../api/novel'
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

/** 与 studio.ts VARIANT_ANGLES 对齐的短标签（选稿卡片用） */
const VARIANT_ANGLE_LABELS = ['悬疑冷峻', '细腻心理', '快节奏冲突', '感官画面']

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
  const variantHandlesRef = useRef<StudioHandle[]>([])
  const resultBodyRef = useRef<HTMLDivElement | null>(null)

  // 多稿对照
  const [multiMode, setMultiMode] = useState(false)
  const [variantCount, setVariantCount] = useState(2)
  const [variants, setVariants] = useState<Array<{ text: string; done: boolean }>>([])
  const [pickedVariant, setPickedVariant] = useState<number | null>(null)

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
    setVariants([])
    setPickedVariant(null)
  }, [])

  const onToken = useCallback((full: string) => {
    setResult(full)
    const el = resultBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const run = useCallback(() => {
    if (!inputText.trim() || runState === 'running') return
    setRunState('running')
    setErrMsg('')
    const input = {
      text: inputText,
      instruction,
      style,
      targetWords: targetWords ? Number(targetWords) : undefined,
    }
    const pid = providerId || null

    if (multiMode) {
      // 多稿：清空旧稿，逐稿流式更新
      setVariants(new Array(variantCount).fill(null).map(() => ({ text: '', done: false })))
      setPickedVariant(null)
      setResult('')
      void generateVariants({
        tool,
        input,
        count: variantCount,
        providerId: pid,
        handlesOut: variantHandlesRef.current,
        onVariant: (i, text, done) => {
          setVariants((vs) => {
            const next = [...vs]
            next[i] = { text, done }
            return next
          })
          if (done) {
            const el = resultBodyRef.current
            if (el) el.scrollTop = el.scrollHeight
          }
        },
      })
        .then((results) => {
          setVariants(results.map((text) => ({ text, done: true })))
          // 自动选中第一份成功稿
          const firstOk = results.findIndex((r) => r.trim())
          setPickedVariant(firstOk >= 0 ? firstOk : null)
          setResult(results[firstOk] ?? '')
          setRunState('done')
        })
        .catch((e) => {
          setErrMsg(e instanceof Error ? e.message : String(e))
          setRunState('error')
        })
      return
    }

    setResult('')
    setPickedVariant(null)
    setVariants([])
    handleRef.current = runStudioTool({ tool, input, providerId: pid, onToken })
    handleRef.current.promise
      .then((out) => {
        setResult(out)
        setRunState('done')
      })
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : String(e))
        setRunState('error')
      })
  }, [inputText, runState, tool, instruction, style, targetWords, providerId, onToken, multiMode, variantCount])

  /** 多稿模式选稿：选中稿进入主结果区（复制/存盘/插入都作用于它） */
  const pickVariant = useCallback((i: number) => {
    setPickedVariant(i)
    setVariants((vs) => {
      if (vs[i]) setResult(vs[i].text)
      return vs
    })
  }, [])

  const cancel = useCallback(() => {
    handleRef.current?.cancel()
    for (const h of variantHandlesRef.current) h.cancel()
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

  // ==== 存为章节：结果直写 stories/chapter-XXXX.md 并纳入章节管理 ====
  const [saveChapterOpen, setSaveChapterOpen] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [chapterSaved, setChapterSaved] = useState<string | null>(null)

  const openSaveChapter = useCallback(() => {
    // 预填：AI 产出的首行 `# 标题`（chapterBodyFromResult 剥除后不会重复出现在正文）
    const { title } = chapterBodyFromResult(result)
    setChapterTitle(title)
    setSaveChapterOpen(true)
    setChapterSaved(null)
  }, [result])

  const saveAsChapter = useCallback(async () => {
    const { body } = chapterBodyFromResult(result)
    try {
      const path = await createChapterWithContent(chapterTitle, body)
      setChapterSaved(path)
    } catch (e) {
      setErrMsg(`存为章节失败：${e instanceof Error ? e.message : String(e)}`)
      setRunState('error')
    }
  }, [chapterTitle, result])

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
                <label className="studio-field" style={{ maxWidth: 170 }}>
                  <span className="studio-label">多稿对照</span>
                  <div className="studio-multirow">
                    <button
                      type="button"
                      className={`studio-multi-toggle${multiMode ? ' on' : ''}`}
                      onClick={() => setMultiMode((v) => !v)}
                      title="同一输入并排生成 2-4 稿不同视角，择优选用"
                    >
                      <Icon name={multiMode ? 'check-circle' : 'book-open'} size={13} />
                      {multiMode ? '已开启' : '关闭'}
                    </button>
                    {multiMode ? (
                      <select
                        className="studio-select"
                        style={{ minHeight: 0 }}
                        value={variantCount}
                        onChange={(e) => setVariantCount(Number(e.target.value))}
                      >
                        {[2, 3, 4].map((n) => (
                          <option key={n} value={n}>{n} 稿</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </label>
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
                  <button className="ok" onClick={openSaveChapter} disabled={!hasResult || running} title="写入新章节文件并纳入章节管理">
                    <Icon name="file-plus" size={12} />
                    存为章节
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
              {saveChapterOpen ? (
                <div className="studio-savechapter">
                  <input
                    className="studio-input"
                    style={{ minHeight: 0, flex: 1 }}
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder="章节标题（缺省用「第 N 章」）"
                    spellCheck={false}
                  />
                  {chapterSaved ? (
                    <span className="studio-saved-ok">
                      <Icon name="check-circle" size={13} />
                      已存入 {chapterSaved}
                    </span>
                  ) : (
                    <>
                      <button className="studio-run" onClick={() => void saveAsChapter()}>
                        <Icon name="check" size={12} />
                        写入
                      </button>
                      <button className="studio-stop" onClick={() => setSaveChapterOpen(false)}>
                        取消
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              <div className="studio-resultbody" ref={resultBodyRef}>
                {variants.length > 0 ? (
                  <div className="studio-variants">
                    {variants.map((v, i) => (
                      <button
                        key={i}
                        className={`studio-variant${pickedVariant === i ? ' picked' : ''}${v.done ? '' : ' gen'}`}
                        onClick={() => pickVariant(i)}
                        title={v.done ? '点击选用此稿' : '生成中…'}
                      >
                        <span className="studio-variant-head">
                          {v.done ? <Icon name="file-text" size={12} /> : <Icon name="clock" size={12} />}
                          第 {i + 1} 稿 · {VARIANT_ANGLE_LABELS[i % VARIANT_ANGLE_LABELS.length]}
                          {pickedVariant === i ? <Icon name="check" size={12} /> : null}
                        </span>
                        <span className="studio-variant-body">{v.text.slice(0, 90) || '……'}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
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
