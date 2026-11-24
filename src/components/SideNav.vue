<template>
  <aside class="sidenav">
    <section v-for="group in groups" :key="group.label">
      <div class="nav-label">{{ group.label }}</div>
      <router-link v-for="item in group.items" :key="item.path" :to="item.path" class="nav-item">
        <AppIcon :name="item.icon" />
        <span>{{ item.title }}</span>
        <span v-if="item.badge === 'works' && store.unpublishedCount" class="nav-badge">{{ store.unpublishedCount }}</span>
      </router-link>
    </section>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { navGroups } from '@/config/nav'
import { useAppStore } from '@/stores/app'
import AppIcon from '@/components/AppIcon.vue'

const store = useAppStore()
const groups = computed(() => navGroups.map((group) => ({
  ...group,
  items: group.items.filter((item) => !item.admin || store.adminMode)
})).filter((group) => group.items.length))
</script>
