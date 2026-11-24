const crypto = require('crypto')

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hashed = crypto.scryptSync(String(password), salt, 32).toString('hex')
  return { salt, hashed }
}

function checkPassword(password, user) {
  const next = hashPassword(password, user.salt)
  const left = Buffer.from(next.hashed, 'hex')
  const right = Buffer.from(user.passwordHash, 'hex')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function ensureDesktop(db) {
  let user = db.users.find((item) => item.username === 'local')
  if (user) return user
  const { salt, hashed } = hashPassword('huang-local-desktop')
  user = {
    id: 'Ulocal',
    username: 'local',
    passwordHash: hashed,
    salt,
    createdAt: new Date().toISOString()
  }
  db.users.push(user)
  return user
}

function enter(db) {
  const user = ensureDesktop(db)
  if (!user.status) user.status = '正常'
  if (user.status === '停用') return { ok: false, message: '这个账号已停用，请让管理员改回正常' }
  const token = crypto.randomBytes(24).toString('hex')
  db.sessions[token] = user.id
  return { ok: true, token, user: { id: user.id, username: user.username, status: user.status } }
}

function ensureAdmin(db) {
  if (db.users.some((item) => item.username === 'admin')) return false
  const { salt, hashed } = hashPassword('admin')
  db.users.push({
    id: 'Uadmin',
    username: 'admin',
    passwordHash: hashed,
    salt,
    createdAt: new Date().toISOString()
  })
  return true
}

function register(db, username, password) {
  const name = String(username || '').trim()
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{2,20}$/.test(name)) {
    return { ok: false, message: '账号用 2 到 20 位中文、字母、数字或下划线' }
  }
  if (String(password || '').length < 6) return { ok: false, message: '密码至少 6 位' }
  if (name === 'admin') return { ok: false, message: 'admin 是保留账号' }
  if (db.users.some((item) => item.username === name)) return { ok: false, message: '这个账号已经注册过' }
  const { salt, hashed } = hashPassword(password)
  const user = { id: `U${Date.now().toString(36)}`, username: name, passwordHash: hashed, salt, createdAt: new Date().toISOString() }
  db.users.push(user)
  const token = crypto.randomBytes(24).toString('hex')
  db.sessions[token] = user.id
  return { ok: true, token, user: { id: user.id, username: user.username } }
}

function login(db, username, password) {
  const name = String(username || '').trim()
  const user = db.users.find((item) => item.username === name)
  if (!user || !checkPassword(password, user)) return { ok: false, message: '账号或密码不正确' }
  const token = crypto.randomBytes(24).toString('hex')
  db.sessions[token] = user.id
  return { ok: true, token, user: { id: user.id, username: user.username } }
}

function logout(db, token) {
  delete db.sessions[token]
}

module.exports = { register, login, logout, ensureAdmin, enter }
