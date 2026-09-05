<script setup lang="ts">
import { watch } from 'vue'

import { useTargetSession } from '../../../session/vm.ts'
import ProcessInstance from '../process-instance/ProcessInstance.vue'
import { createDynamicWflViewModel } from './vm.ts'

const props = defineProps<{ processCode: string }>()
const session = useTargetSession()
const vm = createDynamicWflViewModel(
  props.processCode,
  session.menu?.availableRoutes ?? [],
  session.permissions,
)
watch(
  () => props.processCode,
  (processCode) => vm.setCode(processCode),
)
</script>

<template>
  <ProcessInstance v-if="vm.available.value" :definition-code="processCode" />
  <v-container v-else fluid class="pa-5 pa-md-8">
    <v-alert type="error">流程不存在、未启用或无权访问。</v-alert>
  </v-container>
</template>
