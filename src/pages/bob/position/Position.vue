<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { usePositionViewModel } from './vm'

const model = usePositionViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
