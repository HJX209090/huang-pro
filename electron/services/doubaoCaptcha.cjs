const https = require('https')
const http = require('http')
const { nativeImage } = require('electron')

const CAPTCHA_KEYS = [
  'captcha',
  'verifycenter',
  'rmc.bytedance',
  'verify.snssdk',
  'bdxiguacaptcha',
  'verify.byteimg',
  'captchacore',
  'verify.zijieapi'
]

/** 云码/JFBYM 常见题型号，可按平台后台改本地设置 */
const DEFAULT_TYPES = {
  click: '88888',
  slider: '20111',
  text: '10110',
  math: '50100'
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function detectScript() {
  return `(() => {
    const KEYS = ${JSON.stringify(CAPTCHA_KEYS)}
    const frames = Array.from(document.querySelectorAll('iframe'))
    for (const frame of frames) {
      const src = String(frame.getAttribute('src') || frame.src || '').toLowerCase()
      if (!src || !KEYS.some((key) => src.includes(key))) continue
      const rect = frame.getBoundingClientRect()
      if (rect.width >= 80 && rect.height >= 60) {
        return {
          hit: true,
          via: 'iframe',
          src: src.slice(0, 200),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      }
    }
    const body = String(document.body?.innerText || document.body?.textContent || '').slice(0, 10000)
    if (/拖拽到这里|请选择所有符合|拖动滑块|请完成安全验证|完成验证后继续|请完成下列验证|请输入验证码|计算结果|点击.*图标|依次点击|缺口/.test(body)) {
      return { hit: true, via: 'text', src: '', left: 0, top: 0, w: 0, h: 0 }
    }
    const imgs = Array.from(document.querySelectorAll('img, canvas'))
    const captchaImg = imgs.find((el) => {
      const rect = el.getBoundingClientRect()
      const src = String(el.src || el.getAttribute('src') || '').toLowerCase()
      return rect.width >= 60 && rect.height >= 24 && rect.width <= 420 && (/captcha|verify|code/.test(src) || /验证码/.test((el.alt || '') + (el.title || '')))
    })
    if (captchaImg) {
      const rect = captchaImg.getBoundingClientRect()
      return { hit: true, via: 'image', src: '', left: Math.round(rect.left), top: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
    }
    return { hit: false }
  })()`
}

function boxInfoScript() {
  return `(() => {
    const KEYS = ${JSON.stringify(CAPTCHA_KEYS)}
    const frames = Array.from(document.querySelectorAll('iframe'))
    let box = null
    let src = ''
    for (const frame of frames) {
      const current = String(frame.getAttribute('src') || frame.src || '').toLowerCase()
      if (!current || !KEYS.some((key) => current.includes(key))) continue
      const rect = frame.getBoundingClientRect()
      if (rect.width < 80 || rect.height < 60) continue
      box = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
      src = current.slice(0, 200)
      break
    }
    if (!box) {
      const imgs = Array.from(document.querySelectorAll('img, canvas'))
      const captchaImg = imgs.find((el) => {
        const rect = el.getBoundingClientRect()
        const href = String(el.src || '').toLowerCase()
        return rect.width >= 60 && rect.height >= 24 && (/captcha|verify|code/.test(href) || /验证码/.test((el.alt || '') + (el.title || '')))
      })
      if (captchaImg) {
        const rect = captchaImg.getBoundingClientRect()
        const parent = captchaImg.closest('div,section,form') || captchaImg
        const wrap = parent.getBoundingClientRect()
        box = {
          left: Math.round(Math.min(rect.left, wrap.left)),
          top: Math.round(Math.min(rect.top, wrap.top)),
          width: Math.round(Math.max(rect.width, wrap.width)),
          height: Math.round(Math.max(rect.height + 40, wrap.height))
        }
      }
    }
    const body = String(document.body?.innerText || document.body?.textContent || '').slice(0, 14000)
    let prompt = ''
    const lines = body.split(/\\n+/).map((line) => line.trim()).filter(Boolean)
    for (const line of lines) {
      if (line.length >= 2 && line.length <= 48 && /(请选择|请点击|依次点击|拖动滑块|拖拽到这里|计算结果|验证码|缺口|浴室|厨房|办公室|能看到|物品|物体)/.test(line) && !/刷新|反馈|提交成功/.test(line)) {
        prompt = line
        break
      }
    }
    let kind = 'click'
    if (/拖动滑块|缺口|滑块/.test(body) && !/拖拽到这里|请选择所有符合|依次点击/.test(body)) kind = 'slider'
    else if (/计算结果|等于多少|\\d\\s*[+\\-×x*/÷]\\s*\\d/.test(body)) kind = 'math'
    else if (/请输入验证码|输入图中|字符验证/.test(body) || (!/拖拽|点击|滑块|选择/.test(body) && /验证码/.test(body))) kind = 'text'
    else if (/拖拽到这里|请选择所有符合|依次点击|点击.*图标|点选/.test(body)) kind = 'click'
    return { box, src, prompt, kind, hasText: /拖拽到这里|拖动滑块|请完成安全验证|请输入验证码|计算结果|依次点击/.test(body) }
  })()`
}

function submitPointScript(box) {
  return `(() => {
    const box = ${JSON.stringify(box || null)}
    const sels = ['.vc-captcha-verify-pc-button', '[data-vc-id="btn"]', '.vc-captcha-verify-button-text']
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (!el) continue
      const target = el.closest('.vc-captcha-verify-pc-button,[data-vc-id="btn"]') || el
      const rect = target.getBoundingClientRect()
      if (rect.width >= 40 && rect.height >= 18) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: '提交' }
      }
    }
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span, a'))
    const hit = nodes.find((el) => {
      const text = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      if (!text || rect.width < 40 || rect.height < 18) return false
      if (!/^(提交|确认|完成验证|确定|登录)$/.test(text) && !/提交|确认验证/.test(text)) return false
      if (box) {
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        if (cx < box.left - 60 || cx > box.left + box.width + 60) return false
        if (cy < box.top - 40 || cy > box.top + box.height + 100) return false
      }
      return true
    })
    if (!hit) return null
    const rect = hit.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: String(hit.innerText || '').slice(0, 12) }
  })()`
}

function fillCaptchaInputScript(answer) {
  return `(() => {
    const answer = ${JSON.stringify(String(answer || '').trim())}
    if (!answer) return 'miss'
    const fields = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, textarea, [contenteditable="true"]').forEach((el) => fields.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const box = fields.find((el) => {
      const hint = ((el.placeholder || '') + (el.getAttribute('aria-label') || '') + (el.name || '') + (el.id || '')).toLowerCase()
      const rect = el.getBoundingClientRect()
      return rect.width > 40 && rect.height > 16 && /code|captcha|verify|验证|结果|计算|答案/.test(hint)
    }) || fields.filter((el) => el.getBoundingClientRect().width > 40).pop()
    if (!box) return 'miss'
    box.focus()
    if (box.getAttribute('contenteditable') === 'true') {
      box.textContent = ''
      document.execCommand('insertText', false, answer)
    } else {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(box, answer)
      else box.value = answer
    }
    box.dispatchEvent(new InputEvent('input', { bubbles: true, data: answer, inputType: 'insertText' }))
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return 'filled'
  })()`
}

async function detect(win) {
  if (!win || win.isDestroyed()) return { hit: false }
  try {
    const result = await win.webContents.executeJavaScript(detectScript(), true)
    return result && result.hit ? result : { hit: false }
  } catch {
    return { hit: false }
  }
}

async function boxInfo(win) {
  if (!win || win.isDestroyed()) return {}
  try {
    return await win.webContents.executeJavaScript(boxInfoScript(), true) || {}
  } catch {
    return {}
  }
}

function parsePoints(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  const points = []
  for (const part of text.replace(/;/g, '|').split('|')) {
    const nums = String(part).match(/-?\d+/g) || []
    if (nums.length >= 2) points.push([Number(nums[0]), Number(nums[1])])
  }
  return points
}

function parseSliderOffset(raw) {
  const text = String(raw || '').trim()
  if (!text) return 0
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const points = parsePoints(text)
  if (points[0]) return points[0][0]
  const nums = text.match(/-?\d+/g) || []
  return nums.length ? Number(nums[0]) : 0
}

function parseTextAnswer(raw) {
  return String(raw || '').trim().replace(/\s+/g, '')
}

function solveMathLocally(prompt) {
  const text = String(prompt || '').replace(/[×xX]/g, '*').replace(/÷/g, '/')
  const matched = text.match(/(\d+)\s*([+\-*/])\s*(\d+)/)
  if (!matched) return ''
  const a = Number(matched[1])
  const b = Number(matched[3])
  const op = matched[2]
  if (op === '+') return String(a + b)
  if (op === '-') return String(a - b)
  if (op === '*') return String(a * b)
  if (op === '/' && b) return String(Math.round((a / b) * 100) / 100)
  return ''
}

function requestJson(url, payload, timeout = 90000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    try {
      const target = new URL(url)
      const body = JSON.stringify(payload)
      const lib = target.protocol === 'http:' ? http : https
      const req = lib.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        rejectUnauthorized: false,
        timeout
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          try {
            finish({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
          } catch (error) {
            finish({ ok: false, error: error.message || '打码返回不是 JSON' })
          }
        })
      })
      req.on('error', (error) => finish({ ok: false, error: error.message || '打码请求失败' }))
      req.on('timeout', () => {
        req.destroy()
        finish({ ok: false, error: '打码请求超时' })
      })
      req.write(body)
      req.end()
    } catch (error) {
      finish({ ok: false, error: error.message || '打码地址无效' })
    }
  })
}

