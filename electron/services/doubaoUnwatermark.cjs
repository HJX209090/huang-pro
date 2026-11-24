const crypto = require('crypto')

const QAAB_SALT = Buffer.from(
  '4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58',
  'hex'
)

const FALLBACK_API_RE = [
  /fallback_api\\":\\"(.*?)\\"/gi,
  /"fallback_api"\s*:\s*"([^"]+)"/gi
]

function isHttp(value) {
  const text = String(value || '').trim().toLowerCase()
  return text.startsWith('http://') || text.startsWith('https://')
}

function decodeFragment(value) {
  let text = String(value || '')
  for (let round = 0; round < 3; round += 1) {
    try {
      const decoded = JSON.parse(`"${text.replace(/"/g, '\\"')}"`)
      if (typeof decoded !== 'string' || decoded === text) break
      text = decoded
    } catch {
      break
    }
  }
  return text.replace(/\\u0026/g, '&').replace(/\\\//g, '/')
}

function findValuesByKey(node, key, out = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => findValuesByKey(item, key, out))
    return out
  }
  if (!node || typeof node !== 'object') return out
  Object.entries(node).forEach(([name, value]) => {
    if (name === key && typeof value === 'string' && value.trim()) out.push(value)
    findValuesByKey(value, key, out)
  })
  return out
}

function fallbackApis(raw) {
  const body = String(raw || '')
  let json = null
  try { json = JSON.parse(body) } catch { json = null }
  const found = new Set()
  findValuesByKey(json, 'fallback_api').forEach((value) => {
    const url = decodeFragment(value)
    if (isHttp(url)) found.add(url)
  })
  FALLBACK_API_RE.forEach((pattern) => {
    pattern.lastIndex = 0
    let match = pattern.exec(body)
    while (match) {
      const url = decodeFragment(match[1])
      if (isHttp(url)) found.add(url)
      match = pattern.exec(body)
    }
  })
  return [...found]
}

function withCleanParams(raw) {
  const url = new URL(raw)
  url.searchParams.set('channel', 'no')
  url.searchParams.set('codec_type', '8')
  url.searchParams.set('logo_type', 'unwatermarked')
  return url.toString()
}

function getVideoData(payload) {
  if (!payload || typeof payload !== 'object') return {}
  const videoInfo = payload.video_info || payload.data?.video_info || payload
  if (!videoInfo || typeof videoInfo !== 'object') return {}
  const data = videoInfo.data && typeof videoInfo.data === 'object' ? videoInfo.data : videoInfo
  return data && typeof data === 'object' ? data : {}
}

function pickMainUrlToken(data) {
  const list = data?.video_list
  const entries = list && typeof list === 'object' && !Array.isArray(list) && Object.keys(list).length
    ? Object.values(list)
    : [data]
  let best = null
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const token = String(entry.main_url || entry.play_url || '').trim()
    if (!token) return
    const score = Number(entry.bitrate || entry.real_bitrate || 0)
      + Number(entry.vwidth || entry.width || 0) * Number(entry.vheight || entry.height || 0)
    if (!best || score > best.score) best = { token, score }
  })
  return best?.token || ''
}

