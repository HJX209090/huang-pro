const BASE = 'http://127.0.0.1:17321'
let token = localStorage.getItem('huang-token') || ''

export function setToken(value) {
  token = value || ''
  if (token) localStorage.setItem('huang-token', token)
  else localStorage.removeItem('huang-token')
}

export function getToken() {
  return token
}

export async function request(method, path, body, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : 0
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : ''
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。已有商品会继续留着`)
      timeout.logs = [`请求超过 ${Math.round(timeoutMs / 1000)} 秒，已停止`]
      throw timeout
    }
    throw new Error('本地接口没有启动')
  } finally {
    clearTimeout(timer)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    const failed = new Error(data.message || '接口请求失败')
    failed.logs = data.logs || []
    throw failed
  }
  return data
}

export const api = {
  enter: () => request('POST', '/api/auth/enter'),
  register: (username, password) => request('POST', '/api/auth/register', { username, password }),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),
  systemTime: () => request('GET', '/api/system-time'),
  getState: () => request('GET', '/api/state'),
  saveState: (snapshot) => request('PUT', '/api/state', { snapshot }),
  resetState: () => request('POST', '/api/state/reset'),
  syncCatalog: (target, accountId) => request('POST', '/api/catalog/sync', { target, accountId, page: 1, size: 50 }, target === 'plaza' ? 0 : 180000),
  activate: (code) => request('POST', '/api/license/activate', { code }),
  saveProfile: (displayName) => request('POST', '/api/account/profile', { displayName }),
  unlockAdmin: (password) => request('POST', '/api/admin/unlock', { password }),
  lockAdmin: () => request('POST', '/api/admin/lock'),
  configureLicense: (plan) => request('POST', '/api/license/configure', { plan }),
  generateLicense: (plan) => request('POST', '/api/license/generate', { plan }),
  adminAccounts: () => request('GET', '/api/admin/accounts'),
  setAccountStatus: (id, status) => request('POST', '/api/admin/accounts/status', { id, status }),
  batchAccounts: (kind, text) => request('POST', '/api/accounts/batch', { kind, text }),
  pullShopAuth: (accountId) => request('POST', '/api/shop/auth', { accountId }),
  saveAccountSecret: (id, login, password) => request('POST', '/api/accounts/secret', { id, login, password }),
  removeAccountSecret: (id) => request('POST', '/api/accounts/secret', { id, remove: true })
}
