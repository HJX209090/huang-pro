<template>
  <el-dialog v-model="store.promptVisible" title="视频生成参数确认" width="780px" top="4vh">
    <div style="max-height: calc(100vh - 230px); overflow: auto; padding-right: 6px">
    <p class="muted" style="margin-top: 0">
      {{ boundCount ? `将为 ${boundCount} 件商品各生成一条成片。` : '不绑定商品，生成一条空标题视频。' }}
      提示词整段填写，「商品标题」会换成这件商品的名称。
    </p>
    <el-form label-position="top">
      <div class="form-grid">
        <el-form-item label="模型">
          <el-select v-model="form.model" style="width: 100%">
            <el-option label="Seedance 2.0 Mini" value="Seedance 2.0 Mini" />
            <el-option label="Seedance 2.0" value="Seedance 2.0" />
          </el-select>
        </el-form-item>
        <el-form-item label="时长">
          <el-input v-model="form.duration" placeholder="留空或自己填秒数" />
        </el-form-item>
        <el-form-item label="比例">
          <el-select v-model="form.ratio" style="width: 100%">
            <el-option label="9:16 竖屏" value="9:16" />
            <el-option label="3:4" value="3:4" />
            <el-option label="1:1" value="1:1" />
          </el-select>
        </el-form-item>
        <el-form-item label="声音">
          <el-select v-model="form.voice" style="width: 100%">
            <el-option label="自然悦耳女声" value="自然悦耳女声" />
            <el-option label="温和女声" value="温和女声" />
            <el-option label="清亮男声" value="清亮男声" />
          </el-select>
        </el-form-item>
      </div>
      <div class="prompt-photos">
        <div v-for="item in drafts" :key="item.id || 'empty'" class="prompt-photo-block">
          <div class="goods-title">{{ item.title }}</div>
          <div class="prompt-photo-row">
            <div v-for="(src, index) in item.images" :key="`${item.id}-${index}`" class="prompt-shot">
              <HoverPreview :images="item.images" :start="index">
                <img :src="imageUrl(src)" alt="" />
              </HoverPreview>
              <button type="button" class="shot-remove" title="删除这张" @click="removeShot(item, index)">删除</button>
            </div>
            <button type="button" class="shot-add" @click="uploadImages(item)">上传图片</button>
          </div>
          <p v-if="!item.images.length" class="muted">还没有图片。必须先上传或同步商品图，确认后才会打开豆包发送。</p>
        </div>
      </div>
      <el-form-item label="提示词模板">
        <PromptTemplateBar
          :prompt-text="form.promptText"
          :model="form.model"
          :duration="form.duration"
          :ratio="form.ratio"
          :voice="form.voice"
          @apply="applyTemplate"
        />
        <el-input v-model="form.promptText" type="textarea" :rows="16" placeholder="直接粘贴完整提示词。可保存成多个模板再切换。写「商品标题」就会换成下面每件商品的名称。" />
        <div v-if="filledRows.length" class="prompt-filled">
          <div v-for="item in filledRows" :key="item.id" class="prompt-filled-item">
            <b>{{ item.title }}</b>
            <pre>{{ item.text }}</pre>
          </div>
        </div>
      </el-form-item>
    </el-form>
    </div>
    <template #footer>
      <el-button @click="store.promptVisible = false">取消</el-button>
      <el-button type="primary" :loading="confirming" @click="confirm">确认生成视频</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { upgradePromptSettings } from '@/mock/data'
import HoverPreview from '@/components/HoverPreview.vue'
import PromptTemplateBar from '@/components/PromptTemplateBar.vue'
import { composePrompt, imageUrl } from '@/utils/format'

const store = useAppStore()
const form = reactive(emptyForm())
const confirming = ref(false)

function emptyForm() {
  return {
    model: 'Seedance 2.0 Mini',
    duration: '',
    ratio: '9:16',
    voice: '自然悦耳女声',
    promptText: ''
  }
}

const drafts = ref([])
const boundCount = computed(() => drafts.value.filter((item) => item.id).length)
const filledRows = computed(() => drafts.value.filter((item) => item.id).map((item) => ({
  id: item.id,
  title: item.title,
  text: composePrompt(form, store.products.find((row) => row.id === item.id) || item)
})))

