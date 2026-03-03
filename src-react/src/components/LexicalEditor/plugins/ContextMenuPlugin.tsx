import { useEffect, useState, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COPY_COMMAND,
  CUT_COMMAND,
  PASTE_COMMAND,
  SELECT_ALL_COMMAND,
} from 'lexical'
import './ContextMenuPlugin.css'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  action: (editor: any, selection: string) => void
  condition?: (hasSelection: boolean) => boolean
}

export interface ContextMenuPluginProps {
  customMenuItems?: ContextMenuItem[]
  onMenuItemClick?: (item: ContextMenuItem, selection: string) => void
}

/**
 * ContextMenuPlugin - Provides right-click context menu for the editor
 * 
 * Features:
 * - Basic operations: copy, paste, cut, select all
 * - Conditional menu items based on text selection
 * - Custom menu items support
 * - Auto-close on outside click or Escape key
 */
export function ContextMenuPlugin({
  customMenuItems = [],
  onMenuItemClick,
}: ContextMenuPluginProps) {
  const [editor] = useLexicalComposerContext()
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const [selectedText, setSelectedText] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Handle context menu open
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const rootElement = editor.getRootElement()
      
      // Check if right-click is within the editor
      if (rootElement && rootElement.contains(event.target as Node)) {
        event.preventDefault()
        
        // Get selected text
        let selection = ''
        editor.getEditorState().read(() => {
          const lexicalSelection = $getSelection()
          if ($isRangeSelection(lexicalSelection)) {
            selection = lexicalSelection.getTextContent()
          }
        })
        
        setSelectedText(selection)
        setMenuPosition({ x: event.clientX, y: event.clientY })
        setMenuVisible(true)
      }
    }

    const rootElement = editor.getRootElement()
    if (rootElement) {
      rootElement.addEventListener('contextmenu', handleContextMenu)
      return () => {
        rootElement.removeEventListener('contextmenu', handleContextMenu)
      }
    }
  }, [editor])

  // Handle click outside to close menu
  useEffect(() => {
    if (!menuVisible) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuVisible(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuVisible])

  // Handle Escape key to close menu
  useEffect(() => {
    if (!menuVisible) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuVisible(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuVisible])

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!menuVisible || !menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let adjustedX = menuPosition.x
    let adjustedY = menuPosition.y

    // Adjust horizontal position if menu goes off-screen
    if (menuPosition.x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10
    }

    // Adjust vertical position if menu goes off-screen
    if (menuPosition.y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 10
    }

    menu.style.left = `${adjustedX}px`
    menu.style.top = `${adjustedY}px`
  }, [menuVisible, menuPosition])

  // Basic menu actions
  const handleCopy = () => {
    editor.dispatchCommand(COPY_COMMAND, new ClipboardEvent('copy'))
    setMenuVisible(false)
  }

  const handleCut = () => {
    editor.dispatchCommand(CUT_COMMAND, new ClipboardEvent('cut'))
    setMenuVisible(false)
  }

  const handlePaste = () => {
    editor.dispatchCommand(PASTE_COMMAND, new ClipboardEvent('paste'))
    setMenuVisible(false)
  }

  const handleSelectAll = () => {
    editor.dispatchCommand(SELECT_ALL_COMMAND, new KeyboardEvent('keydown'))
    setMenuVisible(false)
  }

  // Handle custom menu item click
  const handleCustomItemClick = (item: ContextMenuItem) => {
    item.action(editor, selectedText)
    if (onMenuItemClick) {
      onMenuItemClick(item, selectedText)
    }
    setMenuVisible(false)
  }

  if (!menuVisible) {
    return null
  }

  const hasSelection = selectedText.trim().length > 0

  // Filter custom menu items based on their conditions
  const visibleCustomItems = customMenuItems.filter(item => {
    if (item.condition) {
      return item.condition(hasSelection)
    }
    return true
  })

  return (
    <div
      ref={menuRef}
      className="lexical-context-menu"
      role="menu"
      aria-label="编辑器上下文菜单"
      style={{ left: menuPosition.x, top: menuPosition.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="context-menu-section">
        <button
          className="context-menu-item"
          role="menuitem"
          onClick={handleCopy}
          disabled={!hasSelection}
          title="Copy selected text"
          aria-label="复制"
        >
          <span className="menu-icon">📋</span>
          <span className="menu-label">复制</span>
          <span className="menu-shortcut">Ctrl+C</span>
        </button>
        <button
          className="context-menu-item"
          role="menuitem"
          onClick={handleCut}
          disabled={!hasSelection}
          title="Cut selected text"
          aria-label="剪切"
        >
          <span className="menu-icon">✂️</span>
          <span className="menu-label">剪切</span>
          <span className="menu-shortcut">Ctrl+X</span>
        </button>
        <button
          className="context-menu-item"
          role="menuitem"
          onClick={handlePaste}
          title="Paste text"
          aria-label="粘贴"
        >
          <span className="menu-icon">📄</span>
          <span className="menu-label">粘贴</span>
          <span className="menu-shortcut">Ctrl+V</span>
        </button>
        <button
          className="context-menu-item"
          role="menuitem"
          onClick={handleSelectAll}
          title="Select all text"
          aria-label="全选"
        >
          <span className="menu-icon">🔲</span>
          <span className="menu-label">全选</span>
          <span className="menu-shortcut">Ctrl+A</span>
        </button>
      </div>

      {visibleCustomItems.length > 0 && (
        <>
          <div className="context-menu-divider" role="separator" />
          <div className="context-menu-section">
            {visibleCustomItems.map((item) => (
              <button
                key={item.id}
                className="context-menu-item"
                role="menuitem"
                onClick={() => handleCustomItemClick(item)}
                title={item.label}
                aria-label={item.label}
              >
                {item.icon && <span className="menu-icon">{item.icon}</span>}
                <span className="menu-label">{item.label}</span>
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
