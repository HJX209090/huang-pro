const { net, session } = require('electron')
const browserSession = require('./browserSession.cjs')

function partitionOf(accountId) {
  return `persist:huang-publish-${accountId}`
}

function pickList(json) {
  const piles = [
    json?.data?.data,
    json?.data?.list,
    json?.data?.products,
    json?.data?.promotions,
    json?.promotions,
    json?.data,
    json?.list,
    json?.products
  ]
  return piles.find((item) => Array.isArray(item)) || []
}

function ownProductId(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return ''
  const id = node.product_id_str || node.product_id || node.promotion_id
  return id && /^\d{6,}$/.test(String(id)) ? String(id) : ''
}

function walkValues(node, depth, strings) {
  if (node == null || depth > 5) return
  if (typeof node === 'string') {
    strings.push(node.startsWith('//') ? `https:${node}` : node)
    return
  }
  if (Array.isArray(node)) {
    node.slice(0, 8).forEach((item) => walkValues(item, depth + 1, strings))
    return
  }
  if (typeof node === 'object') Object.values(node).forEach((value) => walkValues(value, depth + 1, strings))
}

function pickTitle(strings) {
  const banned = /登录|验证码|风险|选品广场|立即|佣金|加入选品|查看详情|未命名|达人工作台/
  const texts = strings.filter((item) => {
    const text = String(item || '').trim()
    return text.length >= 4 && text.length <= 80 && /[\u4e00-\u9fff]/.test(text) && !banned.test(text) && !/^https?:/.test(text)
  })
  texts.sort((a, b) => b.length - a.length)
  return texts[0] || ''
}

function pickImage(strings) {
  const urls = strings.filter((item) => /^https?:\/\//.test(item) && /ecombdimg|byteimg|pstatp|bytecdn|alicdn|\/obj\/|\.(jpg|jpeg|png|webp)(\?|$)/i.test(item))
  urls.sort((a, b) => b.length - a.length)
  return (urls[0] || '').slice(0, 800)
}

function coerceNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return coerceNumber(raw.amount ?? raw.value ?? raw.num ?? raw.price ?? raw.ratio ?? raw.cos_ratio ?? raw.min ?? raw.max ?? 0)
  }
  if (typeof raw !== 'string') return 0
  const text = raw.replace(/[^\d.]/g, '')
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function pickNumber(node, names, depth = 0) {
  if (!node || depth > 6 || typeof node !== 'object') return 0
  if (!Array.isArray(node)) {
    for (const name of names) {
      const value = coerceNumber(node[name])
      if (value > 0) return value
      // 嵌套 { amount: 8990 } / { value: 20 }
      const nested = node[name]
      if (nested && typeof nested === 'object') {
        const deep = coerceNumber(nested.amount ?? nested.value ?? nested.num ?? nested.price ?? nested.ratio)
        if (deep > 0) return deep
      }
    }
  }
  const list = Array.isArray(node) ? node : Object.values(node)
  for (const value of list) {
    if (value && typeof value === 'object') {
      const found = pickNumber(value, names, depth + 1)
      if (found) return found
    }
  }
  return 0
}

