// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ request: null }))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      interceptors: {
        request: { use: (handler) => { captured.request = handler } },
        response: { use: vi.fn() },
      },
    }),
  },
}))

await import('./api')

describe('API authorization interceptor', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('preserves an explicitly supplied admin authorization header', () => {
    localStorage.setItem('token', 'current-role-token')

    const config = captured.request({
      headers: { Authorization: 'Bearer remembered-admin-token' },
    })

    expect(config.headers.Authorization).toBe('Bearer remembered-admin-token')
  })

  it('uses the current session token when no authorization header is supplied', () => {
    localStorage.setItem('token', 'current-role-token')

    const config = captured.request({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer current-role-token')
  })

  it('uses the H5 token for H5 API requests even when a staff token exists', () => {
    localStorage.setItem('token', 'staff-token')
    localStorage.setItem('h5_token', 'influencer-token')

    const config = captured.request({ url: '/api/h5/me', headers: {} })

    expect(config.headers.Authorization).toBe('Bearer influencer-token')
  })

  it('uses the H5 token for shared upload APIs while browsing H5 pages', () => {
    localStorage.setItem('token', 'staff-token')
    localStorage.setItem('h5_token', 'influencer-token')
    window.history.pushState({}, '', '/h5/products/1')

    const config = captured.request({ url: '/api/upload/direct-ticket', headers: {} })

    expect(config.headers.Authorization).toBe('Bearer influencer-token')
  })
})
