(() => {
  const SOURCE = 'huang-douyin-uploader'
  if (window.__huangDouyinUploader) return
  window.__huangDouyinUploader = true
  let busy = false

  function report(state, note) {
    try {
      document.documentElement.setAttribute('data-huang-uploader', JSON.stringify({
        state,
        note: String(note || ''),
        t: Date.now()
      }))
    } catch { /* ignore */ }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function clickEl(el) {
    if (!el) return false
    try {
      el.click()
      return true
    } catch { /* ignore */ }
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
    } catch {
      return false
    }
  }

  function walkButtons() {
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], span, div, a').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    return nodes
  }

  function findPublishButton() {
    const compact = (value) => String(value || '').replace(/\s+/g, '')
    const exact = document.querySelector('button.button-dhlUZE.primary-cECiOJ, .content-confirm-container-Wp91G7 button')
    if (exact && /发布/.test(exact.textContent || '') && !exact.disabled) {
      return { el: exact, text: compact(exact.textContent) }
    }
    const order = { 确认发布: 0, 确定发布: 1, 立即发布: 2, 发布作品: 3, 发布: 4 }
    const candidates = []
    for (const el of walkButtons()) {
      const text = compact(el.innerText || el.textContent)
      if (!Object.prototype.hasOwnProperty.call(order, text)) continue
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 48 && rect.height > 20)) continue
      if (rect.bottom < 0 || rect.top > window.innerHeight + 80) continue
      const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true' || /disabled|is-disabled/.test(String(el.className || ''))
      candidates.push({ el, text, disabled, top: rect.top, left: rect.left })
    }
    candidates.sort((a, b) => {
      if (order[a.text] !== order[b.text]) return order[a.text] - order[b.text]
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
      return b.top - a.top || b.left - a.left
    })
    return candidates.find((item) => !item.disabled) || null
  }

  function fillInput(el, text) {
    if (!el) return false
    try { el.focus() } catch { /* ignore */ }
    if ('value' in el) el.value = text
    else el.textContent = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function fillTitle(title) {
    const text = String(title || '').trim()
    if (!text) return 'skip'
    const el = document.querySelector('input[placeholder*="填写作品标题"], input[placeholder*="作品标题"], input[placeholder*="添加标题"], .semi-input[placeholder*="填写作品标题"]')
    if (!el) return 'miss'
    fillInput(el, text.slice(0, 30))
    return 'ok'
  }

  function fillDescription(description) {
    const text = String(description || '').trim()
    if (!text) return 'skip'
    const el = document.querySelector('[data-placeholder="添加作品简介"], [data-placeholder*="作品简介"], [data-placeholder*="简介"]')
    if (!el) return 'miss'
    try { el.focus() } catch { /* ignore */ }
    try { document.execCommand('selectAll') } catch { /* ignore */ }
    try {
      if (!document.execCommand('insertText', false, text)) throw new Error('insertText failed')
    } catch {
      el.textContent = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return 'ok'
  }

  async function clickPublish() {
    for (let i = 0; i < 14; i += 1) {
      const hit = findPublishButton()
      if (hit) {
        clickEl(hit.el.closest('button, [role="button"]') || hit.el)
        await sleep(700)
        const again = findPublishButton()
        if (again && /确认|确定/.test(again.text)) {
          clickEl(again.el.closest('button, [role="button"]') || again.el)
          return again.text
        }
        return hit.text
      }
      await sleep(400)
    }
    return ''
  }

  async function runFillAndPublish(payload) {
    if (busy) {
      report('busy', '正在发布')
      return
    }
    busy = true
    report('running', '插件开始填写并发布')
    try {
      fillTitle(payload?.title)
      fillDescription(payload?.description)
      await sleep(400)
      const clicked = await clickPublish()
      if (clicked) report('published', `插件已点${clicked}`)
      else report('miss', '插件没有找到发布按钮')
    } catch (error) {
      report('error', error?.message || '插件发布失败')
    } finally {
      busy = false
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.source !== SOURCE) return
    if (data.action === 'fill-and-publish') runFillAndPublish(data.payload || {})
    if (data.action === 'ping') report('ready', '插件已就绪')
  })

  report('ready', '抖音发布插件已注入')
})()