async function recognizeImage({ imageB64, token, typeId, apiUrl, extra }) {
  const result = await requestJson(apiUrl, {
    token,
    type: typeId || '88888',
    image: imageB64,
    ...(extra ? { extra } : {})
  })
  if (!result.ok) return result
  const data = result.data || {}
  if (data.code !== 10000 && data.code !== '10000') {
    return { ok: false, error: data.msg || `打码 code=${data.code}` }
  }
  const inner = data.data && typeof data.data === 'object' ? data.data : {}
  const raw = String(inner.data ?? inner.result ?? inner.text ?? '')
  return {
    ok: true,
    points: parsePoints(raw),
    pointsRaw: raw,
    text: parseTextAnswer(raw),
    reduceScore: inner.reduce_score
  }
}

function dropTarget(box, index) {
  const offsets = [[0, 0], [14, 6], [-14, 6], [0, 12], [10, 10]]
  const [ox, oy] = offsets[(Math.max(1, index) - 1) % offsets.length]
  let x = box.left + box.width * 0.5 + ox
  let y = box.top + box.height * 0.72 + oy
  x = Math.min(Math.max(x, box.left + box.width * 0.32), box.left + box.width * 0.68)
  y = Math.min(Math.max(y, box.top + box.height * 0.62), box.top + box.height * 0.82)
  return [x, y]
}

