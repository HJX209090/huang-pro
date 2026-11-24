/** 抖音带货默认整段提示词（改版时 bump PROMPT_PACK_VERSION） */
export const PROMPT_PACK_VERSION = 3

export function buildDefaultPromptText(parts = {}) {
  const productLock = parts.productLock || '我现在是一个抖音千万级带货博主。请围绕商品「 商品标题 」，直接用 Seedance 2.0Mini 生成适配抖音平台 10 秒 9:16 竖屏高清短视频， 视频内容要严格遵守抖音社区规范，全程规避极限词、夸大功效词、违规承诺类话术，无敏感内容，无任何价格口播或者文字，要符合千川投流要求。'
  const storyline = parts.storyline || '黄金 3 秒强吸睛开场，一位普通气质女生自然上手体验，真实展示使用过程，呈现对产品的喜爱；中段镜头切换，聚焦刻画产品实物细节，搭配精致逼真图片特效，产品外观保持真实不失真，严格锁定产品原图样式。'
  const caption = parts.caption || '核心卖点搭配科技感艺术字弹窗展示，只提炼可视化卖点，文字简洁醒目；整体画面自然真实流畅，无生硬 AI 感，创意有冲击力，开篇抓人，内容信息饱满不空洞。'
  const oral = parts.oral || '配套带货向口播文案，选用悦耳自然女声配音，人声清晰可听见，口播音频融入视频，口播文案贴合画面节奏，只描述可直观看到的外观、使用感受、实物特点，不做功效夸大、效果保证。'
  const compliance = parts.compliance || '禁止违反生活常识、物理常识。禁止任何人脸、品牌商标、知名 IP、版权角色；视频画面、口播不提任何品牌名称，不添加无法实现的画面效果，不虚构效果；不使用绝对化极限词汇，不做疗效、承诺类表述；口播产品名称一定要清晰，不要混淆其他产品名称，整体风格贴近真实达人实拍，提升带货转化潜力。'
  return [
    productLock,
    `画面主线：${storyline}`,
    `字幕 & 视觉：${caption}`,
    `音频 & 口播：${oral}`,
    `硬性合规要求：${compliance}`
  ].join('\n\n')
}

export function defaultPromptSettings() {
  const productLock = '我现在是一个抖音千万级带货博主。请围绕商品「 商品标题 」，直接用 Seedance 2.0Mini 生成适配抖音平台 10 秒 9:16 竖屏高清短视频， 视频内容要严格遵守抖音社区规范，全程规避极限词、夸大功效词、违规承诺类话术，无敏感内容，无任何价格口播或者文字，要符合千川投流要求。'
  const storyline = '黄金 3 秒强吸睛开场，一位普通气质女生自然上手体验，真实展示使用过程，呈现对产品的喜爱；中段镜头切换，聚焦刻画产品实物细节，搭配精致逼真图片特效，产品外观保持真实不失真，严格锁定产品原图样式。'
  const caption = '核心卖点搭配科技感艺术字弹窗展示，只提炼可视化卖点，文字简洁醒目；整体画面自然真实流畅，无生硬 AI 感，创意有冲击力，开篇抓人，内容信息饱满不空洞。'
  const oral = '配套带货向口播文案，选用悦耳自然女声配音，人声清晰可听见，口播音频融入视频，口播文案贴合画面节奏，只描述可直观看到的外观、使用感受、实物特点，不做功效夸大、效果保证。'
  const compliance = '禁止违反生活常识、物理常识。禁止任何人脸、品牌商标、知名 IP、版权角色；视频画面、口播不提任何品牌名称，不添加无法实现的画面效果，不虚构效果；不使用绝对化极限词汇，不做疗效、承诺类表述；口播产品名称一定要清晰，不要混淆其他产品名称，整体风格贴近真实达人实拍，提升带货转化潜力。'
  return {
    outputDir: '',
    publishOpen: 2,
    publishGap: 8,
    doubaoOpen: 3,
    productImageCount: 0,
    plazaPageLimit: '',
    doubaoGap: 5,
    dailyCollectLimit: 40,
    collectStart: '08:00',
    collectedToday: 0,
    collectedDate: '',
    model: 'Seedance 2.0 Mini',
    duration: null,
    durationTouched: false,
    ratio: '9:16',
    voice: '自然悦耳女声',
    productLock,
    storyline,
    caption,
    oral,
    compliance,
    promptText: buildDefaultPromptText({ productLock, storyline, caption, oral, compliance }),
    promptPackVersion: PROMPT_PACK_VERSION,
    douyinAppKey: '',
    douyinAppSecret: '',
    douyinAccessToken: '',
    douyinShopId: '',
    douyinShopName: ''
  }
}

