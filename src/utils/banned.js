const DEFAULT_BANNED = [
  '第一', '最牛', '最好', '最佳', '最强', '最低价', '最便宜', '唯一', '顶级', '极致', '万能', '史无前例', '国家级', '世界级', '绝对', '百分百', '100%', '百分之百',
  '根治', '治愈', '治疗', '疗效', '药效', '祖传', '药到病除', '包治', '专治', '抗癌', '防癌',
  '稳赚', '必赚', '躺赚', '保证赚钱', '无效退款', '包过',
  '不转不是中国人', '不买后悔',
  '加微信', '加我微信', '加V', '加v', '微信', 'VX', 'vx', '私信我', '扣群', 'QQ群', '淘口令', '复制口令', '小黄车', '点链接', '拍链接', '领链接'
]

export function defaultBannedWords() {
  return [...DEFAULT_BANNED]
}

export function bannedWords(extra = []) {
  const custom = Array.isArray(extra) ? extra : String(extra || '').split(/[\n,，]/)
  const list = [...new Set(custom.map((item) => String(item || '').trim()).filter(Boolean))]
  return list.length ? list : [...DEFAULT_BANNED]
}

export function cleanTitle(title, extra = []) {
  let text = String(title || '')
  const hits = []
  bannedWords(extra).slice().sort((a, b) => b.length - a.length).forEach((word) => {
    if (!word || !text.includes(word)) return
    hits.push(word)
    text = text.split(word).join('')
  })
  text = text.replace(/\s{2,}/g, ' ').replace(/[【】\[\]()（）]{2,}/g, '').trim()
  return { title: text || String(title || '').trim(), hits, changed: hits.length > 0 }
}

/** 入库前：去违禁词，并判断是不是「商品+ID」这类占位标题 */
export function sanitizeProductTitle(title, id = '', extra = []) {
  const raw = String(title || '').trim()
  const cleaned = cleanTitle(raw, extra)
  const text = cleaned.title
  const idText = String(id || '').trim()
  const isPlaceholder = !text
    || (idText && (text === idText || text === `商品 ${idText}` || text === `导入商品 ${idText}`))
    || /^商品\s*\d{8,}$/.test(text)
    || /^导入商品\s*\d{8,}$/.test(text)
  return {
    title: text,
    rawTitle: cleaned.changed ? raw : '',
    bannedHits: cleaned.hits,
    changed: cleaned.changed,
    isPlaceholder
  }
}
