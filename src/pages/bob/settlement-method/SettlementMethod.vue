<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useSettlementMethodViewModel } from './vm'

const model = useSettlementMethodViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
