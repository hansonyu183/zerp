<script setup lang="ts">
import SupplierWorkspace from './SupplierWorkspace.vue'
import { useSupplierViewModel } from './vm'

const model = useSupplierViewModel()
</script>

<template><SupplierWorkspace :model="model" /></template>
