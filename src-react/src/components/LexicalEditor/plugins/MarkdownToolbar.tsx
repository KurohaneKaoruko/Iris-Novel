import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { 
  $getSelection, 
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import type { TextFormatType } from 'lexical'
import { 
  $createHeadingNode,
  $createQuoteNode,
} from '@lexical/rich-text'
import type { HeadingTagType } from '@lexical/rich-text'
import { 
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from '@lexical/list'
import './MarkdownToolbar.css'

/**
 * MarkdownToolbar Component
 * Provides quick access to common Markdown formatting options
 */
export function MarkdownToolbar() {
  const [editor] = useLexicalComposerContext()

  const formatText = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
  }

  const insertHeading = (tag: HeadingTagType) => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const nodes = selection.getNodes()
        nodes.forEach((node) => {
          const parent = node.getParent()
          if (parent) {
            const heading = $createHeadingNode(tag)
            heading.append(...parent.getChildren())
            parent.replace(heading)
          }
        })
      }
    })
  }

  const insertQuote = () => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const nodes = selection.getNodes()
        nodes.forEach((node) => {
          const parent = node.getParent()
          if (parent) {
            const quote = $createQuoteNode()
            quote.append(...parent.getChildren())
            parent.replace(quote)
          }
        })
      }
    })
  }

  const insertUnorderedList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
  }

  const insertOrderedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
  }

  return (
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={() => formatText('bold')}
          title="Bold (Ctrl+B)"
          aria-label="粗体"
        >
          <strong>B</strong>
        </button>
        <button
          className="toolbar-button"
          onClick={() => formatText('italic')}
          title="Italic (Ctrl+I)"
          aria-label="斜体"
        >
          <em>I</em>
        </button>
        <button
          className="toolbar-button"
          onClick={() => formatText('underline')}
          title="Underline (Ctrl+U)"
          aria-label="下划线"
        >
          <u>U</u>
        </button>
        <button
          className="toolbar-button"
          onClick={() => formatText('strikethrough')}
          title="Strikethrough"
          aria-label="删除线"
        >
          <s>S</s>
        </button>
      </div>

      <div className="toolbar-divider"></div>

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={() => insertHeading('h1')}
          title="Heading 1"
          aria-label="标题 1"
        >
          H1
        </button>
        <button
          className="toolbar-button"
          onClick={() => insertHeading('h2')}
          title="Heading 2"
          aria-label="标题 2"
        >
          H2
        </button>
        <button
          className="toolbar-button"
          onClick={() => insertHeading('h3')}
          title="Heading 3"
          aria-label="标题 3"
        >
          H3
        </button>
      </div>

      <div className="toolbar-divider"></div>

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={insertQuote}
          title="Quote"
          aria-label="引用"
        >
          &ldquo;&rdquo;
        </button>
        <button
          className="toolbar-button"
          onClick={insertUnorderedList}
          title="Bullet List"
          aria-label="无序列表"
        >
          • List
        </button>
        <button
          className="toolbar-button"
          onClick={insertOrderedList}
          title="Numbered List"
          aria-label="有序列表"
        >
          1. List
        </button>
      </div>
    </div>
  )
}