async function withDebugger(win, work) {
  const dbg = win.webContents.debugger
  const attachedHere = !dbg.isAttached()
  if (attachedHere) dbg.attach('1.3')
  try {
    return await work(dbg)
  } finally {
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach() } catch { /* 调试连接已经结束 */ }
    }
  }
}

async function mouse(dbg, type, x, y, buttons = 0) {
  const event = {
    type,
    x: Number(x),
    y: Number(y),
    button: buttons || type !== 'mouseMoved' ? 'left' : 'none',
    buttons,
    pointerType: 'mouse'
  }
  if (type !== 'mouseMoved') event.clickCount = 1
  await dbg.sendCommand('Input.dispatchMouseEvent', event)
}

async function clickAt(dbg, x, y) {
  await mouse(dbg, 'mouseMoved', x, y, 0)
  await wait(40)
  await mouse(dbg, 'mousePressed', x, y, 1)
  await wait(40)
  await mouse(dbg, 'mouseReleased', x, y, 0)
}

async function drag(dbg, x1, y1, x2, y2, { steps = 24, holdSec = 0.22, settleSec = 0.18 } = {}) {
  await mouse(dbg, 'mouseMoved', x1, y1, 0)
  await wait(80)
  await mouse(dbg, 'mousePressed', x1, y1, 1)
  await wait(Math.max(120, holdSec * 1000))
  const dist = Math.max(1, Math.hypot(x2 - x1, y2 - y1))
  const nudge = Math.min(8, dist * 0.15)
  const nx = x1 + ((x2 - x1) / dist) * nudge
  const ny = y1 + ((y2 - y1) / dist) * nudge
  await mouse(dbg, 'mouseMoved', nx, ny, 1)
  await wait(60)
  const count = Math.max(12, steps)
  for (let index = 1; index <= count; index += 1) {
    const t = index / count
    const ease = t * t * (3 - 2 * t)
    await mouse(dbg, 'mouseMoved', nx + (x2 - nx) * ease, ny + (y2 - ny) * ease, 1)
    await wait(16)
  }
  await mouse(dbg, 'mouseMoved', x2, y2, 1)
  await wait(Math.max(120, settleSec * 1000))
  await mouse(dbg, 'mouseReleased', x2, y2, 0)
}

