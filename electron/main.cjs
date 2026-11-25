const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell } = require('electron')
const netSocket = require('net')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { Readable } = require('stream')
const store = require('./services/store.cjs')
const secrets = require('./services/secrets.cjs')
const taskRunner = require('./services/taskRunner.cjs')
const httpApi = require('./services/httpApi.cjs')
const browserSession = require('./services/browserSession.cjs')
const media = require('./services/media.cjs')
const shopAuth = require('./services/shopAuth.cjs')
const updater = require('./services/updater.cjs')

const BLOCKED_SCHEMES = ['bytedance', 'snssdk1128', 'aweme', 'douyin', 'sslocal', 'doubao']

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-video', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  ...BLOCKED_SCHEMES.map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }))
])

function isPageUrl(url) {
  return /^(https?:|file:|local-video:|devtools:|about:|data:|blob:)/i.test(String(url || ''))
}

const isDev = !app.isPackaged
const homeData = app.getPath('userData')
const dataPointer = path.join(homeData, 'data-dir.txt')
try {
  if (fs.existsSync(dataPointer)) {
    const customDir = fs.readFileSync(dataPointer, 'utf8').trim()
    if (customDir && fs.existsSync(customDir)) app.setPath('userData', customDir)
  }
} catch { /* 沿用默认数据位置 */ }

function loadAppPage(win) {
  if (!win || win.isDestroyed()) return
  const reveal = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.webContents.once('did-finish-load', reveal)
  setTimeout(reveal, 2500)
  if (isDev) win.loadURL('http://127.0.0.1:5173')
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

function createWindow(size = {}) {
  const width = Math.max(1180, Number(size.width) || 1440)
  const height = Math.max(720, Number(size.height) || 900)
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: 'huang++pro',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    const url = String(win.webContents.getURL() || '')
    if (/127\.0\.0\.1:5173|index\.html/i.test(url)) win.show()
  })

  // 渲染进程崩溃/白屏时自动重载，避免整窗空白
  win.webContents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed()) return
    if (details?.reason === 'clean-exit') return
    setTimeout(() => {
      if (!win.isDestroyed()) loadAppPage(win)
    }, 400)
  })
  win.webContents.on('unresponsive', () => {
    // 主进程被拖住时先等一会；仍无响应则重载
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (win.webContents.isLoading()) return
      loadAppPage(win)
    }, 8000)
  })
  win.webContents.on('did-fail-load', (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || win.isDestroyed()) return
    if (code === -3) return // 主动取消
    if (!/127\.0\.0\.1:5173|index\.html/i.test(String(url || ''))) return
    setTimeout(() => {
      if (!win.isDestroyed()) loadAppPage(win)
    }, 800)
  })

  win.on('close', () => {
    try { browserSession.closeHiddenLookups?.() } catch { /* ignore */ }
  })

  loadAppPage(win)
  return win
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => ({ action: !url || isPageUrl(url) ? 'allow' : 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isPageUrl(url)) event.preventDefault()
  })
  contents.on('will-frame-navigate', (event, url) => {
    const target = typeof url === 'string' ? url : event.url
    if (target && !isPageUrl(target)) event.preventDefault()
  })
})

app.whenReady().then(() => {
  BLOCKED_SCHEMES.forEach((scheme) => {
    protocol.handle(scheme, () => new Response('', { status: 204 }))
  })
  protocol.handle('local-video', (request) => {
    const filePath = new URL(request.url).searchParams.get('path')
    if (!filePath || !fs.existsSync(filePath)) return new Response('missing', { status: 404 })
    const stat = fs.statSync(filePath)
    const size = stat.size
    const type = /\.webm$/i.test(filePath) ? 'video/webm' : /\.mov$/i.test(filePath) ? 'video/quicktime' : 'video/mp4'
    const range = request.headers.get('range')
    const match = range && /bytes=(\d*)-(\d*)/.exec(range)
    let start = 0
    let end = size - 1
    if (match) {
      if (match[1] !== '') start = Math.min(size - 1, Number(match[1]) || 0)
      if (match[2] !== '') end = Math.min(size - 1, Number(match[2]))
      if (match[1] === '' && match[2] !== '') {
        start = Math.max(0, size - Number(match[2]))
        end = size - 1
      }
    }
    if (end < start) end = start
    const stream = fs.createReadStream(filePath, { start, end })
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': type,
      'Content-Length': String(end - start + 1)
    }
    if (match) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    return new Response(Readable.toWeb(stream), { status: match ? 206 : 200, headers })
  })
  Menu.setApplicationMenu(null)
  const userData = app.getPath('userData')
  store.init(userData)
  secrets.init(userData)
  httpApi.start(17321, (payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('catalog:page', payload)
    })
  })
  createWindow()
  updater.setupUpdater()
  updater.scheduleAutoCheck(5000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !store.hasPendingWrite()) return
  event.preventDefault()
  quitting = true
  store.flushWrites().finally(() => app.quit())
})

