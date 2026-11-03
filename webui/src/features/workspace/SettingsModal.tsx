import { useCallback, useEffect, useState } from 'react'
import {
  getAppSettings, getApiKeyStatus, setApiKey, setAppSettings,
  getProjectWritingSettings, setProjectWritingSettings, testProviderConnectivity,
  getSkills, type AppSettings, type Provider, type ProjectWritingSettings, type Skill,
} from '../../api/backend'
import './SettingsModal.css'

type Props = {
  onClose: () => void
  onError: (msg: string | null) => void
  /** 保存后通知外部刷新（如默认技能变化） */
  onSaved?: () => void
}

type Tab = 'providers' | 'writing' | 'skill'

/** 每类 kind 的默认 base_url，便于新建时预填 */
const KIND_DEFAULTS: Record<Provider['kind'], { url: string; model: string }> = {
  OpenAI: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  Anthropic: { url: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' },
  OpenAICompatible: { url: 'https://api.deepseek.com', model: 'deepseek-chat' },
}

export function SettingsModal({ onClose, onError, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('providers')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [writing, setWriting] = useState<ProjectWritingSettings | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [s, w, sk] = await Promise.all([getAppSettings(), getProjectWritingSettings(), getSkills()])
        setSettings(s)
        setWriting(w)
        setSkills(sk)
        const statuses = await Promise.all(
          s.providers.map(async (p) => [p.id, await getApiKeyStatus(p.id).catch(() => false)] as const),
        )
        setKeyStatus(Object.fromEntries(statuses))
      } catch (e) {
        onError(`读取设置失败：${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [onError])

  const updateProvider = (idx: number, patch: Partial<Provider>) => {
    if (!settings) return
    const providers = settings.providers.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    setSettings({ ...settings, providers })
  }

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      setBusy(true)
      try {
        await setAppSettings(next)
        setSettings(next)
      } catch (e) {
        onError(`保存设置失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(false)
      }
    },
    [onError],
  )

  const saveKey = async (providerId: string) => {
    const key = keyDrafts[providerId]
    if (key === undefined) return
    try {
      await setApiKey(providerId, key)
      setKeyStatus((prev) => ({ ...prev, [providerId]: key.length > 0 }))
      setKeyDrafts((prev) => {
        const { [providerId]: _, ...rest } = prev
        return rest
      })
    } catch (e) {
      onError(`保存 Key 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const test = async (provider: Provider) => {
    setTesting(provider.id)
    try {
      const r = await testProviderConnectivity(provider, keyDrafts[provider.id])
      setTestResult((prev) => ({ ...prev, [provider.id]: r.ok ? '✓ 连接成功' : `✗ ${r.message ?? '连接失败'}` }))
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [provider.id]: `✗ ${e instanceof Error ? e.message : String(e)}` }))
    } finally {
      setTesting(null)
    }
  }

  const saveWriting = async () => {
    if (!writing) return
    try {
      await setProjectWritingSettings(writing)
      onSaved?.()
    } catch (e) {
      onError(`保存写作设置失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const addProvider = () => {
    if (!settings) return
    const id = `custom-${Date.now().toString(36)}`
    const d = KIND_DEFAULTS.OpenAICompatible
    void saveSettings({
      ...settings,
      providers: [...settings.providers, { id, name: id, kind: 'OpenAICompatible', api_key: '', base_url: d.url, model_name: d.model }],
    })
  }

  const removeProvider = (idx: number) => {
    if (!settings) return
    if (!window.confirm(`确认删除 Provider「${settings.providers[idx].name}」？`)) return
    const providers = settings.providers.filter((_, i) => i !== idx)
    const active = settings.active_provider_id === settings.providers[idx].id
      ? (providers[0]?.id ?? '')
      : settings.active_provider_id
    void saveSettings({ ...settings, providers, active_provider_id: active })
  }

  if (!settings || !writing) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <p className="modal-loading">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box settings-box" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <nav className="settings-tabs">
            {([['providers', '模型与 Key'], ['writing', '写作偏好'], ['skill', '默认技能']] as const).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <button className="modal-close" onClick={onClose}>✕</button>
        </header>

        <div className="modal-body">
          {tab === 'providers' ? (
            <div className="settings-section">
              <div className="settings-row-head">
                <span>Provider 列表（活跃：<b>{settings.active_provider_id || '未设置'}</b>）</span>
                <button onClick={addProvider}>＋ 新建</button>
              </div>
              {settings.providers.map((p, idx) => (
                <div key={p.id} className="provider-card">
                  <div className="provider-row">
                    <input className="provider-name" value={p.name} onChange={(e) => updateProvider(idx, { name: e.target.value })} placeholder="名称" />
                    <select value={p.kind} onChange={(e) => {
                      const kind = e.target.value as Provider['kind']
                      updateProvider(idx, { kind, base_url: KIND_DEFAULTS[kind].url })
                    }}>
                      {Object.keys(KIND_DEFAULTS).map((k) => (<option key={k} value={k}>{k}</option>))}
                    </select>
                    <label className="provider-active">
                      <input
                        type="radio"
                        checked={settings.active_provider_id === p.id}
                        onChange={() => void saveSettings({ ...settings, active_provider_id: p.id })}
                        title="设为活跃 Provider"
                      />
                      活跃
                    </label>
                    <button className="provider-del" onClick={() => removeProvider(idx)}>✕</button>
                  </div>
                  <div className="provider-row">
                    <input value={p.base_url} onChange={(e) => updateProvider(idx, { base_url: e.target.value })} placeholder="Base URL" />
                    <input value={p.model_name} onChange={(e) => updateProvider(idx, { model_name: e.target.value })} placeholder="模型名" />
                  </div>
                  <div className="provider-row">
                    <input
                      type="password"
                      value={keyDrafts[p.id] ?? ''}
                      onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder={keyStatus[p.id] ? '已配置 Key（输入可覆盖）' : '未配置 API Key'}
                    />
                    {keyDrafts[p.id] !== undefined ? (
                      <button onClick={() => void saveKey(p.id)}>保存 Key</button>
                    ) : null}
                    <button disabled={testing === p.id} onClick={() => void test(p)}>
                      {testing === p.id ? '测试中…' : '测试连接'}
                    </button>
                    <span className={`provider-test ${testResult[p.id]?.startsWith('✓') ? 'ok' : ''}`}>
                      {testResult[p.id] ?? ''}
                    </span>
                  </div>
                </div>
              ))}
              <p className="settings-hint">名称/URL/模型修改后点下方「保存模型设置」生效。</p>
              <button className="settings-save" disabled={busy} onClick={() => void saveSettings(settings)}>保存模型设置</button>
            </div>
          ) : null}

          {tab === 'writing' ? (
            <div className="settings-section">
              <label className="writing-field">
                章节目标字数
                <input
                  type="number"
                  value={writing.chapter_word_target}
                  onChange={(e) => setWriting({ ...writing, chapter_word_target: Number(e.target.value) || 0 })}
                />
                <small>续写模式下单次生成目标；也是章节进度条的基准。</small>
              </label>
              <div className="writing-grid">
                <label className="writing-field">
                  单轮最少字数
                  <input type="number" value={writing.auto_min_chars} onChange={(e) => setWriting({ ...writing, auto_min_chars: Number(e.target.value) || 0 })} />
                </label>
                <label className="writing-field">
                  单轮最多字数
                  <input type="number" value={writing.auto_max_chars} onChange={(e) => setWriting({ ...writing, auto_max_chars: Number(e.target.value) || 0 })} />
                </label>
                <label className="writing-field">
                  最多轮次
                  <input type="number" value={writing.auto_max_rounds} onChange={(e) => setWriting({ ...writing, auto_max_rounds: Number(e.target.value) || 0 })} />
                </label>
                <label className="writing-field">
                  最多推进章节
                  <input type="number" value={writing.auto_max_chapter_advances} onChange={(e) => setWriting({ ...writing, auto_max_chapter_advances: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <button className="settings-save" onClick={() => void saveWriting()}>保存写作偏好</button>
            </div>
          ) : null}

          {tab === 'skill' ? (
            <div className="settings-section">
              <p className="settings-hint">
                设定作品级默认技能：AI 续写 / 聊天自动注入该技能的写作规范（共 {skills.length} 个可用）。
              </p>
              <select
                value={writing.default_skill_id}
                onChange={(e) => setWriting({ ...writing, default_skill_id: e.target.value })}
              >
                <option value="">（不启用）</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.category ? `[${s.category}] ` : ''}{s.name}（{s.id}）</option>
                ))}
              </select>
              {writing.default_skill_id ? (
                <pre className="skill-prompt-preview">
                  {skills.find((s) => s.id === writing.default_skill_id)?.prompt.slice(0, 500) || '（未找到技能内容）'}
                </pre>
              ) : null}
              <button className="settings-save" onClick={() => void saveWriting()}>保存默认技能</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
