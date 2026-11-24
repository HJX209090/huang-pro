const providers = require('./providers.cjs')

const timers = new Map()

function emit(win, payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('task:progress', payload)
}

function generate(workId, win) {
  if (!workId || timers.has(workId)) return
  let progress = 0
  const timer = setInterval(async () => {
    const result = await providers.generateVideo({ workId, progress })
    if (result.mode !== 'simulate') {
      clearInterval(timer)
      timers.delete(workId)
      return
    }
    progress = Math.min(100, progress + 25)
    const done = progress >= 100
    emit(win, {
      workId,
      progress,
      status: done ? '已生成' : '生成中'
    })
    if (done) {
      clearInterval(timer)
      timers.delete(workId)
    }
  }, 700)
  timers.set(workId, timer)
}

module.exports = { generate }
