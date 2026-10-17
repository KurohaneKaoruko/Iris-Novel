import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ContextInjectionCard } from '../src/components/ContextInjectionCard'
import type { InjectionPlan } from '../src/services/ContextInjectionService'
import { I18nProvider } from '../src/i18n/I18nProvider'

function makePlan(): InjectionPlan {
  return {
    degraded: false,
    degradeReason: null,
    items: [
      { key: 'chapter:s/c:1', kind: 'chapter', title: '当前章', sourcePath: 'stories/c.md', content: '前情', matchedBy: 'current-chapter', priority: 0 },
      { key: 'character:a:b', kind: 'character', title: '林秋', sourcePath: 'concept/人物.md', content: '侦探', matchedBy: 'name-match', priority: 1 },
      { key: 'missing:-:x', kind: 'missing', title: '不存在', sourcePath: 'concept/无.md', content: null, matchedBy: 'explicit', priority: 4 },
    ],
  }
}

function setup(overrides?: { removedKeys?: Set<string>; onToggle?: (k: string) => void; readOnly?: boolean }) {
  const onToggle = overrides?.onToggle ?? vi.fn()
  render(
    <I18nProvider>
      <ContextInjectionCard
        plan={makePlan()}
        removedKeys={overrides?.removedKeys}
        onToggle={onToggle}
        readOnly={overrides?.readOnly}
      />
    </I18nProvider>,
  )
  return { onToggle }
}

describe('ContextInjectionCard (6.2)', () => {
  afterEach(() => cleanup())

  it('lists plan items with kind labels and match sources', () => {
    setup()
    const card = screen.getByTestId('ctx-injection-card')
    expect(card.textContent).toContain('林秋')
    expect(card.textContent).toContain('当前章')
    expect(card.textContent).toContain('Character')
    expect(card.textContent).toContain('matched')
    expect(card.textContent).toContain('3/3')
  })

  it('toggle removes/restores items and reports adjustment', () => {
    const { onToggle } = setup()
    const buttons = screen.getAllByTestId('ctx-injection-item')
    expect(buttons).toHaveLength(3)

    fireEvent.click(buttons[1].querySelector('button')!)
    expect(onToggle).toHaveBeenCalledWith('character:a:b')
  })

  it('removedKeys render as struck-through and counted', () => {
    setup({ removedKeys: new Set(['character:a:b']) })
    expect(screen.getByText('2/3')).toBeTruthy()
    expect(screen.getByText(/1 entries removed/)).toBeTruthy()
    const item = screen.getAllByTestId('ctx-injection-item')[1]
    expect(item.className).toContain('removed')
  })

  it('readOnly disables toggles', () => {
    const { onToggle } = setup({ readOnly: true })
    const btn = screen.getAllByTestId('ctx-injection-item')[0].querySelector('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders degraded notice and hides card when plan empty', () => {
    const { container } = render(
      <I18nProvider>
        <ContextInjectionCard plan={{ degraded: true, degradeReason: 'x', items: [] }} />
      </I18nProvider>,
    )
    expect(container.querySelector('[data-testid="ctx-injection-card"]')).toBeNull()

    const { container: c2 } = render(
      <I18nProvider>
        <ContextInjectionCard plan={{ degraded: true, degradeReason: 'x', items: [
          { key: 'k', kind: 'setting', title: 's', sourcePath: null, content: '', matchedBy: 'fallback', priority: 2 },
        ] }} />
      </I18nProvider>,
    )
    expect(c2.textContent).toContain('falling back without injection')
  })
})
