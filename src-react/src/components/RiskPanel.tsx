import { useEffect, useMemo, useState } from 'react'
import { riskScanContent, type RiskScanResult } from '../tauri'
import { useI18n } from '../i18n'
import './RiskPanel.css'

type RiskPanelProps = {
  activeFile: { path: string; content: string } | null
}

export function RiskPanel({ activeFile }: RiskPanelProps) {
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RiskScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const levelLabel: Record<string, string> = {
    high: t('risk.level.high'),
    medium: t('risk.level.medium'),
    low: t('risk.level.low'),
  }

  const canScan = useMemo(
    () => !!activeFile && activeFile.content.trim().length > 0 && !running,
    [activeFile, running],
  )

  useEffect(() => {
    setError(null)
    setResult(null)
  }, [activeFile?.path])

  const onScan = async () => {
    if (!activeFile || !activeFile.content.trim()) return
    setRunning(true)
    setError(null)
    try {
      const res = await riskScanContent(activeFile.path, activeFile.content)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="sidebar-header">{t('risk.title')}</div>
      <div className="sidebar-content risk-panel">
        <div className="risk-panel-toolbar">
          <button className="primary-button risk-panel-run" disabled={!canScan} onClick={() => void onScan()}>
            {running ? t('risk.running') : t('risk.run')}
          </button>
          <div className="risk-panel-meta">
            {activeFile ? activeFile.path : t('risk.noFileOpen')}
          </div>
        </div>

        {error ? <div className="error-text risk-panel-error">{error}</div> : null}

        {!activeFile ? (
          <div className="risk-panel-empty">{t('risk.empty.noFile')}</div>
        ) : null}

        {activeFile && !result && !running ? (
          <div className="risk-panel-empty">{t('risk.empty.hint')}</div>
        ) : null}

        {result ? (
          <div className="risk-panel-result">
            <div className="risk-panel-summary">
              <div className={`risk-level-badge level-${result.overall_level}`}>
                {levelLabel[result.overall_level] ?? result.overall_level}
              </div>
              <div className="risk-summary-text">{result.summary}</div>
            </div>
            <div className="risk-count">{t('risk.summaryCount', { findings: result.findings.length, scanned: result.scanned_chars })}</div>
            {result.findings.length === 0 ? (
              <div className="risk-panel-empty">{t('risk.noFindings')}</div>
            ) : (
              <div className="risk-findings">
                {result.findings.map((item, idx) => (
                  <div key={`${item.category}-${idx}`} className="risk-finding-card">
                    <div className="risk-finding-head">
                      <span className={`risk-level-badge level-${item.level}`}>
                        {levelLabel[item.level] ?? item.level}
                      </span>
                      <span className="risk-category">{item.category || t('risk.otherCategory')}</span>
                    </div>
                    {item.excerpt ? <div className="risk-excerpt">"{item.excerpt}"</div> : null}
                    <div className="risk-reason">{item.reason}</div>
                    {item.suggestion ? <div className="risk-suggestion">{t('risk.suggestion', { suggestion: item.suggestion })}</div> : null}
                    {item.line_start ? (
                      <div className="risk-line">
                        {t('risk.line', {
                          start: item.line_start,
                          end: item.line_end && item.line_end !== item.line_start ? ` - ${item.line_end}` : '',
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
