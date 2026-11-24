const memoryKey = 'tujian-pro-data'

export async function loadData() {
  if (window.tujian?.loadData) return window.tujian.loadData()
  try {
    const raw = localStorage.getItem(memoryKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveData(snapshot) {
  if (window.tujian?.saveData) return window.tujian.saveData(snapshot)
  localStorage.setItem(memoryKey, JSON.stringify({ version: 1, snapshot }))
  return true
}

export async function getInfo() {
  if (window.tujian?.getInfo) return window.tujian.getInfo()
  return {
    userData: '浏览器 localStorage / tujian-pro-data',
    version: '0.1.0',
    platform: 'web',
    packaged: false
  }
}

export async function pickDirectory() {
  if (window.tujian?.pickDirectory) return window.tujian.pickDirectory()
  return ''
}

export function runGenerate(workId) {
  if (window.tujian?.runGenerate) return window.tujian.runGenerate(workId)
  return false
}

export function onTaskProgress(callback) {
  if (window.tujian?.onTaskProgress) return window.tujian.onTaskProgress(callback)
  return () => {}
}

export function onCatalogPage(callback) {
  if (window.tujian?.onCatalogPage) return window.tujian.onCatalogPage(callback)
  return () => {}
}

export function hasNativeBridge() {
  return Boolean(window.tujian?.runGenerate)
}