async function captureCrop(win, box) {
  const image = await win.webContents.capturePage()
  const size = image.getSize()
  const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio || 1', true).catch(() => 1)
  const left = Math.max(0, Math.floor(box.left * dpr))
  const top = Math.max(0, Math.floor(box.top * dpr))
  const width = Math.min(size.width - left, Math.floor(box.width * dpr))
  const height = Math.min(size.height - top, Math.floor(box.height * dpr))
  if (width < 40 || height < 24) {
    return {
      imageB64: image.toPNG().toString('base64'),
      scaleX: box.width / Math.max(1, size.width),
      scaleY: box.height / Math.max(1, size.height)
    }
  }
  const crop = nativeImage.createFromBuffer(image.toPNG()).crop({ x: left, y: top, width, height })
  return {
    imageB64: crop.toPNG().toString('base64'),
    scaleX: box.width / Math.max(1, width),
    scaleY: box.height / Math.max(1, height)
  }
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const types = { ...DEFAULT_TYPES, ...(cfg.types || {}) }
  if (cfg.type) types.click = String(cfg.type).trim() || types.click
  return {
    enabled: Boolean(cfg.enabled && String(cfg.token || '').trim()),
    token: String(cfg.token || '').trim(),
    type: String(cfg.type || types.click).trim() || types.click,
    types,
    url: String(cfg.url || 'https://api.jfbym.com/api/YmServer/customApi').trim(),
    maxRetries: Math.max(1, Math.min(5, Number(cfg.maxRetries) || 3)),
    fallbackHuman: cfg.fallbackHuman !== false,
    humanTimeoutSec: Math.max(30, Math.min(600, Number(cfg.humanTimeoutSec) || 180)),
    watchSec: Math.max(2, Math.min(30, Number(cfg.watchSec) || 8))
  }
}

async function clickSubmit(win, dbg, box) {
  const submit = await win.webContents.executeJavaScript(submitPointScript(box), true).catch(() => null)
  if (submit?.x != null) {
    await clickAt(dbg, submit.x, submit.y)
    await wait(280)
    await clickAt(dbg, submit.x, submit.y)
    return true
  }
  if (box?.width) {
    for (const yr of [0.93, 0.95, 0.9]) {
      for (const xr of [0.5, 0.48, 0.52]) {
        await clickAt(dbg, box.left + box.width * xr, box.top + box.height * yr)
        await wait(120)
      }
    }
  }
  return false
}

async function waitCleared(win, ticks = 28) {
  let gone = 0
  for (let tick = 0; tick < ticks; tick += 1) {
    await wait(450)
    if (!(await detect(win)).hit) {
      gone += 1
      if (gone >= 2) return true
    } else gone = 0
  }
  return false
}

