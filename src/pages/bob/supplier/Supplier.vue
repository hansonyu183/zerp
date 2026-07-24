<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useSupplierViewModel } from './vm'

const model = useSupplierViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
