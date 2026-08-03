# ZERP Frontend

ZERP 前端是单仓中的 Vue SPA，负责页面交互、会话状态、动态菜单和业务 ViewModel。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

## 开发环境

- Node.js 与 pnpm 版本以根目录 `.nvmrc`、`package.json` 和锁文件为准
- Vue 3、TypeScript 7、Vite、Vuetify、Vue Router、Pinia
- Vitest、Vue Test Utils、MSW、Playwright

`pnpm typecheck:native` 使用根目录独立锁定的 TypeScript 7.0.2。Vue 模板检查和依赖 TypeScript JavaScript API 的工具暂由 TypeScript 6 兼容层运行，完整 `pnpm build` 会同时执行两套检查。

从仓库根目录启动完整开发环境：

```bash
make bootstrap
make dev
```

仅运行前端时：

```bash
pnpm --filter @zerp/frontend dev
```

模块内常用命令：

```bash
pnpm build
pnpm lint
pnpm format:check
pnpm docs:check
pnpm test:unit
pnpm test:coverage
pnpm test:e2e
pnpm check
```

以上命令用于模块开发期反馈；形成可验收提交后，在根目录统一运行 `make pre-push`。

## 目录与页面

```text
src/
├─ api/
│  ├─ client.ts          # 统一 API 与受限文件客户端
│  ├─ generated/         # OpenAPI 生成类型，禁止手工修改
│  └─ types.ts           # 前端通用结果与错误类型
├─ components/
│  ├─ common/            # 跨领域、无业务语义的 UI 原语
│  └─ {feature}/         # 跨页面复用的领域或业务能力组件
├─ composables/          # 可复用的有状态行为
├─ layouts/              # 应用布局
├─ pages/
│  ├─ auth/              # 公开认证页面
│  ├─ home/              # 登录后首页
│  ├─ {domain}/shared/   # 同领域页面共享的工作区、VM 和业务辅助逻辑
│  ├─ {domain}/{entity}/ # 实体专属页面及同目录 ViewModel
│  └─ system/            # 占位页与错误页
├─ router/               # 路由、页面注册表和守卫
├─ stores/               # 跨页面共享状态
└─ main.ts
```

每个业务实体对应 `src/pages/{domain}/{entity}`。页面组件负责模板、样式和交互装配，状态与业务动作放在同目录 `vm.ts`：

```text
src/pages/vou/sale-order/
├─ SaleOrder.vue
└─ vm.ts
```

页面组件不得解析响应包络或自行请求 API。复杂页面可以把验证、附件、历史、权限计算和数据转换拆成同目录模块，把可跨页面复用的异步行为拆成 composable，但 `vm.ts` 仍是页面状态和动作的唯一编排入口。

模块归属遵循最小有效共享范围：实体专属逻辑留在实体目录，同一领域复用的页面编排放在 `pages/{domain}/shared/`，跨页面复用的领域或业务能力组件放在 `components/{feature}/`，只有无领域语义的 UI 原语进入 `components/common/`。公共抽取应有实际复用点或明确的一致性需求，不为改名创建薄包装。

进行结构重构时按以下顺序处理：

1. 从现有组件、composable、页面共享目录和路由注册表查找可复用能力；
2. 按最小共享范围确定归属，通过配置和插槽承载同类页面差异；
3. 将请求、业务转换和动作编排从页面移入 VM、同目录模块或 composable；
4. 替换全部调用方，并从真实入口、路由、注册表和导入引用确认旧实现不可达；
5. 删除旧代码、专属测试和失效导出，为新模块补充测试并迁移覆盖率门禁。

远程搜索类 composable 必须处理并发响应顺序、作用域销毁和已选值保留，避免较早请求覆盖新结果或候选刷新后丢失当前显示。

只有以下状态进入 Pinia：

- 当前用户、会话和 CSRF 状态；
- 动态菜单与动作权限；
- 多页面共享且必须保持一致的数据；
- 应用级 UI 状态。

## API 与权限

业务代码只能通过 `src/api/client.ts` 及领域封装调用生成客户端。不得直接使用 `fetch`、拼接任意 API 路径、维护手写 DTO 副本，或在失败时回退到本地假数据。

Cookie、CSRF、统一响应和文件令牌均由 API 客户端处理。页面只消费领域结果和稳定错误类型，并在可用时保留 `requestId`。

动态菜单规则：

- `app` 领域不进入业务菜单；
- 其余领域的任一格式正确实体权限均可生成菜单；
- 本地注册实体加载真实页面，未注册实体加载固定“开发中...”页面；
- 页面动作使用完整权限路径精确判断；
- 前端权限只控制交互，后端鉴权是最终安全边界。

线协议、字段和动作以 `contracts/openapi/` 为准。业务状态机、默认值和交互约束见：

- [APP：访问、会话与权限](../docs/domains/app.md)
- [BOB：业务对象](../docs/domains/bob.md)
- [AUX：辅助对象](../docs/domains/aux.md)
- [VOU：业务单据](../docs/domains/vou.md)
- [WFL：业务流程](../docs/domains/wfl.md)
- [LED：业务账簿](../docs/domains/led.md)

## 测试

Vitest 和组件测试可使用 MSW，handlers 只能存在于测试目录。重点覆盖 API 错误归一化、ViewModel 状态、会话恢复、权限菜单、表单与并发保护。覆盖率门禁采用全局基线加关键模块独立阈值，新增职责不得靠其他高覆盖文件抵消回退。

Playwright 核心流程必须连接根目录 `make e2e` 创建的隔离全栈，不得拦截业务请求。E2E 会使用独立数据库、附件卷、Cookie 和端口，并在结束时清理所属 Compose 项目。

## 部署

正式支持两种前端部署：

- 同源 Web：容器构建把 API 基址设为 `/api/`，Nginx 代理 API 和文件请求；
- Cloudflare Pages：从仓库根目录运行 `pnpm build`，产物为根目录 `dist/`，浏览器直连配置的 HTTPS API。

环境变量、Origin、Cookie、本地代理和 E2E 端口见[前端 API 配置手册](../docs/operations/frontend-api-configuration.md)。

## License

MIT，见根目录 [LICENSE](../LICENSE)。
