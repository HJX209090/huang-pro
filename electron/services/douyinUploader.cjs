const fs = require('fs')
const path = require('path')
const { app, session } = require('electron')
const runtimeLog = require('./runtimeLog.cjs')

const SOURCE = 'huang-douyin-uploader'
const loaded = new WeakSet()

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDirSync(from, to)
    else fs.copyFileSync(from, to)
  }
}

function sourceDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'extensions', 'douyin-uploader'),
    path.join(__dirname, '../extensions/douyin-uploader'),
    path.join(__dirname, 'extensions/douyin-uploader')
  ]
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'manifest.json'))) || ''
}

function unpackedDir() {
  const src = sourceDir()
  if (!src) return ''
  if (!src.includes('.asar')) return src
  const dest = path.join(app.getPath('userData'), 'extensions', 'douyin-uploader')
  try {
    copyDirSync(src, dest)
    return dest
  } catch (error) {
    runtimeLog.info('ext', `插件解压失败 ${error.message || error}`)
    return ''
  }
}

function contentScript() {
  const dir = sourceDir() || unpackedDir()
  const file = path.join(dir, 'content.js')
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

async function install(ses) {
  if (!ses || loaded.has(ses)) return true
  const dir = unpackedDir()
  if (!dir) {
    runtimeLog.info('ext', '找不到抖音发布插件目录')
    return false
  }
  try {
    await ses.loadExtension(dir, { allowFileAccess: true })
    loaded.add(ses)
    runtimeLog.info('ext', `已在内置浏览器安装抖音发布插件 ${dir}`)
    return true
  } catch (error) {
    const msg = String(error?.message || error || '')
    if (/already loaded|already registered/i.test(msg)) {
      loaded.add(ses)
      return true
    }
    runtimeLog.info('ext', `loadExtension 失败，改走页面注入：${msg}`)
    loaded.add(ses)
    return false
  }
}

async function installPartition(kind, id) {
  if (kind !== 'publish') return false
  const ses = session.fromPartition(`persist:huang-${kind}-${id}`)
  return install(ses)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readStatus(win) {
  if (!win || win.isDestroyed()) return null
  const raw = await win.webContents.executeJavaScript(
    `document.documentElement.getAttribute('data-huang-uploader') || ''`
  ).catch(() => '')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function ensureInjected(win) {
  if (!win || win.isDestroyed()) return false
  if (await ping(win)) return true
  const code = contentScript()
  if (!code) return false
  await win.webContents.executeJavaScript(code).catch(() => {})
  return ping(win)
}

async function ping(win) {
  if (!win || win.isDestroyed()) return false
  await win.webContents.executeJavaScript(
    `window.postMessage(${JSON.stringify({ source: SOURCE, action: 'ping' })}, '*'); 'ok'`
  ).catch(() => '')
  await wait(250)
  const status = await readStatus(win)
  return Boolean(status)
}

async function fillAndPublish(win, payload) {
  if (!win || win.isDestroyed()) return { state: 'off', note: '窗口已关' }
  await install(win.webContents.session)
  const injected = await ensureInjected(win)
  if (!injected && !(await ping(win))) {
    return { state: 'off', note: '插件没有注入' }
  }
  await win.webContents.executeJavaScript(
    `document.documentElement.removeAttribute('data-huang-uploader'); 'ok'`
  ).catch(() => '')
  await win.webContents.executeJavaScript(
    `window.postMessage(${JSON.stringify({
      source: SOURCE,
      action: 'fill-and-publish',
      payload: {
        title: String(payload?.title || ''),
        description: String(payload?.description || '')
      }
    })}, '*'); 'sent'`
  ).catch(() => '')
  for (let i = 0; i < 24; i += 1) {
    const status = await readStatus(win)
    if (status?.state === 'published' || status?.state === 'miss' || status?.state === 'error') return status
    await wait(400)
  }
  return { state: 'timeout', note: '插件发布超时' }
}

module.exports = {
  install,
  installPartition,
  fillAndPublish
}
