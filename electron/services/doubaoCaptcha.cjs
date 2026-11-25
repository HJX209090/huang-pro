const https = require('https')
const http = require('http')
const { nativeImage } = require('electron')
const runtimeLog = require('./runtimeLog.cjs')
const doubaoMonitor = require('./doubaoMonitor.cjs')

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
    const dialogs = Array.from(document.querySelectorAll('div,section,dialog,[role="dialog"]')).filter((el) => {
      const text = String(el.innerText || '').replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      if (rect.width < 240 || rect.width > 760 || rect.height < 260 || rect.height > 920) return false
      if (rect.left < 80) return false
      return /拖拽到这里|拖到此处/.test(text) && /请选择/.test(text)
    })
    if (dialogs[0]) {
      const rect = dialogs[0].getBoundingClientRect()
      return {
        hit: true,
        via: 'dialog',
        src: '',
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
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
      const dialogs = Array.from(document.querySelectorAll('div,section,dialog,[role="dialog"]')).filter((el) => {
        const text = String(el.innerText || '').replace(/\\s+/g, '')
        const rect = el.getBoundingClientRect()
        if (rect.width < 240 || rect.width > 760 || rect.height < 260 || rect.height > 920) return false
        if (rect.left < 80) return false
        return /拖拽到这里|拖到此处/.test(text) && /请选择/.test(text)
      })
      dialogs.sort((a, b) => {
        const ar = a.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return (ar.width * ar.height) - (br.width * br.height)
      })
      if (dialogs[0]) {
        const wrap = dialogs[0].getBoundingClientRect()
        box = {
          left: Math.round(wrap.left),
          top: Math.round(wrap.top),
          width: Math.round(wrap.width),
          height: Math.round(wrap.height)
        }
      }
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
  // 默认开启自动过验证：无 token 时走本地识别，有 token 再走第三方
  const enabled = cfg.enabled !== false
  return {
    enabled,
    token: String(cfg.token || process.env.HUANG_CAPTCHA_TOKEN || '').trim(),
    type: String(cfg.type || types.click).trim() || types.click,
    types,
    url: String(cfg.url || 'https://api.jfbym.com/api/YmServer/customApi').trim(),
    maxRetries: Math.max(1, Math.min(6, Number(cfg.maxRetries) || 4)),
    fallbackHuman: cfg.fallbackHuman !== false,
    humanTimeoutSec: Math.max(30, Math.min(600, Number(cfg.humanTimeoutSec) || 180)),
    watchSec: Math.max(2, Math.min(30, Number(cfg.watchSec) || 10))
  }
}

function framesOf(frame, list = []) {
  list.push(frame)
  for (const child of frame.frames || []) framesOf(child, list)
  return list
}

function tilesScript() {
  return `(() => {
    const ownText = (el) => {
      let text = ''
      for (const node of el.childNodes || []) {
        if (node.nodeType === 3) text += node.textContent || ''
      }
      return text.replace(/\\s+/g, '')
    }
    const dialogs = Array.from(document.querySelectorAll('div,section,dialog,[role="dialog"]')).filter((el) => {
      const text = String(el.innerText || '').replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      if (rect.width < 240 || rect.width > 760 || rect.height < 260 || rect.height > 920) return false
      if (rect.left < 80) return false
      return /拖拽到这里|拖到此处/.test(text) && /请选择/.test(text)
    })
    dialogs.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return (ar.width * ar.height) - (br.width * br.height)
    })
    const root = dialogs[0] || document
    const scoped = root.querySelectorAll ? root : document
    const body = String((root.innerText || document.body?.innerText || '')).slice(0, 8000)
    const lines = body.split(/\\n+/).map((line) => line.trim()).filter(Boolean)
    const instruction = /请选择|拖拽到这里|拖到此处|刷新|反馈|提交|请完成安全验证/
    let promptLine = ''
    for (const line of lines) {
      if (line.length >= 4 && line.length <= 24 && !instruction.test(line) && /(场所|物品|能看到|厨房|浴室|办公室|露营|城市|街道|交通|建筑)/.test(line)) {
        promptLine = line
        break
      }
    }
    if (!promptLine) {
      for (const line of lines) {
        if (line.length >= 4 && line.length <= 20 && !instruction.test(line) && !/^\\d+$/.test(line)) {
          promptLine = line
          break
        }
      }
    }
    const dropNodes = Array.from(scoped.querySelectorAll('div,section,span,p')).filter((el) => {
      const text = ownText(el) || String(el.innerText || '').replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      return /拖拽到这里|拖到此处|放到这里/.test(text) && text.length <= 24 && rect.width >= 80 && rect.height >= 36 && rect.width <= 560
    })
    dropNodes.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return (ar.width * ar.height) - (br.width * br.height)
    })
    const drop = dropNodes[0]
    const dropRect = drop ? drop.getBoundingClientRect() : null
    const box = (root !== document ? root.getBoundingClientRect() : null)
    const imgs = Array.from(scoped.querySelectorAll('img, canvas'))
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2
        }
      })
      .filter((item) => {
        if (item.width < 48 || item.height < 48 || item.width > 280 || item.height > 280) return false
        if (box && (item.cx < box.left || item.cx > box.right || item.cy < box.top || item.cy > box.bottom)) return false
        if (dropRect && item.cy > dropRect.top - 8) return false
        return true
      })
      .sort((a, b) => (a.top - b.top) || (a.left - b.left))
    const median = imgs.length ? imgs.map((item) => item.width).sort((a, b) => a - b)[Math.floor(imgs.length / 2)] : 0
    let tiles = imgs.filter((item) => !median || Math.abs(item.width - median) < median * 0.35)
    if (tiles.length >= 9) tiles = tiles.slice(0, 9)
    const submit = Array.from(scoped.querySelectorAll('button, [role="button"], div, span')).find((el) => {
      const text = (ownText(el) || String(el.innerText || '')).replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      return /^(提交|确认|完成验证|确定)$/.test(text) && rect.width >= 40 && rect.height >= 18
    })
    const submitRect = submit ? submit.getBoundingClientRect() : null
    return {
      prompt: promptLine,
      hit: tiles.length >= 3 || /拖拽到这里|请选择所有符合|请完成安全验证/.test(body),
      drop: dropRect ? {
        left: Math.round(dropRect.left),
        top: Math.round(dropRect.top),
        width: Math.round(dropRect.width),
        height: Math.round(dropRect.height),
        cx: Math.round(dropRect.left + dropRect.width / 2),
        cy: Math.round(dropRect.top + dropRect.height / 2)
      } : null,
      submit: submitRect ? {
        cx: Math.round(submitRect.left + submitRect.width / 2),
        cy: Math.round(submitRect.top + submitRect.height / 2)
      } : null,
      tiles: tiles.map((item, index) => ({
        index,
        left: Math.round(item.left),
        top: Math.round(item.top),
        width: Math.round(item.width),
        height: Math.round(item.height),
        cx: Math.round(item.cx),
        cy: Math.round(item.cy)
      }))
    }
  })()`
}

function iframeOffsetScript() {
  return `(() => {
    const KEYS = ${JSON.stringify(CAPTCHA_KEYS)}
    const frames = Array.from(document.querySelectorAll('iframe'))
    for (const frame of frames) {
      const src = String(frame.getAttribute('src') || frame.src || '').toLowerCase()
      if (!KEYS.some((key) => src.includes(key))) continue
      const rect = frame.getBoundingClientRect()
      if (rect.width >= 80 && rect.height >= 60) {
        return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), src: src.slice(0, 180) }
      }
    }
    return { left: 0, top: 0, width: 0, height: 0, src: '' }
  })()`
}

function shiftLayout(layout, ox, oy) {
  if (!layout) return layout
  const move = (box) => box ? {
    ...box,
    left: Math.round((box.left || 0) + ox),
    top: Math.round((box.top || 0) + oy),
    cx: Math.round((box.cx || 0) + ox),
    cy: Math.round((box.cy || 0) + oy)
  } : null
  return {
    ...layout,
    drop: move(layout.drop),
    submit: layout.submit ? { cx: layout.submit.cx + ox, cy: layout.submit.cy + oy } : null,
    tiles: (layout.tiles || []).map((tile) => ({
      ...tile,
      left: tile.left + ox,
      top: tile.top + oy,
      cx: tile.cx + ox,
      cy: tile.cy + oy
    }))
  }
}

async function readCaptchaLayout(win) {
  if (!win || win.isDestroyed()) return null
  let best = null
  const offset = await win.webContents.executeJavaScript(iframeOffsetScript(), true).catch(() => ({ left: 0, top: 0 }))
  for (const frame of framesOf(win.webContents.mainFrame)) {
    try {
      const layout = await frame.executeJavaScript(tilesScript(), true)
      if (!layout?.hit && !(layout?.tiles?.length >= 3)) continue
      const isChild = frame !== win.webContents.mainFrame
      const shifted = isChild ? shiftLayout(layout, offset?.left || 0, offset?.top || 0) : layout
      if (!best || (shifted.tiles?.length || 0) > (best.tiles?.length || 0)) best = shifted
    } catch { /* cross-origin or detached */ }
  }
  return best
}

function promptCategory(prompt) {
  const text = String(prompt || '')
  if (/城市|都市|街道|建筑|场所|车站|马路|能看到/.test(text)) return 'city'
  if (/露营|野营|帐篷|户外|登山|烧烤架|折叠椅/.test(text)) return 'camping'
  if (/厨房|灶台|锅|碗|菜刀|餐具/.test(text)) return 'kitchen'
  if (/浴室|卫生间|马桶|淋浴|洗漱/.test(text)) return 'bathroom'
  if (/办公室|电脑|键盘|工位|文件/.test(text)) return 'office'
  if (/交通|汽车|公交|地铁|自行车/.test(text)) return 'transport'
  return 'general'
}

function scoreBitmapForCategory(bitmap, width, height, category) {
  if (!bitmap || !width || !height) return 0
  const step = Math.max(1, Math.floor(Math.min(width, height) / 28))
  let green = 0
  let warm = 0
  let cool = 0
  let dark = 0
  let bright = 0
  let edge = 0
  let samples = 0
  let prev = null
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const r = bitmap[i]
      const g = bitmap[i + 1]
      const b = bitmap[i + 2]
      const lum = (r + g + b) / 3
      samples += 1
      if (g > r + 12 && g > b + 8) green += 1
      if (r > g + 18 && r > b + 10) warm += 1
      if (b > r + 10 && b > g + 8) cool += 1
      if (lum < 55) dark += 1
      if (lum > 200) bright += 1
      if (prev != null) edge += Math.min(60, Math.abs(lum - prev)) / 60
      prev = lum
    }
  }
  if (!samples) return 0
  const gRatio = green / samples
  const wRatio = warm / samples
  const cRatio = cool / samples
  const dRatio = dark / samples
  const bRatio = bright / samples
  const eRatio = edge / samples
  if (category === 'city') {
    const objectLike = (bRatio > 0.35 && eRatio < 0.18) || (wRatio > 0.35 && eRatio < 0.16)
    const denseNature = gRatio > 0.52 && eRatio < 0.16
    return eRatio * 1.8 + cRatio * 1.0 + dRatio * 0.35 + wRatio * 0.25 + gRatio * 0.35
      - (objectLike ? 1.3 : 0) - (denseNature ? 0.7 : 0)
  }
  if (category === 'camping') {
    // 户外绿 + 人造边缘（椅/炉），压低大片白墙/蝴蝶柔边/动物毛绒
    return gRatio * 2.4 + eRatio * 1.6 + wRatio * 0.8 - bRatio * 1.2 - (gRatio > 0.45 && eRatio < 0.15 ? 1.2 : 0) - (dRatio > 0.55 ? 0.4 : 0)
  }
  if (category === 'kitchen') return wRatio * 1.6 + eRatio * 1.4 + dRatio * 0.4 - gRatio * 0.8
  if (category === 'bathroom') return bRatio * 1.2 + cRatio * 1.1 + eRatio * 0.8 - gRatio * 1.1
  if (category === 'office') return cRatio * 0.8 + eRatio * 1.5 + bRatio * 0.5 - gRatio * 1.3
  return eRatio * 1.2 + gRatio * 0.4
}

