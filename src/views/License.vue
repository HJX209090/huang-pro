<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>软件管理</h1>
        <p>当前使用的是 huang++pro。有效期默认永久，也可以改成固定时长。到期按系统时间判断。</p>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <strong>当前软件</strong>
        <el-button @click="leave">退出管理</el-button>
      </div>
      <p>名称：huang++pro</p>
      <p>版本：{{ version || '本地开发版' }}
        <el-button link type="primary" style="margin-left: 8px" @click="checkUpdate">检查更新</el-button>
      </p>
      <p>系统时间：{{ store.systemNow ? formatTime(store.systemNow) : '—' }}</p>
      <p>当前有效期：{{ store.license?.permanent ? '永久' : (store.license?.label || '未设置') }}
        <span v-if="store.license?.expiresAt">，到 {{ formatTime(store.license.expiresAt) }}</span>
      </p>
      <div class="filters" style="margin-top: 12px">
        <el-select v-model="validity" style="width: 180px">
          <el-option label="永久" value="permanent" />
          <el-option v-for="item in plans" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
        <el-button type="primary" :loading="saving" @click="saveValidity">保存有效期</el-button>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar"><strong>账号</strong></div>
      <p class="muted">授权后的账号保存在这里。可以改每个账号的状态，停用后下次打开进不去。</p>
      <el-table :data="store.adminAccounts">
        <el-table-column label="使用用户" min-width="140">
          <template #default="{ row }">{{ row.displayName || '未填写' }}</template>
        </el-table-column>
        <el-table-column prop="licenseLabel" label="授权" width="140" />
        <el-table-column label="状态" width="160">
          <template #default="{ row }">
            <el-select :model-value="row.status" style="width: 120px" :disabled="row.username === 'admin'" @change="(value) => changeStatus(row, value)">
              <el-option label="正常" value="正常" />
              <el-option label="停用" value="停用" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="开通时间" width="180">
          <template #default="{ row }">{{ row.activatedAt ? formatTime(row.activatedAt) : '—' }}</template>
        </el-table-column>
      </el-table>
    </div>
    <div class="panel">
      <div class="toolbar"><strong>授权码生成器</strong></div>
      <div class="filters">
        <el-select v-model="plan" style="width: 180px">
          <el-option v-for="item in plans" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
        <el-button type="primary" :loading="loading" @click="createCode">生成授权码</el-button>
      </div>
      <div v-if="latest" class="banner" style="margin-top: 12px">
        <div>刚生成的{{ latest.label }}授权码</div>
        <strong>{{ latest.code }}</strong>
        <el-button link type="primary" @click="copy(latest.code)">复制</el-button>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar"><strong>已生成的授权码</strong></div>
      <el-table :data="store.generatedLicenses">
        <el-table-column prop="label" label="时长" width="120" />
        <el-table-column prop="code" label="授权码" min-width="280" />
        <el-table-column label="生成时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" @click="copy(row.code)">复制</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { formatTime } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const plan = ref('1m')
const validity = ref('permanent')
const version = ref('')
const loading = ref(false)
const saving = ref(false)
const latest = ref(null)
const plans = [
  { id: '1w', label: '一周' },
  { id: '1m', label: '1个月' },
  { id: '1y', label: '1年' },
  { id: '3y', label: '3年' },
  { id: '5y', label: '5年' },
  { id: '10y', label: '10年' }
]

onMounted(async () => {
  validity.value = store.license?.permanent ? 'permanent' : (store.license?.plan || 'permanent')
  version.value = await window.tujian?.getInfo?.().then((info) => info?.version || '').catch(() => '')
  try { await store.loadAdminAccounts() } catch (error) { ElMessage.error(error.message || '账号没有读出来') }
})

function checkUpdate() {
  window.dispatchEvent(new CustomEvent('huang-check-update'))
}

async function changeStatus(row, status) {
  try {
    await store.setAccountStatus(row.id, status)
    ElMessage.success(`${row.displayName || '这个账号'} 已改为${status}`)
  } catch (error) {
    ElMessage.error(error.message || '没有改成')
  }
}

async function saveValidity() {
  saving.value = true
  try {
    await store.configureLicense(validity.value)
    ElMessage.success(validity.value === 'permanent' ? '已设为永久' : '有效期已更新')
  } catch (error) {
    ElMessage.error(error.message || '没有保存')
  } finally {
    saving.value = false
  }
}

async function leave() {
  await store.lockAdmin()
  router.push('/dashboard')
}

async function createCode() {
  loading.value = true
  try {
    latest.value = await store.generateLicenseCode(plan.value)
    ElMessage.success('授权码已生成')
  } catch (error) {
    ElMessage.error(error.message || '生成失败')
  } finally {
    loading.value = false
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  ElMessage.success('已复制')
}
</script>
