export const navGroups = [
  {
    label: '工作台',
    items: [
      { path: '/dashboard', title: '仪表盘', icon: 'dashboard' },
      { path: '/messages', title: '消息', icon: 'bell', badge: 'inbox' },
      { path: '/works', title: '我的作品', icon: 'works', badge: 'works' },
      { path: '/workbench', title: '审片工作台', icon: 'bench' },
      { path: '/plaza', title: '选品广场', icon: 'plaza' }
    ]
  },
  {
    label: '豆包管理',
    items: [
      { path: '/doubao', title: '豆包管理', icon: 'chat' },
      { path: '/products', title: '选品车', icon: 'box' }
    ]
  },
  {
    label: '发布中心',
    items: [
      { path: '/publish', title: '发布账号', icon: 'send' },
      { path: '/rpa', title: 'RPA流程', icon: 'flow' },
      { path: '/schedules', title: '定时任务', icon: 'clock' }
    ]
  },
  {
    label: '更多',
    items: [
      { path: '/tasks', title: '任务中心', icon: 'flow' },
      { path: '/toolbox', title: '工具箱', icon: 'tool' },
      { path: '/logs', title: '日志管理', icon: 'log' },
      { path: '/settings', title: '本地设置', icon: 'gear' },
      { path: '/browser', title: '浏览器环境', icon: 'window', admin: true },
      { path: '/proxy', title: '出网代理', icon: 'proxy', admin: true },
      { path: '/license', title: '软件管理', icon: 'key', admin: true },
      { path: '/account', title: '账户', icon: 'account' }
    ]
  }
]
