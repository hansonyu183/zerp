import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { vuetify } from './plugins/vuetify.ts'
import { router } from './router/index.ts'
import { installRouterBehavior } from './router/guards.ts'
import { useTargetSession } from './session/vm.ts'
import './style.css'
import './styles/tables.css'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia).use(router).use(vuetify)
installRouterBehavior(router, useTargetSession(pinia))
app.mount('#app')
