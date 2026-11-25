export function pad(n) {
  return String(n).padStart(2, '0')
}

export function formatTime(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return String(input || '-')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function coverStyle(hue = 210) {
  const value = Number(hue) || 210
  return {
    background: `linear-gradient(155deg, hsl(${value} 75% 78%), hsl(${(value + 24) % 360} 58% 46%))`
  }
}

const TOPIC_DICT = [
  '睡衣', '家居服', '睡裙', '珊瑚绒', '法兰绒', '毛绒', '韩系', '加厚', '秋冬', '冬季', '保暖',
  '女装', '男装', '套装', '开衫', '亲子', '情侣', '居家', '宽松', '显瘦', '开箱', '种草',
  '测评', '穿搭', '上新', '好物', '百搭', '纯棉', '真丝', '冰丝', '短袖', '长袖', '外套',
  '连衣裙', '半身裙', '牛仔裤', '卫衣', '毛衣', '羽绒服', '运动鞋', '拖鞋', '包包', '数码',
  '美妆', '护肤', '零食', '厨房', '收纳', '母婴', '宠物'
]

function isPlaceholderGoodsTitle(title) {
  const text = String(title || '').trim()
  return !text || /^商品\s*\d{6,}$/.test(text) || /^\d{10,}$/.test(text)
}

/** 根据商品标题生成抖音作品标题（短、可读，不是整段商品名硬贴） */
export function publishTitleFromGoods(title, product) {
  let source = String(product?.title || title || '').trim()
  if (isPlaceholderGoodsTitle(source)) {
    source = String(product?.category || product?.shop || '').trim()
  }
  source = source
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!source || isPlaceholderGoodsTitle(source)) {
    const hit = TOPIC_DICT.find((word) => String(title || '').includes(word))
    source = hit ? `${hit}种草分享` : '今日好物分享'
  }
  // 优先保留前半段卖点，超长时截到标点或 28 字
  if (source.length > 28) {
    const cut = source.slice(0, 28)
    const soft = cut.match(/^(.{8,26}?)[，,、\s]/)
    source = soft ? soft[1] : cut
  }
  return source.slice(0, 30)
}

/** 根据商品标题提炼话题词（过滤纯数字/「商品」占位），供抖音选话题 */
export function topicsFromGoods(title, product) {
  const source = String(product?.title || title || '').trim()
  const seeds = []
  const push = (word) => {
    const text = String(word || '').replace(/^#/, '').replace(/[【】[\]()（）#@|｜/\\,，.。!！?？:：;；"'“”\s]/g, '').trim()
    if (!text || text.length < 2 || text.length > 12) return
    if (/^\d+$/.test(text)) return
    if (/^商品\d*$/.test(text)) return
    if (/^https?:/i.test(text) || /haohuo|jinritemai|douyin/i.test(text)) return
    if (seeds.includes(text)) return
    seeds.push(text)
  }
  TOPIC_DICT.forEach((word) => {
    if (source.includes(word)) push(word)
  })
  const brackets = source.match(/[【\[（(][^】\]）)]{2,12}[】\]）)]/g) || []
  brackets.forEach((item) => push(item))
  const cnParts = source
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  cnParts.forEach((part) => {
    if (/^\d+$/.test(part)) return
    if (part.length >= 2 && part.length <= 8) push(part)
    else if (part.length > 8) {
      for (let index = 0; index + 2 <= Math.min(part.length, 12) && seeds.length < 8; index += 2) {
        push(part.slice(index, index + 2))
        if (index + 3 <= part.length) push(part.slice(index, index + 3))
      }
    }
  })
  if (!seeds.length && !isPlaceholderGoodsTitle(source)) {
    const compact = source.replace(/[^\u4e00-\u9fff]/g, '')
    if (compact.length >= 2) push(compact.slice(0, Math.min(6, compact.length)))
  }
  ;['好物推荐', '种草', '日常分享'].forEach(push)
  return seeds.slice(0, 5)
}

/** @deprecated 兼容旧调用，内部走 topicsFromGoods */
export function tagsFromTitle(title) {
  return topicsFromGoods(title)
}

export function earn(price, rate) {
  return ((Number(price) || 0) * (Number(rate) || 0) / 100).toFixed(2)
}

