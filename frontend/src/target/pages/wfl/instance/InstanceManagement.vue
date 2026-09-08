<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive } from 'vue'
import { vouEntityPresentation } from '@zerp/model'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'
import { useWflInstanceViewModel, statuses, nodeActions } from './vm.ts'
const vm = reactive(useWflInstanceViewModel())
onMounted(vm.read)
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ManagementPageFrame title="流程实例">
    <v-alert v-if="vm.error" type="error">{{ vm.error }}</v-alert
    ><v-alert v-if="vm.feedback" type="success">{{ vm.feedback }}</v-alert
    ><v-alert v-if="vm.unknown" type="warning"
      >写入结果待核实，请勿重复提交。<v-btn
        :disabled="vm.busy"
        @click="vm.verify"
        >核实结果</v-btn
      ></v-alert
    >
    <div class="d-flex flex-wrap ga-3 align-center">
      <v-text-field
        v-model="vm.keyword"
        label="流程代码或名称"
        @keydown.enter="!$event.isComposing && vm.search()"
      /><v-btn
        :loading="vm.loading"
        :disabled="!vm.canInstance('query') || vm.busy"
        @click="vm.search"
        >查询</v-btn
      >
    </div>
    <v-pagination
      v-model="vm.page"
      :length="Math.max(1, Math.ceil(vm.total / 20))"
      :disabled="vm.loading || vm.busy"
      @update:model-value="vm.read"
    />
    <v-text-field v-if="vm.instance" v-model="vm.reason" label="实例操作原因" />
    <v-list
      ><v-list-item
        v-for="item in vm.instances"
        :key="item.processId"
        :title="`${item.definitionName} · ${item.rootDocumentNo}`"
        :disabled="!vm.canInstance('get')"
        @click="vm.openInstance(item.processId)"
    /></v-list>
    <v-dialog
      :model-value="vm.document !== null"
      max-width="850"
      @update:model-value="!$event && (vm.document = null)"
      ><v-card v-if="vm.document" :title="vm.document.documentNo"
        ><v-card-text>
          <p>
            {{ vouEntityPresentation[vm.document.entity].label }} ·
            {{ statuses[vm.document.status] }}
          </p>
          <p>
            业务日期：{{ vm.document.payload.businessDate }} · 币种：{{
              vm.document.payload.currency
            }}
          </p>
          <template v-if="'productLines' in vm.document.payload"
            ><v-table
              ><thead>
                <tr>
                  <th>产品</th>
                  <th>数量</th>
                  <th>单价</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="line in vm.document.payload.productLines"
                  :key="line.lineId"
                >
                  <td>{{ line.product.objectId }}</td>
                  <td>{{ line.baseQuantity }}</td>
                  <td>{{ line.unitPrice }}</td>
                </tr>
              </tbody></v-table
            ></template
          >
          <template v-if="'sourceLines' in vm.document.payload"
            ><p
              v-for="line in vm.document.payload.sourceLines"
              :key="line.sourceLineId"
            >
              来源行 {{ line.sourceLineId }} · 数量 {{ line.baseQuantity }}
            </p></template
          >
          <p v-if="'amount' in vm.document.payload">
            金额：{{ vm.document.payload.amount }}
          </p> </v-card-text
        ><v-card-actions
          ><v-btn @click="vm.document = null">关闭</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-card v-if="vm.instance" class="mt-4" :title="vm.instance.definitionName"
      ><v-card-text>
        <p>
          启动版本：{{ vm.instance.approvalEntryId }} · 根单据：{{
            vm.instance.rootDocumentNo
          }}
        </p>
        <div v-for="node in vm.instance.nodes" :key="node.nodeId" class="my-3">
          <p>
            {{ node.nodeName }} · {{ node.documentNo ?? '—' }} ·
            {{ node.status ? statuses[node.status] : '—' }}
          </p>
          <template v-for="action in node.availableActions" :key="action">
            <template v-if="action === 'CREATE_CHILD'"
              ><v-btn
                v-for="target in vm.instance.availableTargets.filter(
                  (item) => item.parentNodeId === node.nodeId,
                )"
                :key="target.targetNodeKey"
                :disabled="vm.busy || vm.unknown"
                @click="vm.nodeAction(node, action, target.targetNodeKey)"
                >创建 {{ target.targetNodeName }}</v-btn
              ></template
            >
            <v-btn
              v-else
              :disabled="vm.busy || vm.unknown"
              @click="vm.nodeAction(node, action)"
              >{{ nodeActions[action] }}</v-btn
            >
          </template>
        </div>
      </v-card-text></v-card
    >
  </ManagementPageFrame>
</template>
