<script setup lang="ts">
import AuxEntityPage from '@/pages/aux/shared/AuxEntityPage.vue'
import { auxConfigs } from '@/pages/aux/shared/config'
import { createAuxEntityViewModel } from '@/pages/aux/shared/vm'

const model = createAuxEntityViewModel(auxConfigs['product-category'])
</script>

<template><AuxEntityPage :model="model" /></template>
