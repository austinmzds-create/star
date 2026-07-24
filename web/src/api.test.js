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
})
