<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useCategoryViewModel } from './vm'

const model = useCategoryViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
