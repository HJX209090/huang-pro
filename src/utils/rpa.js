/** 原来「本地设置 → 发布」里的全局勾选，改成可多选的发布项。 */
export const PUBLISH_OPTION_DEFS = [
  { key: 'dyTitle', label: '根据商品标题填写作品标题' },
  { key: 'dyFakeTitle', label: '标题做短句润色' },
  { key: 'dyTags', label: '根据商品标题选择话题' },
  { key: 'dyCart', label: '挂商品链接' },
  { key: 'dyDeclare', label: 'AI 自主声明' },
  { key: 'dySchedule', label: '抖音平台定时' },
  { key: 'dyPrivate', label: '发布为私密' },
  { key: 'dyManage', label: '发布成功后打开内容管理' },
  { key: 'deleteSources', label: '发布成功后删除本机原片' },
  { key: 'claimDoubao', label: '领取豆包AI生成' },
  { key: 'claimMix', label: '领取混剪' },
  { key: 'claimLive', label: '领取直播切片' }
]

export const RPA_STEP_DEFS = [
  { key: '打开上传页', label: '打开抖音上传页' },
  { key: '检查登录', label: '检查创作者是否已登录' },
  { key: '上传成片并填写文案', label: '上传成片并填写标题、话题' },
  { key: '挂购物车', label: '挂上商品链接' },
  { key: '提交发布', label: '在上传页点击发布' }
]

export function blankPublishPage(delay = 0) {
  return {
    dyTitle: false,
    dyFakeTitle: false,
    dyTags: true,
    dyCart: true,
    dyDeclare: true,
    dySchedule: false,
    dyPrivate: false,
    dyManage: false,
    deleteSources: false,
    claimMix: false,
    claimLive: false,
    claimDoubao: false,
    dyDelay: Number(delay) || 0
  }
}
