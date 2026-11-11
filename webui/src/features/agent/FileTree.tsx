import { useState, type MouseEvent } from 'react'
import type { FsEntry } from '../../api/backend'
import './FileTree.css'

type FileTreeProps = {
  entry: FsEntry
  activePath: string | null
  onOpen: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  /** 点击回复/树中的文件路径（用于面板跳转） */
  onJumpFile?: (path: string) => void
}

/** 递归文件树：目录可折叠；文件 hover 显示操作；仅 Markdown/文本可打开 */
export function FileTree({ entry, activePath, onOpen, onRename, onDelete }: FileTreeProps) {
  return <NodeView entry={entry} depth={0} activePath={activePath} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
}

function NodeView({
  entry,
  depth,
  activePath,
  onOpen,
  onRename,
  onDelete,
}: FileTreeProps & { depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const isDir = entry.kind === 'dir'
  const hidden = entry.name === '.novel' || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target'
  if (hidden) return null

  const openable = !isDir && /\.(md|markdown|txt)$/i.test(entry.name)
  const stop = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation()
    fn()
  }

  const children = isDir
    ? [...(entry.children ?? [])].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    : []

  return (
    <div className="ft-node">
      {isDir ? (
        <button
          className={`ft-row ft-dir ${open ? 'open' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ft-caret">▸</span>
          <span className="ft-name">{entry.name}</span>
        </button>
      ) : (
        <div
          className={`ft-row ft-file ${activePath === entry.path ? 'active' : ''} ${openable ? '' : 'disabled'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => openable && onOpen(entry.path)}
          title={openable ? entry.path : '非文本文件，不可预览'}
        >
          <span className="ft-name">{entry.name}</span>
          <span className="ft-actions">
            <button title="重命名" onClick={(e) => stop(e, () => onRename(entry.path))}>✎</button>
            <button title="删除" onClick={(e) => stop(e, () => onDelete(entry.path))}>✕</button>
          </span>
        </div>
      )}
      {isDir && open
        ? children.map((c) => (
            <NodeView
              key={c.path}
              entry={c}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        : null}
    </div>
  )
}
