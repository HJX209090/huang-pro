<template>
  <div class="page works-page">
    <div class="page-head">
      <div>
        <h1>我的作品</h1>
        <p>当前 {{ filtered.length }} 条 · {{ store.settings.model || '未设置模型' }}</p>
      </div>
      <div class="head-tools">
        <el-select :model-value="store.settings.model" style="width: 180px" @change="setModel">
          <el-option label="Seedance 2.0 Mini" value="Seedance 2.0 Mini" />
          <el-option label="Seedance 2.0" value="Seedance 2.0" />
        </el-select>
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="card">卡片</el-radio-button>
          <el-radio-button value="list">列表</el-radio-button>
        </el-radio-group>
      </div>
    </div>
    <div class="panel works-filters">
      <div class="filter-row">
        <span>类型</span>
        <el-radio-group v-model="kind" size="small">
          <el-radio-button v-for="item in ['全部', '混剪', '直播切片', 'AI']" :key="item" :value="item">{{ item }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="filter-row">
        <span>状态</span>
        <el-radio-group v-model="status" size="small">
          <el-radio-button v-for="item in statuses" :key="item" :value="item">{{ item }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="filters">
        <el-input v-model="keyword" clearable placeholder="标题 / 商品ID / 成片ID" style="width: 260px" @keyup.enter="applied = keyword" />
        <el-button type="primary" @click="applied = keyword">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="创建开始" end-placeholder="创建结束" />
      </div>
    </div>
    <div class="panel works-board">
      <div class="toolbar">
        <el-checkbox :model-value="allChecked" :indeterminate="someChecked" @change="toggleAll">全选</el-checkbox>
        <span class="muted">已选 {{ selected.length }}</span>
        <div class="grow"></div>
        <el-button @click="exportExcel">导出 Excel</el-button>
        <el-button :disabled="!selected.length" @click="markStatus('已生成')">重新为待审核</el-button>
        <el-button type="success" plain :disabled="!selected.length" @click="markStatus('审核通过')">标为已审核</el-button>
        <el-button type="danger" plain :disabled="!selected.length" @click="removeSelected">删除</el-button>
      </div>
      <div v-if="!filtered.length" class="empty-works">
        <p>「{{ store.settings.model || '全部模型' }} · {{ status }}」下暂无作品</p>
        <p class="muted">可切换上方状态筛选，或去剪辑中心生成新成片</p>
        <el-button type="primary" @click="router.push('/doubao')">去剪辑中心</el-button>
      </div>
      <el-table v-else-if="viewMode === 'list'" :data="pageRows" @selection-change="onTableSelect">
        <el-table-column type="selection" width="42" />
        <el-table-column label="标题" min-width="240">
          <template #default="{ row }">
            <div class="list-title">{{ row.title }}</div>
            <div class="goods-sub">{{ row.platform || '抖音' }} · {{ row.model || '未设置模型' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ displayWorkStatus(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="168" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="row-ops">
              <el-button v-if="canReview(row)" link type="primary" @click="open(row)">审核</el-button>
              <el-button v-if="canRepublish(row)" link type="primary" :loading="publishId === row.id" @click="republish(row)">再发布</el-button>
              <el-button v-if="canRegenerate(row)" link type="primary" :loading="regenId === row.id" @click="regenerate(row)">重新生成</el-button>
              <el-button v-if="row.videoPath" link type="primary" @click="strip(row)">去水印</el-button>
              <el-button link type="danger" @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="work-grid">
        <article v-for="work in pageRows" :key="work.id" class="work-card" :class="{ picked: selected.includes(work.id) }" @click="canReview(work) ? open(work) : null">
          <div class="work-cover" :class="{ generating: !work.videoPath && work.status === '生成中' }">
            <el-checkbox class="work-pick" :model-value="selected.includes(work.id)" @click.stop @change="toggle(work.id)" />
            <el-tag class="badge" size="small" :type="statusType(work.status)">{{ displayWorkStatus(work.status) }}</el-tag>
            <video v-if="work.videoPath" class="work-cover" :src="videoUrl(work.videoPath)" muted></video>
            <div v-else-if="work.status === '生成中'" class="gen-motion">
              <i class="gen-spin"></i>
              <div class="gen-walk"><i></i></div>
            </div>
            <span v-else class="cover-empty">{{ work.status === '生成失败' ? '生成失败' : '暂无成片' }}</span>
          </div>
          <div class="work-body">
            <div class="goods-title">{{ work.title }}</div>
            <div class="goods-sub">{{ work.platform || '抖音' }} · {{ work.createdAt }}</div>
            <div v-if="work.failReason" class="fail-line">{{ work.failReason }}</div>
            <div class="work-actions" @click.stop>
              <el-button v-if="canRepublish(work)" size="small" type="primary" :loading="publishId === work.id" @click="republish(work)">再发布</el-button>
              <el-button v-if="canRegenerate(work)" size="small" type="primary" :loading="regenId === work.id" @click="regenerate(work)">重新生成</el-button>
              <el-button v-if="canReview(work)" size="small" @click="open(work)">审核</el-button>
            </div>
          </div>
        </article>
      </div>
      <div v-if="filtered.length" class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="filtered.length"
          :page-sizes="[8, 12, 20, 40, 60]"
          v-model:page-size="pageSize"
          v-model:current-page="page"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { displayWorkStatus, statusType, videoUrl } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const statuses = ['全部', '待审核', '已审核', '制作中', '待发布', '发布中', '已发布', '数据失败', '发布失败']
const kind = ref('全部')
const status = ref('全部')
const keyword = ref('')
const applied = ref('')
const range = ref([])
const selected = ref([])
const viewMode = ref('card')
const page = ref(1)
const pageSize = ref(12)

function matchStatus(work) {
  if (status.value === '全部') return true
  if (status.value === '待审核') return work.status === '已生成'
  if (status.value === '已审核' || status.value === '待发布') return work.status === '审核通过'
  if (status.value === '制作中') return work.status === '待生成' || work.status === '生成中'
  if (status.value === '数据失败') return work.status === '生成失败'
  if (status.value === '发布失败') return work.status === '审核失败'
  return work.status === status.value
}

const filtered = computed(() => store.works.filter((work) => {
  if (applied.value && !`${work.title} ${work.id} ${work.productId || ''}`.includes(applied.value.trim())) return false
  if (!matchStatus(work)) return false
  if (kind.value === '混剪' && work.kind !== '混剪') return false
  if (kind.value === '直播切片' && work.kind !== '直播切片') return false
  if (kind.value === 'AI' && work.kind && work.kind !== 'AI' && !work.model) return false
  if (range.value?.length === 2) {
    const day = String(work.createdAt || '').slice(0, 10)
    if (day < range.value[0] || day > range.value[1]) return false
  }
  return true
}))

const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const allChecked = computed(() => pageRows.value.length > 0 && pageRows.value.every((work) => selected.value.includes(work.id)))
const someChecked = computed(() => selected.value.length > 0 && !allChecked.value)

watch([kind, status, applied, range, viewMode, pageSize], () => { page.value = 1 })
watch(filtered, () => {
  const maxPage = Math.max(1, Math.ceil(filtered.value.length / pageSize.value) || 1)
  if (page.value > maxPage) page.value = maxPage
})

function resetFilters() {
  keyword.value = ''
  applied.value = ''
  kind.value = '全部'
  status.value = '全部'
  range.value = []
  page.value = 1
}

function setModel(value) {
  store.settings.model = value
  store.persist()
}

function toggle(id) {
  selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : selected.value.concat(id)
}

function toggleAll(checked) {
  const ids = pageRows.value.map((work) => work.id)
  selected.value = checked ? [...new Set(selected.value.concat(ids))] : selected.value.filter((id) => !ids.includes(id))
}

function onTableSelect(rows) {
  selected.value = rows.map((item) => item.id)
}

function markStatus(next) {
  store.works.forEach((work) => {
    if (selected.value.includes(work.id)) work.status = next
  })
  store.flush()
  ElMessage.success(next === '审核通过' ? '已标为已审核，可被定时任务领取' : '已改回待审核')
}

function exportExcel() {
  const rows = (selected.value.length ? filtered.value.filter((work) => selected.value.includes(work.id)) : filtered.value)
  if (!rows.length) return ElMessage.warning('没有可导出的作品')
  const header = ['标题', '平台', '状态', '模型', '成片', '创建时间']
  const body = rows.map((work) => [work.title, work.platform || '抖音', work.status, work.model || '', work.videoPath || '', work.createdAt || ''])
  const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '我的作品.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

async function strip(work) {
  const account = store.doubaoAccounts.find((item) => item.id === work.doubaoAccountId)
    || store.doubaoAccounts.find((item) => item.name === work.doubaoAccount)
    || store.doubaoAccounts[0]
  if (!account) return ElMessage.warning('先登录生成这条视频的豆包账号')
  if (!window.tujian?.pullCleanDoubao) return ElMessage.warning('请在桌面窗口里拉取无水印')
  const result = await window.tujian.pullCleanDoubao({
    id: account.id,
    name: account.name,
    login: account.login,
    mode: account.loginMode || 'password',
    chatUrl: work.doubaoChatUrl || '',
    outputFile: work.videoPath,
    outputDir: store.settings.outputDir
  })
  if (!result?.ok) return ElMessage.error(result?.message || '没有拿到无水印视频')
  work.videoPath = result.videoPath
  if (result.doubaoChatUrl) work.doubaoChatUrl = result.doubaoChatUrl
  store.persist()
  ElMessage.success(result.message)
}

const regenId = ref('')
const publishId = ref('')

function canReview(work) {
  // 仅「已生成/待审核」可点审核；审核通过后不再出现
  return work?.status === '已生成'
}

function canRegenerate(work) {
  return ['已生成', '审核通过', '生成失败', '待生成', '审核失败', '已发布'].includes(work?.status)
}

function canRepublish(work) {
  return Boolean(work?.videoPath) && ['已发布', '发布中', '审核通过'].includes(work.status)
}

async function republish(work) {
  if (publishId.value) return ElMessage.info('已有一条正在发布')
  publishId.value = work.id
  try {
    const message = await store.republishWork(work.id)
    if (message) ElMessage.warning(message)
    else ElMessage.success('已再次走完发布流程')
  } catch (error) {
    ElMessage.error(error.message || '再发布失败')
  } finally {
    publishId.value = ''
  }
}

async function regenerate(work) {
  if (regenId.value) return ElMessage.info('已有重新生成在进行')
  regenId.value = work.id
  try {
    const message = await store.regenerateWork(work.id)
    if (message) {
      store.addLog('error', '豆包', `重新生成失败：${message}`)
      return ElMessage.warning(message)
    }
    ElMessage.success('正在打开豆包并发送商品图和提示词')
  } catch (error) {
    store.addLog('error', '豆包', error.message || '重新生成中断')
    ElMessage.error(error.message || '重新生成失败')
  } finally {
    regenId.value = ''
  }
}

function open(work) {
  router.push({ path: '/workbench', query: { id: work.id } })
}

async function remove(work) {
  try {
    await ElMessageBox.confirm(`删除作品「${work.title}」？`, '删除作品', { type: 'warning' })
  } catch { return }
  store.works = store.works.filter((item) => item.id !== work.id)
  selected.value = selected.value.filter((id) => id !== work.id)
  store.persist()
}

async function removeSelected() {
  try {
    await ElMessageBox.confirm(`删除选中的 ${selected.value.length} 条作品？`, '批量删除', { type: 'warning' })
  } catch { return }
  const ids = new Set(selected.value)
  store.works = store.works.filter((item) => !ids.has(item.id))
  selected.value = []
  store.persist()
}
</script>

<style scoped>
.head-tools { display: flex; align-items: center; gap: 8px; flex: none; }
.works-filters { display: grid; gap: 8px; padding: 12px 14px; }
.filter-row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.filter-row > span { width: 32px; color: #667085; flex: none; font-size: 12px; line-height: 28px; }
.filter-row :deep(.el-radio-group) { display: flex; flex-wrap: wrap; gap: 4px; }
.filter-row :deep(.el-radio-button__inner) {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px !important;
}
.works-filters :deep(.el-radio-button:first-child .el-radio-button__inner),
.works-filters :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 6px !important;
}
.works-board { min-height: 360px; }
.empty-works { text-align: center; padding: 48px 16px; }
.list-title {
  font-weight: 600;
  line-height: 1.4;
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.work-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
  align-items: stretch;
}
.work-card {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #eaecf0;
  background: #fff;
  cursor: pointer;
}
.work-card.picked { outline: 2px solid #5b8cff; }
.work-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: #f2f4f7;
  border-bottom: 1px solid #f2f4f7;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.work-cover video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.work-pick { position: absolute; left: 6px; top: 6px; z-index: 2; }
.badge { position: absolute; right: 6px; top: 6px; z-index: 2; }
.cover-empty { color: #d0d5dd; font-size: 12px; font-weight: 600; }
.work-body { display: flex; flex-direction: column; gap: 4px; flex: 1; padding: 8px 9px 10px; }
.work-body .goods-title {
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.work-body .goods-sub { font-size: 11px; color: #98a2b3; }
.fail-line {
  color: #d92d20;
  font-size: 11px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.work-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 2px; }
.work-actions .el-button { flex: 1; margin: 0; }
.work-actions :deep(.el-button) { --el-button-size: 24px; padding: 4px 8px; font-size: 12px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
