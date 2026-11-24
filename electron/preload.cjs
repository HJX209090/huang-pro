const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tujian', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  pickDirectory: () => ipcRenderer.invoke('dialog:directory'),
  moveDataDir: (dir) => ipcRenderer.invoke('data:move', dir),
  pickVideo: () => ipcRenderer.invoke('dialog:video'),
  pickImages: () => ipcRenderer.invoke('dialog:images'),
  openAccount: (payload) => ipcRenderer.invoke('account:open', JSON.parse(JSON.stringify(payload || {}))),
  useProxy: (payload) => ipcRenderer.invoke('proxy:use', payload),
  checkProxy: (payload) => ipcRenderer.invoke('proxy:check', payload),
  appendLog: (line) => ipcRenderer.invoke('log:append', line),
  openLogFile: () => ipcRenderer.invoke('log:open'),
  publishWork: (payload) => ipcRenderer.invoke('work:publish', JSON.parse(JSON.stringify(payload || {}))),
  generateDoubao: (payload) => ipcRenderer.invoke('doubao:generate', JSON.parse(JSON.stringify(payload || {}))),
  chatDoubao: (payload) => ipcRenderer.invoke('doubao:chat', JSON.parse(JSON.stringify(payload || {}))),
  remixDoubao: (payload) => ipcRenderer.invoke('doubao:remix', JSON.parse(JSON.stringify(payload || {}))),
  unwatermarkDoubao: (payload) => ipcRenderer.invoke('doubao:unwatermark', JSON.parse(JSON.stringify(payload || {}))),
  pullCleanDoubao: (payload) => ipcRenderer.invoke('doubao:pull-clean', JSON.parse(JSON.stringify(payload || {}))),
  listDoubaoWindows: () => ipcRenderer.invoke('doubao:windows'),
  focusDoubaoWindow: (key) => ipcRenderer.invoke('doubao:focus', key),
  listSessions: () => ipcRenderer.invoke('session:list'),
  closeSession: (key) => ipcRenderer.invoke('session:close', key),
  closeSessionPrefix: (prefix) => ipcRenderer.invoke('session:close-prefix', prefix),
  followLinks: (payload) => ipcRenderer.invoke('account:follow', payload),
  openAppWindow: () => ipcRenderer.invoke('app:new-window'),
  resizeAppWindow: (payload) => ipcRenderer.invoke('app:resize', payload),
  openPath: (target) => ipcRenderer.invoke('app:open-path', target),
  mediaInfo: () => ipcRenderer.invoke('media:info'),
  probeVideo: (file) => ipcRenderer.invoke('media:probe', file),
  lookupProduct: (payload) => ipcRenderer.invoke('product:lookup', payload),
  stripWatermark: (payload) => ipcRenderer.invoke('media:watermark', payload),
  sliceVideo: (payload) => ipcRenderer.invoke('media:slice', payload),
  trimVideo: (payload) => ipcRenderer.invoke('media:trim', payload),
  copyFiles: (payload) => ipcRenderer.invoke('media:copy', payload),
  cleanupDir: (payload) => ipcRenderer.invoke('media:cleanup', payload),
  pickVideos: () => ipcRenderer.invoke('dialog:videos'),
  accountStatus: (payload) => ipcRenderer.invoke('account:status', payload),
  submitCode: (payload) => ipcRenderer.invoke('account:code', payload),
  requestCode: (payload) => ipcRenderer.invoke('account:send-code', payload),
  bootstrapDoubaoLogin: (payload) => ipcRenderer.invoke('doubao:bootstrap-login', JSON.parse(JSON.stringify(payload || {}))),
  ensurePublishLogin: (payload) => ipcRenderer.invoke('account:ensure-login', JSON.parse(JSON.stringify(payload || {}))),
  runGenerate: (workId) => ipcRenderer.invoke('task:generate', workId),
  onTaskProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('task:progress', listener)
    return () => ipcRenderer.removeListener('task:progress', listener)
  },
  onCatalogPage: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('catalog:page', listener)
    return () => ipcRenderer.removeListener('catalog:page', listener)
  },
  checkUpdate: (payload) => ipcRenderer.invoke('update:check', payload || {}),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdatePage: () => ipcRenderer.invoke('update:open'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  }
})
