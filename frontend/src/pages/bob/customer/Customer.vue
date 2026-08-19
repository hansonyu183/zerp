<script setup lang="ts">
import CustomerWorkspace from './CustomerWorkspace.vue'
import { useCustomerViewModel } from './vm'

const model = useCustomerViewModel()
</script>

<template><CustomerWorkspace :model="model" /></template>
