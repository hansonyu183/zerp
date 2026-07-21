import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'zerpLight',
    themes: {
      zerpLight: {
        dark: false,
        colors: {
          background: '#f4f6f8',
          surface: '#ffffff',
          primary: '#155eef',
          secondary: '#344054',
          error: '#d92d20',
          info: '#0ba5ec',
          success: '#039855',
          warning: '#dc6803',
        },
      },
    },
  },
})
