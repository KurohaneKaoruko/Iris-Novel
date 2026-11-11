import { useCallback, useEffect, useState } from 'react'
import {
  listCharacters,
  listPlotLines,
  listCodex,
  CODEX_TYPES,
  type Character,
  type PlotLine,
  type CodexEntry,
} from '../../api/novel'

type Tab = 'characters' | 'plots' | 'codex'

const PLOT_STATUS: Record<PlotLine['status'], { label: string; cls: string }> = {
  ongoing: { label: '进行中', cls: 'ongoing' },
  completed: { label: '已完结', cls: 'completed' },
  paused: { label: '暂停', cls: 'paused' },
}

type Props = {
  activePath: string | null
  onOpen: (path: string) => void
}

/** 右栏「设定」页签：人物卡 / 情节线 / 设定集 三合一总览 */
export function LorePanel({ activePath, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('characters')
  const [characters, setCharacters] = useState<Character[]>([])
  const [plots, setPlots] = useState<PlotLine[]>([])
  const [codex, setCodex] = useState<CodexEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cs, ps, cx] = await Promise.all([
        listCharacters().catch(() => [] as Character[]),
        listPlotLines().catch(() => [] as PlotLine[]),
        listCodex().catch(() => [] as CodexEntry[]),
      ])
      setCharacters(cs)
      setPlots(ps)
      setCodex(cx)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, activePath])

  const CHAR_ZH: Record<string, string> = {
    appearance: '外貌',
    personality: '性格',
    background: '背景',
    relationships: '关系',
    notes: '备注',
  }

  return (
    <div className="lore">
      <div className="lore-tabs">
        <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>
          人物 {characters.length > 0 ? characters.length : ''}
        </button>
        <button className={tab === 'plots' ? 'active' : ''} onClick={() => setTab('plots')}>
          情节线 {plots.length > 0 ? plots.length : ''}
        </button>
        <button className={tab === 'codex' ? 'active' : ''} onClick={() => setTab('codex')}>
          设定 {codex.length > 0 ? codex.length : ''}
        </button>
        <span className="lore-spacer" />
        <button className="agw-icon-btn" title="刷新" onClick={() => void refresh()}>⟳</button>
      </div>

      {loading ? (
        <div className="agw-empty">加载中…</div>
      ) : (
        <div className="lore-body">
          {tab === 'characters' ? (
            characters.length === 0 ? (
              <div className="agw-empty">
                concept/characters.md 还没有人物卡。
                <br />
                让 Agent 用「## 姓名 + 字段列表」格式维护。
              </div>
            ) : (
              characters.map((c) => (
                <details key={c.id} className="lore-card">
                  <summary>
                    <span className="lore-name">👤 {c.name}</span>
                  </summary>
                  <div className="lore-fields">
                    {(Object.entries(c.data) as Array<[string, string | undefined]>)
                      .filter(([k, v]) => k !== 'name' && v && v.trim())
                      .map(([k, v]) => (
                        <div key={k} className="lore-field">
                          <span className="lf-key">{CHAR_ZH[k] ?? k}</span>
                          <span className="lf-val">{v}</span>
                        </div>
                      ))}
                  </div>
                  <button className="lore-open" onClick={() => onOpen('concept/characters.md')}>
                    打开人物卡 →
                  </button>
                </details>
              ))
            )
          ) : null}

          {tab === 'plots' ? (
            plots.length === 0 ? (
              <div className="agw-empty">
                outline/plotlines.md 还没有情节线。
                <br />
                让 Agent 用「## 线名 + 状态 + 描述」格式维护。
              </div>
            ) : (
              plots.map((p) => {
                const st = PLOT_STATUS[p.status] ?? PLOT_STATUS.ongoing
                return (
                  <div key={p.id} className="lore-card">
                    <div className="lore-plot-head">
                      <span className="lore-name">🧵 {p.name}</span>
                      <span className={`plot-status ${st.cls}`}>{st.label}</span>
                    </div>
                    {p.description ? <div className="lore-desc">{p.description}</div> : null}
                    <div className="lore-range">
                      {p.startChapter || '?'} → {p.endChapter || '…'}
                    </div>
                  </div>
                )
              })
            )
          ) : null}

          {tab === 'codex' ? (
            codex.length === 0 ? (
              <div className="agw-empty">
                concept/codex.md 还没有设定条目。
                <br />
                让 Agent 用「## [类型] 名称」格式维护地点/势力/物品/术语。
              </div>
            ) : (
              codex.map((e) => {
                const t = CODEX_TYPES.find((x) => x.id === e.type)
                return (
                  <details key={e.id} className="lore-card">
                    <summary>
                      <span className="lore-name">
                        {t?.icon ?? '📄'} {e.name}
                      </span>
                      <span className="lore-type">{t?.zh ?? e.type}</span>
                    </summary>
                    {e.summary ? <div className="lore-desc">{e.summary}</div> : null}
                    {e.details ? <div className="lore-fields lore-details">{e.details}</div> : null}
                  </details>
                )
              })
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
