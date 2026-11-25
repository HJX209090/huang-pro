<template>
  <div class="clip-tabs">
    <button type="button" :class="{ on: tab === 'cart' }" @click="go('cart')">选品车</button>
    <button type="button" :class="{ on: tab === 'doubao' }" @click="go('doubao')">豆包账号</button>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

defineProps({
  tab: { type: String, default: 'doubao' }
})

const router = useRouter()

function go(tab) {
  if (tab === 'doubao') router.push('/doubao')
  else router.push('/products')
}
</script>

<style scoped>
.clip-tabs { display: flex; gap: 18px; margin-bottom: 12px; border-bottom: 1px solid #eaecf0; }
.clip-tabs button { border: 0; background: transparent; padding: 8px 2px 10px; color: #667085; cursor: pointer; }
.clip-tabs button.on { color: #7c5cfc; box-shadow: inset 0 -2px 0 #7c5cfc; font-weight: 600; }
</style>
