function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function note(win, text) {
  if (!win || win.isDestroyed()) return
  win.__huangMonitorNote = String(text || '').trim()
  win.__huangMonitorNoteAt = Date.now()
}

function sampleScript() {
  return `(() => {
    const textOf = (root) => String((root && (root.innerText || root.textContent)) || '')
    const body = textOf(document.body).slice(0, 18000)
    const href = String(location.href || '')
    const chatId = (href.match(/doubao\\.com\\/chat\\/([^/?#]+)/i) || [])[1] || ''
    const boxes = []
    const imgs = []
    const files = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('img').forEach((el) => imgs.push(el))
      root.querySelectorAll('input[type="file"]').forEach((el) => files.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const visibleBoxes = boxes.filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 40 && rect.height > 12
    })
    const composer = visibleBoxes[visibleBoxes.length - 1]
    const composerText = composer
      ? String(composer.value || composer.innerText || composer.textContent || '').replace(/\\s+/g, ' ').trim()
      : ''
    const fileCount = files.reduce((sum, el) => sum + ((el.files && el.files.length) || 0), 0)
    const composerImgs = imgs.filter((img) => {
      const rect = img.getBoundingClientRect()
      const src = img.currentSrc || img.src || ''
      return rect.width > 28 && rect.height > 28 && rect.top > window.innerHeight * 0.38 && (src.startsWith('blob:') || src.startsWith('data:'))
    }).length
    const login = /扫码登录|手机号登录|验证码登录|密码登录/.test(body) && /登录/.test(body) && !chatId
    let captcha = ''
    if (/拖拽到这里|请选择所有符合上文/.test(body)) captcha = '拖图验证'
    else if (/拖动滑块|请完成安全验证|完成验证后继续/.test(body)) captcha = /滑块|缺口/.test(body) ? '滑块验证' : '安全验证'
    const confirm = /视频生成参数确认|确认后再开始生成|回复确认后开始/.test(body)
    const generating = /视频生成中|正在生成|排队中|排队生成|稍等片刻|仍在排队/.test(body.slice(-4000))
    const video = Array.from(document.querySelectorAll('video')).some((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 80 && rect.height > 60
    })
    const sent = Boolean(chatId && chatId !== 'chat') && (!composerText || generating || confirm || video)
    let page = '豆包页'
    if (login) page = '登录页'
    else if (chatId && chatId !== 'chat') page = '对话中'
    else if (/\\/chat\\/?(\\?|$)/.test(href)) page = '新对话'
    return {
      page,
      composer: Boolean(composer),
      images: Math.max(fileCount, composerImgs),
      prompt: composerText.length >= 8,
      promptLen: composerText.length,
      sent,
      captcha,
      confirm,
      generating,
      video,
      login,
      href: href.slice(0, 80)
    }
  })()`
}

function tone(ok, wait, bad) {
  if (bad) return 'bad'
  if (wait) return 'wait'
  if (ok) return 'ok'
  return 'idle'
}

function rowsOf(state) {
  const captcha = String(state.captcha || '')
  const action = String(state.note || '')
  return [
    { key: 'page', label: '页面', value: state.page || '未知', tone: tone(!state.login, false, state.login) },
    { key: 'box', label: '输入框', value: state.composer ? '已出现' : '还没有', tone: tone(state.composer, false, !state.composer) },
    { key: 'img', label: '图片', value: state.images > 0 ? `${state.images} 张已放入` : (state.sent ? '已随消息发出' : '未放入'), tone: tone(state.images > 0 || state.sent, false, !state.images && !state.sent) },
    { key: 'prompt', label: '提示词', value: state.prompt ? `已写入 ${state.promptLen} 字` : (state.sent ? '已随消息发出' : '未写入'), tone: tone(state.prompt || state.sent, false, !state.prompt && !state.sent) },
    { key: 'send', label: '发送', value: state.sent ? '已发出' : '还没发出', tone: tone(state.sent, !state.sent && (state.images > 0 || state.prompt), !state.sent && !state.images) },
    { key: 'captcha', label: '验证码', value: captcha || '无', tone: tone(!captcha, Boolean(captcha), false) },
    {
      key: 'gen',
      label: '生成',
      value: state.video ? '已出成片' : (state.generating ? '生成中' : (state.confirm ? '等待确认' : '未开始')),
      tone: tone(state.video || state.generating, state.confirm, false)
    },
    { key: 'act', label: '动作', value: action || '正在看屏幕', tone: tone(Boolean(action), !action, /失败|没有|超时/.test(action)) }
  ]
}

