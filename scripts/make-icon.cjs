const fs = require('fs')
const path = require('path')
const { Resvg } = require('@resvg/resvg-js')
async function main() {

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, '龙 (2).svg'))

function render(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)'
  })
  return resvg.render().asPng()
}

const png256 = render(256)
const png512 = render(512)
fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png512)
fs.writeFileSync(path.join(root, 'src', 'assets', 'brand.png'), png256)
fs.writeFileSync(path.join(root, 'electron', 'icon.png'), png256)
fs.writeFileSync(path.join(root, 'public', 'favicon.png'), png256)

  const pngToIco = (await import('png-to-ico')).default
  const ico = await pngToIco(png256)
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico)
  console.log('icon ready', png512.length, ico.length)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
