/** 一致性检查 tab：全书交叉核对（人物断档/情节线推进/伏笔回收/章节健康），点击跳转 */
import { useCallback, useState } from 'react'
import {
  listChapters, listCharacters, listPlotLines, loadChapterContents, loadMemoryIndices, scanCharacterMentions,
} from '../../api/novel'
import { runConsistencyCheck, type ConsistencyReport, type ConsistencyIssue } from '../../api/consistency'

type Props = {
  onError: (msg: string | null) => void
  onOpenFile: (path: string) => void
}

const SEV_LABEL: Record<ConsistencyIssue['severity'], string> = { high: '重要', medium: '建议', low: '提示' }
const SEV_CLASS: Record<ConsistencyIssue['severity'], string> = { high: 'high', medium: 'medium', low: 'low' }
const DIM_LABEL: Record<ConsistencyIssue['dimension'], string> = {
  character: '人物', plotline: '情节线', foreshadow: '伏笔', chapter: '章节',
}

export function ConsistencyTab({ onError, onOpenFile }: Props) {
  const [report, setReport] = useState<ConsistencyReport | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    setReport(null)
    try {
      const [chapters, meta, characters, plotLines, indices] = await Promise.all([
        loadChapterContents(),
        listChapters(),
        listCharacters(),
        listPlotLines(),
        loadMemoryIndices(),
      ])
      if (chapters.length === 0) {
        onError('没有章节可检查')
        return
      }
      const foreshadow = indices.find((i) => i.path === '.novel/state/foreshadow-index.md')
      const mentions = scanCharacterMentions(chapters, characters.map((c) => c.name))
      setReport(runConsistencyCheck({
        chapters,
        chapterMeta: meta,
        characters,
        mentions,
        plotLines,
        foreshadowIndex: foreshadow?.content ?? '',
      }))
    } catch (e) {
      onError(`一致性检查失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }, [onError])

  return (
    <div className="tools-section">
      <p className="settings-hint">
        全书交叉核对：人物出场断档、情节线长期无推进、伏笔未回收、章节状态矛盾。纯本地规则，不调用 AI。
      </p>
      <div className="tools-row">
        <button className="tools-run" disabled={running} onClick={() => void run()}>
          {running ? '核对中…' : '全书一致性检查'}
        </button>
      </div>

      {report ? (
        <div className="consistency-result">
          <div className="consistency-summary">
            核对 {report.chapterCount} 章 · {report.characterCount} 个人物 · {report.plotLineCount} 条情节线，
            发现 <b>{report.issues.length}</b> 项
            {report.issues.length === 0 ? ' —— 全书状态健康 ✓' : ''}
          </div>
          {report.issues.map((it, i) => (
            <button key={i} className={`consistency-item sev-${SEV_CLASS[it.severity]}`} onClick={() => it.jumpPath && onOpenFile(it.jumpPath)}>
              <span className="consistency-sev">{SEV_LABEL[it.severity]}</span>
              <span className="consistency-dim">{DIM_LABEL[it.dimension]}</span>
              <span className="consistency-msg">{it.message}</span>
              <span className="consistency-detail">{it.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