async function applyClickOrDrag(win, box, crop, recog, kind, prompt = '') {
  await withDebugger(win, async (dbg) => {
    if (kind === 'slider') {
      const offset = parseSliderOffset(recog.pointsRaw || recog.text)
      const startX = box.left + Math.max(18, box.width * 0.08)
      const startY = box.top + box.height * 0.78
      const endX = box.left + Math.min(box.width - 12, Math.max(40, offset || box.width * 0.55))
      await drag(dbg, startX, startY, endX, startY, { steps: 36, holdSec: 0.28, settleSec: 0.25 })
      await clickSubmit(win, dbg, box)
      return
    }
    if (kind === 'text' || kind === 'math') {
      const answer = kind === 'math'
        ? (solveMathLocally(prompt) || solveMathLocally(recog.pointsRaw) || recog.text || parseTextAnswer(recog.pointsRaw))
        : (recog.text || parseTextAnswer(recog.pointsRaw))
      await win.webContents.executeJavaScript(fillCaptchaInputScript(answer), true)
      await wait(200)
      await clickSubmit(win, dbg, box)
      return
    }
    const points = recog.points || []
    const hint = `${prompt} ${recog.pointsRaw || ''}`
    const semanticDrag = /拖拽到这里|投放|拖到/.test(hint) || (points.length > 0 && points.length <= 3 && !/依次点击|请点击|点选/.test(hint))
    const [focusX, focusY] = dropTarget(box, 1)
    await clickAt(dbg, focusX, focusY)
    await wait(200)
    for (let index = 0; index < points.length; index += 1) {
      const [px, py] = points[index]
      const sx = box.left + px * crop.scaleX
      const sy = box.top + py * crop.scaleY
      if (semanticDrag) {
        const [dropX, dropY] = dropTarget(box, index + 1)
        await drag(dbg, sx, sy, dropX, dropY, {
          steps: index === 0 ? 32 : 24,
          holdSec: index === 0 ? 0.32 : 0.22,
          settleSec: index === 0 ? 0.3 : 0.18
        })
      } else {
        await clickAt(dbg, sx, sy)
      }
      await wait(index === 0 ? 700 : 420)
    }
    await clickSubmit(win, dbg, box)
  })
}

async function tryAutoSolve(win, config, notify) {
  const cfg = normalizeConfig(config)
  const out = { attempted: false, ok: false, cleared: false, error: '', pointsRaw: '', kind: '' }
  if (!cfg.enabled) return out
  out.attempted = true
  for (let attempt = 1; attempt <= cfg.maxRetries; attempt += 1) {
    if (!(await detect(win)).hit) {
      out.ok = true
      out.cleared = true
      return out
    }
    const info = await boxInfo(win)
    let box = info.box
    const kind = info.kind || 'click'
    out.kind = kind
    if (!box?.width || !box?.height) {
      const spotted = await detect(win)
      if (spotted.w >= 80 && spotted.h >= 60) {
        box = { left: spotted.left, top: spotted.top, width: spotted.w, height: spotted.h }
      }
    }
    if (!box?.width || !box?.height) {
      out.error = '没有定位到验证区域'
      break
    }
    const typeId = cfg.types[kind] || cfg.type
    notify?.({ confirmNote: `检测到${kindLabel(kind)}验证码，自动打码第 ${attempt}/${cfg.maxRetries} 次` })
    let crop
    try {
      crop = await captureCrop(win, box)
    } catch (error) {
      out.error = error.message || '截图失败'
      break
    }
    let recog
    if (kind === 'math') {
      const local = solveMathLocally(info.prompt)
      if (local) {
        recog = { ok: true, points: [], pointsRaw: local, text: local }
      }
    }
    if (!recog) {
      recog = await recognizeImage({
        imageB64: crop.imageB64,
        token: cfg.token,
        typeId,
        apiUrl: cfg.url,
        extra: String(info.prompt || '').trim()
      })
    }
    if (!recog.ok) {
      out.error = recog.error || '打码识别失败'
      await wait(800)
      continue
    }
    if (kind === 'click' && !recog.points?.length) {
      out.error = '点选题没有返回坐标'
      await wait(800)
      continue
    }
    if ((kind === 'text' || kind === 'math') && !recog.text && !recog.pointsRaw) {
      out.error = '字符/算术题没有返回结果'
      await wait(800)
      continue
    }
    if (kind === 'slider' && !parseSliderOffset(recog.pointsRaw || recog.text)) {
      out.error = '滑块题没有返回缺口距离'
      await wait(800)
      continue
    }
    out.pointsRaw = recog.pointsRaw || recog.text
    try {
      await applyClickOrDrag(win, box, crop, recog, kind, info.prompt || '')
    } catch (error) {
      out.error = error.message || '自动操作失败'
      await wait(800)
      continue
    }
    if (await waitCleared(win)) {
      out.ok = true
      out.cleared = true
      out.error = ''
      notify?.({ confirmNote: `${kindLabel(kind)}验证码已自动通过${out.pointsRaw ? `（${out.pointsRaw}）` : ''}` })
      return out
    }
    await withDebugger(win, async (dbg) => clickSubmit(win, dbg, box)).catch(() => {})
    if (await waitCleared(win, 12)) {
      out.ok = true
      out.cleared = true
      out.error = ''
      notify?.({ confirmNote: `${kindLabel(kind)}验证码已自动通过` })
      return out
    }
    out.error = '自动打码后验证还在'
    await wait(600)
  }
  return out
}

