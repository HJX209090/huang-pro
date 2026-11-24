const { autoUpdater } = require('electron-updater')
const { BrowserWindow, app, shell } = require('electron')

const RELEASES_URL = 'https://github.com/HJX209090/huang-pro/releases/latest'
let started = false
let lastStatus = { status: 'idle' }

function broadcast(payload) {
  lastStatus = { ...payload, at: Date.now() }
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('update:status', lastStatus)
  })
}

function setupUpdater() {
  if (started) return
  started = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  try {
    autoUpdater.forceDevUpdateConfig = false
  } catch { /* ignore */ }

  autoUpdater.on('checking-for-update', () => {
    broadcast({ status: 'checking', message: '正在检查更新…' })
  })
  autoUpdater.on('update-available', (info) => {
    broadcast({
      status: 'available',
      message: `发现新版本 ${info?.version || ''}`,
      version: info?.version || '',
      releaseName: info?.releaseName || '',
      releaseNotes: info?.releaseNotes || ''
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    broadcast({
      status: 'not-available',
      message: '已是最新版本',
      version: info?.version || app.getVersion()
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      status: 'downloading',
      message: '正在下载更新…',
      percent: Number(progress?.percent || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      status: 'downloaded',
      message: '更新已下载完成，重启即可安装',
      version: info?.version || ''
    })
  })
  autoUpdater.on('error', (error) => {
    const raw = error?.message || String(error || '更新失败')
    // 还没发过 Release / 仓库私有时 GitHub 会 404，不当成硬错误吓人
    if (/404|releases\.atom|ERR_CONNECTION|ENOTFOUND|net::/i.test(raw)) {
      broadcast({
        status: 'not-available',
        message: '当前已是最新版本（或云端尚未发布安装包）',
        version: app.getVersion(),
        softError: raw
      })
      return
    }
    broadcast({
      status: 'error',
      message: raw
    })
  })
}

async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    const payload = {
      status: 'dev',
      message: '开发模式不检查更新，请使用安装版体验自动更新',
      manual: Boolean(manual)
    }
    broadcast(payload)
    return { ok: false, ...payload }
  }

  setupUpdater()
  broadcast({ status: 'checking', message: '正在检查更新…', manual: Boolean(manual) })
  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      ok: true,
      status: 'checking',
      version: result?.updateInfo?.version || '',
      currentVersion: app.getVersion()
    }
  } catch (error) {
    const raw = error?.message || '检查更新失败，请确认已联网'
    if (/404|releases\.atom|ERR_CONNECTION|ENOTFOUND|net::/i.test(raw)) {
      const payload = {
        status: 'not-available',
        message: manual ? '没有检测到新版本（请确认 GitHub Releases 已发布安装包）' : '已是最新版本',
        version: app.getVersion(),
        manual: Boolean(manual),
        softError: raw
      }
      broadcast(payload)
      return { ok: true, ...payload }
    }
    const payload = {
      status: 'error',
      message: raw,
      manual: Boolean(manual)
    }
    broadcast(payload)
    return { ok: false, ...payload }
  }
}

async function downloadUpdate() {
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式无法下载更新' }
  }
  setupUpdater()
  try {
    broadcast({ status: 'downloading', message: '正在下载更新…', percent: 0 })
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error?.message || '下载更新失败'
    broadcast({ status: 'error', message })
    return { ok: false, message }
  }
}

function installUpdate() {
  if (!app.isPackaged) return { ok: false, message: '开发模式无法安装更新' }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch {
      app.relaunch()
      app.exit(0)
    }
  })
  return { ok: true }
}

function openReleasesPage() {
  return shell.openExternal(RELEASES_URL)
}

function getStatus() {
  return {
    ...lastStatus,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    releasesUrl: RELEASES_URL
  }
}

function scheduleAutoCheck(delayMs = 4000) {
  if (!app.isPackaged) return
  setTimeout(() => {
    checkForUpdates({ manual: false }).catch(() => {})
  }, delayMs)
}

module.exports = {
  setupUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  openReleasesPage,
  getStatus,
  scheduleAutoCheck
}
