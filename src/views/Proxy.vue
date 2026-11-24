<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>出网代理</h1>
        <p>检查会真的去连主机和端口。打开开关后，新开的豆包和发布窗口会走这个代理。</p>
      </div>
      <el-button type="primary" @click="edit()">新建代理</el-button>
    </div>
    <div class="panel">
      <el-table :data="store.proxies">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column prop="host" label="主机" min-width="140" />
        <el-table-column prop="port" label="端口" width="90" />
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="toggle(row)" /></template>
        </el-table-column>
        <el-table-column prop="status" label="检查" width="120" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="check(row)">测试连接</el-button>
            <el-button link @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="visible" :title="form.id ? '编辑代理' : '新建代理'" width="460px">
      <el-form label-width="72px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="HTTP" value="HTTP" />
            <el-option label="SOCKS5" value="SOCKS5" />
          </el-select>
        </el-form-item>
        <el-form-item label="主机"><el-input v-model="form.host" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { uid } from '@/utils/format'

const store = useAppStore()
const visible = ref(false)
const form = reactive({ id: '', name: '', type: 'HTTP', host: '', port: 7890 })

async function check(row) {
  if (!window.tujian?.checkProxy) return ElMessage.warning('请在桌面窗口里测试')
  row.status = '连接中'
  const result = await window.tujian.checkProxy({ host: row.host, port: row.port, type: row.type })
  row.status = result?.ok ? '可连接' : (result?.message || '连不上')
  store.persist()
  if (result?.ok) ElMessage.success(row.status)
  else ElMessage.warning(row.status)
}

function toggle(row) {
  if (row.enabled) {
    store.proxies.forEach((item) => {
      if (item.id !== row.id) item.enabled = false
    })
  }
  store.persist()
  store.syncProxy()
}

function edit(row) {
  if (row) Object.assign(form, row)
  else Object.assign(form, { id: '', name: '', type: 'HTTP', host: '', port: 7890 })
  visible.value = true
}

function save() {
  if (!form.name.trim() || !form.host.trim()) return ElMessage.warning('填写名称和主机')
  if (form.id) {
    const target = store.proxies.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name: form.name, type: form.type, host: form.host, port: form.port, status: '未检测' })
  } else {
    store.proxies.unshift({ ...form, id: uid('PX'), enabled: false, status: '未检测' })
  }
  store.persist()
  visible.value = false
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除代理 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.proxies = store.proxies.filter((item) => item.id !== row.id)
  store.persist()
}
</script>
