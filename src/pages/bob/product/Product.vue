<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useProductViewModel } from './vm'

const model = useProductViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
