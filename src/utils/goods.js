export function isPromoText(text) {
  const value = String(text || '').trim()
  if (!value || value.length > 16) return false
  return /包邮|免邮|满减|优惠券|立减|\d{1,4}\s*减\s*\d{1,4}/.test(value)
}

export function isShopName(text) {
  const value = String(text || '').trim()
  return value.length >= 2 && value.length <= 24 && /店$/.test(value)
}

export function goodsShop(item) {
  const shop = String(item?.shop || '').trim()
  const category = String(item?.category || '').trim()
  if (shop && shop !== '抖音') return shop
  if (isShopName(category)) return category
  return shop || '抖音'
}

export function goodsCategory(item) {
  const value = String(item?.category || '').trim()
  if (!value || isPromoText(value) || isShopName(value) || ['选品广场', '达人选品', '选品车', '抖音'].includes(value)) return '未分类'
  return value
}

export function goodsTags(item) {
  const tags = []
  const push = (text) => {
    const value = String(text || '').trim()
    if (!value || !isPromoText(value) || tags.includes(value)) return
    tags.push(value)
  }
  ;(item?.tags || []).forEach(push)
  push(item?.coupon)
  push(item?.category)
  if (item?.freeShipping) push('包邮')
  return tags
}

export function isFreeShipping(item) {
  return Boolean(item?.freeShipping) || goodsTags(item).some((tag) => /包邮|免邮/.test(tag))
}

export function couponTags(item) {
  return goodsTags(item).filter((tag) => !/包邮|免邮/.test(tag))
}
