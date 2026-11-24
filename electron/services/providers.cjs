// 真实出片、登录、发布接在这里。
// 框架阶段固定走本地模拟，只把进度回给界面，不访问外部平台。
async function generateVideo() {
  return { mode: 'simulate' }
}

module.exports = { generateVideo }
