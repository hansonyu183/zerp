<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import { useOtherPartyViewModel } from './vm'

const model = useOtherPartyViewModel()
</script>

<template><BobEntityPage :model="model" /></template>
