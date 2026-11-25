<template>
  <div class="page">
    <MatrixTabs />
    <div class="panel">
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索形象" style="width: 220px" />
        <div class="grow">
          <el-button type="primary" @click="edit()">新建形象</el-button>
        </div>
      </div>
      <el-table :data="rows">
        <el-table-column prop="name" label="形象" min-width="160" />
        <el-table-column prop="voice" label="声音" width="140" />
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="syncStatus(row)" /></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="today" label="今日成片" width="100" />
        <el-table-column prop="note" label="备注" min-width="160" />
        <el-table-column prop="createdAt" label="创建时间" width="160" />
        <el-table-column label="操作" min-width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="visible" :title="form.id ? '编辑形象' : '新建形象'" width="460px">
      <el-form label-width="72px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="声音">
          <el-select v-model="form.voice" style="width: 100%">
            <el-option label="自然悦耳女声" value="自然悦耳女声" />
            <el-option label="温和女声" value="温和女声" />
            <el-option label="清亮男声" value="清亮男声" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MatrixTabs from '@/components/MatrixTabs.vue'
import { useAppStore } from '@/stores/app'
import { formatTime, uid } from '@/utils/format'

const store = useAppStore()
const keyword = ref('')
const visible = ref(false)
const form = reactive({ id: '', name: '', voice: '自然悦耳女声', note: '' })
const rows = computed(() => store.digitalHumans.filter((item) => !keyword.value || item.name.includes(keyword.value.trim())))

function syncStatus(row) {
  row.status = row.enabled ? '空闲' : '停用'
  store.persist()
}

function edit(row) {
  if (row) Object.assign(form, row)
  else Object.assign(form, { id: '', name: '', voice: '自然悦耳女声', note: '' })
  visible.value = true
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写形象名称')
  if (form.id) {
    const target = store.digitalHumans.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name: form.name, voice: form.voice, note: form.note })
  } else {
    store.digitalHumans.unshift({
      id: uid('DH'), name: form.name, voice: form.voice, enabled: true, status: '空闲', today: 0, note: form.note, createdAt: formatTime(new Date())
    })
  }
  store.persist()
  visible.value = false
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除形象 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.digitalHumans = store.digitalHumans.filter((item) => item.id !== row.id)
  store.persist()
}
</script>
