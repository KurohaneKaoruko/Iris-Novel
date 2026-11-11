import { useCallback, useEffect, useState } from 'react'
import {
  getAppSettings,
  setAppSettings,
  getApiKeyStatus,
  setApiKey,
  testProviderConnectivity,
  type AppSettings,
  type Provider,
  type ProviderConnectivityResult,
} from '../../api/backend'
import { PromptDialog } from '../workspace/Dialogs'
import './SettingsDialog.css'

type Props = { onClose: () => void }

/** 应用设置：模型 Provider 管理（Key/地址/模型/连通性）+ 激活选择 */
export function SettingsDialog({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Provider>>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ProviderConnectivityResult & { err?: string }>>({})
  const [saved, setSaved] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [newProviderName, setNewProviderName] = useState<{ open: boolean } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await getAppSettings()
        setSettings(s)
        setDrafts(Object.fromEntries(s.providers.map((p) => [p.id, { ...p }])))
        const statuses = await Promise.all(s.providers.map(async (p) => [p.id, await getApiKeyStatus(p.id).catch(() => false)] as const))
        setKeyStatus(Object.fromEntries(statuses))
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const patch = useCallback((id: string, field: keyof Provider, value: string) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }))
  }, [])

  const save = useCallback(async () => {
    if (!settings) return
    try {
      // 先存独立 key 输入（secrets 通道），再存整体设置（其中 api_key 空则不动已存 key）
      for (const [pid, key] of Object.entries(keyInputs)) {
        if (key.trim()) await setApiKey(pid, key.trim())
      }
      const next: AppSettings = {
        ...settings,
        providers: Object.values(drafts).map((p) => ({ ...p, api_key: '' })),
      }
      await setAppSettings(next)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
      setKeyInputs({})
      const s = await getAppSettings()
      setSettings(s)
      setDrafts(Object.fromEntries(s.providers.map((p) => [p.id, { ...p }])))
      const statuses = await Promise.all(s.providers.map(async (p) => [p.id, await getApiKeyStatus(p.id).catch(() => false)] as const))
      setKeyStatus(Object.fromEntries(statuses))
    } catch (e) {
      setResults((r) => ({ ...r, __save: { ok: false, err: e instanceof Error ? e.message : String(e) } as never }))
    }
  }, [drafts, keyInputs, settings])

  const test = useCallback(async (id: string) => {
    const p = drafts[id]
    if (!p) return
    setTesting(id)
    try {
      const r = await testProviderConnectivity({ ...p, api_key: '' }, keyInputs[id]?.trim() || undefined)
      setResults((rs) => ({ ...rs, [id]: r }))
    } catch (e) {
      setResults((rs) => ({ ...rs, [id]: { ok: false, err: e instanceof Error ? e.message : String(e) } as never }))
    } finally {
      setTesting(null)
    }
  }, [drafts, keyInputs])

  const activate = useCallback(async (id: string) => {
    if (!settings) return
    await save()
    setSettings((s) => (s ? { ...s, active_provider_id: id } : s))
    try {
      const cur = await getAppSettings()
      await setAppSettings({ ...cur, active_provider_id: id })
    } catch { /* ignore */ }
  }, [save, settings])

  const addProvider = useCallback(async (name: string) => {
    if (!settings) return
    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || `custom-${Date.now()}`
    if (settings.providers.some((p) => p.id === id)) return
    const p: Provider = { id, name: name.trim(), kind: 'OpenAICompatible', api_key: '', base_url: '', model_name: '' }
    const next = { ...settings, providers: [...settings.providers, p] }
    try {
      await setAppSettings(next)
      setSettings(next)
      setDrafts((d) => ({ ...d, [id]: p }))
    } catch { /* ignore */ }
  }, [settings])

  if (loadErr) {
    return (
      <div className="set-overlay" onClick={onClose}>
        <div className="set-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
          <div className="set-head"><b>设置</b><button className="set-x" onClick={onClose}>✕</button></div>
          <p className="set-err">加载失败：{loadErr}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="set-overlay" onClick={onClose}>
      <div className="set-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="set-head">
          <b>设置 · 模型服务</b>
          <span className="set-head-actions">
            {saved ? <span className="set-saved">已保存 ✓</span> : null}
            <button className="set-save" onClick={() => void save()}>保存</button>
            <button className="set-x" onClick={onClose}>✕</button>
          </span>
        </div>

        <div className="set-body">
          {settings?.providers.map((p) => {
            const d = drafts[p.id] ?? p
            const r = results[p.id]
            const hasKey = keyStatus[p.id]
            return (
              <div key={p.id} className={`set-card ${settings.active_provider_id === p.id ? 'active' : ''}`}>
                <div className="set-card-head">
                  <label className="set-radio">
                    <input type="radio" name="active-provider" checked={settings.active_provider_id === p.id} onChange={() => void activate(p.id)} />
                    <b>{d.name || p.id}</b>
                    <code className="set-pid">{p.id}</code>
                    {hasKey ? <span className="set-keyok">Key 已存</span> : <span className="set-keynone">未配 Key</span>}
                  </label>
                  <button className="set-test" disabled={testing === p.id} onClick={() => void test(p.id)}>
                    {testing === p.id ? '测试中…' : '测试连接'}
                  </button>
                </div>

                <div className="set-grid">
                  <label>名称<input value={d.name} onChange={(e) => patch(p.id, 'name', e.target.value)} /></label>
                  <label>类型
                    <select value={d.kind} onChange={(e) => patch(p.id, 'kind', e.target.value)}>
                      <option value="OpenAI">OpenAI</option>
                      <option value="Anthropic">Anthropic</option>
                      <option value="OpenAICompatible">OpenAI 兼容（DeepSeek/Ollama 等）</option>
                    </select>
                  </label>
                  <label>Base URL<input value={d.base_url} placeholder="https://api.example.com/v1" onChange={(e) => patch(p.id, 'base_url', e.target.value)} /></label>
                  <label>模型名<input value={d.model_name} placeholder="gpt-4o-mini" onChange={(e) => patch(p.id, 'model_name', e.target.value)} /></label>
                  <label className="set-key-row">API Key
                    <input
                      type="password"
                      value={keyInputs[p.id] ?? ''}
                      placeholder={hasKey ? '已保存（输入可更换）' : 'sk-…'}
                      onChange={(e) => setKeyInputs((k) => ({ ...k, [p.id]: e.target.value }))}
                    />
                  </label>
                </div>

                {r ? (
                  <div className={`set-result ${r.err || !r.ok ? 'bad' : 'good'}`}>
                    {r.err ? `测试失败：${r.err}` : r.ok ? `连接正常${typeof r.latency_ms === 'number' ? `（${r.latency_ms}ms）` : ''}：${r.message ?? ''}` : `连接失败：${r.message ?? '未知错误'}`}
                  </div>
                ) : null}
              </div>
            )
          })}

          <button className="set-add" onClick={() => setNewProviderName({ open: true })}>＋ 添加自定义 Provider</button>
        </div>
      </div>

      {newProviderName ? (
        <PromptDialog
          title="新 Provider 名称"
          placeholder="例如：SiliconFlow"
          onConfirm={(v: string) => { setNewProviderName(null); void addProvider(v) }}
          onCancel={() => setNewProviderName(null)}
        />
      ) : null}
    </div>
  )
}
