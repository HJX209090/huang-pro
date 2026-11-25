<template>
  <div class="page schedule-page">
    <div class="schedule-main">
      <div class="page-head">
        <div>
          <h1>定时任务</h1>
          <p>任务组就是本机执行器。发片类点「立即执行」会马上跑这一组；本机开关关掉后，到点不会自动跑。</p>
        </div>
        <div class="head-actions">
          <el-switch
            :model-value="store.settings.localScheduleOn !== false"
            active-text="本机到点执行"
            size="large"
            @change="(value) => { store.settings.localScheduleOn = value; store.persist() }"
          />
          <el-button v-if="tab === 'mine'" type="primary" size="large" @click="edit()">新建任务组</el-button>
        </div>
      </div>
      <el-tabs v-model="tab" class="schedule-tabs">
        <el-tab-pane :label="`我的任务（${store.mySchedules.length}）`" name="mine" />
        <el-tab-pane :label="`系统内置（${store.systemSchedules.length}）`" name="system" />
      </el-tabs>
      <section class="panel plan-panel">
        <h2>任务计划</h2>
        <p class="muted">任务组负责何时、对哪些号发布。发片类在组里勾选账号；到点或立即执行时，只使用勾中的创作者账号。不勾选则用全部已启用账号。</p>
        <div class="table-scroll">
          <el-table :data="tableRows" class="plan-table">
            <el-table-column prop="name" label="任务名称" min-width="160" />
            <el-table-column label="账号" min-width="140">
              <template #default="{ row }">{{ accountLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="节奏" min-width="140">
              <template #default="{ row }">{{ triggerLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="88">
              <template #default="{ row }"><el-switch v-model="row.enabled" size="large" @change="onToggle(row)" /></template>
            </el-table-column>
            <el-table-column label="操作" min-width="280">
              <template #default="{ row }">
                <div class="row-ops">
                  <el-button type="primary" plain :loading="runningId === row.id" @click="run(row)">立即执行</el-button>
                  <el-button @click="edit(row)">编辑</el-button>
                  <el-button type="danger" plain @click="remove(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <p v-if="!tableRows.length" class="muted empty-line">{{ emptyHint }}</p>
      </section>
      <section v-if="tab === 'mine'" class="preset-block">
        <h2>推荐模板（小白）</h2>
        <div class="preset-grid">
          <button type="button" @click="edit(null, '每天固定时间发')">
            <b>每天固定时间发</b>
            <span>适合日更一条、踩点发布</span>
          </button>
          <button type="button" @click="edit(null, '每隔一段时间检查')">
            <b>每隔一段时间检查</b>
            <span>到点检查审核通过的作品</span>
          </button>
          <button type="button" @click="edit(null, '只跑一次')">
            <b>只跑一次</b>
            <span>指定日期只执行一次</span>
          </button>
        </div>
      </section>
    </div>

    <el-drawer v-model="visible" :title="drawerTitle" :size="drawerSize" class="schedule-drawer" append-to-body>
      <div class="drawer-scroll">
        <section class="block">
          <h3>1. 基本信息</h3>
          <el-input v-model="form.name" size="large" placeholder="任务组名称（必填）" />
        </section>

        <section v-if="form.builtin" class="block">
          <h3>任务类型</h3>
          <el-select v-model="form.type" size="large" style="width: 100%">
            <el-option value="审核通过后发布" label="审核通过后发布" />
            <el-option value="选品采集" label="选品采集" />
            <el-option value="生成队列" label="生成队列" />
            <el-option value="登录巡检" label="登录巡检" />
          </el-select>
        </section>

        <section v-if="isPublishTask" class="block">
          <div class="block-head">
            <h3>2. 本机 RPA 流程</h3>
            <el-button size="large" @click="openFlows">配置自己的流程</el-button>
          </div>
          <p class="muted">本机流程是你在「RPA 流程」页保存的发布步骤，只存在这台电脑上。下面这些选项就是原来「本地设置 → 发布」的全局勾选：填标题、润色、话题、挂车、AI 声明、平台定时、私密、内容管理、删原片，以及领取混剪、直播切片、豆包成片。默认一项都不选，选中后会出现标签，点 × 去掉。</p>
          <el-select
            v-model="form.picks"
            multiple
            filterable
            clearable
            placeholder="默认不选，点开后再选"
            style="width: 100%"
          >
            <el-option-group label="发布项">
              <el-option v-for="item in publishOptions" :key="item.key" :label="item.label" :value="`opt:${item.key}`" />
            </el-option-group>
            <el-option-group v-if="store.rpaFlows.length" label="本机流程">
              <el-option v-for="flow in store.rpaFlows" :key="flow.id" :label="flow.name" :value="`flow:${flow.id}`" />
            </el-option-group>
          </el-select>
          <p v-if="!store.rpaFlows.length" class="flow-note">还没有自己的流程。点右上角可以新建一套步骤，建好后会出现在这个下拉里。</p>
        </section>
        <section v-else class="block">
          <h3>2. 任务说明</h3>
          <p class="muted">{{ form.desc || (form.type === '选品采集' ? '到点同步选品库。' : form.type === '登录巡检' ? '到点检查创作者登录，掉线会记到消息里。' : '到点把待生成作品送进豆包。') }}</p>
        </section>

        <section v-if="isPublishTask" class="block">
          <div class="block-head">
            <h3>3. 选择发布账号</h3>
            <b>已选 {{ form.accounts.length }} / {{ store.publishAccounts.length }}</b>
          </div>
          <p class="muted">点分组加入，再点一次取消。保存的是当时选中的号。</p>
          <div class="account-tools">
            <el-input v-model="accountQuery" size="large" clearable placeholder="搜索账号名称或 ID" />
            <el-select v-model="accountGroup" size="large" clearable placeholder="全部分组" style="width: 160px">
              <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
            </el-select>
            <el-button size="large" @click="selectPage">本页全选</el-button>
            <el-button size="large" @click="selectFiltered">筛选全选</el-button>
            <el-button size="large" @click="form.accounts = []">清空</el-button>
          </div>
          <div v-if="accountPageRows.length" class="account-list">
            <button
              v-for="item in accountPageRows"
              :key="item.id"
              type="button"
              class="account-row"
              :class="{ on: form.accounts.includes(item.id) }"
              @click="toggleAccount(item.id)"
            >
              <span>{{ item.name }}</span>
              <em>{{ item.creatorLoginStatus || '未检测' }} · {{ item.group || '默认分组' }}</em>
            </button>
          </div>
          <p v-else class="muted">暂无当前平台发布账号，请先到「发布账号」绑定。</p>
          <div v-if="accountPool.length > accountPageSize" class="account-pager">
            <el-button size="large" :disabled="accountPage <= 1" @click="accountPage -= 1">上一页</el-button>
            <span>{{ accountPage }} / {{ accountPageCount }}</span>
            <el-button size="large" :disabled="accountPage >= accountPageCount" @click="accountPage += 1">下一页</el-button>
          </div>
        </section>

        <section class="block">
          <h3>{{ isPublishTask ? '4' : '3' }}. 触发节奏</h3>
          <p class="muted">决定任务什么时候执行，与下方「本机排队」无关。排队只在每一次触发时对多账号生效。</p>
          <div class="mode-switch">
            <button type="button" :class="{ on: form.mode === '单次' }" @click="form.mode = '单次'">单次</button>
            <button type="button" :class="{ on: form.mode === '定时' }" @click="form.mode = '定时'">定时</button>
            <button type="button" :class="{ on: form.mode === '循环' }" @click="form.mode = '循环'">循环</button>
          </div>
          <div class="rhythm-grid">
            <label>
              <span>任务状态</span>
              <el-select v-model="form.enabled" size="large">
                <el-option :value="true" label="启用" />
                <el-option :value="false" label="停用" />
              </el-select>
            </label>
            <label v-if="form.mode === '定时'">
              <span>周期</span>
              <el-select v-model="form.cycle" size="large">
                <el-option value="day" label="每天" />
                <el-option value="week" label="每周" />
                <el-option value="month" label="每月" />
              </el-select>
            </label>
            <label v-if="form.mode === '定时' && form.cycle === 'week'">
              <span>星期</span>
              <el-select v-model="form.weekdays" multiple clearable collapse-tags-tooltip placeholder="选择星期" size="large">
                <el-option v-for="item in weekOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </label>
            <label v-if="form.mode === '定时' && form.cycle === 'month'">
              <span>每月几号</span>
              <el-input-number v-model="form.monthDay" size="large" :min="1" :max="31" style="width: 100%" />
            </label>
            <label v-if="form.mode === '单次'">
              <span>日期</span>
              <el-date-picker v-model="form.date" size="large" type="date" value-format="YYYY-MM-DD" placeholder="年 / 月 / 日" style="width: 100%" />
            </label>
            <label v-if="form.mode === '循环'">
              <span>间隔分钟</span>
              <el-input-number v-model="form.intervalMinutes" size="large" :min="5" :max="720" style="width: 100%" />
            </label>
            <label v-if="form.mode !== '循环'">
              <span>到点时间</span>
              <el-time-picker v-model="form.time" size="large" format="HH:mm" value-format="HH:mm" placeholder="10:00" style="width: 100%" />
            </label>
          </div>
          <p v-if="form.mode === '定时' && form.cycle === 'day'" class="muted">每天到这个钟点跑一遍。桌面请保持打开。</p>
          <p v-else-if="form.mode === '定时' && form.cycle === 'week'" class="muted">只在选中的星期、到这个钟点跑一遍。</p>
          <p v-else-if="form.mode === '定时' && form.cycle === 'month'" class="muted">每月这一天的这个钟点跑一遍。没有这一天的月份会跳过，例如 31 号不会在 2 月执行。</p>
        </section>
      </div>
      <div class="drawer-actions">
        <el-button size="large" @click="visible = false">取消</el-button>
        <el-button type="primary" size="large" @click="save">{{ form.id ? '保存任务组' : '创建任务组' }}</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { isBuiltinSchedule } from '@/utils/builtinSchedules'
