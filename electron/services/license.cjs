const crypto = require('crypto')

const SECRET = 'huang++pro-license-v1'
const PERMANENT_CODE = 'Hjx@178588'

const PLANS = {
  '1w': { days: 7, label: '一周' },
  '1m': { days: 30, label: '1个月' },
  '1y': { days: 365, label: '1年' },
  '3y': { days: 365 * 3, label: '3年' },
  '5y': { days: 365 * 5, label: '5年' },
  '10y': { days: 365 * 10, label: '10年' }
}

function signBody(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex').slice(0, 12).toUpperCase()
}

function generate(plan) {
  const key = String(plan || '').toLowerCase()
  if (!PLANS[key]) {
    return { ok: false, message: '请选择授权时长' }
  }
  const nonce = crypto.randomBytes(4).toString('hex').toUpperCase()
  const body = `${key}.${nonce}`
  const code = `HP-${key.toUpperCase()}-${nonce}-${signBody(body)}`
  return {
    ok: true,
    code,
    plan: key,
    label: PLANS[key].label,
    days: PLANS[key].days,
    createdAt: new Date().toISOString()
  }
}

function verify(code) {
  const text = String(code || '').trim()
  if (text === PERMANENT_CODE) {
    return { ok: true, permanent: true, plan: 'permanent', label: '永久', days: 0 }
  }
  const matched = text.match(/^HP-(1W|1M|1Y|3Y|5Y|10Y)-([A-F0-9]+)-([A-F0-9]+)$/i)
  if (!matched) return { ok: false, message: '授权码不正确' }
  const plan = matched[1].toLowerCase()
  const nonce = matched[2].toUpperCase()
  const signature = matched[3].toUpperCase()
  if (signBody(`${plan}.${nonce}`) !== signature) return { ok: false, message: '授权码不正确' }
  return { ok: true, permanent: false, plan, label: PLANS[plan].label, days: PLANS[plan].days }
}

function systemNow() {
  return new Date()
}

function applyPlan(plan, now = systemNow()) {
  const clock = now instanceof Date ? now : systemNow()
  const key = String(plan || 'permanent').toLowerCase()
  if (key === 'permanent') {
    return {
      ok: true,
      license: {
        code: PERMANENT_CODE,
        permanent: true,
        plan: 'permanent',
        label: '永久',
        confirmed: true,
        activatedAt: clock.toISOString(),
        expiresAt: null
      },
      systemNow: clock.toISOString()
    }
  }
  if (!PLANS[key]) return { ok: false, message: '请选择有效期' }
  return {
    ok: true,
    license: {
      code: '',
      permanent: false,
      plan: key,
      label: PLANS[key].label,
      confirmed: true,
      activatedAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + PLANS[key].days * 86400000).toISOString()
    },
    systemNow: clock.toISOString()
  }
}

function activate(code, now = systemNow()) {
  const result = verify(code)
  if (!result.ok) return result
  const clock = now instanceof Date ? now : systemNow()
  const license = {
    code: result.permanent ? PERMANENT_CODE : String(code).trim(),
    permanent: result.permanent,
    plan: result.plan,
    label: result.label,
    confirmed: true,
    unlocked: true,
    activatedAt: clock.toISOString(),
    expiresAt: result.permanent ? null : new Date(clock.getTime() + result.days * 86400000).toISOString()
  }
  return { ok: true, license, systemNow: clock.toISOString() }
}

module.exports = { PLANS, PERMANENT_CODE, generate, verify, activate, applyPlan, systemNow }
