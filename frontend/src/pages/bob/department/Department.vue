<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useDepartmentViewModel } from './vm'

const model = useDepartmentViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
