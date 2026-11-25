const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let crc = n
    for (let i = 0; i < 8; i += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    table[n] = crc >>> 0
  }
  return table
})()

function crc32(data) {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function xmlUnescape(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function columnName(index) {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = (Array.isArray(row) ? row : [row]).map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function workbookFiles(rows) {
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="导入" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml(rows),
  }
}

function u16(view, offset, value) { view.setUint16(offset, value, true) }
function u32(view, offset, value) { view.setUint32(offset, value, true) }

export function buildXlsx(rows) {
  const encoder = new TextEncoder()
  const files = Object.entries(workbookFiles(rows)).map(([name, text]) => ({
    name: encoder.encode(name),
    data: encoder.encode(text),
  }))
  files.forEach((file) => { file.crc = crc32(file.data) })
  let size = 22
  files.forEach((file) => { size += 30 + file.name.length + file.data.length + 46 + file.name.length })
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let offset = 0
  const locals = []
  files.forEach((file) => {
    locals.push(offset)
    u32(view, offset, 0x04034b50)
    u16(view, offset + 4, 20)
    u16(view, offset + 6, 0)
    u16(view, offset + 8, 0)
    u16(view, offset + 10, 0)
    u16(view, offset + 12, 0)
    u32(view, offset + 14, file.crc)
    u32(view, offset + 18, file.data.length)
    u32(view, offset + 22, file.data.length)
    u16(view, offset + 26, file.name.length)
    u16(view, offset + 28, 0)
    out.set(file.name, offset + 30)
    out.set(file.data, offset + 30 + file.name.length)
    offset += 30 + file.name.length + file.data.length
  })
  const centralStart = offset
  files.forEach((file, index) => {
    u32(view, offset, 0x02014b50)
    u16(view, offset + 4, 20)
    u16(view, offset + 6, 20)
    u16(view, offset + 8, 0)
    u16(view, offset + 10, 0)
    u16(view, offset + 12, 0)
    u16(view, offset + 14, 0)
    u32(view, offset + 16, file.crc)
    u32(view, offset + 20, file.data.length)
    u32(view, offset + 24, file.data.length)
    u16(view, offset + 28, file.name.length)
    u16(view, offset + 30, 0)
    u16(view, offset + 32, 0)
    u16(view, offset + 34, 0)
    u16(view, offset + 36, 0)
    u32(view, offset + 38, 0)
    u32(view, offset + 42, locals[index])
    out.set(file.name, offset + 46)
    offset += 46 + file.name.length
  })
  const centralSize = offset - centralStart
  u32(view, offset, 0x06054b50)
  u16(view, offset + 4, 0)
  u16(view, offset + 6, 0)
  u16(view, offset + 8, files.length)
  u16(view, offset + 10, files.length)
  u32(view, offset + 12, centralSize)
  u32(view, offset + 16, centralStart)
  u16(view, offset + 20, 0)
  return out
}

async function inflateRaw(data) {
  const stream = new DecompressionStream('deflate-raw')
  const response = new Response(new Blob([data]).stream().pipeThrough(stream))
  return new Uint8Array(await response.arrayBuffer())
}

function findEocd(bytes) {
  const start = Math.max(0, bytes.length - 22 - 65535)
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i
  }
  return -1
}

export async function readXlsxTexts(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new Error('不是 xlsx')
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const files = {}
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break
    const method = view.getUint16(cursor + 10, true)
    const compSize = view.getUint32(cursor + 20, true)
    const nameLen = view.getUint16(cursor + 28, true)
    const extraLen = view.getUint16(cursor + 30, true)
    const commentLen = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen))
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const packed = bytes.subarray(dataStart, dataStart + compSize)
    const raw = method === 0 ? packed : method === 8 ? await inflateRaw(packed) : new Uint8Array()
    files[name.replace(/\\/g, '/')] = decoder.decode(raw)
    cursor += 46 + nameLen + extraLen + commentLen
  }
  const texts = []
  Object.entries(files).forEach(([name, xml]) => {
    if (!/sharedStrings\.xml$|worksheets\/sheet\d+\.xml$/.test(name)) return
    const matches = xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>|<v>([\s\S]*?)<\/v>/g)
    for (const match of matches) texts.push(xmlUnescape(match[1] ?? match[2] ?? ''))
  })
  return texts
}
