const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')

let filePath = ''

function init(userData) {
  filePath = path.join(userData, 'huang-secrets.json')
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
}

function encrypt(text) {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(String(text)).toString('base64')
  return Buffer.from(String(text), 'utf8').toString('base64')
}

function decrypt(payload) {
  if (!payload) return ''
  if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  return Buffer.from(payload, 'base64').toString('utf8')
}

function save(id, login, password) {
  const data = readAll()
  data[id] = { login: String(login || ''), password: encrypt(password || '') }
  writeAll(data)
}

function read(id) {
  const item = readAll()[id]
  if (!item) return null
  return { login: item.login, password: decrypt(item.password) }
}

function remove(id) {
  const data = readAll()
  delete data[id]
  writeAll(data)
}

module.exports = { init, save, read, remove }
