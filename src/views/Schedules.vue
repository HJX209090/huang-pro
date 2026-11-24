<template>
  <div class="page schedule-page">
    <div class="schedule-main">
      <div class="page-head">
        <div>
          <h1>定时任务</h1>
          <p>软件开着时到点自动跑；点「立即执行」会马上跑这一条，不用等到设定时间。</p>
        </div>
        <el-button type="primary" @click="edit()">新建任务组</el-button>
      </div>
      <div class="panel">
        <h3>任务列表</h3>
        <el-table :data="store.schedules">
          <el-table-column prop="name" label="任务组名称" min-width="140" />
          <el-table-column label="触发方式" width="100">
            <template #default="{ row }">{{ row.mode || '定时' }}</template>
          </el-table-column>
          <el-table-column label="触发时间" width="160">
            <template #default="{ row }">{{ row.mode === '循环' ? `每 ${row.intervalMinutes || 30} 分钟` : (row.date ? `${row.date} ${row.time}` : `每天 ${row.time}`) }}</template>
          </el-table-column>
          <el-table-column prop="account" label="发布账号" width="140" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }"><el-switch v-model="row.enabled" @change="store.persist()" /></template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :loading="runningId === row.id" @click="run(row)">立即执行</el-button>
              <el-button link @click="edit(row)">编辑</el-button>
              <el-button link type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p v-if="!store.schedules.length" class="muted">暂无定时任务。点右上角新建任务组。</p>
      </div>
      <div class="preset-grid">
        <button type="button" @click="edit(null, '原片回放（小白）')">原片回放（小白）<span>每天固定时刻发布</span></button>
        <button type="button" @click="edit(null, '每隔一段时间检查')">每隔一段时间检查<span>到点检查审核通过的作品</span></button>
        <button type="button" @click="edit(null, '只跑一次')">只跑一次<span>指定日期只执行一次</span></button>
      </div>
    </div>
    <el-drawer v-model="visible" :title="form.id ? '编辑任务组' : '新建任务组'" size="460px">
      <el-form label-position="top">
        <h3>1. 基本信息</h3>
        <el-form-item label="任务组名称">
          <el-input v-model="form.name" placeholder="任务组名称（必填）" />
        </el-form-item>
        <h3>2. 本机 RPA 流程</h3>
        <p class="muted">到点后打开这个账号的抖音上传页，写入作品标题和按标题生成的 5 个标签，并点击发布。</p>
        <el-button @click="router.push('/rpa')">管理本机流程</el-button>
        <h3>3. 选择发布账号</h3>
        <el-select v-model="form.account" clearable placeholder="全部账号" style="width: 100%" @visible-change="(open) => open && syncAccountStatus()">
          <el-option
            v-for="item in store.publishAccounts"
            :key="item.id"
            :label="`${item.name}（${item.loginStatus || '未检测'}）`"
            :value="item.name"
          />
        </el-select>
        <p class="muted">定时与发布共用同一浏览器会话。请先在「发布账号」里同窗口登录百应+创作者（创作者需抖音会话）；之后到点免二次扫码。仅登百应、从未在同窗口进过创作者时，仍可能要扫一次抖音。</p>
        <h3>4. 触发节奏</h3>
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
        <el-button type="primary" @click="save">创建任务组</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { uid } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const visible = ref(false)
const runningId = ref('')
const form = reactive({ id: '', name: '', type: '审核通过后发布', mode: '定时', date: '', time: '13:00', intervalMinutes: 30, account: '', enabled: true })

function edit(row, preset) {
  if (row) Object.assign(form, { mode: '定时', enabled: true, intervalMinutes: 30, ...row })
  else Object.assign(form, { id: '', name: preset || '', type: '审核通过后发布', mode: preset === '只跑一次' ? '单次' : (preset === '每隔一段时间检查' ? '循环' : '定时'), date: '', time: '13:00', intervalMinutes: 30, account: '', enabled: true })
  visible.value = true
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写任务组名称')
  if (form.mode !== '循环' && !form.time) return ElMessage.warning('选择定时时间')
  const payload = {
    name: form.name.trim(),
    type: '审核通过后发布',
    mode: form.mode,
    date: form.mode === '单次' ? (form.date || '') : '',
    time: form.mode === '循环' ? '' : form.time,
    intervalMinutes: form.mode === '循环' ? Math.max(5, Number(form.intervalMinutes) || 30) : 0,
    account: form.account || '',
    enabled: form.enabled !== false
  }
  if (form.id) {
    const target = store.schedules.find((item) => item.id === form.id)
    if (target) Object.assign(target, payload)
  } else {
    store.schedules.unshift({ ...payload, id: uid('SC'), lastRun: '' })
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
      if (st?.loginStatus) account.loginStatus = st.loginStatus
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
  try { await ElMessageBox.confirm(`删除任务 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.schedules = store.schedules.filter((item) => item.id !== row.id)
  store.persist()
}
</script>

<style scoped>
.schedule-page { min-height: calc(100vh - 88px); }
.preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.preset-grid button { text-align: left; border: 1px solid #eaecf0; background: #fff; border-radius: 12px; padding: 16px; cursor: pointer; }
.preset-grid span { display: block; color: #667085; margin-top: 6px; font-size: 12px; }
.drawer-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
