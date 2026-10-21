import { describe, expect, it, vi, beforeEach } from 'vitest'

// useProjectWritingSettings 依赖 ../src/tauri 的 IPC 封装
vi.mock('../src/tauri', () => ({
  isTauriApp: () => false,
  getProjectWritingSettings: vi.fn(),
  setProjectWritingSettings: vi.fn(),
  initNovel: vi.fn(),
}))

import { renderHook, act } from '@testing-library/react'
import { useProjectWritingSettings } from '../src/hooks/useProjectWritingSettings'

describe('useProjectWritingSettings 默认技能（defaultSkillId）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始 defaultSkillId 为空，updateSettings 可更新', () => {
    const { result } = renderHook(() => useProjectWritingSettings('/tmp/fake-work'))
    expect(result.current.settings.defaultSkillId).toBe('')

    act(() => {
      result.current.updateSettings({ defaultSkillId: 'novel-style-xianxia' })
    })
    expect(result.current.settings.defaultSkillId).toBe('novel-style-xianxia')
  })

  it('非 Tauri 环境不触发保存，状态仍可本地变更', async () => {
    const { result } = renderHook(() => useProjectWritingSettings('/tmp/fake-work'))
    await act(async () => {
      result.current.updateSettings({ defaultSkillId: 'novel-craft' })
      await result.current.saveSettings()
    })
    expect(result.current.settings.defaultSkillId).toBe('novel-craft')
    // isTauriApp() 为 false，不应触达后端
    const { setProjectWritingSettings } = await import('../src/tauri')
    expect(setProjectWritingSettings).not.toHaveBeenCalled()
  })
})
