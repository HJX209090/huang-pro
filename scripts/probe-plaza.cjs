const { app } = require('electron')
const browserSession = require('../electron/services/browserSession.cjs')

const id = process.argv[2] || 'PBmwsvdw0e1d5y'

app.whenReady().then(async () => {
  const texts = await browserSession.collectProducts({ id, target: 'plaza' })
  let ids = 0
  texts.forEach((text) => {
    ids += (String(text).match(/"product_id"/g) || []).length
  })
  console.log('blobs', texts.length, 'productIdFields', ids)
  app.quit()
})
