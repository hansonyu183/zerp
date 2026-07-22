# ZERP

ZERP 是供企业内部使用的 ERP 前端项目，面向基础资料、销售、采购、库存、财务、报表和系统管理等业务场景。项目采用 Vue 单页应用（SPA）架构，由 Cloudflare Pages 托管，并连接各运行环境对应的真实后端 API。

本文档既是项目说明，也是前端工程约定。新增页面、接口、状态和测试时应遵循本文定义的边界。

## 领域文档

- [APP（应用访问与权限管理）](./docs/domains/app.md)
- [BOB（基础业务对象）](./docs/domains/bob.md)

## 技术栈

| 技术 | 基线版本 | 用途 |
| --- | --- | --- |
| [Vue](https://vuejs.org/) | 3 | 前端框架，使用 Composition API 和 TypeScript |
| [Vite](https://vite.dev/) | 8 | 开发服务器与生产构建 |
| [Vuetify](https://vuetifyjs.com/) | 4 | UI 组件与主题系统 |
| [Vue Router](https://router.vuejs.org/) | 5 | SPA 路由和访问控制 |
| [Pinia](https://pinia.vuejs.org/) | 3 | 全局共享状态 |
| [Vitest](https://vitest.dev/) | 最新稳定版 | 单元测试和组件测试 |
| [Vue Test Utils](https://test-utils.vuejs.org/) | 最新稳定版 | Vue 组件测试 |
| [MSW](https://mswjs.io/) | 最新稳定版 | 测试环境中的 API 模拟 |
| [Playwright](https://playwright.dev/) | 最新稳定版 | 连接真实测试后端的端到端测试 |

具体补丁版本以 `package.json` 和 `pnpm-lock.yaml` 为准。升级主版本前必须检查迁移指南并完成回归测试。

## 环境要求

- Node.js 20.19+ 或 22.12+
- pnpm（通过 Corepack 管理）
- 可访问的真实后端 API

```bash
corepack enable
pnpm install
pnpm dev
```

常用命令由 `package.json` 提供：

```bash
pnpm dev          # 启动本地开发服务器
pnpm build        # 类型检查并生成生产构建
pnpm preview      # 本地预览生产构建
pnpm test:unit    # 单元测试和组件测试
pnpm test:e2e     # 连接真实测试后端执行端到端测试
pnpm test         # 执行完整测试集
```

## 推荐目录结构

```text
src/
├─ api/
│  ├─ client.ts                 # 原生 fetch 统一客户端
│  └─ types.ts                  # 通用请求、响应和错误类型
├─ assets/                      # 字体、图片和全局样式
├─ components/                  # 跨页面复用的展示组件
├─ layouts/                     # 应用框架和页面布局
├─ pages/
│  ├─ signin/                   # 根页面：登录
│  │  ├─ SignIn.vue
│  │  └─ vm.ts
│  ├─ home/                     # 根页面：登录后的应用主页
│  │  ├─ Home.vue               # 顶栏、侧栏与内容加载出口
│  │  ├─ vm.ts
│  │  └─ content/               # 业务内容组件，不是独立根页面
│  │     └─ {domain}/
│  │        └─ {entity}/
│  │           ├─ {Entity}.vue  # 模板、Vuetify 组件和页面样式
│  │           └─ vm.ts         # 页面状态、业务动作和 API 调用
│  └─ notfound/                 # 根页面：404
│     └─ NotFound.vue
├─ plugins/                     # Vuetify 等插件初始化
├─ router/
│  ├─ index.ts                  # Router 实例和守卫
│  └─ registry.ts               # domain/entity 到页面组件的本地注册表
├─ stores/                      # Pinia 全局状态
├─ App.vue
└─ main.ts

tests/
├─ unit/                        # Vitest 单元与组件测试
├─ mocks/                       # 仅测试环境使用的 MSW handlers
└─ e2e/                         # Playwright 真实 API 测试
```

## 页面与业务内容开发约定

`pages` 下只保留 `signin`、`home` 和 `notfound` 三个根页面。登录后的业务界面共用 `home` 的顶栏、侧栏和内容区域；每个业务实体对应 `home/content` 下的一个组件目录。

例如，销售订单组件及其接口 `vou/saleorder/*` 对应：

```text
src/pages/home/content/vou/saleorder/
├─ SaleOrder.vue
└─ vm.ts
```

`home` 根据当前路由和后端菜单权限，从 `content/{domain}/{entity}` 加载匹配的实体组件。业务组件不得自行创建应用框架，也不得重复实现顶栏和侧栏。

### `{Entity}.vue`

- 主要定义 HTML 模板、Vuetify 组件和 scoped CSS。
- 从同目录 `vm.ts` 获取响应式状态和页面动作。
- 不直接调用 `fetch`，不拼接 API 地址，不解析后端响应包络。
- 仅保留必要的组件装配逻辑；可复用的展示组件放入 `src/components`。

```vue
<script setup lang="ts">
import { reactive } from 'vue'
import { useSaleOrderViewModel } from './vm'

const vm = reactive(useSaleOrderViewModel())
</script>

<template>
  <v-container>
    <v-btn :loading="vm.saving" @click="vm.save">保存</v-btn>
  </v-container>
</template>

<style scoped>
/* 仅属于当前页面的样式 */
</style>
```

### `vm.ts`

- 导出命名清晰的组合式 ViewModel，例如 `useSaleOrderViewModel()`。
- 管理当前页面的 `ref`、`reactive`、`computed`、校验状态和加载状态。
- 通过 `src/api/client.ts` 调用真实后端 API。
- 将后端错误转换为页面级、字段级或全局提示所需的状态。
- 页面卸载后不得继续写入已失效状态；需要时使用 `AbortController` 取消请求。

页面内临时状态保留在 `vm.ts`。只有以下状态进入 Pinia：

- 当前用户和会话状态；
- 动态菜单与动作权限；
- 多页面共享且需要保持一致的数据；
- 应用级 UI 状态，例如主题或全局通知。

不要仅为避免传递参数而创建全局 Store，也不要在多个页面复制同一份全局数据。

## 真实后端 API

开发、联调、预览和生产环境必须连接各自对应的真实后端 API。API 基址统一由环境变量提供：

```dotenv
VITE_API_BASE_URL=https://api.example.com/
```

环境文件不得提交密码、Cookie、API 密钥或测试账号。所有以 `VITE_` 开头的变量都会进入浏览器构建，必须视为公开信息。

### 强制规则

- 业务源码不得使用硬编码假数据、随机数据或本地 JSON 代替后端响应。
- 请求失败时不得自动回退到模拟数据，应显示明确的加载失败或服务不可用状态。
- 错误提示和日志应保留后端返回的 `requestId`，便于前后端联合排查。
- MSW 只允许在 Vitest 单元测试和组件测试中启用，不得进入开发、预览或生产构建。
- Playwright 核心业务流程不得拦截业务请求，必须连接独立的真实测试后端。

### URL 规范

所有 API 使用 `POST + application/json`，路径固定为三级：

```text
/{domain}/{entity}/{action}
```

| 层级 | 含义 | 示例 |
| --- | --- | --- |
| `domain` | 业务领域，对应一级动态菜单 | `app`、`vou` |
| `entity` | 业务实体，对应二级菜单及页面 | `user`、`saleorder` |
| `action` | 对实体执行的操作 | `signin`、`query`、`save`、`delete` |

示例：

```text
POST /app/user/signin
POST /app/user/session
POST /vou/saleorder/query
POST /vou/saleorder/save
```

### 请求与响应

请求体直接使用当前操作所需的 JSON 数据。列表查询统一使用以下字段：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "status": "open"
  },
  "sort": [
    { "field": "createdAt", "order": "desc" }
  ]
}
```

应用服务器已接收并处理的请求始终返回 HTTP 200。响应包络固定为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "01J..."
}
```

- `code === 0`：业务成功。
- `code !== 0`：业务失败。
- `message`：供用户提示或诊断，不能作为程序判断条件。
- `data`：操作结果；无数据时由接口契约明确为 `null`、对象或数组。
- `requestId`：一次请求的全链路追踪标识。

列表成功响应的 `data` 统一为：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

业务错误码必须稳定区分以下类别，具体数值由后端 API 契约统一维护：

- 未登录或会话失效；
- 已登录但无操作权限；
- 并发更新或数据冲突；
- 参数或字段校验失败；
- 服务端内部异常。

HTTP 200 只代表应用服务器返回了业务结果。DNS、CORS、TLS、连接中断、超时、非 JSON 响应等仍属于传输错误。`api/client.ts` 必须分别归一化传输错误、协议错误和业务错误，页面不得自行重复实现。

## Cookie 会话与 CSRF

鉴权由真实后端使用 Cookie 会话实现：

```text
POST /app/user/signin   # 登录并由后端写入会话 Cookie
POST /app/user/session  # 恢复用户、菜单、权限及 CSRF Token
POST /app/user/signout  # 注销并由后端清理会话 Cookie
```

- 会话 Cookie 必须由后端设置为 `Secure`、`HttpOnly` 和适当的 `SameSite`。
- 前端不得读取、复制或持久化会话标识。
- `api/client.ts` 对所有请求设置 `credentials: 'include'`。
- 登录后的请求携带会话接口返回的 `X-CSRF-Token`。
- 未登录业务码触发清空用户、菜单和权限 Store，并跳转登录页。
- 无权限业务码显示权限提示，不自动重试。
- 跨域部署时，后端必须显式允许准确的前端 Origin 和凭证，禁止使用通配符 CORS。

## 动态菜单、路由与权限

登录或恢复会话后，后端返回两级菜单及动作权限。菜单标识与 API 路径保持一致：

- 一级菜单使用 `domain`；
- 二级菜单使用 `entity`；
- 页面路由使用 `/${domain}/${entity}`；
- 动作权限使用后端返回的 `action` 集合。

前端以 `${domain}/${entity}` 为键，从编译期定义的本地注册表解析 `home/content` 下的业务组件，并由 `home` 的内容区域加载：

```ts
export const pageRegistry = {
  'vou/saleorder': () => import('@/pages/home/content/vou/saleorder/SaleOrder.vue'),
}
```

后端不得返回可被前端直接导入的任意组件路径。未在本地注册的实体不显示，并记录包含 `domain`、`entity` 和 `requestId` 的诊断信息。业务路由仍使用 `/${domain}/${entity}`，但它们渲染在 `home` 的 content 出口内，不新增第四种根页面。

前端权限仅用于菜单、按钮和交互控制，不是安全边界。真实后端必须对每次实体操作重新校验会话及动作权限。

## 首期业务模块

| 模块 | 主要范围 |
| --- | --- |
| 仪表盘 | 待办事项、核心指标和业务概览 |
| 基础资料 | 客户、供应商、商品、仓库、组织等主数据 |
| 销售 | 销售订单、出库、退货及相关查询 |
| 采购 | 采购订单、入库、退货及相关查询 |
| 库存 | 库存余额、调拨、盘点和流水 |
| 财务 | 应收、应付、收付款和业务对账 |
| 报表 | 经营、销售、采购、库存和财务报表 |
| 系统管理 | 用户、角色、菜单、权限和系统配置 |

具体 `domain`、`entity`、字段和动作编码以真实后端菜单及 API 契约为准。本文只固定三级 API 与页面映射规则；已确定的销售订单示例为 `vou/saleorder/*`。

## 测试策略

### 单元测试和组件测试

使用 Vitest、Vue Test Utils 和 MSW，重点覆盖：

- `api/client.ts` 对响应包络、业务码、超时、网络错误、非 JSON 响应和 CSRF 的处理；
- 列表分页、过滤和排序协议；
- `vm.ts` 的加载、保存、校验、并发保护和错误状态；
- Pinia 会话恢复、菜单和权限状态；
- 动态菜单过滤、本地页面解析和未知实体处理；
- 页面组件是否只通过 ViewModel 执行业务逻辑。

MSW handlers 必须放在测试目录，并确保生产入口无法导入它们。

### 端到端测试

Playwright 必须连接独立的真实测试后端，使用专用测试账号和可清理、可重复的数据集。核心业务请求不得通过 `page.route()` 等方式模拟。

至少覆盖以下流程：

1. 登录并加载真实会话；
2. 刷新页面后恢复会话、菜单和权限；
3. 根据后端菜单进入销售订单页面；
4. 查询并保存真实测试销售订单；
5. 验证无权限动作被前后端共同拒绝；
6. 验证会话失效后的清理和登录跳转；
7. 注销并确认会话失效。

测试 API 地址、账号和数据初始化方式通过 CI 密钥或受控测试环境提供，不得提交到 Git。

## Cloudflare Pages 部署

在 Cloudflare Pages 中连接 Git 仓库并使用以下配置：

| 配置项 | 值 |
| --- | --- |
| Framework preset | Vue |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Root directory | `/` |

分别为 Preview 和 Production 环境设置其真实 API 地址：

```dotenv
VITE_API_BASE_URL=https://api-preview.example.com/
```

```dotenv
VITE_API_BASE_URL=https://api.example.com/
```

部署注意事项：

- Preview 与 Production 不得共用生产写入权限的测试账号。
- 前端和 API 均必须使用 HTTPS。
- 不创建顶层 `404.html`，Cloudflare Pages 会按默认 SPA 行为将未知页面路径交给根 `index.html`，从而支持 Vue Router History 模式。
- 每次部署前必须通过构建、单元测试；生产发布前还必须通过真实测试后端上的关键端到端流程。

参考：[Cloudflare Pages 构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Cloudflare Pages SPA 路由](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## 安全要求

- 禁止在仓库中提交密码、会话 Cookie、API 密钥、生产数据或测试账号。
- 禁止在浏览器代码中加入任何依赖保密性的凭证。
- 日志和错误提示不得输出 Cookie、CSRF Token 或敏感业务数据。
- 权限判断以后端为最终准则，前端隐藏按钮不能代替后端鉴权。
- 涉及真实数据的调试应使用受控账号，并遵循企业数据访问和审计要求。

## License

许可证信息见 [LICENSE](./LICENSE)。
