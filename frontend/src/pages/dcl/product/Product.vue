<script setup lang="ts">
import ProductPage from './ProductPage.vue'
import { useDclProductViewModel } from './vm'

// Product keeps the established product-specific editor slots (unit conversion
// and formula) while its VM and all mutations are DCL-owned.
const model = useDclProductViewModel()
</script>

<template>
  <ProductPage :model="model" />
</template>
