<template>
  <el-drawer v-model="visible" title="提示词模板" direction="rtl" size="420px">
    <div class="prompt-list">
      <button
        v-for="item in templates"
        :key="item.id"
        type="button"
        class="prompt-card"
        :class="{ on: item.id === store.settings.activePromptTemplateId }"
        @click="useTemplate(item)"
      >
        <b>{{ item.name }}</b>
        <span>{{ item.promptText }}</span>
      </button>
      <p v-if="!templates.length" class="muted">还没有模板。</p>
    </div>
    <div class="drawer-add">
      <el-input v-model="name" placeholder="模板名称，例如 细节特写" />
      <el-input v-model="text" type="textarea" :rows="6" placeholder="写提示词。商品标题会换成每件商品的名称。" />
      <el-button type="primary" style="width: 100%" @click="addTemplate">新增提示词模板</el-button>
    </div>
  </el-drawer>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { upgradePromptSettings } from '@/mock/data'

const visible = defineModel({ type: Boolean, default: false })
const store = useAppStore()
const name = ref('')
const text = ref('')
const templates = computed(() => {
  upgradePromptSettings(store.settings)
  return store.settings.promptTemplates || []
})

function useTemplate(item) {
  store.settings.activePromptTemplateId = item.id
  store.settings.promptText = item.promptText || ''
  store.persist()
  ElMessage.success(`当前模板：${item.name}`)
}

function addTemplate() {
  const promptText = text.value.trim()
  if (!promptText) return ElMessage.warning('先写提示词')
  const item = {
    id: `tpl-${Date.now().toString(36)}`,
    name: name.value.trim() || '未命名模板',
    promptText,
    model: store.settings.model,
    duration: store.settings.duration || '',
    ratio: store.settings.ratio,
    voice: store.settings.voice
  }
  store.settings.promptTemplates.push(item)
  store.settings.activePromptTemplateId = item.id
  store.settings.promptText = promptText
  name.value = ''
  text.value = ''
  store.persist()
  ElMessage.success('已新增模板')
}
</script>

<style scoped>
.prompt-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 320px); overflow: auto; }
.prompt-card { text-align: left; border: 1px solid #eaecf0; background: #fff; border-radius: 10px; padding: 10px; cursor: pointer; }
.prompt-card.on { border-color: #7c5cfc; background: #f6f3ff; }
.prompt-card b { display: block; margin-bottom: 4px; }
.prompt-card span { display: block; color: #667085; font-size: 12px; line-height: 1.5; max-height: 54px; overflow: hidden; }
.drawer-add { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
</style>
