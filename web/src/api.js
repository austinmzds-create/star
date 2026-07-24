import axios from 'axios'

const api = axios.create({ baseURL: '/' })

const MUTATION_METHODS = ['post', 'put', 'patch', 'delete']

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
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
    if (err.response?.status === 401 && !location.pathname.startsWith('/h5')) {
      localStorage.removeItem('token')
      location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api
