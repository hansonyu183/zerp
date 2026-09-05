<script setup lang="ts" generic="Entity extends VouEntity">
import type { VouEntity } from '@zerp/model'

import FamilyEditor from './editors/FamilyEditor.vue'
import VouWorkspace from './VouWorkspace.vue'
import { useVouPageController } from './vm.ts'

const props = defineProps<{
  entity: Entity
}>()
const model = useVouPageController(props.entity)
</script>

<template>
  <div :data-vou-page="`vou-${entity}-page`">
    <VouWorkspace :entity="entity" :model="model">
      <template #draft="{ draft, referenceOptions, sourceLineOptions }">
        <FamilyEditor
          :entity="entity"
          :editor="model.config.editor"
          :payload="draft.payload"
          :reference-options="referenceOptions"
          :source-line-options="sourceLineOptions"
          @change="model.saveFamilyDraft(draft)"
          @source-search="model.loadSourceLines($event)"
        />
      </template>
      <template #detail="{ view, referenceOptions, sourceLineOptions }">
        <FamilyEditor
          :entity="entity"
          :editor="model.config.editor"
          :payload="view.payload"
          :reference-options="referenceOptions"
          :source-line-options="sourceLineOptions"
          :editable="false"
        />
      </template>
    </VouWorkspace>
  </div>
</template>
