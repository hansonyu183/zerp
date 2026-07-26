import { createApp } from 'vue'
import App from './App.vue'
import { vuetify } from '@/plugins/vuetify'
import { router } from '@/router'
import { pinia } from '@/stores'
import '@/style.css'

createApp(App).use(pinia).use(router).use(vuetify).mount('#app')
