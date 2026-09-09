<script setup lang="ts">
import type { wflInstance, WflInstanceActionInput } from '../../api.ts'
import { statuses, nodeActions } from './node-data.ts'
type Instance = Awaited<ReturnType<typeof wflInstance>>
defineProps<{
  nodes: Instance['nodes']
  targets: Instance['availableTargets']
  disabled: boolean
}>()
const emit = defineEmits<{
  action: [
    node: Instance['nodes'][number],
    action: WflInstanceActionInput['action'],
    targetNodeKey?: string,
  ]
}>()
</script>
<template>
  <div v-for="node in nodes" :key="node.nodeId" class="my-3">
    <p>
      {{ node.nodeName }} · {{ node.documentNo ?? '—' }} ·
      {{ node.status ? statuses[node.status] : '—' }}
    </p>
    <template v-for="action in node.availableActions" :key="action">
      <template v-if="action === 'CREATE_CHILD'"
        ><v-btn
          v-for="target in targets.filter(
            (item) => item.parentNodeId === node.nodeId,
          )"
          :key="target.targetNodeKey"
          :disabled="disabled"
          @click="emit('action', node, action, target.targetNodeKey)"
          >创建 {{ target.targetNodeName }}</v-btn
        ></template
      >
      <v-btn
        v-else
        :disabled="disabled"
        @click="emit('action', node, action)"
        >{{ nodeActions[action] }}</v-btn
      >
    </template>
  </div>
</template>
