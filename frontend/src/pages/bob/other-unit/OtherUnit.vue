<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useOtherUnitViewModel } from './vm'
const model = useOtherUnitViewModel()
</script>
<template><BobEntityPage :model="model" /></template>
