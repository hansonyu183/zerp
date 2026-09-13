<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { findThemePreset } from './plugins/themes.ts'

const theme = useTheme()
const defaults = computed(
  () => findThemePreset(theme.global.name.value)?.blueprint.defaults,
)
</script>

<template>
  <v-defaults-provider :defaults="defaults">
    <v-app><router-view /></v-app>
  </v-defaults-provider>
</template>