function namedText(node, keys, depth = 0) {
  if (!node || depth > 5 || typeof node !== 'object') return ''
  if (!Array.isArray(node)) {
    for (const key of keys) {
      const value = node[key]
      if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value) && value.length >= 2 && value.length <= 80) return value.trim()
    }
  }
  const list = Array.isArray(node) ? node : Object.values(node)
  for (const value of list) {
    if (value && typeof value === 'object') {
      const found = namedText(value, keys, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function imageUrl(value) {
  if (typeof value !== 'string') return ''
  const url = value.startsWith('//') ? `https:${value}` : value
  if (!/^https?:\/\//.test(url) || !/ecombdimg|byteimg|pstatp|bytecdn|alicdn|\/obj\/|\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return ''
  const size = url.match(/www(\d+)-(\d+)/i)
  if (size && Number(size[1]) < 200 && Number(size[2]) < 200) return ''
  return url.slice(0, 800)
}

function collectImages(node, depth = 0, list = [], seen = new Set()) {
  if (!node || depth > 6 || list.length >= 6) return list
  if (typeof node === 'string') {
    const url = imageUrl(node)
    const key = url.split('?')[0]
    if (url && !seen.has(key)) {
      seen.add(key)
      list.push(url)
    }
    return list
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectImages(item, depth + 1, list, seen))
    return list
  }
  if (typeof node === 'object') Object.values(node).forEach((value) => collectImages(value, depth + 1, list, seen))
  return list
}

function namedImage(node, depth = 0) {
  if (!node || depth > 5) return ''
  if (typeof node === 'string') {
    const url = node.startsWith('//') ? `https:${node}` : node
    return /^https?:\/\//.test(url) && /ecombdimg|byteimg|pstatp|bytecdn|alicdn|\/obj\/|\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) ? url.slice(0, 800) : ''
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = namedImage(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  const preferred = ['cover', 'img', 'image', 'pic', 'main_img', 'white_image', 'img_url', 'elastic_img', 'url_list', 'url']
  for (const key of preferred) {
    if (node[key]) {
      const found = namedImage(node[key], depth + 1)
      if (found) return found
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = namedImage(value, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function padTime(value) {
  return String(value).padStart(2, '0')
}

function clockText(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} ${padTime(date.getHours())}:${padTime(date.getMinutes())}`
}

function timeText(input) {
  if (input == null || input === '') return ''
  if (typeof input === 'number' || /^\d{10,13}$/.test(String(input))) {
    const raw = Number(input)
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : 0
    return ms ? clockText(new Date(ms)) : ''
  }
  if (typeof input === 'string') {
    const text = input.trim().replace('T', ' ').replace(/\//g, '-')
    const matched = text.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/)
    if (!matched) return ''
    const [year, month, day] = matched[1].split('-')
    const date = `${year}-${padTime(month)}-${padTime(day)}`
    return matched[2] ? `${date} ${matched[2]}` : date
  }
  if (typeof input === 'object') {
    const raw = input.date ?? input.stat_date ?? input.day ?? input.date_time ?? input.datetime ?? input.time ?? input.x ?? input.ts ?? input.timestamp ?? input.date_str
    return timeText(raw)
  }
  return ''
}

function pointValue(item) {
  if (typeof item === 'number') return Number.isFinite(item) ? item : null
  if (!item || typeof item !== 'object') return null
  const number = Number(item.sale ?? item.sales ?? item.order_num ?? item.order_cnt ?? item.value ?? item.num ?? item.cnt ?? item.y)
  return Number.isFinite(number) ? number : null
}

function asSeries(value, dates) {
  if (!Array.isArray(value) || value.length < 2) return null
  const points = []
  value.forEach((item, index) => {
    const number = pointValue(item)
    if (number == null) return
    const time = timeText(item) || timeText(Array.isArray(dates) ? dates[index] : '')
    points.push({ value: number, time })
  })
  return points.length >= 2 ? points.slice(-30) : null
}

function zipAxes(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null
  const dates = node.date_list || node.dateList || node.dates || node.x_axis || node.xAxis || node.axis || node.time_list || node.times
  const values = node.sale_list || node.sales_list || node.order_list || node.values || node.y_axis || node.yAxis || node.list || node.points || node.data
  if (!Array.isArray(values)) return null
  return asSeries(values, dates)
}

function seriesFrom(value) {
  if (Array.isArray(value)) return asSeries(value)
  if (value && typeof value === 'object') return zipAxes(value) || asSeries(value.list || value.points || value.data)
  return null
}

function pickTrend(node, depth = 0) {
  if (!node || depth > 5 || typeof node !== 'object' || Array.isArray(node)) return []
  const zipped = zipAxes(node)
  if (zipped) return zipped
  for (const [key, value] of Object.entries(node)) {
    if (/trend|curve|sale_list|day_sale|order_cnt|axis/i.test(key)) {
      const series = seriesFrom(value)
      if (series) return series
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = pickTrend(value, depth + 1)
      if (found.length) return found
    }
  }
  return []
}

function isShopName(text) {
  const value = String(text || '').trim()
  return value.length >= 2 && value.length <= 24 && /店$/.test(value)
}

function isPromoText(text) {
  const value = String(text || '').trim()
  if (!value || value.length > 16) return false
  return /包邮|免邮|满减|优惠券|立减|\d{1,4}\s*减\s*\d{1,4}/.test(value)
}

function collectTags(node, depth = 0, tags = [], seen = new Set()) {
  if (!node || depth > 5 || tags.length >= 8) return tags
  if (typeof node === 'string') {
    const text = node.trim()
    if (isPromoText(text) && !seen.has(text)) {
      seen.add(text)
      tags.push(text)
    }
    return tags
  }
  if (Array.isArray(node)) {
    node.slice(0, 20).forEach((item) => collectTags(item, depth + 1, tags, seen))
    return tags
  }
  if (typeof node === 'object') Object.values(node).forEach((value) => collectTags(value, depth + 1, tags, seen))
  return tags
}

function mapNode(node, index) {
  const strings = []
  walkValues(node, 0, strings)
  const title = namedText(node, ['title', 'name', 'product_name', 'elastic_title', 'goods_name']) || pickTitle(strings)
  if (!title) return null
  const images = collectImages(node)
  const trend = pickTrend(node)
  const tags = collectTags(node)
  const namedCategory = namedText(node, ['category_name', 'first_cname', 'second_cname', 'leaf_cname', 'cate_name', 'first_category_name', 'industry_name', 'cid_name'])
  const priceRaw = pickNumber(node, [
    'discount_price', 'min_price', 'price', 'market_price', 'coupon_price', 'actual_price',
    'sku_min_price', 'good_price', 'origin_amount', 'model_price', 'activity_price',
    'promotion_price', 'final_price', 'sale_price', 'price_value', 'amount'
  ])
  const rateRaw = pickNumber(node, [
    'cos_ratio', 'cos_ratio_str', 'commission_rate', 'commission', 'estimated_cos_ratio',
    'cos_fee_rate', 'cos_fee', 'estimated_commission', 'commission_rate_str', 'cosRatio'
  ])
  const sales = pickNumber(node, [
    'sell_num', 'sales', 'monthly_sale', 'sell_num_30d', 'order_num', 'month_sale_num',
    'sale_count', 'volume', 'sold_count', 'sales_volume', 'month_sell_num', 'sale_num'
  ])
  // 分→元：仅当数值像「分」（≥1000）才除；100~999 按元保留，避免 150 元被当成 1.5
  const price = priceRaw >= 1000 ? Math.round(priceRaw) / 100 : priceRaw
  const rate = rateRaw >= 1000 ? Math.round(rateRaw) / 100
    : (rateRaw > 0 && rateRaw < 1 ? Math.round(rateRaw * 10000) / 100 : (rateRaw > 100 ? rateRaw / 100 : rateRaw))
  return {
    id: ownProductId(node),
    title,
    price,
    rate,
    category: (namedCategory && !isPromoText(namedCategory) && !isShopName(namedCategory) ? namedCategory : '')
      || pickTitle(strings.filter((item) => item !== title && String(item).length <= 8 && !isPromoText(item) && !isShopName(item)))
      || '未分类',
    tags,
    freeShipping: tags.some((tag) => /包邮|免邮/.test(tag)),
    coupon: tags.find((tag) => !/包邮|免邮/.test(tag)) || '',
    shop: strings.find((item) => isShopName(item) && item !== title) || '抖音',
    source: '已登录账号',
    monthlySales: sales > 1000000 ? 0 : sales,
    external: true,
    scriptReady: false,
    hue: (index * 37) % 360,
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    image: images[0] || namedImage(node) || pickImage(strings),
    images,
    trend
  }
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function mapCartCard(card, index) {
  const base = card.base_product_info || {}
  const biz = card.business_operation_info || {}
  const shop = card.base_shop_info || {}
  const priceRaw = coerceNumber(
    base.price ?? base.discount_price ?? base.min_price ?? base.model_price ?? base.activity_price
    ?? card.price ?? card.discount_price ?? card.min_price ?? 0
  )
  const rateRaw = coerceNumber(
    biz.cos_ratio ?? biz.cos_ratio_str ?? biz.commission_rate ?? biz.estimated_cos_ratio
    ?? card.cos_ratio ?? card.cos_ratio_str ?? card.commission_rate ?? 0
  )
  const cover = imageUrl(typeof base.cover === 'string' ? base.cover : '')
    || imageUrl(typeof card.cover === 'string' ? card.cover : '')
    || namedImage(base)
    || namedImage(card)
  const extra = collectImages(card)
  const fromBase = collectImages(base)
  const images = [...new Set([cover, ...extra, ...fromBase].filter(Boolean))].slice(0, 6)
  const title = base.title || base.product_name || base.elastic_title || base.name
    || card.title || card.product_name || card.name || '未命名商品'
  const category = namedText(card, ['category_name', 'first_cname', 'second_cname', 'leaf_cname', 'cate_name', 'first_category_name'])
    || namedText(base, ['category_name', 'first_cname', 'second_cname', 'leaf_cname', 'cate_name'])
    || '选品车'
  const salesRaw = coerceNumber(
    biz.monthly_sale ?? biz.sell_num ?? biz.sell_num_30d ?? biz.order_num ?? biz.month_sell_num
    ?? card.sell_num ?? card.monthly_sale ?? card.sales ?? 0
  )
  return {
    id: String(card.product_id || base.product_id || card.product_id_str || base.product_id_str || ''),
    title,
    price: priceRaw >= 1000 ? Math.round(priceRaw) / 100 : priceRaw,
    rate: rateRaw >= 1000 ? Math.round(rateRaw) / 100
      : (rateRaw > 0 && rateRaw < 1 ? Math.round(rateRaw * 10000) / 100 : (rateRaw > 100 ? rateRaw / 100 : rateRaw)),
    category,
    shop: shop.shop_name || '抖音',
    source: '选品车',
    monthlySales: salesRaw > 1000000 ? 0 : salesRaw,
    external: true,
    scriptReady: false,
    hue: (index * 37) % 360,
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    image: images[0] || '',
    images,
    link: `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${card.product_id || base.product_id || ''}`
  }
}

function readProducts(json) {
  const views = json?.data?.cart_view_card
  if (Array.isArray(views)) {
    const rows = []
    views.forEach((view) => {
      ;(view?.cards || []).forEach((card) => {
        if (card?.product_card) rows.push(mapCartCard(card.product_card, rows.length))
      })
    })
    if (rows.some((item) => item.image && item.title && item.title !== '未命名商品')) return rows.filter((item) => item.id && item.title)
  }
  const rows = []
  const seen = new Set()
  function visit(node, depth) {
    if (!node || depth > 8) return
    if (typeof node === 'string') {
      if (node.includes('product_id') && node.length > 40) {
        try { visit(JSON.parse(node), depth + 1) } catch { /* 不是商品 JSON */ }
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1))
      return
    }
    if (typeof node !== 'object') return
    const id = ownProductId(node)
    if (id && !seen.has(id)) {
      const mapped = mapNode(node, rows.length)
      if (mapped?.title) {
        seen.add(id)
        rows.push(mapped)
      }
    }
    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') visit(value, depth + 1)
    })
  }
  visit(json, 0)
  return rows.filter((item) => item.id && item.title && item.title !== '未命名商品')
}

function requestJson(partition, url, { method = 'GET', body, referer } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const ses = session.fromPartition(partition)
      const req = net.request({
        url,
        method,
        session: ses,
        useSessionCookies: true
      })
      req.setHeader('Accept', 'application/json, text/plain, */*')
      req.setHeader('Referer', referer)
      req.setHeader('Origin', new URL(referer).origin)
      req.setHeader('User-Agent', CHROME_UA)
      if (body) req.setHeader('Content-Type', 'application/json')
      const timer = setTimeout(() => {
        try { req.abort() } catch { /* 已结束 */ }
        finish(null)
      }, 15000)
      const chunks = []
      req.on('response', (res) => {
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          clearTimeout(timer)
          const text = Buffer.concat(chunks).toString('utf8')
          try { finish(JSON.parse(text)) } catch { finish(null) }
        })
      })
      req.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      if (body) req.write(JSON.stringify(body))
      req.end()
    } catch {
      finish(null)
    }
  })
}

const WORKBENCH = {
  products: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart',
  plaza: 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
}

async function listSelected(partition) {
  const referer = WORKBENCH.products
  const urls = [
    'https://buyin.jinritemai.com/pc/selection_cart/list',
    'https://buyin.jinritemai.com/pc/selection_cart/get_list',
    'https://buyin.jinritemai.com/pc/selection/cart/list',
    'https://buyin.jinritemai.com/square_pc_api/selection_cart/list',
    'https://buyin.jinritemai.com/pc/selection/window/list'
  ]
  for (const url of urls) {
    const gathered = []
    const seen = new Set()
    for (let page = 1; page <= 5; page += 1) {
      const json = await requestJson(partition, url, {
        method: 'POST',
        referer,
        body: { page, page_no: page, page_size: 50, size: 50 }
      })
      const list = readProducts(json).map((item) => ({ ...item, source: '达人选品', category: item.category || '达人选品' }))
      list.forEach((item) => {
        if (seen.has(item.id)) return
        seen.add(item.id)
        gathered.push(item)
      })
      if (list.length < 20) break
    }
    if (gathered.length) return gathered
  }
  return []
}

async function listPlaza(partition) {
  const referer = WORKBENCH.plaza
  const urls = [
    'https://buyin.jinritemai.com/pc/selection/common/material_list',
    'https://buyin.jinritemai.com/square_pc_api/pc/selection/common/material_list'
  ]
  const scenes = ['PCSquareFeed', 'PCSquareSearch']
  for (const url of urls) {
    for (const scene of scenes) {
      const gathered = []
      const seen = new Set()
      let cursor = 0
      for (let page = 0; page < 4; page += 1) {
        const json = await requestJson(partition, url, {
          method: 'POST',
          referer,
          body: { cursor, size: 30, scene, search_text: '', extra: {}, page: page + 1, page_size: 30 }
        })
        const list = readProducts(json).map((item) => ({ ...item, source: '选品广场' }))
        list.forEach((item) => {
          if (seen.has(item.id)) return
          seen.add(item.id)
          gathered.push(item)
        })
        if (!list.length) break
        const next = Number(json?.data?.cursor ?? json?.data?.next_cursor)
        if (!json?.data?.has_more) break
        cursor = Number.isFinite(next) && next !== cursor ? next : cursor + list.length
      }
      if (gathered.length) return gathered
    }
  }
  return []
}

function pageLimitOf(value) {
  const text = String(value ?? '').trim()
  if (!text) return 0
  const number = Math.floor(Number(text))
  return number > 0 ? number : 0
}

async function capture(accountId, target = 'products', options = {}) {
  const page = target === 'plaza' ? 'plaza' : 'products'
  const label = page === 'plaza' ? '选品广场' : '达人选品'
  if (!accountId) return { ok: false, loggedIn: false, products: [], message: '先选定一个抖音发布账号' }
  const partition = partitionOf(accountId)
  const cookies = await session.fromPartition(partition).cookies.get({})
  const loggedIn = browserSession.loggedIn(cookies, 'publish')
  const logs = ['检查账号登录']
  if (!loggedIn) {
    logs.push('这个账号还没有登录，停止同步')
    return { ok: false, loggedIn: false, products: [], logs, message: '这个账号还没有登录。登录达人工作台一次后，再同步就会把商品拉进软件。' }
  }
  logs.push('登录还在，开始同步' + label)
  const shopName = ''
  let products = []
  try {
    const seenLive = new Set()
    let emptyStreak = 0
    const collected = await browserSession.collectProducts({
      id: accountId,
      target: page,
      pageLimit: page === 'plaza' ? pageLimitOf(options.pageLimit) : 0,
      onPage: async (text) => {
        let json = null
        try { json = JSON.parse(text) } catch { json = null }
        const batch = []
        readProducts(json).forEach((item) => {
          if (!item.id || seenLive.has(item.id)) return
          seenLive.add(item.id)
          batch.push({
            ...item,
            source: page === 'plaza' ? '选品广场' : '达人选品',
            category: page === 'plaza' ? (item.category || '选品广场') : (item.category || '达人选品')
          })
        })
        if (!batch.length) {
          emptyStreak += 1
          return emptyStreak >= 3 ? 'stop' : ''
        }
        emptyStreak = 0
        if (options.onProducts) await options.onProducts(batch)
        return ''
      }
    })
    ;(collected.logs || []).forEach((line) => logs.push(line))
    const seen = new Set()
    ;(collected.texts || []).forEach((blob) => {
      let json = null
      try { json = JSON.parse(blob) } catch { json = null }
      readProducts(json).forEach((item) => {
        if (!item.id || seen.has(item.id)) return
        seen.add(item.id)
        products.push({
          ...item,
          source: page === 'plaza' ? '选品广场' : '达人选品',
          category: page === 'plaza' ? (item.category || '选品广场') : (item.category || '达人选品')
        })
      })
    })
    const named = products.filter((item) => item.title && item.title !== '未命名商品').length
    const pictured = products.filter((item) => item.image).length
    logs.push(products.length ? `解析出 ${products.length} 件商品，名称 ${named} 件，图片 ${pictured} 件` : '没有解析出商品')
    if (products[0]) logs.push(`第一条：${products[0].title}${products[0].image ? '，图片已同步' : '，图片没解析出来'}`)
  } catch (error) {
    logs.push(`同步中断：${error.message || '未知错误'}`)
    products = []
  }
  return {
    ok: products.length > 0,
    loggedIn: true,
    appKey: '',
    appSecret: '',
    accessToken: '',
    shopId: '',
    shopName,
    products,
    logs,
    message: products.length
      ? `已把 ${products.length} 件${label}同步进软件`
      : `登录还在，这次接口没有给出可入库的商品。已经同步过的会继续留在软件里。`
  }
}

function productIdFrom(text) {
  const raw = String(text || '').trim()
  const query = raw.match(/(?:id|product_id|promotion_id|goods_id)=(\d{6,})/i)
  if (query) return query[1]
  if (/^\d{8,}$/.test(raw)) return raw
  const digits = raw.match(/(\d{10,})/)
  return digits ? digits[1] : ''
}

function requestText(partition, url, referer) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const ses = session.fromPartition(partition)
      const req = net.request({ url, method: 'GET', session: ses, useSessionCookies: true })
      req.setHeader('Accept', 'text/html,application/json;q=0.9,*/*;q=0.8')
      req.setHeader('Referer', referer)
      req.setHeader('User-Agent', CHROME_UA)
      const timer = setTimeout(() => {
        try { req.abort() } catch { /* 已结束 */ }
        finish('')
      }, 15000)
      const chunks = []
      req.on('response', (res) => {
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          clearTimeout(timer)
          finish(Buffer.concat(chunks).toString('utf8'))
        })
      })
      req.on('error', () => {
        clearTimeout(timer)
        finish('')
      })
      req.end()
    } catch {
      finish('')
    }
  })
}

function isRealTitle(product) {
  const title = String(product?.title || '').trim()
  const id = String(product?.id || '')
  if (!title || title === '未命名商品') return false
  if (id && (title === id || title === `商品 ${id}` || title === `导入商品 ${id}`)) return false
  if (/^商品\s*\d{8,}$/.test(title) || /^导入商品\s*\d{8,}$/.test(title)) return false
  return true
}

function normalizeLooked(product, id, link) {
  if (!product) return null
  const images = [...new Set([...(product.images || []), product.image]
    .map((item) => imageUrl(String(item || '')) || String(item || '').trim())
    .filter((item) => /^https?:\/\//.test(item)))]
  const title = String(product.title || '').trim()
  if (!title || title === '未命名商品') return null
  const priceRaw = Number(product.price) || 0
  const rateRaw = Number(product.rate) || 0
  const salesRaw = Number(product.monthlySales) || 0
  return {
    ...product,
    id: String(product.id || id),
    title,
    image: images[0] || '',
    images: images.slice(0, 6),
    price: priceRaw >= 1000 ? Math.round(priceRaw) / 100 : priceRaw,
    rate: rateRaw >= 1000 ? Math.round(rateRaw) / 100 : (rateRaw > 0 && rateRaw < 1 ? Math.round(rateRaw * 10000) / 100 : (rateRaw > 100 ? rateRaw / 100 : rateRaw)),
    category: product.category || '链接导入',
    shop: product.shop || '抖音',
    link: String(link || product.link || `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${id}`),
    monthlySales: salesRaw > 1000000 ? 0 : salesRaw
  }
}

function mergeNormalized(base, extra) {
  if (!base) return extra || null
  if (!extra) return base
  const images = [...new Set([...(base.images || []), base.image, ...(extra.images || []), extra.image]
    .map((item) => String(item || '').trim())
    .filter((item) => /^https?:\/\//.test(item)))].slice(0, 6)
  const category = [extra.category, base.category].find((item) => item && !['链接导入', '未分类', '选品广场'].includes(item))
    || extra.category || base.category || '链接导入'
  return {
    ...base,
    ...extra,
    title: isRealTitle(extra) ? extra.title : base.title,
    price: Number(extra.price) > 0 ? Number(extra.price) : Number(base.price) || 0,
    rate: Number(extra.rate) > 0 ? Number(extra.rate) : Number(base.rate) || 0,
    monthlySales: Number(extra.monthlySales) > 0 ? Number(extra.monthlySales) : Number(base.monthlySales) || 0,
    category,
    shop: (extra.shop && extra.shop !== '待补充' ? extra.shop : '') || base.shop || '抖音',
    images,
    image: images[0] || '',
    link: extra.link || base.link
  }
}

function isCompleteProduct(product) {
  return Boolean(isRealTitle(product) && (product.image || product.images?.length))
}

async function lookup({ accountId, link, name, login, mode }) {
  const id = productIdFrom(link)
  if (!id) return { ok: false, message: '链接里没有商品编号' }
  const partition = accountId ? partitionOf(accountId) : 'persist:huang-publish-guest'
  const detailLink = String(link || '').startsWith('http')
    ? String(link)
    : `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${id}&origin_type=604`
  let partial = null
  const take = (normalized, source) => {
    if (!normalized || !isRealTitle(normalized)) return
    const withSource = { ...normalized, source: normalized.source || source }
    partial = mergeNormalized(partial, withSource)
  }

  // 1) 已登录账号的选品车接口里按编号找（主路径：不弹窗）
  try {
    const cart = await listSelected(partition)
    const hit = cart.find((row) => String(row.id) === String(id))
    take(normalizeLooked(hit, id, detailLink), '选品车')
  } catch { /* 未登录或接口改版 */ }

  // 1b) 带 search_text / product_id 再问一遍选品车
  try {
    const cartUrls = [
      'https://buyin.jinritemai.com/pc/selection_cart/list',
      'https://buyin.jinritemai.com/pc/selection_cart/get_list',
      'https://buyin.jinritemai.com/pc/selection/cart/list',
      'https://buyin.jinritemai.com/square_pc_api/selection_cart/list'
    ]
    for (const url of cartUrls) {
      for (const body of [
        { page: 1, page_no: 1, page_size: 50, size: 50, search_text: id, product_id: id },
        { page: 1, page_no: 1, page_size: 50, size: 50, keyword: id }
      ]) {
        const json = await requestJson(partition, url, { method: 'POST', referer: WORKBENCH.products, body })
        const rows = json ? readProducts(json) : []
        const found = rows.find((row) => String(row.id) === String(id)) || rows[0]
        take(normalizeLooked(found, id, detailLink), '选品车')
      }
    }
  } catch { /* ignore */ }

  // 2) 百应详情接口（仍用账号 cookie，不开窗）
  const tries = [
    {
      url: `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?product_id=${id}`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
    },
    {
      url: `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?promotion_id=${id}`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
    },
    {
      url: `https://buyin.jinritemai.com/pc/selection/decision/product_detail?product_id=${id}`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
    },
    {
      url: `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?id=${id}&enter_from=selection_cart`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
    },
    {
      url: `https://buyin.jinritemai.com/pc/selection/common/material_detail?product_id=${id}`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
    },
    {
      url: `https://buyin.jinritemai.com/square_pc_api/selection/decision/pack_detail?product_id=${id}`,
      referer: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
    }
  ]
  for (const item of tries) {
    const json = await requestJson(partition, item.url, { referer: item.referer })
    const rows = json ? readProducts(json) : []
    const found = rows.find((row) => String(row.id) === String(id)) || rows[0]
    take(normalizeLooked(found, id, detailLink), '百应详情')
  }

  // 3) 广场搜索这个编号
  try {
    const plazaUrls = [
      'https://buyin.jinritemai.com/pc/selection/common/material_list',
      'https://buyin.jinritemai.com/square_pc_api/pc/selection/common/material_list'
    ]
    for (const url of plazaUrls) {
      const json = await requestJson(partition, url, {
        method: 'POST',
        referer: WORKBENCH.plaza,
        body: { cursor: 0, size: 20, scene: 'PCSquareSearch', search_text: id, extra: {}, page: 1, page_size: 20 }
      })
      const rows = json ? readProducts(json) : []
      const found = rows.find((row) => String(row.id) === String(id)) || rows[0]
      take(normalizeLooked(found, id, detailLink), '选品广场')
    }
  } catch { /* 搜索失败继续 */ }

  // 4) 仍缺字段：后台静默窗只打百应选品车会话（不打开 haohuo 消费者页、不显示窗口）
  const needSilent = !partial
    || !isRealTitle(partial)
    || !(Number(partial.price) > 0)
    || !(Number(partial.rate) > 0)
    || !(partial.images || []).length
  if (accountId && needSilent) {
    try {
      const scraped = await browserSession.scrapeProductById({
        id: accountId,
        name: name || '发布账号',
        login: login || '',
        mode: mode || 'password',
        productId: id
      })
      take(normalizeLooked(scraped, id, detailLink), scraped?.source || '选品车静默')
    } catch { /* 抓取失败继续 */ }
  }

  if (partial && isRealTitle(partial)) {
    const missing = []
    if (!(partial.images || []).length && !partial.image) missing.push('图片')
    if (!(Number(partial.price) > 0)) missing.push('价格')
    if (!(Number(partial.rate) > 0)) missing.push('佣金')
    if (!partial.category || ['链接导入', '未分类'].includes(partial.category)) missing.push('类目')
    if (!(Number(partial.monthlySales) > 0)) missing.push('销量')
    return {
      ok: true,
      product: partial,
      message: missing.length ? `已入库，但仍缺：${missing.join('、')}。请先登录百应并同步选品车补全` : ''
    }
  }
  return {
    ok: false,
    product: { id, title: `商品 ${id}`, link: detailLink, price: 0, rate: 0, category: '链接导入', shop: '抖音', image: '', images: [] },
    message: '没有从百应选品车/广场拉到商品。请先用发布账号登录达人工作台，把商品加入选品车后再导入 ID（采集不会打开商品 H5 页）'
  }
}

module.exports = { capture, lookup }
