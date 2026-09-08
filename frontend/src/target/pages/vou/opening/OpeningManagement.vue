<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import VouListPage from '../../../components/vou-list-page/VouListPage.vue'
import type { VouDetail } from '../../../components/vou-list-page/vm.ts'
import OpeningEditor from './OpeningEditor.vue'
import OpeningSnapshot from './OpeningSnapshot.vue'
import { openingPage, useOpeningEditorViewModel } from './vm.ts'
const list = ref<{ refresh: () => Promise<boolean> } | null>(null)
const vm = reactive(
  useOpeningEditorViewModel(async () => list.value?.refresh()),
)
async function clone(document: VouDetail) {
  if (document.entity === 'opening') await vm.cloneSubmission(document)
}
onBeforeUnmount(vm.dispose)
</script>
<template>
  <section>
    <v-alert
      v-if="vm.feedback && !vm.open"
      class="mx-6 mt-4"
      type="info"
      closable
      @click:close="vm.feedback = ''"
      >{{ vm.feedback }}</v-alert
    >
    <VouListPage
      ref="list"
      vou-type="opening"
      :definition="openingPage"
      editor-available
      @create="vm.openCreate"
      @clone="clone"
    >
      <template #detail="{ document }"
        ><OpeningSnapshot
          v-if="document.entity === 'opening'"
          :document="document"
      /></template>
    </VouListPage>
    <OpeningEditor :vm="vm" />
  </section>
</template>
