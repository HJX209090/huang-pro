<template>
  <div class="tpl-bar">
    <el-select v-model="activeId" filterable placeholder="选择提示词模板" style="width: 220px">
      <el-option v-for="item in templates" :key="item.id" :label="item.name" :value="item.id" />
    </el-select>
    <el-button @click="saveCurrent">保存到当前模板</el-button>
    <el-button type="primary" plain @click="saveAs">另存为新模板</el-button>
    <el-button @click="rename">重命名</el-button>
    <el-button type="danger" plain :disabled="templates.length < 2" @click="remove">删除</el-button>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { upgradePromptSettings } from '@/mock/data'
import { uid } from '@/utils/format'

const props = defineProps({
  promptText: { type: String, default: '' },
  model: { type: String, default: '' },
  duration: { type: [String, Number], default: '' },
  ratio: { type: String, default: '' },
  voice: { type: String, default: '' }
})
const emit = defineEmits(['apply'])
const store = useAppStore()

onMounted(() => {
  upgradePromptSettings(store.settings)
})

const templates = computed(() => store.settings.promptTemplates || [])
const activeId = computed({
  get: () => store.settings.activePromptTemplateId || '',
  set: (id) => pick(id)
})

function current() {
  return {
    promptText: props.promptText || '',
    model: props.model || store.settings.model,
    duration: props.duration ?? '',
    ratio: props.ratio || store.settings.ratio,
    voice: props.voice || store.settings.voice
  }
}

function pick(id) {
  const item = templates.value.find((row) => row.id === id)
  if (!item) return
  store.settings.activePromptTemplateId = id
  store.settings.promptText = item.promptText || ''
  if (item.model) store.settings.model = item.model
  if (item.ratio) store.settings.ratio = item.ratio
  if (item.voice) store.settings.voice = item.voice
  store.settings.duration = item.duration ?? ''
  store.persist()
  emit('apply', { ...item })
}

function writeActive() {
  const item = templates.value.find((row) => row.id === store.settings.activePromptTemplateId)
  if (!item) return false
  Object.assign(item, current())
  store.settings.promptText = item.promptText
  store.persist()
  return true
}

async function saveCurrent() {
  if (!writeActive()) return ElMessage.warning('先选择一个模板')
  ElMessage.success('已保存到当前模板')
}

async function saveAs() {
  try {
    const { value } = await ElMessageBox.prompt('模板名称', '另存为新模板', { inputValue: '新模板' })
    const name = String(value || '').trim()
    if (!name) return
    const item = { id: uid('PT'), name, ...current() }
    store.settings.promptTemplates.push(item)
    store.settings.activePromptTemplateId = item.id
    store.settings.promptText = item.promptText
    store.persist()
    emit('apply', { ...item })
    ElMessage.success(`已添加模板 ${name}`)
  } catch { /* 取消 */ }
}

async function rename() {
  const item = templates.value.find((row) => row.id === store.settings.activePromptTemplateId)
  if (!item) return
  try {
    const { value } = await ElMessageBox.prompt('模板名称', '重命名', { inputValue: item.name })
    const name = String(value || '').trim()
    if (!name) return
    item.name = name
    store.persist()
  } catch { /* 取消 */ }
}

async function remove() {
  if (templates.value.length < 2) return
  const item = templates.value.find((row) => row.id === store.settings.activePromptTemplateId)
  if (!item) return
  try {
    await ElMessageBox.confirm(`删除模板「${item.name}」？`, '删除模板', { type: 'warning' })
  } catch { return }
  store.settings.promptTemplates = store.settings.promptTemplates.filter((row) => row.id !== item.id)
  pick(store.settings.promptTemplates[0].id)
}
</script>

<style scoped>
.tpl-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
</style>
