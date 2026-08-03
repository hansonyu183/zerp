<script setup lang="ts">
import AuxEntityPage from '../shared/AuxEntityPage.vue'
import { createAuxEntityViewModel } from '../shared/vm'
import { auxConfigs } from '../shared/config'
const vm = createAuxEntityViewModel(auxConfigs['asset-category'])
</script>
<template><AuxEntityPage :model="vm" /></template>
