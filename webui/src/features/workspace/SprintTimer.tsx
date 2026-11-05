/**
 * 写作冲刺计时器：设定时长 + 目标字数，倒计时内统计编辑器净增字数。
 * 纯前端（localStorage 记忆设置），不落作品盘。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import './SprintTimer.css'

type Props = {
  /** 当前章节字数（保存后更新） */
  chapterWords: number
  /** 章节切换时重置（key 变化） */
  activePath: string | null
}

type SprintState = 'idle' | 'running' | 'paused' | 'done'

const STORE_KEY = 'iris-creation-sprint'
const DURATIONS = [15, 25, 45, 60]

type Persisted = { minutes: number; target: number }

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Persisted
      return { minutes: v.minutes ?? 25, target: v.target ?? 500 }
    }
  } catch { /* ignore */ }
  return { minutes: 25, target: 500 }
}

export function SprintTimer({ chapterWords, activePath }: Props) {
  const [{ minutes, target }, setCfg] = useState<Persisted>(loadPersisted)
  const [state, setState] = useState<SprintState>('idle')
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60)
  const startWordsRef = useRef(0)
  const pathAtStartRef = useRef<string | null>(null)

  // 配置变更时同步 idle 计时
  useEffect(() => {
    if (state === 'idle') setSecondsLeft(minutes * 60)
  }, [minutes, state])

  const persist = (next: Persisted) => {
    setCfg(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // 倒计时
  useEffect(() => {
    if (state !== 'running') return
    const iv = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setState('done')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(iv)
  }, [state])

  const start = () => {
    startWordsRef.current = chapterWords
    pathAtStartRef.current = activePath
    setSecondsLeft(minutes * 60)
    setState('running')
  }

  const reset = useCallback(() => {
    setState('idle')
    setSecondsLeft(minutes * 60)
  }, [minutes])

  const delta = Math.max(0, chapterWords - startWordsRef.current)
  const pct = target > 0 ? Math.min(100, Math.round((delta / target) * 100)) : 0
  const mm = Math.floor(secondsLeft / 60)
  const ss = secondsLeft % 60
  const timeStr = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  const progressClass = delta >= target ? 'hit' : pct >= 60 ? 'close' : ''

  if (state === 'idle') {
    return (
      <div className="sprint-timer">
        <select
          value={minutes}
          title="冲刺时长"
          onChange={(e) => persist({ minutes: Number(e.target.value), target })}
        >
          {DURATIONS.map((d) => <option key={d} value={d}>{d} 分钟</option>)}
        </select>
        <input
          type="number"
          min={100}
          step={100}
          value={target}
          title="目标字数"
          onChange={(e) => persist({ minutes, target: Math.max(0, Number(e.target.value) || 0) })}
        />
        <button className="sprint-start" onClick={start} disabled={!activePath} title={activePath ? '' : '先打开一个章节'}>
          ⚡ 冲刺
        </button>
      </div>
    )
  }

  return (
    <div className={`sprint-timer running ${progressClass}`}>
      <span className="sprint-clock">{timeStr}</span>
      <span className="sprint-words">+{delta}/{target} 字</span>
      <div className="sprint-bar"><div className="sprint-bar-fill" style={{ width: `${pct}%` }} /></div>
      {state === 'running' ? (
        <button className="sprint-ctl" onClick={() => setState('paused')}>暂停</button>
      ) : state === 'paused' ? (
        <button className="sprint-ctl" onClick={() => setState('running')}>继续</button>
      ) : (
        <span className="sprint-done-badge">{delta >= target ? '🎉 达成！' : '时间到'}</span>
      )}
      <button className="sprint-ctl" onClick={reset}>重置</button>
    </div>
  )
}
