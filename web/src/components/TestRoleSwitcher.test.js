// @vitest-environment jsdom
import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TestRoleSwitcher from './TestRoleSwitcher.vue'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../api', () => ({ default: { post: mocks.post } }))
vi.mock('element-plus', async (loadOriginal) => {
  const actual = await loadOriginal()
  return { ...actual, ElMessage: { error: mocks.error } }
})

const mountSwitcher = () => mount(TestRoleSwitcher, {
  global: { plugins: [ElementPlus] },
})

describe('TestRoleSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.post.mockReset()
    mocks.error.mockReset()
  })

  it('uses the remembered admin token after switching roles', async () => {
    localStorage.setItem('token', 'admin-token')
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', name: '管理员' }))
    mocks.post.mockRejectedValue({ response: { data: { detail: 'stop after request' } } })
    const wrapper = mountSwitcher()
    await flushPromises()

    wrapper.getComponent({ name: 'ElDropdown' }).vm.$emit('command', 'bd')
    await flushPromises()

    expect(localStorage.getItem('test_staff_token')).toBe('admin-token')
    expect(mocks.post).toHaveBeenCalledWith('/api/auth/dev-switch', { role: 'bd' }, {
      headers: { Authorization: 'Bearer admin-token' },
    })
  })

  it('does not show the switcher to an ordinary business account', () => {
    localStorage.setItem('token', 'bd-token')
    localStorage.setItem('user', JSON.stringify({ id: 2, role: 'bd', name: '商务' }))

    const wrapper = mountSwitcher()

    expect(wrapper.find('.test-role-switcher').exists()).toBe(false)
  })

  it('appears immediately when an admin session is created after mount', async () => {
    const wrapper = mountSwitcher()
    expect(wrapper.find('.test-role-switcher').exists()).toBe(false)

    localStorage.setItem('token', 'admin-token')
    localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', name: '管理员' }))
    window.dispatchEvent(new Event('role-session-changed'))
    await flushPromises()

    expect(wrapper.find('.test-role-switcher').exists()).toBe(true)
  })
})
