<script setup lang="ts">
import { computed } from 'vue'
import DirectPage from '../components/direct-page/DirectPage.vue'
import VersionPage from '../components/version-page/VersionPage.vue'
import DocumentPage from '../components/document-page/DocumentPage.vue'
import ConfigurationPage from '../components/configuration-page/ConfigurationPage.vue'
import ProcessPage from '../components/process-page/ProcessPage.vue'
import ReportPage from '../components/report-page/ReportPage.vue'

import ManagementPageFrame from '../components/ManagementPageFrame.vue'
import Forbidden from '../pages/system/Forbidden.vue'
import { useTargetSession } from '../session/vm.ts'
import { targetResourceRegistry, type ResourceRegistry } from './registry.ts'

const props = withDefaults(
  defineProps<{
    domain?: string
    entity?: string
    registry?: ResourceRegistry
  }>(),
  { domain: '', entity: '', registry: () => targetResourceRegistry },
)

const session = useTargetSession()
const resourceKey = computed(() =>
  props.domain && props.entity ? `${props.domain}/${props.entity}` : '',
)
const authorized = computed(() =>
  resourceKey.value ? session.hasResource(props.domain, props.entity) : false,
)
const registration = computed(() =>
  authorized.value ? props.registry.resolve(props.domain, props.entity) : null,
)
const definition = computed(() => registration.value?.definition)
const instanceKey = computed(() => `${session.generation}:${resourceKey.value}`)
</script>

<template>
  <ManagementPageFrame v-if="!resourceKey" title="业务功能">
    请从左侧导航选择功能。
  </ManagementPageFrame>
  <Forbidden v-else-if="!authorized" />
  <DirectPage
    v-else-if="definition?.kind === 'direct'"
    :key="instanceKey"
    :definition="definition"
  />
  <VersionPage
    v-else-if="definition?.kind === 'version'"
    :key="instanceKey"
    :definition="definition"
  />
  <DocumentPage
    v-else-if="definition?.kind === 'document'"
    :key="instanceKey"
    :definition="definition"
  />
  <ConfigurationPage
    v-else-if="definition?.kind === 'configuration'"
    :key="instanceKey"
    :definition="definition"
  />
  <ProcessPage
    v-else-if="definition?.kind === 'process'"
    :key="instanceKey"
    :definition="definition"
  />
  <ReportPage
    v-else-if="definition?.kind === 'report'"
    :key="instanceKey"
    :definition="definition"
  />
  <ManagementPageFrame
    v-else
    title="功能尚未实现"
    data-testid="business-unimplemented"
  >
    你已有此资源的访问权限，功能页面尚未实现。资源 ID：<strong>{{
      resourceKey
    }}</strong>
  </ManagementPageFrame>
</template>
