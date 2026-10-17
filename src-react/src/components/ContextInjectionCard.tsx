/**
 * 上下文注入卡（6.2）：生成前展示"涉及资料清单"，
 * 用户可增删条目（调整立即作用于本次生成），生成后展示注入来源。
 */

import { useMemo } from 'react'
import { useI18n } from '../i18n'
import { AppIcon } from './icons/AppIcon'
import type { InjectionPlan } from '../services/ContextInjectionService'
import './ContextInjectionCard.css'

type Props = {
  plan: InjectionPlan | null
  /** 已移除条目键集合（受控；调整持久作用于后续生成） */
  removedKeys?: Set<string>
  onToggle?: (key: string) => void
  /** 只读模式（生成中/完成后仅展示注入来源） */
  readOnly?: boolean
}

const KIND_LABEL_KEY: Record<string, string> = {
  chapter: 'injection.kind.chapter',
  character: 'injection.kind.character',
  setting: 'injection.kind.setting',
  outline: 'injection.kind.outline',
  missing: 'injection.kind.missing',
}

export function ContextInjectionCard({ plan, removedKeys, onToggle, readOnly = false }: Props) {
  const { t } = useI18n()

  const items = plan?.items ?? []
  const removedCount = useMemo(
    () => items.filter((i) => removedKeys?.has(i.key)).length,
    [items, removedKeys],
  )

  if (!plan || items.length === 0) return null

  return (
    <div className="ctx-injection-card" data-testid="ctx-injection-card">
      <div className="ctx-injection-header">
        <span className="ctx-injection-title">
          <AppIcon name="graph" size={12} />
          <span>{t('injection.title')}</span>
        </span>
        <span className="ctx-injection-count">
          {items.length - removedCount}/{items.length}
        </span>
      </div>

      {plan.degraded ? (
        <div className="ctx-injection-degraded">{t('injection.degraded')}</div>
      ) : null}

      <ul className="ctx-injection-list">
        {items.map((item) => {
          const isRemoved = removedKeys?.has(item.key) ?? false
          return (
            <li
              key={item.key}
              className={`ctx-injection-item ${isRemoved ? 'removed' : ''}`}
              data-testid="ctx-injection-item"
            >
              <button
                type="button"
                className="ctx-injection-toggle"
                onClick={() => onToggle?.(item.key)}
                disabled={readOnly}
                title={isRemoved ? t('injection.restore') : t('injection.remove')}
              >
                {isRemoved ? '+' : '−'}
              </button>
              <span className={`ctx-injection-kind ${item.kind}`}>
                {t(KIND_LABEL_KEY[item.kind] ?? 'injection.kind.setting')}
              </span>
              <span className="ctx-injection-name" title={item.sourcePath ?? undefined}>
                {item.title}
              </span>
              <span className="ctx-injection-source">
                {item.matchedBy === 'explicit'
                  ? t('injection.matchedBy.explicit')
                  : item.matchedBy === 'current-chapter'
                    ? t('injection.matchedBy.currentChapter')
                    : item.matchedBy === 'name-match'
                      ? t('injection.matchedBy.nameMatch')
                      : ''}
              </span>
            </li>
          )
        })}
      </ul>

      {removedCount > 0 && !readOnly ? (
        <div className="ctx-injection-footer">{t('injection.adjusted', { count: removedCount })}</div>
      ) : null}
    </div>
  )
}
