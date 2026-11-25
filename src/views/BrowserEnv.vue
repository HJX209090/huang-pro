<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>浏览器环境</h1>
        <p>打开这一页会自动检查绑定账号是否还登录。启动会打开这个账号自己的浏览器。</p>
        <p class="muted">内置 Chromium {{ runtime.chrome || '读取中' }} · Electron {{ runtime.electron || '-' }} · 不需要另下 Chrome 内核</p>
      </div>
      <el-button @click="checkAll">自动检查</el-button>
      <el-button type="primary" @click="edit()">新建环境</el-button>
    </div>
    <div class="panel">
      <el-table :data="store.browsers">
        <el-table-column prop="name" label="环境名称" min-width="140" />
        <el-table-column prop="group" label="分组" width="120" />
        <el-table-column prop="account" label="绑定账号" width="140" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="remark" label="备注" min-width="140" />
        <el-table-column label="操作" min-width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="launch(row)">启动</el-button>
            <el-button link @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="visible" :title="form.id ? '编辑环境' : '新建环境'" width="480px">
      <el-form label-width="88px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" style="width: 100%">
            <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="绑定账号">
          <el-select v-model="form.account" style="width: 100%">
            <el-option v-for="item in store.publishAccounts" :key="item.id" :label="item.name" :value="item.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { uid } from '@/utils/format'

const store = useAppStore()
const visible = ref(false)
const form = reactive({ id: '', name: '', group: '默认分组', account: '', remark: '' })
const runtime = reactive({ chrome: '', electron: '', userData: '' })

onMounted(async () => {
  const info = await window.tujian?.getInfo?.()
  if (info) Object.assign(runtime, info)
  checkAll()
})

async function checkAll() {
  if (!window.tujian?.accountStatus) return
  for (const row of store.browsers) {
    const account = store.publishAccounts.find((item) => item.name === row.account || item.id === row.account)
    if (!account) {
      row.status = '未绑定'
      continue
    }
    const result = await window.tujian.accountStatus({ kind: 'publish', id: account.id })
    row.status = result.loginStatus
    account.loginStatus = result.loginStatus
  }
  store.persist()
}

async function launch(row) {
  const account = store.publishAccounts.find((item) => item.name === row.account || item.id === row.account)
  if (!account) return ElMessage.warning('先绑定一个发布账号')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里启动')
  const result = await window.tujian.openAccount({
    kind: 'publish',
    id: account.id,
    name: account.name,
    login: account.login,
    mode: account.loginMode || 'password',
    already: account.loginStatus === '已登录'
  })
  row.status = result.loginStatus || '已打开'
  account.loginStatus = result.loginStatus || account.loginStatus
  store.persist()
  store.addLog('info', '环境', `${row.name} 已打开绑定账号 ${account.name}`)
}

function edit(row) {
  if (row) Object.assign(form, row)
  else Object.assign(form, { id: '', name: '', group: store.groups[0] || '默认分组', account: '', remark: '' })
  visible.value = true
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写环境名称')
  if (form.id) {
    const target = store.browsers.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name: form.name, group: form.group, account: form.account, remark: form.remark })
  } else {
    store.browsers.unshift({ ...form, id: uid('BR'), status: '未启动' })
  }
  store.persist()
  visible.value = false
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除环境 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.browsers = store.browsers.filter((item) => item.id !== row.id)
  store.persist()
}
</script>