export function statusType(status) {
  if (['已生成', '已发布', '审核通过', '已登录', '在线', '成功', '已启用'].includes(status)) return 'success'
  if (['生成中', '发布中', '检测中', '待生成'].includes(status)) return 'warning'
  if (['失败', '生成失败', '发布失败', '审核失败', '未登录', '异常'].includes(status)) return 'danger'
  return 'info'
}

/** 作品状态给人看的文案 */
export function displayWorkStatus(status) {
  const map = {
    待生成: '待生成',
    生成中: '生成中',
    已生成: '待审核',
    审核通过: '已审核',
    审核失败: '已驳回',
    发布中: '发布中',
    已发布: '已发布',
    生成失败: '生成失败'
  }
  return map[status] || status || '未知'
}

export function videoUrl(filePath) {
  if (!filePath) return ''
  return `local-video://play/?path=${encodeURIComponent(filePath)}`
}

export function keepProductImage(value) {
  const url = String(value || '').trim()
  if (!url) return false
  if (/^(file:|local-video:)/i.test(url)) return true
  if (!/^(https?:)?\/\//i.test(url)) return false
  if (/icon|logo|avatar|sprite|favicon|emoji|badge|qrcode|qr_code|shop_logo|placeholder/i.test(url)) return false
  const size = url.match(/(?:www|resize|crop|thumb)[^0-9]{0,8}(\d{1,4})[-x_:](\d{1,4})/i)
    || url.match(/(?:^|[^0-9])(\d{2,4})x(\d{2,4})(?:[^0-9]|$)/i)
  if (size && Number(size[1]) > 0 && Number(size[1]) < 240 && Number(size[2]) > 0 && Number(size[2]) < 240) return false
  return true
}

export function imageUrl(value) {
  const src = String(value || '')
  if (!src) return ''
  if (/^(https?:|data:|blob:|local-video:)/i.test(src)) return src
  return videoUrl(src)
}

export function fillTemplate(template, product) {
  const title = product?.title || '商品'
  return String(template || '')
    .replaceAll('{{title}}', title)
    .replaceAll('{{category}}', product?.category || '')
    .replaceAll('{{price}}', product ? String(product.price ?? '') : '')
    .replaceAll('{{shop}}', product?.shop || '')
    .replaceAll('商品标题', title)
}

function withLabel(label, text) {
  const body = String(text || '').trim()
  if (!body) return ''
  if (body.startsWith(label)) return body
  return `${label}：${body}`
}

export function composePrompt(form, product) {
  const source = String(form?.promptText || '').trim()
  if (source) {
    let text = fillTemplate(source, product)
    const seconds = Number(form?.duration)
    if (seconds > 0) text = text.replace(/10\s*秒/, `${seconds} 秒`)
    if (form?.ratio) text = text.replace('9:16', form.ratio)
    if (form?.model && !/mini/i.test(form.model)) text = text.replace(/Seedance\s*2\.0\s*Mini/gi, form.model)
    return withVoice(text, form?.voice)
  }
  let opening = fillTemplate(form?.lockText, product)
  const seconds = Number(form?.duration)
  if (seconds > 0) opening = opening.replace(/10\s*秒/, `${seconds} 秒`)
  if (form?.ratio) opening = opening.replace('9:16', form.ratio)
  if (form?.model && !/mini/i.test(form.model)) opening = opening.replace(/Seedance\s*2\.0\s*Mini/gi, form.model)
  const lines = [
    opening,
    withLabel('画面主线', fillTemplate(form?.storyline, product)),
    withLabel('字幕 & 视觉', fillTemplate(form?.caption, product)),
    withLabel('音频 & 口播', fillTemplate(form?.script || form?.oral, product)),
    withLabel('硬性合规要求', fillTemplate(form?.compliance, product))
  ].filter(Boolean).join('\n\n')
  return withVoice(lines, form?.voice)
}

export function withVoice(text, voice) {
  const body = String(text || '').trim()
  const name = String(voice || '').trim()
  if (!body || !name || body.includes(name)) return body
  return `${body}\n\n配音音色：${name}。口播使用这个音色。`
}
