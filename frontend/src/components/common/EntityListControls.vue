<script setup lang="ts">
defineOptions({ name: 'EntityListControls' })

interface Props {
  keyword: string
  loading?: boolean
  searchLabel?: string
  creatable?: boolean
  filterable?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
  searchLabel: '关键字',
  creatable: false,
  filterable: false,
})

const emit = defineEmits<{
  'update:keyword': [value: string]
  query: []
  create: []
  resetFilters: []
  applyFilters: []
}>()
</script>

<template>
  <section class="entity-list-controls">
    <v-expansion-panels
      v-if="filterable"
      class="entity-list-controls__filters"
      variant="accordion"
    >
      <v-expansion-panel>
        <v-expansion-panel-title>筛选条件</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="entity-list-controls__filter-grid">
            <slot name="filters" />
          </div>
          <div class="entity-list-controls__filter-actions">
            <slot name="filter-actions">
              <v-btn
                :disabled="loading"
                variant="text"
                @click="emit('resetFilters')"
              >
                重置
              </v-btn>
              <v-btn
                color="primary"
                :loading="loading"
                @click="emit('applyFilters')"
              >
                应用筛选
              </v-btn>
            </slot>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div class="entity-list-controls__toolbar">
      <v-text-field
        :model-value="keyword"
        clearable
        density="comfortable"
        hide-details
        :label="searchLabel"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        @keyup.enter="emit('query')"
        @update:model-value="emit('update:keyword', $event ?? '')"
      />
      <v-btn
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="emit('query')"
      >
        查询
      </v-btn>
      <v-btn
        v-if="creatable"
        color="primary"
        :disabled="loading"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="emit('create')"
      >
        新增
      </v-btn>
      <slot name="toolbar" />
    </div>
  </section>
</template>

<style scoped>
.entity-list-controls__filters {
  margin-bottom: 16px;
}

.entity-list-controls__filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
}

.entity-list-controls__filter-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.entity-list-controls__toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 420px) auto auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}

@media (max-width: 900px) {
  .entity-list-controls__filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .entity-list-controls__filter-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .entity-list-controls__toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .entity-list-controls__toolbar .v-input {
    grid-column: 1 / -1;
  }
}
</style>
