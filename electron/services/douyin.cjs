const crypto = require('crypto')

function timestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date())
  const pick = (type) => parts.find((item) => item.type === type).value
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) sorted[key] = normalize(value[key])
    return sorted
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return value == null ? '' : String(value)
}

function paramJson(payload) {
  return JSON.stringify(normalize(payload))
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
}

function sign({ appKey, appSecret, method, paramJsonStr, ts }) {
  const pattern = `app_key${appKey}method${method}param_json${paramJsonStr}timestamp${ts}v2`
  return crypto.createHmac('sha256', appSecret).update(`${appSecret}${pattern}${appSecret}`).digest('hex')
}

function yuanFromCent(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount) / 100
}

function mapProduct(item, index) {
  const price = yuanFromCent(item.discount_price ?? item.price ?? item.market_price ?? 0)
  const category = item.category_detail?.first_cname || item.category_name || item.first_cid_name || '未分类'
  return {
    id: String(item.product_id_str || item.product_id || item.id),
    title: item.name || item.title || '未命名商品',
    price,
    rate: Number(item.cos_ratio || item.commission_rate || 0) || 0,
    category,
    shop: item.shop_name || '抖店',
    source: '抖店开放平台',
    monthlySales: Number(item.sell_num || item.sales || 0) || 0,
    external: true,
    scriptReady: false,
    hue: (index * 37) % 360,
    createdAt: timestamp().slice(0, 16),
    image: item.img || item.pic || ''
  }
}

async function listProducts({ appKey, appSecret, accessToken, page = 1, size = 20 }) {
  if (!appKey || !appSecret || !accessToken) {
    const error = new Error('登录账号里还没有店铺接口凭证')
    error.status = 400
    throw error
  }
  const method = 'product.listV2'
  const paramJsonStr = paramJson({
    page,
    size,
    status: 0,
    check_status: 3
  })
  const ts = timestamp()
  const signValue = sign({ appKey, appSecret, method, paramJsonStr, ts })
  const query = new URLSearchParams({
    method,
    app_key: appKey,
    access_token: accessToken,
    timestamp: ts,
    v: '2',
    sign: signValue,
    sign_method: 'hmac-sha256'
  })
  const response = await fetch(`https://openapi-fxg.jinritemai.com/product/listV2?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: '*/*' },
    body: paramJsonStr
  })
  const json = await response.json()
  if (Number(json.code) !== 10000) {
    const error = new Error(json.sub_msg || json.msg || '抖店接口没有返回商品')
    error.status = 502
    throw error
  }
  const list = json.data?.data || json.data?.list || json.data?.products || []
  return {
    total: Number(json.data?.total || list.length) || list.length,
    products: list.map(mapProduct)
  }
}

async function createToken({ appKey, appSecret, shopId }) {
  if (!appKey || !appSecret) {
    const error = new Error('还没有从登录账号里读到 appKey 和 appSecret')
    error.status = 400
    throw error
  }
  const method = 'token.create'
  const payload = { code: '', grant_type: 'authorization_self' }
  if (shopId) payload.shop_id = String(shopId)
  const paramJsonStr = paramJson(payload)
  const ts = timestamp()
  const signValue = sign({ appKey, appSecret, method, paramJsonStr, ts })
  const query = new URLSearchParams({
    method,
    app_key: appKey,
    timestamp: ts,
    v: '2',
    sign: signValue,
    sign_method: 'hmac-sha256'
  })
  const response = await fetch(`https://openapi-fxg.jinritemai.com/token/create?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: '*/*' },
    body: paramJsonStr
  })
  const json = await response.json()
  if (Number(json.code) !== 10000) {
    const error = new Error(json.sub_msg || json.msg || '没能换到 accessToken')
    error.status = 502
    throw error
  }
  return {
    accessToken: json.data?.access_token || '',
    refreshToken: json.data?.refresh_token || '',
    shopId: String(json.data?.shop_id || shopId || ''),
    shopName: json.data?.shop_name || ''
  }
}

module.exports = { listProducts, createToken }
