<script setup lang="ts">
import { computed } from 'vue'

import type { ArchiveSubmission, IdentityArchiveSnapshot } from './lifecycle.ts'

const props = defineProps<{
  entity: ArchiveSubmission['entity']
  snapshot: IdentityArchiveSnapshot
}>()

const identityKindLabels = {
  PERSON: '个人',
  ORGANIZATION: '组织',
} as const
const capabilityLabels = {
  EXTERNAL_PART_TIME: '外部兼职销售',
  CHANNEL_PARTNER: '渠道商',
} as const
const defaultOperatingEntity = computed(() =>
  props.snapshot.operatingEntities.find(
    (item) => item.objectId === props.snapshot.defaultOperatingEntityId,
  ),
)
const settlementMethod = computed(() =>
  'settlementMethod' in props.snapshot ? props.snapshot.settlementMethod : null,
)
const hasSettlementMethod = computed(
  () => props.entity === 'supplier' || props.entity === 'other-unit',
)
const defaultPurchaser = computed(() =>
  'defaultPurchaser' in props.snapshot ? props.snapshot.defaultPurchaser : null,
)
const capabilities = computed(() =>
  'capabilities' in props.snapshot ? props.snapshot.capabilities : [],
)
</script>

<template>
  <v-table density="compact" class="mt-4">
    <tbody>
      <tr>
        <th>身份类型</th>
        <td>{{ identityKindLabels[snapshot.identityKind] }}</td>
        <th>法定名称</th>
        <td>{{ snapshot.legalName }}</td>
      </tr>
      <tr>
        <th>显示名称</th>
        <td>{{ snapshot.displayName }}</td>
        <th>证件号码</th>
        <td>{{ snapshot.legalIdentifier }}</td>
      </tr>
      <tr>
        <th>联系人</th>
        <td>{{ snapshot.contactName || '—' }}</td>
        <th>联系电话</th>
        <td>{{ snapshot.phone || '—' }}</td>
      </tr>
      <tr>
        <th>地址</th>
        <td colspan="3">{{ snapshot.address || '—' }}</td>
      </tr>
      <tr>
        <th>适用经营主体</th>
        <td colspan="3">
          {{
            snapshot.operatingEntities.length
              ? snapshot.operatingEntities
                  .map((item) => `${item.code} · ${item.name}`)
                  .join('、')
              : '无'
          }}
        </td>
      </tr>
      <tr>
        <th>默认经营主体</th>
        <td colspan="3">
          {{
            defaultOperatingEntity
              ? `${defaultOperatingEntity.code} · ${defaultOperatingEntity.name}`
              : '无'
          }}
        </td>
      </tr>
      <tr v-if="hasSettlementMethod">
        <th>结算方式</th>
        <td colspan="3">
          {{
            settlementMethod
              ? `${settlementMethod.code} · ${settlementMethod.name}`
              : '无'
          }}
        </td>
      </tr>
      <tr v-if="entity === 'supplier'">
        <th>默认采购员</th>
        <td colspan="3">
          {{
            defaultPurchaser
              ? `${defaultPurchaser.code} · ${defaultPurchaser.name}`
              : '无'
          }}
        </td>
      </tr>
      <tr v-if="entity === 'sales-partner'">
        <th>合作能力</th>
        <td colspan="3">
          {{
            capabilities.length
              ? capabilities.map((item) => capabilityLabels[item]).join('、')
              : '无'
          }}
        </td>
      </tr>
      <tr>
        <th>备注</th>
        <td colspan="3">{{ snapshot.remark || '—' }}</td>
      </tr>
    </tbody>
  </v-table>
</template>
