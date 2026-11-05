import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { readText } from '../../api/backend'
import { subscribeEvent } from '../../api/rpc'
import './EditorPane.css'

type EditorPaneProps = {
  /** key 由父组件按 path 绑定，path 变化即整体重挂载 */
  path: string
  saving: boolean
  onSave: (content: string) => Promise<void>
  onContentChanged: () => void
  onSaved: () => void
  onError: (msg: string | null) => void
  /** AI 写入信号：'ai-replace' 整体替换 / 'ai-append' 追加末尾 / 'ai-selection' 替换当前选区，消费后删除 key */
  aiReplaceSignal?: React.MutableRefObject<Map<string, string>>
  /** 跳行信号：值为目标行号（1-based），消费后置空。用于 lint/搜索结果定位 */
  goToLineSignal?: React.MutableRefObject<number | null>
  /** 选区变化上报（供 AiWriteBar 判断有无选中文字） */
  onSelectionChange?: (hasSelection: boolean, selectedText: string) => void
}

/**
 * TipTap 编辑器：纯段落文本（小说正文），无富格式噪音。
 * 内容为纯文本行；保存时以 \n 连接段落。
 * Ctrl+S 由本组件捕获并走 onSave。
 */
export function EditorPane({ path, saving, onSave, onContentChanged, onSaved, onError, aiReplaceSignal, goToLineSignal, onSelectionChange }: EditorPaneProps) {
  const [loading, setLoading] = useState(true)
  const [initialContent, setInitialContent] = useState('')
  const lastSyncedRef = useRef<string>('')
  const dirtyRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 小说正文只需要段落与标题；关闭噪音扩展
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: '',
    onUpdate: () => {
      if (!editor) return
      const text = editorText(editor)
      if (text === lastSyncedRef.current) return
      dirtyRef.current = true
      onContentChanged()
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void doSave()
          return true
        }
        return false
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to, empty } = ed.state.selection
      onSelectionChange?.(!empty, ed.state.doc.textBetween(from, to, '\n'))
    },
  })

  // 加载文档内容
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    readText(path)
      .then((text) => {
        if (cancelled) return
        setInitialContent(text)
        lastSyncedRef.current = text
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        onError(`读取失败：${e instanceof Error ? e.message : String(e)}`)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onError, path])

  // 内容加载完成后注入编辑器（按行分段）
  useEffect(() => {
    if (!editor || loading) return
    editor.commands.setContent(linesToDoc(initialContent))
  }, [editor, initialContent, loading])

  // 外部修改同步：fs_changed 且变更路径是当前文件、本地无未保存修改时，重新加载
  useEffect(() => {
    const un = subscribeEvent('fs_changed', (raw) => {
      const p = (raw ?? {}) as { path?: string }
      const changed = typeof p.path === 'string' ? p.path : null
      if (!changed || changed !== path) return
      if (dirtyRef.current) return // 有未保存修改时不覆盖，交由用户保存决策
      readText(path)
        .then((text) => {
          if (text === lastSyncedRef.current) return
          setInitialContent(text)
        })
        .catch(() => {})
    })
    return () => un()
  }, [path])

  const doSave = useCallback(async () => {
    if (!editor) return
    const text = editorText(editor)
    try {
      await onSave(text)
      lastSyncedRef.current = text
      dirtyRef.current = false
      onSaved()
    } catch {
      // 错误已由上层记录
    }
  }, [editor, onSaved, onSave])

  // AI 写入信号：整体替换 / 追加 / 替换选区（统一走「改完即存」）
  useEffect(() => {
    if (!editor || !aiReplaceSignal) return
    const applyAndSave = () => {
      const text = editorText(editor)
      lastSyncedRef.current = text
      dirtyRef.current = true
      onContentChanged()
      void onSave(text).then(() => {
        lastSyncedRef.current = text
        dirtyRef.current = false
        onSaved()
      })
    }
    const iv = window.setInterval(() => {
      const replace = aiReplaceSignal.current.get('ai-replace')
      const append = aiReplaceSignal.current.get('ai-append')
      const selection = aiReplaceSignal.current.get('ai-selection')
      if (replace !== undefined) {
        aiReplaceSignal.current.delete('ai-replace')
        editor.commands.setContent(linesToDoc(replace))
        applyAndSave()
      } else if (append !== undefined) {
        aiReplaceSignal.current.delete('ai-append')
        editor.commands.setTextSelection(editor.state.doc.content.size)
        editor.commands.insertContent('\n\n' + append.trim())
        applyAndSave()
      } else if (selection !== undefined) {
        aiReplaceSignal.current.delete('ai-selection')
        const { from, to } = editor.state.selection
        if (from !== to) {
          editor.chain().insertContentAt({ from, to }, selection.trim()).run()
          applyAndSave()
        }
      }
      // lint/搜索定位：跳到目标行。编辑器被 modal 遮住时不消费，等可见再跳（滚动才有效）
      const signal = goToLineSignal
      const line = signal?.current
      const editorVisible = editor.view.dom.offsetParent !== null && !document.querySelector('.modal-overlay')
      if (line !== undefined && line !== null && line >= 1 && !editorVisible) {
      }
      if (signal && line !== undefined && line !== null && line >= 1 && editorVisible) {
        signal.current = null
        const doc = editor.state.doc
        let targetPos: { from: number; to: number } | null = null
        let idx = 0
        doc.descendants((node, pos) => {
          if (targetPos) return false
          if (node.isTextblock) {
            idx += 1
            if (idx === line) {
              targetPos = { from: pos + 1, to: pos + node.content.size + 1 }
              return false
            }
          }
          return true
        })
        const tp = targetPos as { from: number; to: number } | null
        if (tp) {
          editor.commands.setTextSelection(tp)
          editor.commands.focus()
          // 同步滚动（rAF 在后台/无合成器环境会被无限节流）：用目标段落 DOM 几何对滚动容器做中心对齐
          try {
            const domAt = editor.view.domAtPos(tp.from)
            const el = domAt.node instanceof Element ? domAt.node : domAt.node.parentElement
            const block = (el?.closest('p, h1, h2, h3') ?? el) as HTMLElement | null
            const scroller = editor.view.dom.closest('.editor-content') as HTMLElement | null
            if (block && scroller) {
              const bRect = block.getBoundingClientRect()
              const sRect = scroller.getBoundingClientRect()
              const delta = bRect.top - (sRect.top + sRect.height / 2)
              scroller.scrollTop += delta
            } else {
              block?.scrollIntoView({ block: 'center' })
            }
          } catch { /* pos 可能因文档变化失效，忽略 */ }
        }
      }
    }, 300)
    return () => window.clearInterval(iv)
  }, [aiReplaceSignal, goToLineSignal, editor, onContentChanged, onSaved, onSave])

  // 卸载前提示未保存（简单兜底；后续可加 beforeunload）
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        console.warn('离开时存在未保存内容：', path)
      }
    }
  }, [path])

  return (
    <div className="editor-pane">
      <div className="editor-file-bar">
        <span className="editor-path">{path}</span>
        <button className="save-btn" disabled={saving || loading} onClick={() => void doSave()}>
          保存 (Ctrl+S)
        </button>
      </div>
      {loading ? (
        <div className="editor-loading">加载中…</div>
      ) : (
        <EditorContent editor={editor} className="editor-content" />
      )}
    </div>
  )
}

/** 编辑器纯文本导出：段落间 \n */
function editorText(editor: NonNullable<ReturnType<typeof useEditor>>): string {
  const paragraphs: string[] = []
  editor.state.doc.forEach((node) => {
    paragraphs.push(node.textContent)
  })
  return paragraphs.join('\n')
}

/** 纯文本 → TipTap 文档：非空行成段；markdown 标题行（# …）转 heading */
function linesToDoc(text: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = []
  for (const line of text.split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      nodes.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: heading[2] ? [{ type: 'text', text: heading[2] }] : [],
      })
    } else {
      nodes.push({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })
    }
  }
  return nodes.length > 0 ? nodes : [{ type: 'paragraph' }]
}
