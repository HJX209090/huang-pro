/** 系统内置定时任务定义（首次出现时写入 schedules，用户可改可删） */
export const BUILTIN_SCHEDULE_DEFS = [
  {
    id: 'SYS-collect',
    name: '每日选品同步',
    type: '选品采集',
    mode: '定时',
    date: '',
    time: '08:00',
    intervalMinutes: 0,
    account: '',
    enabled: true,
    builtin: true,
    desc: '每天到点同步选品库，对应选品车里的「开始时间」'
  },
  {
    id: 'SYS-auto-publish',
    name: '审核通过后自动发布',
    type: '审核通过后发布',
    mode: '循环',
    date: '',
    time: '',
    intervalMinutes: 30,
    account: '',
    enabled: false,
    builtin: true,
    desc: '每隔一段时间检查已审核成片并送去抖音发布（默认关闭，可自行打开）'
  },
  {
    id: 'SYS-login-patrol',
    name: '登录状态巡检',
    type: '登录巡检',
    mode: '循环',
    date: '',
    time: '',
    intervalMinutes: 20,
    account: '',
    enabled: true,
    builtin: true,
    desc: '检查豆包、达人工作台、创作者中心。账密过期自动登录；扫码过期写入消息，可点去登录'
  },
  {
    id: 'SYS-generate',
    name: '待生成作品自动开做',
    type: '生成队列',
    mode: '循环',
    date: '',
    time: '',
    intervalMinutes: 60,
    account: '',
    enabled: false,
    builtin: true,
    desc: '每隔一段时间把「待生成」作品送进豆包队列（默认关闭）'
  }
]

export function isBuiltinSchedule(row) {
  return Boolean(row?.builtin) || String(row?.id || '').startsWith('SYS-')
}
