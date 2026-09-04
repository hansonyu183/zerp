<script setup lang="ts">
defineProps<{
  label: string
  value: Record<string, unknown>
  options?: readonly Record<string, unknown>[]
}>()

const emit = defineEmits<{
  select: [value: Record<string, unknown>]
}>()
</script>

<template>
  <fieldset class="reference-editor">
    <legend>{{ label }}</legend>
    <label
      >选择资料
      <select
        :value="
          String(
            value.objectId ??
              value.id ??
              value.operatingEntityId ??
              value.otherUnitId ??
              '',
          )
        "
        @change="
          emit(
            'select',
            (options ?? []).find(
              (option) =>
                String(option.objectId ?? option.id) ===
                ($event.target as HTMLSelectElement).value,
            ) ?? {},
          )
        "
      >
        <option value="">未选择</option>
        <option
          v-for="option in options ?? []"
          :key="String(option.objectId ?? option.id)"
          :value="String(option.objectId ?? option.id)"
        >
          {{ option.code }} · {{ option.name }}
        </option>
      </select>
    </label>
    <p v-if="value.code || value.name">
      当前选择：{{ value.code }} · {{ value.name }}
    </p>
  </fieldset>
</template>
