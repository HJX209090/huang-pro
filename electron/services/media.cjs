const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error ? error.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error })
    })
  })
}

function which(command) {
  return new Promise((resolve) => {
    execFile('where', [command], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve('')
      const found = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find((line) => line && fs.existsSync(line))
      resolve(found || '')
    })
  })
}

async function ffmpegBin() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH
  const found = await which('ffmpeg')
  if (found) return found
  const candidates = [
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
  ]
  return candidates.find((item) => item && fs.existsSync(item)) || ''
}

async function info() {
  const bin = await ffmpegBin()
  return { ok: Boolean(bin), path: bin, message: bin ? '' : '本机没有找到 ffmpeg。安装后重开软件，去水印和切片才能处理视频。' }
}

async function probe(file) {
  const bin = await ffmpegBin()
  if (!bin) return null
  if (!file || !fs.existsSync(file)) return null
  const result = await run(bin, ['-hide_banner', '-i', file])
  const text = `${result.stdout}\n${result.stderr}`
  const match = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/) || text.match(/(\d{2,5})x(\d{2,5})/)
  if (!match) return { width: 0, height: 0, text: text.slice(0, 500) }
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0
  return { width: Number(match[1]), height: Number(match[2]), seconds, text: text.slice(0, 800) }
}

function even(value) {
  const number = Math.round(Number(value) || 0)
  return number - (number % 2)
}

function textBox(width, height, corner) {
  const wide = corner === 'tl' ? 0.22 : 0.18
  const tall = corner === 'tl' ? 0.055 : 0.045
  const w = Math.max(72, Math.min(even(width * wide), width - 8))
  const h = Math.max(28, Math.min(even(height * tall), height - 8))
  const margin = Math.max(4, even(Math.min(width, height) * 0.012))
  let x = margin
  let y = margin
  if (corner === 'br') {
    x = even(width - w - margin)
    y = even(height - h - margin)
  }
  x = Math.max(2, Math.min(x, width - w - 2))
  y = Math.max(2, Math.min(y, height - h - 2))
  return { x, y, w, h }
}

async function stripWatermark({ file, dir }) {
  const bin = await ffmpegBin()
  if (!bin) return { ok: false, message: '本机没有找到 ffmpeg，装好后才能去掉豆包文字' }
  if (!file || !fs.existsSync(file)) return { ok: false, message: '视频文件不在电脑上' }
  const meta = await probe(file)
  if (!meta?.width || !meta?.height) return { ok: false, message: '没有读出视频宽高' }
  const topLeft = textBox(meta.width, meta.height, 'tl')
  const bottomRight = textBox(meta.width, meta.height, 'br')
  const folder = dir || path.dirname(file)
  fs.mkdirSync(folder, { recursive: true })
  const output = path.join(folder, `${path.basename(file, path.extname(file))}-去水印.mp4`)
  const filter = [
    `delogo=x=${topLeft.x}:y=${topLeft.y}:w=${topLeft.w}:h=${topLeft.h}:show=0`,
    `delogo=x=${bottomRight.x}:y=${bottomRight.y}:w=${bottomRight.w}:h=${bottomRight.h}:show=0`
  ].join(',')
  const result = await run(bin, ['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', output])
  if (!result.ok || !fs.existsSync(output) || fs.statSync(output).size < 1000) {
    return { ok: false, message: '去水印没有完成', detail: result.stderr.slice(-400) }
  }
  return { ok: true, output, topLeft, bottomRight, message: `已去掉左上角和右下角的豆包文字，保存到 ${output}` }
}

function presetLabel(preset) {
  if (preset === 'left-bottom') return '左下角'
  if (preset === 'right-top') return '右上角'
  if (preset === 'left-top') return '左上角'
  return '右下角'
}

async function sliceVideo({ file, seconds, dir }) {
  const bin = await ffmpegBin()
  if (!bin) return { ok: false, message: '本机没有找到 ffmpeg，装好后才能切片' }
  if (!file || !fs.existsSync(file)) return { ok: false, message: '视频文件不在电脑上' }
  const folder = path.join(dir || path.dirname(file), `${path.basename(file, path.extname(file))}-切片`)
  fs.mkdirSync(folder, { recursive: true })
  const pattern = path.join(folder, 'part-%03d.mp4')
  const span = String(Math.max(3, Number(seconds) || 10))
  let result = await run(bin, ['-y', '-i', file, '-c', 'copy', '-map', '0', '-f', 'segment', '-segment_time', span, '-reset_timestamps', '1', pattern])
  let files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.mp4')).map((name) => path.join(folder, name)) : []
  if (!result.ok || files.length < 1) {
    files.forEach((item) => fs.rmSync(item, { force: true }))
    result = await run(bin, ['-y', '-i', file, '-c:v', 'libx264', '-c:a', 'aac', '-f', 'segment', '-segment_time', span, '-reset_timestamps', '1', pattern])
    files = fs.readdirSync(folder).filter((name) => name.endsWith('.mp4')).map((name) => path.join(folder, name))
  }
  if (!files.length) return { ok: false, message: '没有切出片段', detail: result.stderr.slice(-400) }
  return { ok: true, files, dir: folder, message: `已切成 ${files.length} 段` }
}

async function trimVideo({ file, start, end, dir }) {
  const bin = await ffmpegBin()
  if (!bin) return { ok: false, message: '本机没有找到 ffmpeg，装好后才能裁切' }
  if (!file || !fs.existsSync(file)) return { ok: false, message: '视频文件不在电脑上' }
  const folder = dir || path.dirname(file)
  fs.mkdirSync(folder, { recursive: true })
  const output = path.join(folder, `${path.basename(file, path.extname(file))}-裁切.mp4`)
  const args = ['-y', '-ss', String(start || '0'), '-i', file]
  if (end) args.push('-to', String(end))
  args.push('-c:v', 'libx264', '-c:a', 'aac', output)
  const result = await run(bin, args)
  if (!result.ok || !fs.existsSync(output)) return { ok: false, message: '裁切没有完成', detail: result.stderr.slice(-400) }
  return { ok: true, output, message: `已裁切到 ${output}` }
}

function copyFiles({ files, dir }) {
  if (!dir) return { ok: false, message: '先选择保存目录' }
  fs.mkdirSync(dir, { recursive: true })
  const saved = []
  for (const file of files || []) {
    if (!file || !fs.existsSync(file)) continue
    const dest = path.join(dir, path.basename(file))
    fs.copyFileSync(file, dest)
    saved.push(dest)
  }
  return { ok: Boolean(saved.length), files: saved, message: saved.length ? `已复制 ${saved.length} 个文件` : '没有可复制的成片' }
}

function cleanupDir({ dir, days }) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, removed: 0, message: '目录不存在' }
  const maxAge = Math.max(1, Number(days) || 7) * 86400000
  const now = Date.now()
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let stat
    try { stat = fs.statSync(full) } catch { continue }
    if (!stat.isFile() || !/\.(mp4|webm|mov|jpg|jpeg|png|webp)$/i.test(name)) continue
    if (now - stat.mtimeMs < maxAge) continue
    fs.rmSync(full, { force: true })
    removed += 1
  }
  return { ok: true, removed, message: removed ? `已清理 ${removed} 个文件` : '没有到期的文件' }
}

module.exports = { info, probe, stripWatermark, sliceVideo, trimVideo, copyFiles, cleanupDir }
