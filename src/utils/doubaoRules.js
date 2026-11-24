/** 版权/图片限制：不要立刻失败，同一条任务里多发几次 */
export const RETRY_COPYRIGHT_MARKERS = [
  '输入图片可能涉及版权限制，请更换后重试',
  '输入图片可能涉及版权限制',
  '生成的视频可能涉及版权限制，请更换输入内容后重试',
  '可能涉及版权限制',
  '由于版权相关限制',
  '请更换图片后再试',
  '请更换后重试',
  '请更换输入内容后重试'
]

/** 排队/并行占用：等一会再催发或重发 */
export const RETRY_BUSY_MARKERS = [
  '当前视频仍在排队生成中',
  '暂时无法并行发起新的视频任务',
  '无法并行发起新的视频任务',
  '仍在排队生成中',
  '请先等待这条',
  '结果出来后我会立即同步'
]

const FAIL_MARKERS = [
  '暂时无法创作对应的内容',
  '无法针对该图片进行创作',
  '视频生成失败',
  '抱歉，我无法生成你要求的内容',
  '我无法生成你要求的内容',
  '无法生成你要求的内容',
  '未通过审核',
  '触发风控',
  '违规内容',
  '生成免费次数用完了',
  '免费次数用完了',
  '免费次数用完',
  '今日免费次数用完',
  '免费次数已用完'
]

const WEAK_MARKERS = ['生成失败', '创作失败', '生成出错', '内容无法生成']

export function defaultReplyRules() {
  const text = '确认生成视频'
  return {
    first: [
      { enabled: true, match: '要不要', action: 'text', reply: '马上生成视频', buttonLabel: '' },
      { enabled: true, match: '豆包使用规范', action: 'click', reply: text, buttonLabel: '确认生成' },
      { enabled: true, match: '确认后我再开始生成视频', action: 'text', reply: text, buttonLabel: '' },
      { enabled: true, match: '确认后我再开始生成', action: 'text', reply: text, buttonLabel: '' },
      { enabled: true, match: '确认后开始生成视频', action: 'text', reply: text, buttonLabel: '' },
      { enabled: true, match: '是否确认改用', action: 'text', reply: text, buttonLabel: '' }
    ],
    follow: [
      { enabled: true, match: '请确认生成', reply: text },
      { enabled: true, match: '确认后我再开始生成视频', reply: text },
      { enabled: true, match: '确认后我再开始生成', reply: text },
      { enabled: true, match: '确认后开始生成视频', reply: text },
      { enabled: true, match: '是否确认改用', reply: text }
    ],
    nudge: ['继续生成视频', '帮我生成视频', '马上生成视频', '开始生成视频']
  }
}

export function defaultFailRules() {
  return {
    // 版权/排队不进立刻失败：生成流程里会自动多发几次
    immediate: FAIL_MARKERS.map((match) => ({ enabled: true, match, rollbackQuota: true })),
    weak: WEAK_MARKERS.map((match) => ({ enabled: true, match })),
    retryCopyright: RETRY_COPYRIGHT_MARKERS.map((match) => ({ enabled: true, match })),
    retryBusy: RETRY_BUSY_MARKERS.map((match) => ({ enabled: true, match }))
  }
}

export function ensureDoubaoRules(settings) {
  if (!settings.doubaoReply?.first?.length) settings.doubaoReply = defaultReplyRules()
  if (!settings.doubaoFail?.immediate?.length) settings.doubaoFail = defaultFailRules()
  if (!Array.isArray(settings.doubaoReply.nudge) || !settings.doubaoReply.nudge.length) {
    settings.doubaoReply.nudge = defaultReplyRules().nudge
  }
  if (!settings.doubaoFail.weak?.length) settings.doubaoFail.weak = defaultFailRules().weak
  const defaults = defaultFailRules()
  // 旧配置里版权话术还在「立刻失败」里：挪到重试列表，避免一碰版权就停
  if (!settings.doubaoFail.retryCopyright?.length) {
    const copyrightSet = new Set(RETRY_COPYRIGHT_MARKERS)
    settings.doubaoFail.immediate = (settings.doubaoFail.immediate || []).filter((row) => !copyrightSet.has(String(row.match || '')))
    settings.doubaoFail.retryCopyright = defaults.retryCopyright
  }
  if (!settings.doubaoFail.retryBusy?.length) {
    settings.doubaoFail.retryBusy = defaults.retryBusy
  }
  return settings
}