const retiredLocks = [
  '参考商品「{{title}}」的颜色、领口、衣长和版型，只还原外观，不生成原图里的人物脸部。',
  '只按上传的商品图还原「{{title}}」的外观，不要人物脸。直接生成，不要先写方案。'
]
const retiredStorylines = [
  '前 3 秒展示上身效果，中段看版型和衣长，结尾回到整体感受。',
  '前 3 秒看商品整体，中段看关键细节，结尾回到整体。'
]

export function upgradePromptSettings(settings) {
  const next = defaultPromptSettings()
  const retired = retiredLocks.includes(settings.productLock) || retiredStorylines.includes(settings.storyline)
  if (retired || !settings.caption) {
    if (retired) {
      settings.productLock = next.productLock
      settings.storyline = next.storyline
      settings.oral = next.oral
      settings.compliance = next.compliance
    }
    settings.caption = settings.caption || next.caption
  }
  // 提示词包升版：强制同步默认整段文案，避免豆包多轮生成不对版
  const packVer = Number(settings.promptPackVersion) || 0
  if (packVer < PROMPT_PACK_VERSION) {
    settings.productLock = next.productLock
    settings.storyline = next.storyline
    settings.caption = next.caption
    settings.oral = next.oral
    settings.compliance = next.compliance
    settings.promptText = next.promptText
    settings.promptPackVersion = PROMPT_PACK_VERSION
    if (Array.isArray(settings.promptTemplates)) {
      const def = settings.promptTemplates.find((item) => item.id === 'tpl-default')
      if (def) {
        def.promptText = next.promptText
        def.model = settings.model || 'Seedance 2.0 Mini'
        def.ratio = settings.ratio || '9:16'
        def.voice = settings.voice || '自然悦耳女声'
      }
    }
  }
  if (!String(settings.promptText || '').trim()) {
    settings.promptText = buildDefaultPromptText(settings)
  }
  if (!Array.isArray(settings.promptTemplates)) settings.promptTemplates = []
  if (!settings.promptTemplates.length) {
    const pack = (id, name, promptText) => ({
      id,
      name,
      promptText,
      model: settings.model || 'Seedance 2.0 Mini',
      duration: settings.duration || '',
      ratio: settings.ratio || '9:16',
      voice: settings.voice || '自然悦耳女声'
    })
    settings.promptTemplates = [
      pack('tpl-default', '抖音带货默认', settings.promptText),
      pack('tpl-detail', '细节特写', '围绕商品「商品标题」拍一条抖音竖屏细节展示。开头 3 秒给商品整体，中段切到材质、颜色和关键结构，结尾回到整体。不要可识别人脸，不要品牌商标，不要价格，不要极限词。直接生成视频，不要先写方案，不要让我确认。'),
      pack('tpl-oral', '口播种草', '围绕商品「商品标题」做一条口播种草。普通女生侧脸出镜，语气自然，只讲能看见的外观和使用过程。画面 9:16，口播清楚。不要明星脸，不要品牌名，不要价格和功效承诺。直接生成视频，不要先写方案。')
    ]
  }
  if (!settings.promptTemplates.some((item) => item.id === 'tpl-compliance')) {
    settings.promptTemplates.push({
      id: 'tpl-compliance',
      name: '合规带货',
      promptText: '围绕商品「商品标题」生成一条 9:16 抖音带货视频。只讲能看见的外观和使用过程。禁止出现极限词、疗效承诺、绝对化用语、微信、小黄车和外部引流。口播报出商品名称。直接生成视频。',
      model: settings.model || 'Seedance 2.0 Mini',
      duration: settings.duration || '',
      ratio: settings.ratio || '9:16',
      voice: settings.voice || '自然悦耳女声'
    })
  }
  if (!settings.promptTemplates.some((item) => item.id === settings.activePromptTemplateId)) {
    settings.activePromptTemplateId = settings.promptTemplates[0].id
  }
  if (!settings.durationTouched && Number(settings.duration) === 10) settings.duration = null
  if (settings.plazaPageLimit == null) settings.plazaPageLimit = ''
  else settings.plazaPageLimit = String(settings.plazaPageLimit).trim()
  return settings
}

export function createSeed() {
  return {
    points: 0,
    publishNo: 1,
    groups: ['默认分组'],
    activeAccountId: '',
    products: [],
    plaza: [],
    works: [],
    doubaoAccounts: [],
    digitalHumans: [],
    publishAccounts: [],
    collectAccounts: [],
    schedules: [],
    rpaFlows: [],
    proxies: [],
    browsers: [],
    logs: [],
    doubaoChats: [],
    settings: defaultPromptSettings(),
    license: null,
    generatedLicenses: []
  }
}
