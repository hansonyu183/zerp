<script setup lang="ts">
import type { ProductData } from '@zerp/model'
import { productBehaviorLabels, formulaResolutionLabels } from './vm.ts'
defineProps<{ snapshot: ProductData }>()
</script>
<template>
  <dl>
    <dt>名称</dt>
    <dd>{{ snapshot.name }}</dd>
    <dt>条码</dt>
    <dd>{{ snapshot.barcode || '—' }}</dd>
    <dt>规格 / 型号</dt>
    <dd>{{ snapshot.specification || '—' }} / {{ snapshot.model || '—' }}</dd>
    <dt>产品类型</dt>
    <dd>
      {{ snapshot.productType.name }}（{{
        snapshot.productType.behaviorProfile
          ? productBehaviorLabels[snapshot.productType.behaviorProfile]
          : '未设置'
      }}）
    </dd>
    <dt>分类</dt>
    <dd>{{ snapshot.productCategory.name }}</dd>
    <dt>计价单位 / 默认录入单位</dt>
    <dd>
      {{ snapshot.pricingUnit.name }} / {{ snapshot.defaultInputUnit.name }}
    </dd>
    <dt>默认包装规格</dt>
    <dd>{{ snapshot.defaultPackagingSpec || '—' }}</dd>
    <dt>可回收</dt>
    <dd>{{ snapshot.recyclable ? '是' : '否' }}</dd>
    <dt>备注</dt>
    <dd>{{ snapshot.remark || '—' }}</dd>
  </dl>
  <v-table
    ><thead>
      <tr>
        <th>录入单位</th>
        <th>换算系数</th>
        <th>录入精度</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="conversion in snapshot.unitConversions"
        :key="conversion.unit.id"
      >
        <td>{{ conversion.unit.name }}</td>
        <td>{{ conversion.factor }}</td>
        <td>{{ conversion.unit.quantityScale }}</td>
      </tr>
    </tbody></v-table
  >
  <template v-if="snapshot.fixedFormula">
    <p>
      配方产量：{{ snapshot.fixedFormula.output.enteredQuantity }}
      {{ snapshot.fixedFormula.output.enteredUnit.name }}；基准数量
      {{ snapshot.fixedFormula.output.baseQuantity }}
    </p>
    <v-table
      ><thead>
        <tr>
          <th>原料</th>
          <th>录入用量</th>
          <th>基准用量</th>
          <th>确认状态</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="component in snapshot.fixedFormula.components"
          :key="component.material.objectId"
        >
          <td>{{ component.material.code }} · {{ component.material.name }}</td>
          <td>
            {{ component.quantity.enteredQuantity }}
            {{ component.quantity.enteredUnit.name }}
          </td>
          <td>{{ component.quantity.baseQuantity }}</td>
          <td>{{ formulaResolutionLabels[component.resolutionStatus] }}</td>
        </tr>
      </tbody></v-table
    >
  </template>
</template>
