<template>
  <ProductCart v-if="route.query.tab === 'cart'" />
  <ProductLibrary v-else />
</template>

<script setup>
import { useRoute } from 'vue-router'
import ProductLibrary from '@/components/ProductLibrary.vue'
import ProductCart from '@/components/ProductCart.vue'

const route = useRoute()
</script>
