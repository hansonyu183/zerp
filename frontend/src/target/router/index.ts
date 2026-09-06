import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
} from 'vue-router'

import AppLayout from '../layouts/AppLayout.vue'
import ResourceHost from '../navigation/ResourceHost.vue'
import ChangePassword from '../pages/auth/change-password/ChangePassword.vue'
import SignIn from '../pages/auth/signin/SignIn.vue'
import Forbidden from '../pages/system/Forbidden.vue'
import NotFound from '../pages/system/NotFound.vue'

export function createTargetRouter(history: RouterHistory): Router {
  return createRouter({
    history,
    routes: [
      {
        path: '/signin',
        name: 'signin',
        component: SignIn,
        meta: { public: true, title: '登录', useCaseKey: 'app/signin' },
      },
      {
        path: '/change-password',
        name: 'change-password',
        component: ChangePassword,
        meta: {
          requiresAuth: true,
          restrictedSession: true,
          title: '修改密码',
          useCaseKey: 'app/change-password',
        },
      },
      {
        path: '/',
        name: 'app',
        component: AppLayout,
        meta: { requiresAuth: true },
        children: [
          {
            path: '',
            name: 'resource-home',
            component: ResourceHost,
            props: { domain: '', entity: '' },
            meta: {
              requiresAuth: true,
              title: '业务功能',
              useCaseKey: 'app/navigation',
            },
          },
          {
            path: 'forbidden',
            name: 'forbidden',
            component: Forbidden,
            meta: {
              requiresAuth: true,
              title: '无权访问',
              useCaseKey: 'app/forbidden',
            },
          },
          {
            path: ':domain/:entity',
            name: 'resource-host',
            component: ResourceHost,
            props: true,
            meta: {
              requiresAuth: true,
              title: '业务功能',
              useCaseKey: 'app/navigation',
            },
          },
        ],
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFound,
        meta: {
          requiresAuth: true,
          title: '页面不存在',
          useCaseKey: 'app/not-found',
        },
      },
    ],
  })
}

export const router = createTargetRouter(
  createWebHistory(import.meta.env.BASE_URL),
)
