import type { ThemeDefinition } from 'vuetify'
import { md1, md2, md3 } from 'vuetify/blueprints'

export const themePresets = [
  {
    name: 'Material Design 1',
    light: 'md1Light',
    dark: 'md1Dark',
    blueprint: md1,
  },
  {
    name: 'Material Design 2',
    light: 'md2Light',
    dark: 'md2Dark',
    blueprint: md2,
  },
  {
    name: 'Material Design 3',
    light: 'md3Light',
    dark: 'md3Dark',
    blueprint: md3,
  },
] as const

export const defaultThemeName = themePresets[2].light

export function findThemePreset(name: string) {
  return themePresets.find(
    (preset) => preset.light === name || preset.dark === name,
  )
}

export const themes: Record<string, ThemeDefinition> = {}
for (const preset of themePresets) {
  const officialThemes = preset.blueprint.theme
    ? preset.blueprint.theme.themes
    : undefined
  for (const mode of ['light', 'dark'] as const) {
    const official = officialThemes?.[mode]
    themes[preset[mode]] = {
      ...official,
      dark: mode === 'dark',
      colors: {
        ...official?.colors,
        'table-header': mode === 'dark' ? '#22262d' : '#f2f4f7',
        muted: mode === 'dark' ? '#aeb7c5' : '#667085',
      },
    }
  }
}
