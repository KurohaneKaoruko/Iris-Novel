/**
 * 深链路由：hash 协议 `#/studio?work=<encoded>&chapter=<encoded>`。
 * SPA 无服务端路由，刷新/重启后从 URL 恢复「当前作品 + 当前章节」。
 * 编解码统一交给 URLSearchParams（写入 set 自动编码，读取 get 自动解码），
 * 不手工调 encodeURIComponent，避免双重编码。
 */

export type DeepLink = { work: string | null; chapter: string | null }

export function readDeepLink(): DeepLink {
  const hash = window.location.hash
  if (!hash.startsWith('#/studio')) return { work: null, chapter: null }
  const qIndex = hash.indexOf('?')
  if (qIndex < 0) return { work: null, chapter: null }
  const params = new URLSearchParams(hash.slice(qIndex + 1))
  return { work: params.get('work'), chapter: params.get('chapter') }
}

/** work 为 null 时回到书架（清空 hash）；chapter 可单独更新 */
export function writeDeepLink(work: string | null, chapter?: string | null): void {
  if (!work) {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
    return
  }
  const params = new URLSearchParams()
  params.set('work', work)
  if (chapter) params.set('chapter', chapter)
  history.replaceState(null, '', `#/studio?${params.toString()}`)
}
