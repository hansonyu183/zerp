<script setup lang="ts">
import { computed } from 'vue'
import {
  navigationIcon,
  type NavigationMenuGroup,
} from '../presentation/navigation-icons.ts'
const props = defineProps<{ groups: readonly NavigationMenuGroup[] }>()
const items = computed(() =>
  props.groups.map((group) => ({
    ...group,
    resolvedIcon: navigationIcon(group.icon),
    resources: group.resources.map((resource) => ({
      ...resource,
      resolvedIcon: navigationIcon(resource.icon),
    })),
  })),
)
</script>
<template>
  <v-list nav class="px-3"
    ><v-list-group
      v-for="group in items"
      :key="group.domain"
      :value="group.domain"
      ><template #activator="{ props }"
        ><v-list-item
          v-bind="props"
          :prepend-icon="group.resolvedIcon"
          :title="group.displayName" /></template
      ><v-list-item
        v-for="resource in group.resources"
        :key="resource.key"
        :prepend-icon="resource.resolvedIcon"
        :title="resource.displayName"
        :to="resource.routePath"
        rounded="lg" /></v-list-group
  ></v-list>
</template>
