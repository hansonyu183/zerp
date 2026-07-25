<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useCustomerViewModel } from './vm'

const model = useCustomerViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
