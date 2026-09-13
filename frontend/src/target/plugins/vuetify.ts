import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import { zhHans } from 'vuetify/locale'
import { defaultThemeName, findThemePreset, themes } from './themes.ts'

const savedTheme = localStorage.getItem('zerp-theme')

export const vuetify = createVuetify({
  defaults: {
    VBtn: { color: 'primary' },
  },
  locale: {
    locale: 'zhHans',
    messages: { zhHans },
  },
  theme: {
    defaultTheme:
      savedTheme && findThemePreset(savedTheme) ? savedTheme : defaultThemeName,
    themes,
  },
})
