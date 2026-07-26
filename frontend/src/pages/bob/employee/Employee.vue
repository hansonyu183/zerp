<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useEmployeeViewModel } from './vm'

const model = useEmployeeViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
