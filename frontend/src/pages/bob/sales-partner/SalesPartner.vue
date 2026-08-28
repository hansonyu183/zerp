<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useSalesPartnerViewModel } from './vm'
const model = useSalesPartnerViewModel()
</script>
<template><BobEntityPage :model="model" /></template>
