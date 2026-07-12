// @vitest-environment jsdom
import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Login from './Login.vue'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  push: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../api', () => ({ default: { post: mocks.post } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('element-plus', async (loadOriginal) => {
  const actual = await loadOriginal()
  return {
    ...actual,
    ElMessage: {
      warning: mocks.warning,
      error: mocks.error,
      success: mocks.success,
    },
  }
})

function mountLogin() {
  return mount(Login, { global: { plugins: [ElementPlus] } })
}

async function openPasswordLogin() {
  const wrapper = mountLogin()
  await wrapper.get('[data-testid="password-tab"]').trigger('click')
  return wrapper
}

describe('Login', () => {
  beforeEach(() => {
    mocks.post.mockReset()
    mocks.push.mockReset()
    mocks.warning.mockReset()
    mocks.error.mockReset()
    mocks.success.mockReset()
    localStorage.clear()
  })

  it('defaults to phone login and exposes a password login tab', () => {
    const wrapper = mountLogin()

    expect(wrapper.text()).toContain('手机号登录')
    expect(wrapper.text()).toContain('账号密码登录')
    expect(wrapper.find('input[placeholder="手机号"]').exists()).toBe(true)
  })

  it('does not request password login when credentials are missing', async () => {
    const wrapper = await openPasswordLogin()

    await wrapper.get('[data-testid="password-submit"]').trigger('click')

    expect(mocks.warning).toHaveBeenCalledWith('请填写账号和密码')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('submits staff credentials and enters the workbench', async () => {
    mocks.post.mockResolvedValue({
      token: 'staff-token',
      kind: 'staff',
      user: { id: 1, name: '管理员', role: 'admin' },
    })
    const wrapper = await openPasswordLogin()
    await wrapper.get('input[placeholder="账号"]').setValue('admin')
    await wrapper.get('input[placeholder="密码"]').setValue('admin123')

    await wrapper.get('[data-testid="password-submit"]').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/api/auth/login', {
      username: 'admin',
      password: 'admin123',
    })
    expect(localStorage.getItem('token')).toBe('staff-token')
    expect(localStorage.getItem('user')).toBe(JSON.stringify({
      id: 1,
      name: '管理员',
      role: 'admin',
    }))
    expect(mocks.push).toHaveBeenCalledWith('/workbench')
  })

  it('shows the backend error and restores the submit button', async () => {
    mocks.post.mockRejectedValue({
      response: { data: { detail: '用户名或密码错误' } },
    })
    const wrapper = await openPasswordLogin()
    await wrapper.get('input[placeholder="账号"]').setValue('admin')
    await wrapper.get('input[placeholder="密码"]').setValue('wrong')

    await wrapper.get('[data-testid="password-submit"]').trigger('click')
    await flushPromises()

    expect(mocks.error).toHaveBeenCalledWith('用户名或密码错误')
    expect(wrapper.get('[data-testid="password-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('submits password login with Enter', async () => {
    mocks.post.mockResolvedValue({
      token: 'staff-token',
      kind: 'staff',
      user: { id: 2, name: '商务', role: 'bd' },
    })
    const wrapper = await openPasswordLogin()
    await wrapper.get('input[placeholder="账号"]').setValue('business')
    const passwordInput = wrapper.get('input[placeholder="密码"]')
    await passwordInput.setValue('secret')

    await passwordInput.trigger('keyup.enter')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/api/auth/login', {
      username: 'business',
      password: 'secret',
    })
  })
})
