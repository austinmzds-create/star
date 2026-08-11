import axios from 'axios'

const api = axios.create({ baseURL: '/' })

const MUTATION_METHODS = ['post', 'put', 'patch', 'delete']

export function isH5ApiRequest(config = {}) {
  const url = String(config.url || '')
  return url.startsWith('/api/h5') || url.startsWith('api/h5')
}

export function selectAuthToken(config = {}, storage = localStorage, path = location.pathname) {
  const h5Token = storage.getItem('h5_token')
  if (h5Token && (isH5ApiRequest(config) || String(path || '').startsWith('/h5'))) {
    return h5Token
  }
  return storage.getItem('token')
}

function clearInvalidH5Session(storage = localStorage) {
  const h5Token = storage.getItem('h5_token')
  storage.removeItem('h5_token')
  if (h5Token && storage.getItem('token') === h5Token) storage.removeItem('token')
  window.dispatchEvent(new Event('role-session-changed'))
}

api.interceptors.request.use((config) => {
  config.headers = config.headers || {}
  const token = selectAuthToken(config)
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => {
    const method = res.config?.method?.toLowerCase()
    if (!res.config?.skipBadgeRefresh && MUTATION_METHODS.includes(method)) {
      setTimeout(() => window.dispatchEvent(new Event('nav-badge-refresh')), 0)
    }
    return res.data
  },
  (err) => {
    if (err.response?.status === 401 && (isH5ApiRequest(err.config) || location.pathname.startsWith('/h5'))) {
      clearInvalidH5Session()
    } else if (err.response?.status === 401 && !location.pathname.startsWith('/h5')) {
      localStorage.removeItem('token')
      location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api
