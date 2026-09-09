<script setup lang="ts">
import { vouEntityPresentation } from '@zerp/model'
import type { WflData } from './wfl-data.ts'
import DetailBlock from './DetailBlock.vue'
defineProps<{
  graph: NonNullable<WflData['compiledGraph']>
  result?: NonNullable<WflData['trial']>['result']
}>()
</script>
<template>
  <section aria-label="编译图">
    <h3>编译图：{{ graph.name }}</h3>
    <DetailBlock
      :definition="{
        caption: '流程节点',
        fields: [
          { key: 'key', type: 'text', caption: '节点标识' },
          { key: 'name', type: 'text', caption: '节点名称' },
          {
            key: 'entity',
            type: 'enum',
            caption: '单据类型',
            options: Object.entries(vouEntityPresentation).map(
              ([value, item]) => ({ value, caption: item.label }),
            ),
          },
        ],
        empty: { key: '', name: '', entity: '' },
      }"
      :model-value="graph.nodes"
      mode="read"
    />
    <div class="graph-edges">
      <p v-for="(edge, index) in graph.edges" :key="index">
        {{
          graph.nodes.find((node) => node.key === edge.sourceKey)?.name ??
          edge.sourceKey
        }}
        →
        {{
          graph.nodes.find((node) => node.key === edge.targetKey)?.name ??
          edge.targetKey
        }}：{{ edge.actionName }}
      </p>
    </div>
    <template v-if="result"
      ><h3>实际试算结果</h3>
      <v-alert :type="result.ok ? 'success' : 'error'">{{
        result.ok ? '执行成功' : (result.error ?? '执行失败')
      }}</v-alert>
      <p v-if="result.evaluation">
        {{ result.evaluation.rootMatched ? '根节点匹配' : '根节点未匹配' }}
      </p>
      <div
        v-for="branch in result.evaluation?.branches ?? []"
        :key="branch.targetKey"
      >
        <p>
          {{
            graph.nodes.find((node) => node.key === branch.targetKey)?.name ??
            branch.targetKey
          }}：{{ branch.matched ? '命中' : '未命中' }}
        </p>
        <pre v-if="branch.initial !== undefined">{{
          JSON.stringify(branch.initial, null, 2)
        }}</pre>
      </div></template
    >
  </section>
</template>
<style scoped>
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.graph-edges {
  overflow-wrap: anywhere;
}
</style>
