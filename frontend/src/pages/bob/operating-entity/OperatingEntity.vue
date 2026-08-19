<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useOperatingEntityViewModel } from './vm'

const model = useOperatingEntityViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