import { uid } from '@/utils/format'
import { PUBLISH_OPTION_DEFS } from '@/utils/rpa'

const store = useAppStore()
const router = useRouter()
const tab = ref('mine')
const visible = ref(false)
const runningId = ref('')
const form = reactive({
  id: '',
  name: '',
  type: '审核通过后发布',
  mode: '定时',
  cycle: 'day',
  weekdays: [],
  monthDay: 1,
  date: '',
  time: '10:00',
  intervalMinutes: 30,
  account: '',
  accounts: [],
  picks: [],
  enabled: true,
  builtin: false,
  desc: ''
})
const publishOptions = PUBLISH_OPTION_DEFS
const weekOptions = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]

const tableRows = computed(() => (tab.value === 'system' ? store.systemSchedules : store.mySchedules))
const emptyHint = computed(() => (
  tab.value === 'system'
    ? '暂无系统内置任务（可能已被全部删除）。'
    : '暂无定时任务。点右上角新建任务组。'
))
const drawerTitle = computed(() => {
  if (!form.id) return '新建任务组'
  return form.builtin ? '编辑系统内置任务' : '编辑任务组'
})
const isPublishTask = computed(() => !form.type || form.type === '审核通过后发布')
const viewport = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const drawerSize = computed(() => `${Math.min(780, Math.max(360, viewport.value - 12))}px`)
const accountQuery = ref('')
const accountGroup = ref('')
const accountPage = ref(1)
const accountPageSize = 6
const accountPool = computed(() => store.publishAccounts.filter((item) => {
  if (accountGroup.value && item.group !== accountGroup.value) return false
  const query = accountQuery.value.trim()
  if (query && !`${item.name || ''}${item.id || ''}`.includes(query)) return false
  return true
}))
const accountPageCount = computed(() => Math.max(1, Math.ceil(accountPool.value.length / accountPageSize)))
const accountPageRows = computed(() => accountPool.value.slice((accountPage.value - 1) * accountPageSize, accountPage.value * accountPageSize))

