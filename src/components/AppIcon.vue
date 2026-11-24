<template>
  <svg class="app-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="name === 'dashboard'" d="M4 13h7V4H4v9zm9 7h7v-7h-7v7zM4 20h7v-5H4v5zm9-9h7V4h-7v7z" />
    <path v-else-if="name === 'works'" d="M7 4h10v2H7V4zm2 4h6v12l-3-2-3 2V8z" />
    <path v-else-if="name === 'bench'" d="M8 3h8v18H8V3zm2 2v14h4V5h-4zm1 15h2v1h-2v-1z" />
    <path v-else-if="name === 'plaza'" d="M4 9l8-5 8 5v11H4V9zm5 11h2v-4h2v4h2v-6H9v6z" />
    <path v-else-if="name === 'box'" d="M3 8l9-4 9 4-9 4-9-4zm0 2.2V19l9 4V14.2L3 10.2zm18 0l-9 4V23l9-4V10.2z" />
    <path v-else-if="name === 'user'" d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H5z" />
    <path v-else-if="name === 'chat'" d="M5 5h14v10H8l-3 3V5z" />
    <path v-else-if="name === 'send'" d="M4 12l16-8-6 16-2-6-8-2z" />
    <path v-else-if="name === 'flow'" d="M4 6h6v4H4V6zm10 0h6v4h-6V6zM9 8h6M7 10v4h10v-4M12 14v4M8 18h8" />
    <path v-else-if="name === 'clock'" d="M12 4a8 8 0 100 16 8 8 0 000-16zm1 4v5h4v-2h-2V8h-2z" />
    <path v-else-if="name === 'tool'" d="M14 6l4 4-7 7H7v-4l7-7zm1-2l3 3" />
    <path v-else-if="name === 'window'" d="M4 5h16v14H4V5zm0 4h16" />
    <path v-else-if="name === 'proxy'" d="M7 8a4 4 0 018 0v2h1a3 3 0 010 6H8a3 3 0 010-6h1V8z" />
    <path v-else-if="name === 'log'" d="M7 3h8l4 4v14H7V3zm8 1v4h4M9 12h6M9 16h6" />
    <path v-else-if="name === 'gear'" d="M12 8a4 4 0 100 8 4 4 0 000-8zm8 4l-2 .6-.6 1.8 1.2 1.6-1.4 1.4-1.6-1.2-1.8.6L12 20l-.6-2-1.8-.6-1.6 1.2-1.4-1.4 1.2-1.6-.6-1.8L4 12l2-.6.6-1.8L5.4 8l1.4-1.4 1.6 1.2 1.8-.6L12 4l.6 2 1.8.6 1.6-1.2L17.4 8l-1.2 1.6.6 1.8L20 12z" />
    <path v-else-if="name === 'account'" d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zm0 6a2 2 0 110 4 2 2 0 010-4z" />
    <path v-else-if="name === 'key'" d="M8 14a5 5 0 116.3-4.8L21 8v4h-3v2h-2v-2h-2l-1.2 1.2A5 5 0 018 14zm2-1a1 1 0 100-2 1 1 0 000 2z" />
    <path v-else-if="name === 'play'" d="M9 7l8 5-8 5V7z" />
  </svg>
</template>

<script setup>
defineProps({
  name: { type: String, required: true }
})
</script>

<style scoped>
.app-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  flex: none;
}
</style>
