/** 正文体检 tab：跑 lint 规则引擎，按级别分组展示，点击定位到行 */
import { useCallback, useMemo, useState } from 'react'
import { readText } from '../../api/backend'
import { lintChapter, type LintIssue } from '../../api/lint'

type Props = {
  activePath: string | null
  onError: (msg: string | null) => void
  onOpenFile: (path: string, line?: number) => void
}

const LEVEL_LABEL: Record<LintIssue['level'], string> = { error: '一级套路', warn: '密度超限', info: '句式结构' }
const LEVEL_ORDER: Array<LintIssue['level']> = ['error', 'warn', 'info']

export function LintTab({ activePath, onError, onOpenFile }: Props) {
  const [issues, setIssues] = useState<LintIssue[] | null>(null)
  const [target, setTarget] = useState<string>('')
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    if (!activePath) {
      onError('没有打开的章节')
      return
    }
    setRunning(true)
    setIssues(null)
    try {
      const content = await readText(activePath)
      setIssues(lintChapter(content))
      setTarget(activePath)
    } catch (e) {
      onError(`体检失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }, [activePath, onError])

  const grouped = useMemo(() => {
    const m = new Map<LintIssue['level'], LintIssue[]>()
    for (const lv of LEVEL_ORDER) m.set(lv, [])
    for (const i of issues ?? []) m.get(i.level)?.push(i)
    return m
  }, [issues])

  const total = issues?.length ?? 0

  return (
    <div className="tools-section">
      <p className="settings-hint">
        按 Novelist-Skills 铁律库扫描当前章节：一级套路（出现即改写）、二级限频（密度失控）、句式模板与结构提示。纯本地规则，不调用 AI。
      </p>
      <div className="tools-row">
        <span className="lint-target">{activePath ?? '（未打开章节）'}</span>
        <button className="tools-run" disabled={running || !activePath} onClick={() => void run()}>
          {running ? '体检中…' : '开始体检'}
        </button>
      </div>

      {issues !== null ? (
        total === 0 ? (
          <p className="tools-empty">✓ 未发现问题，文字很干净</p>
        ) : (
          <div className="lint-groups">
            <div className="lint-summary">
              共 {total} 处：{LEVEL_ORDER.map((lv) => `${LEVEL_LABEL[lv]} ${grouped.get(lv)?.length ?? 0}`).join(' · ')}
            </div>
            {LEVEL_ORDER.map((lv) => {
              const items = grouped.get(lv) ?? []
              if (items.length === 0) return null
              return (
                <div key={lv} className="lint-group">
                  <div className={`lint-group-title lint-${lv}`}>{LEVEL_LABEL[lv]}（{items.length}）</div>
                  {items.map((it, k) => (
                    <button
                      key={`${it.rule}-${it.line}-${k}`}
                      className="lint-item"
                      title="点击在编辑器中定位"
                      onClick={() => target && onOpenFile(target, it.line)}
                    >
                      <span className="lint-line">L{it.line}</span>
                      <span className="lint-rule">{it.rule}{it.count ? `（${it.count}/${it.limit}）` : ''}</span>
                      <span className="lint-snippet">{it.snippet}</span>
                      <span className="lint-advice">{it.advice}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )
      ) : null}
    </div>
  )
}