function onViewport() {
  viewport.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', onViewport))
onUnmounted(() => window.removeEventListener('resize', onViewport))
watch([accountQuery, accountGroup, accountPool], () => {
  if (accountPage.value > accountPageCount.value) accountPage.value = accountPageCount.value
})

function toggleAccount(id) {
  form.accounts = form.accounts.includes(id)
    ? form.accounts.filter((item) => item !== id)
    : form.accounts.concat(id)
}

function selectPage() {
  form.accounts = [...new Set(form.accounts.concat(accountPageRows.value.map((item) => item.id)))]
}

function selectFiltered() {
  form.accounts = [...new Set(form.accounts.concat(accountPool.value.map((item) => item.id)))]
}

function accountName(idOrName) {
  const found = store.publishAccounts.find((item) => item.id === idOrName || item.name === idOrName)
  return found?.name || idOrName
}

function accountIds(row) {
  const raw = Array.isArray(row?.accounts) && row.accounts.length
    ? row.accounts
    : (row?.account ? String(row.account).split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : [])
  return raw.map((item) => store.publishAccounts.find((account) => account.id === item || account.name === item)?.id || item)
}

function accountLabel(row) {
  const ids = accountIds(row)
  if (!ids.length) return '全部账号'
  return ids.map((item) => accountName(item)).join('、')
}

function triggerLabel(row) {
  if (row.mode === '循环') return `每 ${row.intervalMinutes || 30} 分钟`
  if (row.mode === '单次' || row.date) return `${row.date || '单次'} ${row.time || ''}`.trim()
  if (row.cycle === 'week') {
    const names = (row.weekdays || []).map((item) => weekOptions.find((day) => day.value === Number(item))?.label || '').filter(Boolean)
    return `每${names.join('、') || '周'} ${row.time || '--'}`
  }
  if (row.cycle === 'month') return `每月${row.monthDay || 1}日 ${row.time || '--'}`
  return `每天 ${row.time || '--'}`
}

function openFlows() {
  visible.value = false
  router.push('/rpa')
}

function onToggle(row) {
  if (row.id === 'SYS-collect' && row.time) store.settings.collectStart = row.time
  store.persist()
}

function edit(row, preset) {
  if (row) {
    Object.assign(form, {
      mode: '定时',
      cycle: 'day',
      weekdays: [],
      monthDay: 1,
      enabled: true,
      intervalMinutes: 30,
      type: '审核通过后发布',
      builtin: false,
      desc: '',
      picks: [],
      ...row,
      accounts: accountIds(row),
      picks: Array.isArray(row.picks) ? [...row.picks] : [],
      weekdays: Array.isArray(row.weekdays) ? row.weekdays.map((item) => Number(item)) : [],
      cycle: row.cycle || 'day',
      monthDay: Number(row.monthDay) || 1,
      builtin: isBuiltinSchedule(row)
    })
  } else {
    Object.assign(form, {
      id: '',
      name: preset || '',
      type: '审核通过后发布',
      mode: preset === '只跑一次' ? '单次' : (preset === '每隔一段时间检查' ? '循环' : '定时'),
      cycle: 'day',
      weekdays: [],
      monthDay: 1,
      date: '',
      time: '10:00',
      intervalMinutes: 30,
      account: '',
      accounts: [],
      picks: [],
      enabled: true,
      builtin: false,
      desc: ''
    })
  }
  accountQuery.value = ''
  accountGroup.value = ''
  accountPage.value = 1
  visible.value = true
  syncAccountStatus()
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写任务组名称')
  if (form.mode !== '循环' && !form.time) return ElMessage.warning('选择定时时间')
  if (form.mode === '定时' && form.cycle === 'week' && !form.weekdays.length) return ElMessage.warning('每周至少选一天')
  const payload = {
    name: form.name.trim(),
    type: form.type || '审核通过后发布',
    mode: form.mode,
    cycle: form.mode === '定时' ? (form.cycle || 'day') : 'day',
    weekdays: form.mode === '定时' && form.cycle === 'week' ? [...form.weekdays] : [],
    monthDay: form.mode === '定时' && form.cycle === 'month' ? Math.min(31, Math.max(1, Number(form.monthDay) || 1)) : 1,
    date: form.mode === '单次' ? (form.date || '') : '',
    time: form.mode === '循环' ? '' : form.time,
    intervalMinutes: form.mode === '循环' ? Math.max(5, Number(form.intervalMinutes) || 30) : 0,
    account: (form.accounts || []).map((item) => accountName(item)).join('、'),
    accounts: [...(form.accounts || [])],
    picks: [...(form.picks || [])],
    enabled: form.enabled !== false,
    desc: form.desc || ''
  }
  if (form.id) {
    const target = store.schedules.find((item) => item.id === form.id)
    if (target) {
      Object.assign(target, payload)
      if (form.builtin) target.builtin = true
    }
  } else {
    store.schedules.unshift({ ...payload, id: uid('SC'), lastRun: '', builtin: false })
  }
  if (form.id === 'SYS-collect' && payload.time) {
    store.settings.collectStart = payload.time
  }
  store.persist()
  visible.value = false
  ElMessage.success('任务组已保存')
}

async function syncAccountStatus() {
  if (!window.tujian?.accountStatus) return
  for (const account of store.publishAccounts) {
    try {
      const st = await window.tujian.accountStatus({ kind: 'publish', id: account.id })
      account.creatorLoginStatus = st?.creatorLoginStatus || '待登录'
      account.buyinLoginStatus = st?.buyinLoginStatus || account.buyinLoginStatus || '待登录'
      account.loginStatus = account.creatorLoginStatus
    } catch { /* ignore */ }
  }
  store.persist()
}

async function run(row) {
  if (!row) return
  if (runningId.value) return ElMessage.info('有任务正在执行，稍等一下')
  runningId.value = row.id
  try {
    await syncAccountStatus()
    const message = await store.executeSchedule(row, { immediate: true })
    const text = message || `${row.name} 已立即执行`
    if (/没有审核通过|待审核|领取过滤|可发成片/.test(text)) {
      ElMessage.warning(text)
    } else if (/没有|但|失败|稍后再试/.test(text)) {
      ElMessage.warning(text)
    } else {
      ElMessage.success(text)
    }
  } catch (error) {
    ElMessage.error(error.message || '立即执行失败')
  } finally {
    runningId.value = ''
  }
}

async function remove(row) {
  const tip = isBuiltinSchedule(row)
    ? `删除系统内置任务「${row.name}」？删除后不会自动恢复，相关自动能力也会停掉。`
    : `删除任务 ${row.name}？`
  try { await ElMessageBox.confirm(tip, '删除', { type: 'warning' }) } catch { return }
  if (isBuiltinSchedule(row)) store.dismissBuiltinSchedule(row.id)
  else {
    store.schedules = store.schedules.filter((item) => item.id !== row.id)
    store.persist()
  }
  ElMessage.success('已删除')
}
</script>

<style scoped>
.schedule-page { min-height: 0; font-size: 16px; }
.schedule-main { min-width: 0; }
.page-head { align-items: center; }
.page-head h1 { font-size: 28px; }
.page-head p { font-size: 15px; line-height: 1.6; max-width: 720px; }
.head-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.plan-panel h2, .preset-block h2 { margin: 0 0 8px; font-size: 20px; }
.plan-panel p, .empty-line { font-size: 15px; line-height: 1.6; }
.table-scroll { width: 100%; overflow-x: auto; }
.plan-table { width: 100%; }
.row-ops { display: flex; flex-wrap: wrap; gap: 8px; }
.row-ops .el-button { min-height: 40px; padding: 8px 14px; font-size: 15px; }
.preset-block { margin-top: 8px; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.preset-grid button {
  text-align: left;
  border: 1px solid #eaecf0;
  background: #fff;
  border-radius: 14px;
  padding: 18px 16px;
  cursor: pointer;
  min-height: 88px;
}
.preset-grid b { display: block; font-size: 17px; }
.preset-grid span { display: block; color: #667085; margin-top: 8px; font-size: 14px; line-height: 1.5; }
.drawer-scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 4px 12px; }
.block { margin-bottom: 22px; }
.block h3 { margin: 0 0 10px; font-size: 18px; }
.block-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.block-head b { color: #6d4aff; font-size: 16px; }
.flow-card {
  display: block;
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px solid #d9ccff;
  background: #f7f4ff;
  border-radius: 12px;
}
.flow-card span { display: block; margin-top: 6px; color: #667085; line-height: 1.6; }
.flow-note { margin: 10px 0 0; color: #b54708; line-height: 1.6; }
.account-tools, .account-pager, .rhythm-grid { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.account-tools .el-input { flex: 1 1 220px; }
.account-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.account-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: 1px solid #eaecf0;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 15px;
}
.account-row.on { border-color: #6d4aff; background: #f6f3ff; }
.account-row em { color: #667085; font-style: normal; }
.mode-switch { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0; }
.mode-switch button {
  min-height: 48px;
  border: 1px solid #eaecf0;
  border-radius: 12px;
  background: #fff;
  font-size: 16px;
  cursor: pointer;
}
.mode-switch button.on { border-color: #6d4aff; color: #6d4aff; background: #f6f3ff; font-weight: 700; }
.rhythm-grid { margin-top: 8px; }
.rhythm-grid label { display: flex; flex-direction: column; gap: 6px; flex: 1 1 180px; font-size: 14px; color: #475467; }
.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 4px 4px;
  border-top: 1px solid #eaecf0;
  background: #fff;
}
@media (max-width: 900px) {
  .page-head { flex-direction: column; align-items: stretch; }
  .head-actions { width: 100%; }
  .head-actions .el-button { flex: 1; }
  .plan-table { width: 100%; }
  .preset-grid { grid-template-columns: 1fr; }
  .mode-switch { grid-template-columns: 1fr; }
}
</style>

<style>
.schedule-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px 12px;
}
.schedule-drawer .el-drawer__header {
  margin-bottom: 8px;
  font-size: 20px;
}
.schedule-drawer .el-button {
  min-height: 40px;
}
</style>
