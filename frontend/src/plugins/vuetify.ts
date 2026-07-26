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
          'on-background': '#172b4d',
          'on-surface': '#172b4d',
          'on-surface-variant': '#667085',
          primary: '#155eef',
          secondary: '#344054',
          error: '#d92d20',
          info: '#0ba5ec',
          success: '#039855',
          warning: '#dc6803',
        },
      },
      zerpDark: {
        dark: true,
        colors: {
          background: '#0f1115',
          surface: '#181b20',
          'on-background': '#edf0f6',
          'on-surface': '#edf0f6',
          'on-surface-variant': '#aeb7c5',
          primary: '#42a5f5',
          secondary: '#aeb7c5',
          error: '#ff6b6b',
          info: '#40c4ff',
          success: '#36c98f',
          warning: '#ffb454',
        },
      },
    },
  },
})
