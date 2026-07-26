<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useVehicleViewModel } from './vm'

const model = useVehicleViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