ipcMain.handle('proxy:use', (_event, payload) => browserSession.useProxy(payload))
ipcMain.handle('proxy:check', (_event, payload) => new Promise((resolve) => {
  const host = String(payload?.host || '').trim()
  const port = Number(payload?.port)
  if (!host || !port) return resolve({ ok: false, message: '主机或端口是空的' })
  const socket = netSocket.connect({ host, port })
  const timer = setTimeout(() => {
    socket.destroy()
    resolve({ ok: false, message: '连接超时，端口没有响应' })
  }, 5000)
  socket.once('connect', () => {
    clearTimeout(timer)
    socket.end()
    resolve({ ok: true, message: `已连上 ${host}:${port}` })
  })
  socket.once('error', (error) => {
    clearTimeout(timer)
    resolve({ ok: false, message: error.code === 'ECONNREFUSED' ? '端口拒绝连接' : (error.message || '连不上') })
  })
}))
ipcMain.handle('log:append', (_event, line) => {
  const file = path.join(app.getPath('userData'), 'huang.log')
  try { fs.appendFileSync(file, `${String(line || '')}\n`) } catch { /* ignore */ }
  return { ok: true, file }
})
ipcMain.handle('log:open', () => {
  const runtimeLog = require('./services/runtimeLog.cjs')
  const file = runtimeLog.logFile()
  if (!fs.existsSync(file)) fs.writeFileSync(file, '')
  shell.showItemInFolder(file)
  return { ok: true, file }
})
ipcMain.handle('account:open', async (_event, payload) => {
  const runtimeLog = require('./services/runtimeLog.cjs')
  runtimeLog.info('account.open', `打开账号 kind=${payload?.kind || ''} id=${payload?.id || ''} url=${String(payload?.url || '').slice(0, 80)}`)
  try {
    const result = await browserSession.openAccount(payload || {})
    runtimeLog.info('account.open', `完成 loginStatus=${result?.loginStatus || ''} ${result?.message || ''}`)
    return JSON.parse(JSON.stringify(result || { ok: false }))
  } catch (error) {
    runtimeLog.error('account.open', error?.message || error)
    return { ok: false, message: String(error?.message || error || '打开失败') }
  }
})
ipcMain.handle('work:publish', async (event, payload) => {
  try {
    return await browserSession.publishOnCreator({
      ...(payload || {}),
      notify: (data) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send('task:progress', data)
        } catch { /* 渲染进程已关 */ }
      }
    })
  } catch (error) {
    const msg = String(error?.message || error || '')
    if (/destroyed|Object has been destroyed/i.test(msg)) {
      return { ok: false, attached: false, message: '发布窗口被关掉或刷新了，请再点一次「发布到抖音」' }
    }
    return { ok: false, attached: false, message: msg || '发布失败' }
  }
})
ipcMain.handle('app:new-window', () => {
  createWindow()
  return { ok: true }
})
ipcMain.handle('app:resize', (_event, payload) => {
  const width = Math.max(1180, Number(payload?.width) || 1440)
  const height = Math.max(720, Number(payload?.height) || 900)
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
  if (!win) return { ok: false, message: '没有可调整的窗口' }
  win.setSize(width, height)
  return { ok: true, width, height }
})
ipcMain.handle('app:open-path', async (_event, target) => {
  const text = String(target || '').trim()
  if (!text) return { ok: false, message: '路径为空' }
  if (/^https?:\/\//i.test(text)) {
    await shell.openExternal(text)
    return { ok: true }
  }
  if (!fs.existsSync(text)) {
    try { fs.mkdirSync(text, { recursive: true }) } catch { /* 打不开就返回错误 */ }
  }
  const result = await shell.openPath(text)
  return result ? { ok: false, message: result } : { ok: true }
})
ipcMain.handle('doubao:chat', (_event, payload) => browserSession.chatOnDoubao(payload || {}))
ipcMain.handle('doubao:remix', (_event, payload) => browserSession.remixOnDoubao(payload || {}))
ipcMain.handle('doubao:unwatermark', (_event, payload) => browserSession.unwatermarkChat(payload || {}))
ipcMain.handle('doubao:pull-clean', (_event, payload) => browserSession.pullCleanVideo(payload || {}))
ipcMain.handle('doubao:windows', () => browserSession.listWindows())
ipcMain.handle('doubao:focus', (_event, key) => browserSession.focusWindow(key))
ipcMain.handle('session:list', () => browserSession.listWindows())
ipcMain.handle('session:close', (_event, key) => browserSession.closeWindow(key))
ipcMain.handle('session:close-prefix', (_event, prefix) => browserSession.closeWindowsByPrefix(prefix))
ipcMain.handle('account:follow', (_event, payload) => browserSession.followLinks(payload || {}))
ipcMain.handle('product:lookup', async (_event, payload) => {
  const runtimeLog = require('./services/runtimeLog.cjs')
  runtimeLog.info('product.lookup', `IPC 收到查询 ${String(payload?.link || payload?.productId || '').slice(0, 80)}`)
  try {
    const result = await shopAuth.lookup(payload || {})
    return JSON.parse(JSON.stringify(result || { ok: false }))
  } catch (error) {
    runtimeLog.error('product.lookup', error?.message || error)
    return { ok: false, message: String(error?.message || error || '查询失败') }
  }
})
ipcMain.handle('media:info', () => media.info())
ipcMain.handle('media:probe', (_event, file) => media.probe(file))
ipcMain.handle('media:watermark', (_event, payload) => media.stripWatermark(payload || {}))
ipcMain.handle('media:slice', (_event, payload) => media.sliceVideo(payload || {}))
ipcMain.handle('media:trim', (_event, payload) => media.trimVideo(payload || {}))
ipcMain.handle('media:copy', (_event, payload) => media.copyFiles(payload || {}))
ipcMain.handle('media:cleanup', (_event, payload) => media.cleanupDir(payload || {}))
ipcMain.handle('doubao:generate', async (event, payload) => {
  try {
    return await browserSession.generateOnDoubao({
      ...(payload || {}),
      notify: (data) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send('task:progress', data)
        } catch { /* 渲染进程已关 */ }
      }
    })
  } catch (error) {
    const msg = String(error?.message || error || '')
    if (/EPERM|EBUSY|operation not permitted|resource busy/i.test(msg)) {
      return { ok: false, message: '成片已下载但保存时文件被占用（杀毒/资源管理器预览常见）。请关掉占用后点重新生成，或换一个输出目录。' }
    }
    return { ok: false, message: msg || '豆包生成失败' }
  }
})
ipcMain.handle('account:status', (_event, payload) => browserSession.accountStatus(payload || {}))
ipcMain.handle('account:code', (_event, payload) => browserSession.submitCode(payload || {}))
ipcMain.handle('account:send-code', (_event, payload) => browserSession.requestCode(payload || {}))
ipcMain.handle('doubao:bootstrap-login', async (_event, payload) => {
  try {
    const result = await browserSession.bootstrapDoubaoLogin(payload || {})
    return JSON.parse(JSON.stringify(result || { ok: false, message: '无结果' }))
  } catch (error) {
    return { ok: false, loginStatus: '待确认', message: String(error?.message || error || '打开豆包失败') }
  }
})
ipcMain.handle('publish:bootstrap-login', async (_event, payload) => {
  try {
    const result = await browserSession.bootstrapPublishLogin(payload || {})
    return JSON.parse(JSON.stringify(result || { ok: false, message: '无结果' }))
  } catch (error) {
    return { ok: false, message: String(error?.message || error || '打开登录页失败') }
  }
})
ipcMain.handle('account:silent-login', async (_event, payload) => {
  try {
    const result = await browserSession.silentPasswordLogin(payload || {})
    return JSON.parse(JSON.stringify(result || { ok: false, loginStatus: '待登录' }))
  } catch (error) {
    return { ok: false, loginStatus: '待登录', message: String(error?.message || error || '自动登录失败') }
  }
})
ipcMain.handle('account:ensure-login', (_event, payload) => browserSession.ensurePublishLogin(payload || {}))
ipcMain.handle('dialog:images', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择商品图',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
  })
  if (result.canceled || !result.filePaths.length) return []
  const dir = path.join(app.getPath('userData'), 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  return result.filePaths.map((file) => {
    const dest = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file).toLowerCase()}`)
    fs.copyFileSync(file, dest)
    return dest
  })
})
ipcMain.handle('dialog:videos', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择视频',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] }]
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths
})
ipcMain.handle('dialog:video', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择成片',
    properties: ['openFile'],
    filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] }]
  })
  if (result.canceled || !result.filePaths[0]) return ''
  return result.filePaths[0]
})
ipcMain.handle('app:info', () => ({
  userData: app.getPath('userData'),
  videos: app.getPath('videos'),
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
  packaged: app.isPackaged,
  api: 'http://127.0.0.1:17321'
}))
ipcMain.handle('update:check', (_event, payload) => updater.checkForUpdates(payload || {}))
ipcMain.handle('update:download', () => updater.downloadUpdate())
ipcMain.handle('update:install', () => updater.installUpdate())
ipcMain.handle('update:open', () => updater.openReleasesPage())
ipcMain.handle('update:status', () => updater.getStatus())
ipcMain.handle('data:move', async (_event, dir) => {
  const target = String(dir || '').trim()
  if (!target) return { ok: false, message: '先选择一个文件夹' }
  const current = app.getPath('userData')
  const from = path.resolve(current)
  const to = path.resolve(target)
  const relative = path.relative(from, to)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return { ok: false, message: '请选到当前数据文件夹外面的位置' }
  }
  fs.mkdirSync(to, { recursive: true })
  for (const name of ['huang-data.json', 'huang-secrets.json']) {
    const source = path.join(from, name)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(to, name))
  }
  const partitions = path.join(from, 'Partitions')
  if (fs.existsSync(partitions)) fs.cpSync(partitions, path.join(to, 'Partitions'), { recursive: true })
  fs.mkdirSync(homeData, { recursive: true })
  fs.writeFileSync(dataPointer, to, 'utf8')
  app.relaunch()
  app.exit(0)
  return { ok: true }
})
ipcMain.handle('dialog:directory', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择作品输出目录',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return ''
  return result.filePaths[0]
})
ipcMain.handle('task:generate', (event, workId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  taskRunner.generate(workId, win)
  return true
})
