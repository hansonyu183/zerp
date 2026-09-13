<script setup lang="ts" generic="Row extends object">
import { useDisplay } from 'vuetify'
const { xs } = useDisplay()
withDefaults(
  defineProps<{
    headers: readonly {
      key: string
      title: string
      width?: number
      minWidth?: number
      sortable?: boolean
    }[]
    items: readonly Row[]
    identityKey: Extract<keyof Row, string>
    loading?: boolean
  }>(),
  { loading: false },
)
defineSlots<{ cell(props: { item: Row; column: string }): unknown }>()
</script>
<template>
  <div class="list-surface" :aria-busy="loading">
    <template v-if="xs">
      <v-progress-linear v-if="loading" indeterminate aria-label="加载中" />
      <div class="list-cards">
        <v-card
          v-for="item in items"
          :key="String(item[identityKey])"
          variant="outlined"
          class="list-card"
        >
          <dl>
            <template
              v-for="header in headers.filter((h) => h.key !== '$actions')"
              :key="header.key"
            >
              <dt>{{ header.title }}</dt>
              <dd><slot name="cell" :item="item" :column="header.key" /></dd>
            </template>
          </dl>
          <div
            v-if="headers.some((h) => h.key === '$actions')"
            class="list-card-actions"
          >
            <slot name="cell" :item="item" column="$actions" />
          </div>
        </v-card>
        <p v-if="!items.length && !loading" class="pa-4">暂无数据。</p>
      </div>
    </template>
    <v-data-table
      v-else
      :headers="headers"
      :items="items"
      :item-value="identityKey"
      :loading="loading"
      :items-per-page="-1"
      disable-sort
      hide-default-footer
    >
      <template
        v-for="header in headers"
        :key="header.key"
        #[`item.${header.key}`]="{ item }"
      >
        <slot name="cell" :item="item" :column="header.key" />
      </template>
      <template #no-data>暂无数据。</template>
    </v-data-table>
  </div>
</template>
<style scoped>
.list-surface {
  min-width: 0;
  width: 100%;
}
.list-cards {
  display: grid;
  gap: 12px;
}
.list-card {
  padding: 16px;
  min-width: 0;
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 8px 16px;
}
dt {
  color: rgb(var(--v-theme-muted));
}
dd {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.list-card-actions {
  margin-top: 12px;
}
</style>
