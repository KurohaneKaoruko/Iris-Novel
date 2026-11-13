import { useCallback, useEffect, useState } from 'react'
import { listWorkspaceTree, readText, writeText, createDir } from '../../api/backend'
import {
  assembleBackupReport,
  buildExportFilename,
  collectBackupFiles,
  sha256Hex,
  type BackupFileEntry,
} from '../../api/exportCenter'
import { Icon } from '../../components/Icon'
import { useProject } from '../../state/ProjectContext'
import './BackupTab.css'

/** 单文件清单采集：读内容 → 字数（去空白）+ 字节 + SHA-256 */
async function collectEntry(path: string): Promise<BackupFileEntry> {
  const content = await readText(path)
  return {
    path,
    words: content.replace(/\s/g, '').length,
    bytes: new TextEncoder().encode(content).length,
    hash: await sha256Hex(content),
  }
}

/**
 * 「备份」页签：工程快照报告（零新依赖，非压缩包）。
 * 全工程文件树（排除 exports/）逐文件字数/大小/SHA-256 清单，落盘 exports/backups/。
 * hash 清单用于日后核对内容是否被改动；完整目录冷备份建议用系统工具。
 */
export function BackupTab() {
  const { workName } = useProject()
  const [files, setFiles] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const tree = await listWorkspaceTree(8)
        setFiles(collectBackupFiles(tree))
      } catch {
        setFiles([])
      }
    })()
  }, [])

  const run = useCallback(async () => {
    const snapshotFiles = files ?? []
    if (snapshotFiles.length === 0 || busy) return
    setBusy(true)
    setErr('')
    setDone('')
    setProgress(0)
    try {
      const entries: BackupFileEntry[] = []
      // 分批处理（批间让出主线程），千文件级工程不冻 UI
      const BATCH = 12
      for (let i = 0; i < snapshotFiles.length; i += BATCH) {
        const batch = snapshotFiles.slice(i, i + BATCH)
        entries.push(...(await Promise.all(batch.map((p) => collectEntry(p)))))
        setProgress(Math.min(snapshotFiles.length, i + BATCH))
        await new Promise((r) => setTimeout(r, 0))
      }
      await createDir('exports/backups').catch(() => {})
      const filename = buildExportFilename(workName || '未命名作品', 'backup', 'md')
      const relPath = `exports/backups/${filename}`
      await writeText(relPath, assembleBackupReport({ workName: workName || '未命名作品', files: entries }))
      setDone(relPath)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, files, workName])

  return (
    <div className="bkp">
      <div className="bkp-intro">
        <Icon name="package" size={16} />
        <div>
          <div className="bkp-title">工程备份快照</div>
          <div className="bkp-desc">
            生成全工程文件清单报告：逐文件记录字数、大小与 SHA-256 校验值，写入 <code>exports/backups/</code>。
            用于追溯「某个时间点工程里有什么、内容是否被改动」；恢复整目录请配合系统级冷备份。
          </div>
        </div>
      </div>

      <div className="bkp-actions">
        <button className="tools-run primary" disabled={busy || !files || files.length === 0} onClick={() => void run()}>
          {busy ? `备份中 ${progress}/${files?.length ?? 0}…` : <><Icon name="download" size={14} />生成备份快照</>}
        </button>
        <span className="tools-run-hint">
          {files === null ? '扫描工程中…' : `${files.length} 个文件将纳入清单（exports/ 产物不重复纳入）`}
        </span>
      </div>

      {done ? (
        <div className="tools-ok">
          <Icon name="check-circle" size={14} /> 备份完成：<code className="exp-path">{done}</code>
        </div>
      ) : null}
      {err ? <div className="tools-err">{err}</div> : null}

      {files !== null && files.length > 0 ? (
        <div className="bkp-files">
          <div className="tools-section-title">纳入清单的文件（前 30）</div>
          {files.slice(0, 30).map((p) => (
            <div key={p} className="bkp-file">
              <Icon name="file-text" size={13} />
              <span className="bkp-file-path">{p}</span>
            </div>
          ))}
          {files.length > 30 ? <div className="bkp-more">…共 {files.length} 个</div> : null}
        </div>
      ) : files !== null ? (
        <div className="tools-hint">工程内暂无可备份文件。</div>
      ) : null}
    </div>
  )
}
