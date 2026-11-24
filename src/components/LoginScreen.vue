<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-mark">++</div>
      <h1>huang++pro</h1>
      <p>{{ mode === 'login' ? '登录本机账号' : '注册一个只保存在这台电脑上的账号' }}</p>
      <el-input v-model="username" placeholder="账号" />
      <el-input v-model="password" type="password" show-password placeholder="密码" />
      <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
        {{ mode === 'login' ? '登录' : '注册并登录' }}
      </el-button>
      <button type="button" class="login-switch" @click="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? '没有账号，去注册' : '已有账号，去登录' }}
      </button>
      <p v-if="error" class="login-error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const mode = ref('login')
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    if (mode.value === 'login') await store.login(username.value, password.value)
    else await store.register(username.value, password.value)
  } catch (err) {
    error.value = err.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>