async function scoreTile(win, tile, category) {
  try {
    const crop = await captureCrop(win, {
      left: tile.left,
      top: tile.top,
      width: tile.width,
      height: tile.height
    })
    const image = nativeImage.createFromBuffer(Buffer.from(crop.imageB64, 'base64'))
    const size = image.getSize()
    const bitmap = image.getBitmap()
    return scoreBitmapForCategory(bitmap, size.width, size.height, category)
  } catch {
    return 0
  }
}

async function localSemanticSolve(win, notify) {
  const layout = await readCaptchaLayout(win)
  if (!layout?.tiles?.length || layout.tiles.length < 3) {
    runtimeLog.warn('captcha', `弹窗图不够 tiles=${layout?.tiles?.length || 0} prompt=${layout?.prompt || ''}`)
    return { ok: false, error: '没有找到可拖拽图片（含验证 iframe）' }
  }
  const category = promptCategory(layout.prompt)
  notify?.({ confirmNote: `正在识别验证图「${layout.prompt || category}」并自动拖拽` })
  doubaoMonitor.note(win, `正在拖验证图「${layout.prompt || category}」`)
  runtimeLog.info('captcha', `题目「${layout.prompt || ''}」分类=${category} 图${layout.tiles.length}张`)
  const scored = []
  for (const tile of layout.tiles) {
    const score = await scoreTile(win, tile, category)
    scored.push({ tile, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const threshold = category === 'city' ? 0.22 : (category === 'camping' ? 0.28 : 0.32)
  const positive = scored.filter((item) => item.score > threshold)
  const need = category === 'city'
    ? Math.min(6, Math.max(3, positive.length || 4))
    : (category === 'camping' ? Math.min(5, Math.max(2, positive.length || 3)) : Math.min(4, Math.max(2, positive.length || 3)))
  const picks = (positive.length >= 2 ? positive : scored.slice(0, need))
    .slice(0, need)
    .map((item) => item.tile)
  if (!picks.length) return { ok: false, error: '本地识别没有选出图片' }
  const drop = layout.drop || {
    cx: Math.round((Math.min(...layout.tiles.map((t) => t.left)) + Math.max(...layout.tiles.map((t) => t.left + t.width))) / 2),
    cy: Math.round(Math.max(...layout.tiles.map((t) => t.top + t.height)) + 48)
  }
  await withDebugger(win, async (dbg) => {
    for (let index = 0; index < picks.length; index += 1) {
      const tile = picks[index]
      const dx = drop.cx + ((index % 3) - 1) * 16
      const dy = drop.cy + Math.floor(index / 3) * 12
      await drag(dbg, tile.cx, tile.cy, dx, dy, {
        steps: index === 0 ? 36 : 26,
        holdSec: index === 0 ? 0.34 : 0.22,
        settleSec: 0.24
      })
      await wait(index === 0 ? 720 : 420)
    }
    if (layout.submit?.cx) {
      await clickAt(dbg, layout.submit.cx, layout.submit.cy)
      await wait(260)
      await clickAt(dbg, layout.submit.cx, layout.submit.cy)
    } else {
      const box = {
        left: Math.min(...layout.tiles.map((item) => item.left)),
        top: Math.min(...layout.tiles.map((item) => item.top)),
        width: Math.max(...layout.tiles.map((item) => item.left + item.width)) - Math.min(...layout.tiles.map((item) => item.left)),
        height: (layout.drop ? layout.drop.top + layout.drop.height : Math.max(...layout.tiles.map((item) => item.top + item.height))) - Math.min(...layout.tiles.map((item) => item.top)) + 80
      }
      await clickSubmit(win, dbg, box)
    }
  })
  return { ok: true, picks: picks.length, category, prompt: layout.prompt, scores: scored.map((s) => Number(s.score.toFixed(2))) }
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
    const typeId = cfg.types[kind] || cfg.type
    runtimeLog.info('captcha', `检测到${kindLabel(kind)} 第 ${attempt}/${cfg.maxRetries} 次`)
    doubaoMonitor.note(win, `检测到${kindLabel(kind)}验证，自动处理第 ${attempt} 次`)
    notify?.({ confirmNote: `检测到${kindLabel(kind)}验证码，自动处理第 ${attempt}/${cfg.maxRetries} 次` })

    // 点选/拖拽：优先本地语义拖拽。弹窗没有 iframe 时也必须跑，不能因为没定位到框就停
    if (kind === 'click') {
      const local = await localSemanticSolve(win, notify)
      if (local.ok) {
        out.pointsRaw = `local:${local.category}:${local.picks}`
        if (await waitCleared(win)) {
          out.ok = true
          out.cleared = true
          out.error = ''
          doubaoMonitor.note(win, `验证码已自动通过（拖了 ${local.picks} 张）`)
          notify?.({ confirmNote: `验证码已自动通过（拖了 ${local.picks} 张）` })
          return out
        }
        // 没过就点刷新再试
        await withDebugger(win, async (dbg) => {
          const refresh = await win.webContents.executeJavaScript(`(() => {
            const el = Array.from(document.querySelectorAll('button,span,div,a')).find((node) => {
              const text = String(node.innerText || '').replace(/\\s+/g, '')
              return text === '刷新' || text.includes('刷新')
            })
            if (!el) return null
            const rect = el.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          })()`, true).catch(() => null)
          if (refresh?.x) await clickAt(dbg, refresh.x, refresh.y)
        }).catch(() => {})
        await wait(900)
      } else if (!cfg.token) {
        out.error = local.error || '本地识别未通过'
      }
    }

    if (!box?.width || !box?.height) {
      out.error = out.error || '没有定位到验证区域'
      if (kind === 'click') {
        await wait(700)
        continue
      }
      break
    }

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
    if (!recog && cfg.token) {
      recog = await recognizeImage({
        imageB64: crop.imageB64,
        token: cfg.token,
        typeId,
        apiUrl: cfg.url,
        extra: String(info.prompt || '').trim()
      })
    }
    if (!recog) {
      if (kind === 'click') {
        out.error = out.error || '本地拖拽后验证仍在'
        await wait(700)
        continue
      }
      out.error = cfg.token ? '识别失败' : '当前题型需联网识别，正在重试本地策略'
      await wait(700)
      continue
    }
    if (!recog.ok) {
      out.error = recog.error || '识别失败'
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
  doubaoMonitor.note(win, '检测到验证码，正在自动处理')
  notify?.({ confirmNote: '检测到验证码，正在自动处理' })
  if (cfg.enabled) {
    const auto = await tryAutoSolve(win, cfg, notify)
    if (auto.cleared) {
      doubaoMonitor.note(win, '验证码已自动通过')
      return { hit: true, cleared: true, timedOut: false, auto: true, pointsRaw: auto.pointsRaw, kind: auto.kind }
    }
    if (!cfg.fallbackHuman) {
      doubaoMonitor.note(win, auto.error || '自动验证失败')
      return { hit: true, cleared: false, timedOut: true, auto: true, error: auto.error || '自动验证失败', kind: auto.kind }
    }
    doubaoMonitor.note(win, `自动拖未过：${auto.error || '等待人工拖完'}`)
    notify?.({ confirmNote: `自动处理未过：${auto.error || '请在窗口里拖一下'}。等待你完成后继续` })
    try { if (!win.isDestroyed()) { win.show(); win.focus() } } catch { /* ignore */ }
  } else {
    doubaoMonitor.note(win, '请在窗口里完成验证')
    notify?.({ confirmNote: '检测到验证码。请在打开的窗口里完成验证，完成后会自动继续' })
    try { if (!win.isDestroyed()) { win.show(); win.focus() } } catch { /* ignore */ }
  }
  const humanDeadline = Date.now() + cfg.humanTimeoutSec * 1000
  while (Date.now() < humanDeadline) {
    if (!(await detect(win)).hit) {
      doubaoMonitor.note(win, '验证码已通过，继续生成')
      notify?.({ confirmNote: '验证码已通过，继续' })
      return { hit: true, cleared: true, timedOut: false, auto: false }
    }
    await wait(1000)
  }
  doubaoMonitor.note(win, '验证码等待超时')
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
