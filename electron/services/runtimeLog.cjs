const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

function stamp() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function logFile() {
  try {
    return path.join(app.getPath('userData'), 'huang.log')
  } catch {
    return path.join(process.cwd(), 'huang.log')
  }
}

function levelTag(level) {
  const raw = String(level || 'I').toUpperCase()
  if (raw === 'ERROR' || raw === 'E' || raw === 'ERR') return 'E'
  if (raw === 'WARN' || raw === 'W' || raw === 'WARNING') return 'W'
  if (raw === 'SUCCESS' || raw === 'S' || raw === 'OK') return 'S'
  return 'I'
}

function write(level, scope, message, extra) {
  const line = `${stamp()} ${levelTag(level)} | ${String(scope || 'app')}: ${String(message || '')}${extra != null ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`
  try {
    fs.appendFileSync(logFile(), `${line}\n`)
  } catch { /* ignore */ }
  try {
    console.log(line)
  } catch { /* ignore */ }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send('runtime:log', { line, level: levelTag(level), scope, message, time: stamp() })
    } catch { /* ignore */ }
  }
  return line
}

module.exports = {
  write,
  info: (scope, message, extra) => write('I', scope, message, extra),
  warn: (scope, message, extra) => write('W', scope, message, extra),
  error: (scope, message, extra) => write('E', scope, message, extra),
  success: (scope, message, extra) => write('S', scope, message, extra),
  logFile
}