function productImages(item) {
  const removed = new Set(item?.removedImages || [])
  return [...new Set([...(item?.images || []), item?.image].map((src) => String(src || '').trim()).filter((src) => src && !removed.has(src) && (/^https?:\/\//.test(src) || src.startsWith('//') || /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\') || src.startsWith('file:') || src.startsWith('local-video:'))))]
}

watch(() => store.promptVisible, (visible) => {
  if (!visible) return
  const rows = store.products.filter((item) => store.promptProductIds.includes(item.id))
  drafts.value = (rows.length ? rows : [{ id: '', title: '本次上传的图片', images: [] }]).map((item) => ({
    id: item.id,
    title: item.title,
    images: productImages(item)
  }))
  const before = store.settings.productLock
  upgradePromptSettings(store.settings)
  if (store.settings.productLock !== before) store.persist()
  form.model = store.settings.model
  form.duration = store.settings.duration || ''
  form.ratio = store.settings.ratio
  form.voice = store.settings.voice
  // 确认框只放模板。已经替换过的提示词里带着某一件商品的名字，不能拿来套下一件。
  form.promptText = String(store.settings.promptText || '').trim()
})

async function uploadImages(item) {
  if (!window.tujian?.pickImages) {
    ElMessage.warning('请在桌面窗口里上传图片')
    return
  }
  const files = await window.tujian.pickImages()
  if (!files?.length) return
  item.images.push(...files)
}

function removeShot(item, index) {
  const src = item.images[index]
  item.images.splice(index, 1)
  if (item.id && src) store.removeProductImage(item.id, src)
}

function applyTemplate(item) {
  form.promptText = item.promptText || ''
  if (item.model) form.model = item.model
  if (item.ratio) form.ratio = item.ratio
  if (item.voice) form.voice = item.voice
  form.duration = item.duration || ''
}

async function confirm() {
  if (confirming.value) return
  confirming.value = true
  try {
  const account = store.doubaoAccount()
  if (!account) {
    ElMessage.error('先添加一个豆包账号。没有账号时，确认生成视频不会打开网页')
    return
  }
  if (!window.tujian?.openAccount || !window.tujian?.generateDoubao) {
    ElMessage.error('请在桌面的 huang++pro 窗口里点确认生成视频')
    return
  }
  if (!String(form.promptText || '').trim()) {
    ElMessage.warning('先填写提示词。提示词和图片必须一起发')
    return
  }
  const missing = drafts.value.filter((item) => item.id && !item.images.length)
  if (missing.length) {
    ElMessage.warning(`「${missing[0].title}」没有商品图。先上传图片，或回到选品库同步后再生成`)
    return
  }
  store.settings.promptText = form.promptText
  store.settings.model = form.model
  store.settings.duration = form.duration
  store.settings.ratio = form.ratio
  store.settings.voice = form.voice
  const active = (store.settings.promptTemplates || []).find((item) => item.id === store.settings.activePromptTemplateId)
  if (active) Object.assign(active, { promptText: form.promptText, model: form.model, duration: form.duration, ratio: form.ratio, voice: form.voice })
  store.persist()
  try {
    const opened = await window.tujian.openAccount({
      kind: 'doubao',
      id: account.id,
      name: account.name,
      login: account.login || '',
      mode: account.loginMode || 'password',
      url: 'https://www.doubao.com/chat/',
      slot: 'acct',
      already: account.loginStatus === '已登录'
    })
    if (opened && opened.ok === false) {
      ElMessage.error(opened.message || '豆包网页没有打开')
      return
    }
  } catch (error) {
    ElMessage.error(error?.message || '豆包网页没有打开')
    return
  }
  const imagesByProduct = {}
  drafts.value.forEach((item) => {
    const product = store.products.find((row) => row.id === item.id)
    const removed = new Set(product?.removedImages || [])
    const images = (item.images || []).filter((src) => src && !removed.has(src))
    item.images = images
    imagesByProduct[item.id] = [...images]
  })
  drafts.value.forEach((item) => {
    if (!item.id || !item.images.length) return
    store.setProductImages(item.id, item.images)
  })
  const created = store.createWorks(store.promptProductIds, { ...form, imagesByProduct })
  if (!created?.length) {
    ElMessage.error('豆包网页已打开，但这几件商品没有生成任务')
    return
  }
  store.promptVisible = false
  ElMessage.success(`已打开豆包，正在发送 ${created.length} 条的图片和提示词`)
  } finally {
    confirming.value = false
  }
}
</script>

<style scoped>
.prompt-photos { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.prompt-photo-row { display: flex; gap: 8px; overflow: auto; padding-bottom: 4px; }
.prompt-photo-row img { width: 76px; height: 76px; object-fit: cover; border-radius: 8px; background: #f3f4f6; flex: none; cursor: zoom-in; }
.prompt-shot { position: relative; flex: none; }
.shot-remove, .shot-add {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.shot-remove {
  position: absolute;
  z-index: 2;
  right: 4px;
  bottom: 4px;
  background: rgba(17, 24, 39, .72);
  color: #fff;
  font-size: 12px;
  padding: 2px 6px;
}
.shot-add {
  width: 76px;
  height: 76px;
  background: #f8fafc;
  color: #344054;
  border: 1px dashed #d0d5dd;
}
.prompt-filled { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; max-height: 220px; overflow: auto; }
.prompt-filled-item { background: #f8fafc; border-radius: 8px; padding: 8px 10px; }
.prompt-filled-item pre { margin: 6px 0 0; white-space: pre-wrap; font-family: inherit; font-size: 12px; color: #344054; }
</style>