function paintHudScript(state) {
  const payload = JSON.stringify({
    rows: rowsOf(state),
    shot: String(state.shot || ''),
    live: true,
    collapsed: Boolean(state.collapsed)
  })
  return `(function () {
    var S = ${payload};
    var host = document.getElementById('huang-monitor-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'huang-monitor-host';
      host.style.cssText = 'position:fixed;top:54px;right:12px;z-index:2147483646;width:268px;font-family:sans-serif;';
      document.documentElement.appendChild(host);
      var shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>'
        + ':host{all:initial}'
        + '.card{pointer-events:none;background:rgba(12,18,28,.86);color:#eef3fb;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.35);overflow:hidden;backdrop-filter:blur(10px)}'
        + '.bar{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:pointer;pointer-events:auto;user-select:none}'
        + '.title{font-size:12px;font-weight:700;letter-spacing:.04em}'
        + '.live{font-size:11px;color:#7CFFB2}'
        + '.body{padding:0 10px 10px}'
        + '.shot{width:100%;height:88px;object-fit:cover;border-radius:8px;background:#0b1220;display:block;margin-bottom:8px}'
        + '.row{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.35;margin:5px 0}'
        + '.k{width:42px;flex:none;color:#9fb0c8}'
        + '.v{flex:1;word-break:break-all}'
        + '.dot{width:7px;height:7px;border-radius:50%;margin-top:5px;flex:none}'
        + '.ok{background:#3ddc84}.wait{background:#ffc53d}.bad{background:#ff6b6b}.idle{background:#66768a}'
        + '.hide{display:none}'
        + '</style>'
        + '<div class="card"><div class="bar"><span class="title">屏幕监测</span><span class="live">● 实时</span></div>'
        + '<div class="body"><img class="shot" alt=""><div class="rows"></div></div></div>';
      shadow.querySelector('.bar').addEventListener('click', function () {
        host.setAttribute('data-collapsed', host.getAttribute('data-collapsed') === '1' ? '0' : '1');
        shadow.querySelector('.body').classList.toggle('hide', host.getAttribute('data-collapsed') === '1');
      });
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    var root = host.shadowRoot;
    if (!root) return 'miss';
    var collapsed = host.getAttribute('data-collapsed') === '1';
    root.querySelector('.body').classList.toggle('hide', collapsed);
    var rows = root.querySelector('.rows');
    rows.innerHTML = S.rows.map(function (row) {
      return '<div class="row"><i class="dot ' + row.tone + '"></i><span class="k">' + row.label + '</span><span class="v">' + String(row.value || '').replace(/[<>]/g, '') + '</span></div>';
    }).join('');
    var img = root.querySelector('.shot');
    if (S.shot) img.src = S.shot;
    img.style.display = S.shot || img.src ? 'block' : 'none';
    return collapsed ? 'collapsed' : 'ok';
  })()`
}

async function sample(win) {
  const page = await win.webContents.executeJavaScript(sampleScript(), true).catch(() => null)
  const age = Date.now() - Number(win.__huangMonitorNoteAt || 0)
  const noteText = age < 45000 ? String(win.__huangMonitorNote || '') : ''
  return {
    page: '豆包页',
    composer: false,
    images: 0,
    prompt: false,
    promptLen: 0,
    sent: false,
    captcha: '',
    confirm: false,
    generating: false,
    video: false,
    login: false,
    ...(page && typeof page === 'object' ? page : {}),
    note: noteText
  }
}

async function grab(win) {
  try {
    const image = await win.webContents.capturePage()
    if (!image || image.isEmpty()) return ''
    const small = image.resize({ width: 252, quality: 'good' })
    return `data:image/jpeg;base64,${small.toJPEG(40).toString('base64')}`
  } catch {
    return ''
  }
}

function attach(win) {
  if (!win || win.isDestroyed() || win.__huangMonitor) return
  win.__huangMonitor = true
  let busy = false
  let shotAt = 0
  let lastShot = ''
  const tick = async () => {
    if (busy || win.isDestroyed()) return
    busy = true
    try {
      const state = await sample(win)
      if (Date.now() - shotAt > 1600) {
        const shot = await grab(win)
        if (shot) {
          lastShot = shot
          shotAt = Date.now()
        }
      }
      state.shot = lastShot
      if (!win.isDestroyed()) {
        await win.webContents.executeJavaScript(paintHudScript(state), true)
      }
    } catch { /* 页面还在跳转 */ }
    busy = false
  }
  const timer = setInterval(tick, 700)
  win.on('closed', () => clearInterval(timer))
  win.webContents.on('did-finish-load', () => { shotAt = 0; tick() })
  win.webContents.on('did-navigate-in-page', () => { tick() })
  setTimeout(tick, 300)
}

module.exports = { attach, note }
