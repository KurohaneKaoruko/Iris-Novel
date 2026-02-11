import { useEffect, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { 
  $getRoot, 
  $createParagraphNode, 
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  UNDO_COMMAND,
  REDO_COMMAND,
} from 'lexical'
import type { EditorState, LexicalEditor as LexicalEditorType } from 'lexical'
import type { LexicalEditorProps } from '../../types/editor'
import { AIAssistPlugin } from './plugins/AIAssistPlugin'
import './LexicalEditor.css'

/**
 * Extended editor interface with custom methods
 */
export interface ExtendedLexicalEditor extends LexicalEditorType {
  getSelection: () => any
  getSelectedText: () => string
  getContent: () => string
  setContent: (content: string) => void
}

/**
 * Plugin to set initial content
 */
function InitialContentPlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    if (content) {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        
        // Split content by newlines and create paragraphs
        const lines = content.split('\n')
        lines.forEach((line) => {
          const paragraph = $createParagraphNode()
          if (line) {
            paragraph.append($createTextNode(line))
          }
          root.append(paragraph)
        })
      })
    }
  }, [editor, content])
  
  return null
}

/**
 * Plugin to expose editor instance via ref with custom methods
 */
function EditorRefPlugin({ 
  editorRef, 
  onReady 
}: { 
  editorRef?: React.MutableRefObject<any>
  onReady?: (editor: any) => void
}) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    // Extend editor with custom methods
    const extendedEditor = editor as ExtendedLexicalEditor
    
    // Add getSelection method
    extendedEditor.getSelection = () => {
      let selection = null
      editor.getEditorState().read(() => {
        selection = $getSelection()
      })
      return selection
    }
    
    // Add getSelectedText method
    extendedEditor.getSelectedText = () => {
      let selectedText = ''
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selectedText = selection.getTextContent()
        }
      })
      return selectedText
    }
    
    // Add getContent method - returns complete editor content
    extendedEditor.getContent = () => {
      let content = ''
      editor.getEditorState().read(() => {
        const root = $getRoot()
        content = root.getTextContent()
      })
      return content
    }
    
    // Add setContent method - sets editor content (handles both plain text and rich text)
    extendedEditor.setContent = (content: string) => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        
        // Split content by newlines and create paragraphs
        const lines = content.split('\n')
        lines.forEach((line) => {
          const paragraph = $createParagraphNode()
          if (line) {
            paragraph.append($createTextNode(line))
          }
          root.append(paragraph)
        })
      })
    }
    
    if (editorRef) {
      editorRef.current = extendedEditor
    }
    if (onReady) {
      onReady(extendedEditor)
    }
  }, [editor, editorRef, onReady])
  
  return null
}

/**
 * Plugin to handle keyboard shortcuts for undo/redo
 * Ctrl+Z for undo, Ctrl+Y for redo
 */
function KeyboardShortcutsPlugin() {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(UNDO_COMMAND, undefined)
        } else if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
          event.preventDefault()
          editor.dispatchCommand(REDO_COMMAND, undefined)
        }
      }
    }
    
    // Register keyboard event listener
    const rootElement = editor.getRootElement()
    if (rootElement) {
      rootElement.addEventListener('keydown', handleKeyDown)
      return () => {
        rootElement.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [editor])
  
  return null
}

/**
 * LexicalEditor Component
 * A wrapper around Lexical editor with basic functionality
 */
export function LexicalEditor({
  initialContent,
  onChange,
  config,
  readOnly = false,
  placeholder = '开始写作...',
  editorRef,
  className = '',
  onReady,
  fileType,
}: LexicalEditorProps) {
  const contentEditableRef = useRef<HTMLDivElement>(null)
  
  // Determine if we should use RichText or PlainText based on file type
  // .md files use RichText, .txt files use PlainText
  const useRichText = fileType === '.md' || fileType === 'md'
  
  // Handle content changes
  const handleChange = (editorState: EditorState, editor: any) => {
    editorState.read(() => {
      const root = $getRoot()
      const textContent = root.getTextContent()
      onChange(textContent, editor)
    })
  }
  
  // Initial config for LexicalComposer
  const initialConfig = {
    namespace: config.namespace,
    theme: config.theme,
    onError: config.onError,
    nodes: config.nodes || [],
    editable: !readOnly,
  }
  
  return (
    <div className={`lexical-editor-wrapper ${className}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="lexical-editor-container">
          {useRichText ? (
            <RichTextPlugin
              contentEditable={
                <ContentEditable 
                  ref={contentEditableRef}
                  className="lexical-content-editable"
                  aria-placeholder={placeholder}
                  placeholder={
                    <div className="lexical-placeholder">{placeholder}</div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          ) : (
            <PlainTextPlugin
              contentEditable={
                <ContentEditable 
                  ref={contentEditableRef}
                  className="lexical-content-editable"
                  aria-placeholder={placeholder}
                  placeholder={
                    <div className="lexical-placeholder">{placeholder}</div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          )}
          <HistoryPlugin />
          <KeyboardShortcutsPlugin />
          <OnChangePlugin onChange={handleChange} />
          <InitialContentPlugin content={initialContent} />
          <EditorRefPlugin editorRef={editorRef} onReady={onReady} />
          <AIAssistPlugin />
        </div>
      </LexicalComposer>
    </div>
  )
}
