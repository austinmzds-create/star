export function applyRoleSession(data, storage = localStorage) {
  storage.setItem('token', data.token)
  storage.setItem('user', JSON.stringify(data.user))
  if (data.kind === 'influencer') storage.setItem('h5_token', data.token)
  else storage.removeItem('h5_token')

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('role-session-changed'))
  }
  return data.kind === 'influencer' ? '/h5' : '/workbench'
}
