<template>
  <div class="page schedule-page">
    <div class="schedule-main">
      <div class="page-head">
        <div>
          <h1>定时任务</h1>
          <p>软件开着时到点自动跑；点「立即执行」会马上跑这一条，不用等到设定时间。</p>
        </div>
        <el-button v-if="tab === 'mine'" type="primary" @click="edit()">新建任务组</el-button>
      </div>
      <el-tabs v-model="tab" class="schedule-tabs">
        <el-tab-pane :label="`我的任务（${store.mySchedules.length}）`" name="mine" />
        <el-tab-pane :label="`系统内置（${store.systemSchedules.length}）`" name="system" />
      </el-tabs>
      <div class="panel">
        <h3>{{ tab === 'system' ? '系统内置' : '任务列表' }}</h3>
        <p v-if="tab === 'system'" class="muted tab-hint">这些是软件自带的定时能力，可改时间/开关，也可删除；删掉后不会再自动加回来。</p>
        <el-table :data="tableRows">
          <el-table-column prop="name" label="任务组名称" min-width="140" />
          <el-table-column v-if="tab === 'system'" prop="desc" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column label="类型" width="130">
            <template #default="{ row }">{{ row.type || '审核通过后发布' }}</template>
          </el-table-column>
          <el-table-column label="触发方式" width="100">
            <template #default="{ row }">{{ row.mode || '定时' }}</template>
          </el-table-column>
          <el-table-column label="触发时间" width="160">
            <template #default="{ row }">{{ triggerLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="发布账号" min-width="160">
            <template #default="{ row }">{{ accountLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }"><el-switch v-model="row.enabled" @change="onToggle(row)" /></template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :loading="runningId === row.id" @click="run(row)">立即执行</el-button>
              <el-button link @click="edit(row)">编辑</el-button>
              <el-button link type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p v-if="!tableRows.length" class="muted">{{ emptyHint }}</p>
      </div>
      <div v-if="tab === 'mine'" class="preset-grid">
        <button type="button" @click="edit(null, '原片回放（小白）')">原片回放（小白）<span>每天固定时刻发布</span></button>
        <button type="button" @click="edit(null, '每隔一段时间检查')">每隔一段时间检查<span>到点检查审核通过的作品</span></button>
        <button type="button" @click="edit(null, '只跑一次')">只跑一次<span>指定日期只执行一次</span></button>
      </div>
    </div>
    <el-drawer v-model="visible" :title="drawerTitle" size="460px">
      <el-form label-position="top">
        <h3>1. 基本信息</h3>
        <el-form-item label="任务组名称">
          <el-input v-model="form.name" placeholder="任务组名称（必填）" />
        </el-form-item>
        <el-form-item v-if="form.builtin" label="任务类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option value="审核通过后发布" label="审核通过后发布" />
            <el-option value="选品采集" label="选品采集" />
            <el-option value="生成队列" label="生成队列" />
            <el-option value="登录巡检" label="登录巡检" />
          </el-select>
        </el-form-item>
        <template v-if="form.type === '审核通过后发布' || !form.type">
          <h3>2. 本机 RPA 流程</h3>
          <p class="muted">到点后打开这个账号的抖音上传页，写入作品标题和按标题生成的 5 个标签，并点击发布。</p>
          <el-button @click="router.push('/rpa')">管理本机流程</el-button>
          <h3>3. 选择发布账号</h3>
          <el-select v-model="form.accounts" multiple collapse-tags clearable placeholder="不选则用全部已启用账号" style="width: 100%" @visible-change="(open) => open && syncAccountStatus()">
            <el-option
              v-for="item in store.publishAccounts"
              :key="item.id"
              :label="`${item.name}（${item.creatorLoginStatus || '未检测'}）`"
              :value="item.id"
            />
          </el-select>
          <p class="muted">可以多选。例如勾选 A、B、C，到点就只用这三个创作者账号发布。</p>
        </template>
        <template v-else>
          <h3>2. 任务说明</h3>
          <p class="muted">{{ form.desc || (form.type === '选品采集' ? '到点同步选品库。' : '到点把待生成作品送进豆包。') }}</p>
        </template>
        <h3>{{ form.type === '审核通过后发布' || !form.type ? '4' : '3' }}. 触发节奏</h3>
        <el-radio-group v-model="form.mode">
          <el-radio-button value="单次">单次</el-radio-button>
          <el-radio-button value="定时">定时</el-radio-button>
          <el-radio-button value="循环">循环</el-radio-button>
        </el-radio-group>
        <el-form-item label="任务状态">
          <el-switch v-model="form.enabled" active-text="启用" />
        </el-form-item>
        <el-form-item v-if="form.mode === '单次'" label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" placeholder="年 / 月 / 日" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="form.mode === '循环'" label="间隔分钟">
          <el-input-number v-model="form.intervalMinutes" :min="5" :max="720" />
        </el-form-item>
        <el-form-item v-else label="时间">
          <el-time-picker v-model="form.time" format="HH:mm" value-format="HH:mm" placeholder="13:00" style="width: 100%" />
        </el-form-item>
      </el-form>
      <div class="drawer-actions">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { isBuiltinSchedule } from '@/utils/builtinSchedules'
import { uid } from '@/utils/format'

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
  date: '',
  time: '13:00',
  intervalMinutes: 30,
  account: '',
  accounts: [],
  enabled: true,
  builtin: false,
  desc: ''
})

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
  if (row.date) return `${row.date} ${row.time}`
  return `每天 ${row.time || '--'}`
}

function onToggle(row) {
  if (row.id === 'SYS-collect' && row.time) store.settings.collectStart = row.time
  store.persist()
}

function edit(row, preset) {
  if (row) {
    Object.assign(form, {
      mode: '定时',
      enabled: true,
      intervalMinutes: 30,
      type: '审核通过后发布',
      builtin: false,
      desc: '',
      ...row,
      accounts: accountIds(row),
      builtin: isBuiltinSchedule(row)
    })
  } else {
    Object.assign(form, {
      id: '',
      name: preset || '',
      type: '审核通过后发布',
      mode: preset === '只跑一次' ? '单次' : (preset === '每隔一段时间检查' ? '循环' : '定时'),
      date: '',
      time: '13:00',
      intervalMinutes: 30,
      account: '',
      accounts: [],
      enabled: true,
      builtin: false,
      desc: ''
    })
  }
  visible.value = true
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写任务组名称')
  if (form.mode !== '循环' && !form.time) return ElMessage.warning('选择定时时间')
  const payload = {
    name: form.name.trim(),
    type: form.type || '审核通过后发布',
    mode: form.mode,
    date: form.mode === '单次' ? (form.date || '') : '',
    time: form.mode === '循环' ? '' : form.time,
    intervalMinutes: form.mode === '循环' ? Math.max(5, Number(form.intervalMinutes) || 30) : 0,
    account: (form.accounts || []).map((item) => accountName(item)).join('、'),
    accounts: [...(form.accounts || [])],
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
.schedule-page { min-height: calc(100vh - 88px); }
.schedule-tabs { margin-bottom: 4px; }
.tab-hint { margin: 0 0 12px; }
.preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.preset-grid button { text-align: left; border: 1px solid #eaecf0; background: #fff; border-radius: 12px; padding: 16px; cursor: pointer; }
.preset-grid span { display: block; color: #667085; margin-top: 6px; font-size: 12px; }
.drawer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