function findKeySeed(value, depth = 0) {
  if (depth > 10 || value == null) return ''
  if (typeof value === 'string') {
    const query = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i)
    if (query) return decodeURIComponent(query[1])
    const field = value.match(/["']key_seed["']\s*:\s*["']([^"']+)/i)
    return field ? decodeURIComponent(field[1]) : ''
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findKeySeed(item, depth + 1)
      if (hit) return hit
    }
    return ''
  }
  if (typeof value === 'object') {
    if (typeof value.key_seed === 'string' && value.key_seed.trim()) return value.key_seed.trim()
    for (const item of Object.values(value)) {
      const hit = findKeySeed(item, depth + 1)
      if (hit) return hit
    }
  }
  return ''
}

function padBase64(text) {
  return text + '='.repeat((4 - (text.length % 4)) % 4)
}

function base64DecodeLoose(text) {
  const raw = String(text || '').trim()
  const swap = (map) => raw.replace(/[$@#]/g, (char) => map[char] || char)
  const variants = [raw, swap({ $: '_', '@': '/', '#': '.' }), swap({ $: '+', '@': '/', '#': '=' })]
  const seen = new Set()
  for (const candidate of variants) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    try {
      return Buffer.from(padBase64(candidate).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    } catch { /* 下一种写法 */ }
  }
  return null
}

function asciiUrl(data) {
  if (!data?.length) return ''
  for (const byte of data) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) return ''
  }
  return data.toString('ascii')
}

function stripPkcs7(data) {
  if (!data?.length) return Buffer.alloc(0)
  const pad = data[data.length - 1]
  if (pad < 1 || pad > 16 || pad > data.length) return data
  for (let index = data.length - pad; index < data.length; index += 1) {
    if (data[index] !== pad) return data
  }
  return data.subarray(0, data.length - pad)
}

function decryptAesCbc(payload, key, iv) {
  if (!payload?.length || payload.length % 16 !== 0 || key.length !== 16 || iv.length !== 16) return ''
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
    decipher.setAutoPadding(false)
    const plain = Buffer.concat([decipher.update(payload), decipher.final()])
    const direct = asciiUrl(plain)
    if (isHttp(direct)) return direct
    const stripped = asciiUrl(stripPkcs7(plain))
    return isHttp(stripped) ? stripped : ''
  } catch {
    return ''
  }
}

function decodeQaabToken(token, keySeed) {
  const data = base64DecodeLoose(token)
  const seed = base64DecodeLoose(keySeed)
  if (!data || !seed) return ''
  const digest1 = crypto.createHash('sha512').update(seed.subarray(0, 32)).digest()
  const digest2 = crypto.createHash('sha512').update(Buffer.concat([digest1, QAAB_SALT])).digest()
  const key = digest2.subarray(0, 16)
  const iv = digest2.subarray(16, 32)
  const attempts = []
  if (data.length >= 4 && data[0] === 0xA8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    attempts.push([data.subarray(4), key, iv], [data.subarray(4), iv, key])
    if (data.length > 36) attempts.push([data.subarray(36), key, data.subarray(20, 36)], [data.subarray(36), key, iv])
  } else {
    attempts.push([data, key, iv])
  }
  for (const [payload, itemKey, itemIv] of attempts) {
    const url = decryptAesCbc(payload, itemKey, itemIv)
    if (url) return url
  }
  return ''
}

function decodeMainUrl(token, keySeed) {
  const text = String(token || '').trim()
  if (!text) return ''
  if (isHttp(text)) return text
  const plain = asciiUrl(base64DecodeLoose(text))
  if (isHttp(plain)) return plain
  if (text.startsWith('qAAB') && keySeed) return decodeQaabToken(text, keySeed)
  return ''
}

function videoUrlFromPayload(payload) {
  const data = getVideoData(payload)
  const token = pickMainUrlToken(data)
  if (!token) return ''
  return decodeMainUrl(token, findKeySeed(payload))
}

function normalizeChatUrl(raw) {
  const text = String(raw || '').trim()
  const match = text.match(/https?:\/\/(?:www\.)?doubao\.com\/chat\/[^\s"'<>]+/i)
  if (match) return match[0].replace(/[).,;]+$/, '')
  try {
    const url = new URL(text)
    if (url.hostname.toLowerCase().includes('doubao.com') && url.pathname.includes('/chat/')) return text.split(/\s/)[0].replace(/[).,;]+$/, '')
  } catch { /* 不是链接 */ }
  return ''
}

module.exports = {
  fallbackApis,
  withCleanParams,
  videoUrlFromPayload,
  normalizeChatUrl
}
