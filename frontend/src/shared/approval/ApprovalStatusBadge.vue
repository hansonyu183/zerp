<script setup lang="ts">
import type { ApprovalStatus } from '@/api/generated'
import { computed } from 'vue'

import { approvalStatusPresentation } from './presentation'

const props = defineProps<{ status: ApprovalStatus }>()
const presentation = computed(() => approvalStatusPresentation[props.status])
</script>

<template>
  <v-chip
    class="approval-status-badge"
    :color="presentation.color"
    density="compact"
    size="small"
    variant="tonal"
  >
    {{ presentation.label }}
  </v-chip>
</template>
