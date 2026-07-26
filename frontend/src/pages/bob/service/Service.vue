<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useServiceViewModel } from './vm'

const model = useServiceViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
