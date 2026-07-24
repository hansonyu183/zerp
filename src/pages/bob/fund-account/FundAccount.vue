<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useFundAccountViewModel } from './vm'

const model = useFundAccountViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