function kindLabel(kind) {
  if (kind === 'slider') return '滑块缺口'
  if (kind === 'math') return '算术'
  if (kind === 'text') return '字符'
  return '点选/拖拽'
}

async function resolveHit(win, config, notify) {
  const cfg = normalizeConfig(config)
  notify?.({ confirmNote: '检测到验证码，正在处理' })
  if (cfg.enabled) {
    const auto = await tryAutoSolve(win, cfg, notify)
    if (auto.cleared) return { hit: true, cleared: true, timedOut: false, auto: true, pointsRaw: auto.pointsRaw, kind: auto.kind }
    if (!cfg.fallbackHuman) {
      return { hit: true, cleared: false, timedOut: true, auto: true, error: auto.error || '自动打码失败', kind: auto.kind }
    }
    notify?.({ confirmNote: `自动打码未过：${auto.error || '请在窗口里完成验证'}。等待人工操作` })
  } else {
    notify?.({ confirmNote: '检测到验证码。请在打开的窗口里完成验证，完成后会自动继续' })
  }
  const humanDeadline = Date.now() + cfg.humanTimeoutSec * 1000
  while (Date.now() < humanDeadline) {
    if (!(await detect(win)).hit) {
      notify?.({ confirmNote: '验证码已通过，继续' })
      return { hit: true, cleared: true, timedOut: false, auto: false }
    }
    await wait(1000)
  }
  return { hit: true, cleared: false, timedOut: true, auto: false, error: '验证码等待超时' }
}

async function waitGate(win, config, notify, options = {}) {
  const cfg = normalizeConfig(config)
  if (options.alreadyHit) return resolveHit(win, cfg, notify)
  const deadline = Date.now() + cfg.watchSec * 1000
  let hit = false
  while (Date.now() < deadline) {
    const current = await detect(win)
    if (current.hit) {
      hit = true
      break
    }
    await wait(500)
  }
  if (!hit) return { hit: false, cleared: true, timedOut: false, auto: false }
  return resolveHit(win, cfg, notify)
}

async function checkNow(win, config, notify) {
  const current = await detect(win)
  if (!current.hit) return { hit: false, cleared: true, timedOut: false, auto: false }
  return resolveHit(win, config, notify)
}

module.exports = {
  detect,
  waitGate,
  checkNow,
  normalizeConfig,
  DEFAULT_TYPES
}
