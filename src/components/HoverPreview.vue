<template>
  <span class="hover-anchor" :class="{ 'is-block': block }" @mouseenter="schedule" @mouseleave="scheduleClose" @click.stop="openFull">
    <slot />
  </span>
  <teleport to="body">
    <div
      v-if="open && (video || shown)"
      class="hover-pop"
      :class="{ 'is-video': Boolean(video) }"
      :style="popStyle"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <video v-if="video" ref="player" :src="video" controls autoplay playsinline @click.stop />
      <template v-else>
        <img :src="shown" alt="" @click.stop="openFull" />
        <div v-if="urls.length > 1" class="hover-nav">
          <button type="button" @click.stop="step(-1)">上一张</button>
          <span>{{ cursor + 1 }} / {{ urls.length }}</span>
          <button type="button" @click.stop="step(1)">下一张</button>
        </div>
        <button type="button" class="hover-full" @click.stop="openFull">查看完整照片</button>
      </template>
    </div>
    <el-image-viewer
      v-if="viewer"
      :url-list="urls"
      :initial-index="cursor"
      :z-index="5200"
      teleported
      @close="viewer = false"
      @switch="cursor = $event"
    />
  </teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElImageViewer } from 'element-plus'
import { imageUrl } from '@/utils/format'

const props = defineProps({
  images: { type: Array, default: () => [] },
  start: { type: Number, default: 0 },
  video: { type: String, default: '' },
  block: { type: Boolean, default: false }
})
const emit = defineEmits(['open'])

const open = ref(false)
const viewer = ref(false)
const cursor = ref(0)
const popStyle = ref({})
const player = ref(null)
let enterTimer = 0
let leaveTimer = 0

const urls = computed(() => props.images.map((item) => imageUrl(item)).filter(Boolean))
const shown = computed(() => urls.value[cursor.value] || urls.value[0] || '')

watch(() => props.start, (value) => {
  cursor.value = value || 0
}, { immediate: true })

watch(open, (value) => {
  if (!value && player.value) {
    player.value.pause()
    player.value.currentTime = 0
  }
})

function place(target) {
  const rect = target.getBoundingClientRect()
  const width = props.video ? 280 : 380
  const height = props.video ? 520 : 500
  let left = rect.right + 12
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 12)
  let top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - height - 8))
  popStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` }
}

function schedule(event) {
  clearTimeout(leaveTimer)
  const target = event.currentTarget
  clearTimeout(enterTimer)
  enterTimer = setTimeout(() => {
    if (props.video || urls.value.length) {
      cursor.value = Math.min(props.start || 0, Math.max(urls.value.length - 1, 0))
      place(target)
      open.value = true
    }
  }, 160)
}

function cancelClose() {
  clearTimeout(leaveTimer)
}

function scheduleClose() {
  clearTimeout(enterTimer)
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => {
    open.value = false
  }, 140)
}

function step(delta) {
  const count = urls.value.length
  if (!count) return
  cursor.value = (cursor.value + delta + count) % count
}

function openFull() {
  open.value = false
  if (props.video) {
    emit('open')
    return
  }
  if (urls.value.length) viewer.value = true
}
</script>
