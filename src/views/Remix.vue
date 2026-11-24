<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>视频二创</h1>
        <p>把商品和参考素材交给已登录的豆包，按当前提示词模板生成一条新视频。</p>
      </div>
      <span class="num-hint">已存任务 {{ tasks.length }}</span>
    </div>
    <div class="panel">
      <el-radio-group v-model="mode">
        <el-radio-button value="cloud">云端剪辑（现有）</el-radio-button>
        <el-radio-button value="local">本地剪辑</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel">
      <div class="toolbar">
        <strong>添加抖音商品与素材</strong>
        <el-select v-model="accountId" placeholder="豆包账号" style="width: 220px">
          <el-option v-for="item in store.doubaoAccounts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </div>
      <p class="muted">商品。一行一个链接或商品 ID。</p>
      <el-input v-model="goodsText" type="textarea" :rows="4" placeholder="例如 https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1234567890123" />
      <div class="toolbar">
        <el-button type="primary" plain :loading="adding" @click="addGoods">粘贴商品</el-button>
        <el-button @click="goodsText = ''; goods = []">清空</el-button>
        <span class="num-hint">已识别 {{ goods.length }} 件</span>
      </div>
      <div v-for="item in goods" :key="item.id" class="file-line">{{ item.title }} · {{ item.id }}</div>
      <p class="muted">素材。本地视频路径，或点选择视频。</p>
      <el-input v-model="materialText" type="textarea" :rows="3" placeholder="例如 D:\视频\参考.mp4" />
      <div class="toolbar">
        <el-button @click="pickMaterial">粘贴素材</el-button>
        <el-button @click="materialText = ''">清空</el-button>
        <span v-if="mode === 'local'" class="num-hint">本地裁切秒数，例如 5</span>
        <el-input-number v-if="mode === 'local'" v-model="seconds" :min="3" :max="60" />
      </div>
      <el-button type="primary" style="width: 100%; margin-top: 12px" :loading="running" @click="submit">提交</el-button>
    </div>
    <div class="panel">
      <strong>已存任务</strong>
      <div v-if="!tasks.length" class="muted">还没有提交过二创。</div>
      <div v-for="item in tasks" :key="item.id" class="queue-item">
        <div>{{ item.title }}</div>
        <div class="sub-line">{{ item.time }} · {{ item.message }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { upgradePromptSettings } from '@/mock/data'
import { composePrompt, formatTime, uid } from '@/utils/format'

const store = useAppStore()
const mode = ref('cloud')
const accountId = ref(store.doubaoAccounts[0]?.id || '')
const goodsText = ref('')
const materialText = ref('')
const goods = ref([])
const adding = ref(false)
const running = ref(false)
const seconds = ref(5)
const tasks = computed(() => store.settings.remixTasks || [])

function productIdFrom(text) {
  const raw = String(text || '').trim()
  const query = raw.match(/(?:id|product_id|promotion_id|goods_id)=(\d{6,})/i)
  if (query) return query[1]
  if (/^\d{8,}$/.test(raw)) return raw
  return raw.match(/(\d{10,})/)?.[1] || ''
}

async function addGoods() {
  const lines = [...new Set(goodsText.value.split(/\s+/).map((item) => item.trim()).filter(Boolean))]
  if (!lines.length) return ElMessage.warning('先粘贴商品链接')
  adding.value = true
  try {
    for (const line of lines) {
      let remote = null
      if (window.tujian?.lookupProduct) {
        const result = await window.tujian.lookupProduct({ accountId: store.activeAccountId, link: line })
        if (result?.product) remote = result.product
      }
      const id = remote?.id || productIdFrom(line)
      if (!id || goods.value.some((item) => item.id === id)) continue
      const row = {
        id,
        title: remote?.title || `商品 ${id}`,
        price: Number(remote?.price) || 0,
        category: remote?.category || '',
        shop: remote?.shop || ''
      }
      goods.value.push(row)
      if (!store.products.some((item) => item.id === id)) {
        store.products.unshift({
          ...row,
          rate: Number(remote?.rate) || 0,
          source: '链接导入',
          link: line,
          accountId: store.activeAccountId,
          external: true,
          scriptReady: false,
          hue: 200,
          createdAt: formatTime(new Date()),
          image: remote?.image || '',
          images: remote?.images || []
        })
      }
    }
    store.persist()
    if (!goods.value.length) ElMessage.warning('没有识别出商品编号')
  } finally {
    adding.value = false
  }
}

async function pickMaterial() {
  if (!window.tujian?.pickVideo) return ElMessage.warning('请在桌面窗口里选择视频')
  const file = await window.tujian.pickVideo()
  if (file) materialText.value = file
}

function remember(title, message) {
  const list = Array.isArray(store.settings.remixTasks) ? store.settings.remixTasks : []
  list.unshift({ id: uid('R'), title, message, time: formatTime(new Date()) })
  store.settings.remixTasks = list.slice(0, 30)
  store.persist()
}

async function submit() {
  const material = materialText.value.trim()
  if (!material) return ElMessage.warning('先放入一条参考视频')
  if (mode.value === 'local') {
    if (!window.tujian?.trimVideo) return ElMessage.warning('请在桌面窗口里裁切')
    running.value = true
    try {
      const result = await window.tujian.trimVideo({ file: material, start: '0', end: String(seconds.value), dir: store.settings.outputDir })
      if (!result?.ok) throw new Error(result?.message || '本地裁切失败')
      remember(goods.value[0]?.title || '本地剪辑', result.message)
      ElMessage.success(result.message)
    } catch (error) {
      ElMessage.error(error.message || '本地裁切失败')
    } finally {
      running.value = false
    }
    return
  }
  if (!window.tujian?.remixDoubao) return ElMessage.warning('请在桌面窗口里提交')
  const account = store.doubaoAccounts.find((item) => item.id === accountId.value)
  if (!account) return ElMessage.warning('先添加豆包账号')
  upgradePromptSettings(store.settings)
  const template = (store.settings.promptTemplates || []).find((item) => item.id === store.settings.activePromptTemplateId)
  const product = goods.value[0] || null
  const prompt = composePrompt({
    promptText: template?.promptText || store.settings.promptText,
    model: template?.model || store.settings.model,
    duration: template?.duration || store.settings.duration,
    ratio: template?.ratio || store.settings.ratio
  }, product)
  if (!prompt) return ElMessage.warning('先在提示词模板里写一套文案')
  running.value = true
  try {
    const result = await window.tujian.remixDoubao({
      id: account.id,
      name: account.name,
      login: account.login,
      mode: account.loginMode || 'password',
      videoPath: material,
      prompt,
      slot: `remix-${Date.now().toString(36)}`
    })
    const message = result?.confirmNote || result?.message || '已发给豆包'
    remember(product?.title || '云端二创', message)
    if (result?.confirmNeeded && !result?.confirmSent) ElMessage.warning(message)
    else ElMessage.success(message)
  } catch (error) {
    ElMessage.error(error.message || '二创失败')
  } finally {
    running.value = false
  }
}
</script>
