import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { APP_LOCALES, DEFAULT_LOCALE, MESSAGES, type AppLocale, type TranslationParams } from './messages'

const I18N_STORAGE_KEY = 'iris-novel-locale'

type I18nContextValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: (key: string, params?: TranslationParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function resolveInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = localStorage.getItem(I18N_STORAGE_KEY)
    if (stored && APP_LOCALES.includes(stored as AppLocale)) {
      return stored as AppLocale
    }
  } catch {
    // ignore storage errors
  }

  const nav = navigator.language?.toLowerCase() ?? ''
  if (nav.startsWith('zh')) return 'zh-CN'
  return DEFAULT_LOCALE
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => resolveInitialLocale())

  useEffect(() => {
    try {
      localStorage.setItem(I18N_STORAGE_KEY, locale)
    } catch {
      // ignore storage errors
    }
  }, [locale])

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next)
  }, [])

  const t = useCallback(
    (key: string, params?: TranslationParams): string => {
      const localized = MESSAGES[locale][key]
      const fallback = MESSAGES[DEFAULT_LOCALE][key]
      const template = localized ?? fallback ?? key
      return interpolate(template, params)
    },
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
