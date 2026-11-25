<template>
  <div class="page rpa-page">
    <div class="page-head">
      <div>
        <h1>RPA 流程</h1>
        <p>流程保存在这台电脑上。可以自己选步骤和发布项，定时任务的下拉里也能选到。</p>
      </div>
      <el-button type="primary" size="large" @click="edit()">新建流程</el-button>
    </div>
    <section class="panel">
      <el-table :data="flows">
        <el-table-column prop="name" label="流程名称" min-width="160" />
        <el-table-column label="步骤" min-width="280">
          <template #default="{ row }">{{ (row.steps || []).join(' → ') || '还没有步骤' }}</template>
        </el-table-column>
        <el-table-column label="启用" width="88">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="store.persist()" /></template>
        </el-table-column>
        <el-table-column label="最近执行" min-width="150">
          <template #default="{ row }">{{ row.lastRun || '还没有' }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="220">
          <template #default="{ row }">
            <div class="row-ops">
              <el-button type="primary" plain :disabled="!row.enabled || runningId === row.id" @click="run(row)">
                {{ runningId === row.id ? '执行中' : '执行' }}
              </el-button>
              <el-button @click="edit(row)">编辑</el-button>
              <el-button type="danger" plain @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="!flows.length" class="muted empty-line">还没有流程。点右上角新建，选好步骤后就能在定时任务里选用。</p>
    </section>

    <el-dialog v-model="visible" :title="form.id ? '编辑流程' : '新建流程'" width="min(680px, 94vw)">
      <el-form label-width="88px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：抖音挂车发布" />
        </el-form-item>
        <el-form-item label="步骤">
          <el-select v-model="form.steps" multiple clearable placeholder="默认不选，点开后选择" style="width: 100%">
            <el-option v-for="item in stepOptions" :key="item.key" :label="item.label" :value="item.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布项">
          <el-select v-model="form.options" multiple clearable filterable placeholder="默认不选，点开后选择" style="width: 100%">
            <el-option v-for="item in publishOptions" :key="item.key" :label="item.label" :value="item.key" />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="muted">步骤按固定顺序执行：打开上传页、检查登录、上传并填文案、挂商品、点击发布。发布项决定这一次要不要填标题、话题、挂车、声明和私密。选中的标签可以点 × 去掉。</p>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存流程</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { uid } from '@/utils/format'
import { PUBLISH_OPTION_DEFS, RPA_STEP_DEFS, blankPublishPage } from '@/utils/rpa'

const store = useAppStore()
const flows = computed(() => (store.rpaFlows || []).filter((item) => !item.platform || item.platform === '抖音'))
const runningId = ref('')
const visible = ref(false)
const form = reactive({ id: '', name: '', steps: [], options: [], enabled: true })
const stepOptions = RPA_STEP_DEFS
const publishOptions = PUBLISH_OPTION_DEFS
const stepOrder = RPA_STEP_DEFS.map((item) => item.key)

function edit(row) {
  if (row) {
    Object.assign(form, {
      id: row.id,
      name: row.name || '',
      steps: [...(row.steps || [])],
      options: [...(row.options || [])],
      enabled: row.enabled !== false
    })
  } else {
    Object.assign(form, { id: '', name: '', steps: [], options: [], enabled: true })
  }
  visible.value = true
}

function save() {
  const name = form.name.trim()
  if (!name) return ElMessage.warning('填写流程名称')
  const steps = stepOrder.filter((item) => form.steps.includes(item))
  const options = publishOptions.map((item) => item.key).filter((item) => form.options.includes(item))
  if (!Array.isArray(store.rpaFlows)) store.rpaFlows = []
  if (form.id) {
    const target = store.rpaFlows.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name, steps, options, platform: '抖音' })
  } else {
    store.rpaFlows.unshift({
      id: uid('RPA'),
      name,
      platform: '抖音',
      enabled: true,
      steps,
      options,
      lastRun: ''
    })
  }
  store.persist()
  visible.value = false
  ElMessage.success('流程已保存')
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除流程「${row.name}」？`, '删除', { type: 'warning' }) } catch { return }
  store.rpaFlows = store.rpaFlows.filter((item) => item.id !== row.id)
  store.schedules.forEach((task) => {
    if (Array.isArray(task.picks)) task.picks = task.picks.filter((item) => item !== `flow:${row.id}`)
  })
  store.persist()
  ElMessage.success('已删除')
}

async function run(flow) {
  if (runningId.value) return
  runningId.value = flow.id
  const page = blankPublishPage(store.settings.publishPage?.dyDelay)
  ;(flow.options || []).forEach((key) => { page[key] = true })
  if (!(flow.options || []).some((key) => String(key).startsWith('claim'))) page.claimDoubao = true
  try {
    const result = await store.runRpaFlow(flow, { page })
    if (result?.ok) ElMessage.success(result.message || '已执行')
    else ElMessage.warning(result?.message || '没有执行完')
  } catch (error) {
    ElMessage.error(error.message || '执行失败')
  } finally {
    runningId.value = ''
  }
}
</script>

<style scoped>
.empty-line { margin: 12px 0 0; }
</style>
