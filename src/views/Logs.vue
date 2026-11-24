<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>日志管理</h1>
        <p>同步过程在这里，模块选「同步」就能看到卡在哪一步。最多保留 2000 条。</p>
      </div>
      <el-button @click="openFile">打开日志文件</el-button>
      <el-button @click="clearLogs">清空</el-button>
    </div>
    <div class="panel filters">
      <el-select v-model="moduleName" clearable placeholder="全部模块" style="width: 140px" @change="page = 1">
        <el-option v-for="item in modules" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="operator" clearable placeholder="全部操作人" style="width: 140px" @change="page = 1">
        <el-option v-for="item in operators" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="level" clearable placeholder="全部级别" style="width: 140px" @change="page = 1">
        <el-option label="信息" value="info" />
        <el-option label="成功" value="success" />
        <el-option label="警告" value="warning" />
      </el-select>
    </div>
    <div class="panel">
      <el-table :data="pageRows">
        <el-table-column prop="time" label="时间" width="170" />
        <el-table-column label="操作人" width="110">
          <template #default="{ row }">{{ row.operator || '本地用户' }}</template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="100" />
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="levelType(row.level)">{{ levelText(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="内容" min-width="280" />
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="rows.length"
          :page-sizes="[10, 20, 50, 100]"
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
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const moduleName = ref('')
const operator = ref('')
const level = ref('')
const page = ref(1)
const pageSize = ref(20)
const modules = computed(() => [...new Set(store.logs.map((item) => item.module))])
const operators = computed(() => [...new Set(store.logs.map((item) => item.operator || '本地用户'))])
watch([moduleName, operator, level, pageSize], () => { page.value = 1 })

function levelType(value) {
  if (value === 'success') return 'success'
  if (value === 'warning') return 'warning'
  return 'info'
}

function levelText(value) {
  if (value === 'success') return '成功'
  if (value === 'warning') return '警告'
  return '信息'
}

const rows = computed(() => store.logs.filter((item) => {
  if (moduleName.value && item.module !== moduleName.value) return false
  if (operator.value && (item.operator || '本地用户') !== operator.value) return false
  if (level.value && item.level !== level.value) return false
  return true
}))

const pageRows = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function openFile() {
  if (!window.tujian?.openLogFile) return ElMessage.warning('请在桌面窗口里打开')
  const result = await window.tujian.openLogFile()
  if (result?.file) ElMessage.success('已定位到日志文件')
}

async function clearLogs() {
  try { await ElMessageBox.confirm('清空全部日志？', '清空', { type: 'warning' }) } catch { return }
  store.logs = []
  page.value = 1
  store.persist()
}
</script>
