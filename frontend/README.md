# ZERP Frontend

ZERP 前端是单仓中的 Vue SPA，负责页面交互、会话状态、动态菜单和业务 ViewModel。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

普通 JSON 业务请求统一通过 `src/api/client.ts` 的 `postContract` 或其领域封装发起，path、request 与 response 均从生成 OpenAPI 类型推导。文件上传、下载和 CSV 导出使用客户端的专用方法。

## 环境与启动

- Node.js 与 pnpm 版本以根目录 `.nvmrc`、`package.json` 和锁文件为准
- Vue 3、TypeScript 7、Vite、Vuetify、Vue Router、Pinia

从仓库根目录启动完整开发环境：

```bash
make bootstrap
make dev
```

仅运行前端：

```bash
pnpm --filter @zerp/frontend dev
```

## 常用命令

在 `frontend/` 目录运行：

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:vue-template-typecheck
pnpm test:coverage
pnpm check
```

`pnpm typecheck` 是唯一生产类型门禁：通过 `vue-tsc` 与 TypeScript native bridge 使用 TypeScript 7/tsgo checker，以一次 `vue-tsc -b --force` 检查 `.ts`、`.tsx` 和 `.vue` template。`pnpm test:vue-template-typecheck` 是独立工具链回归测试，要求同一 checker 拒绝故意错误的隔离 Vue template fixture；`pnpm check` 会自动运行它，但它不是 `typecheck` 命令的一部分。

真实全栈 Playwright 从仓库根目录运行：

```bash
make e2e
```

## 文档导航

- [前端工程约束](AGENTS.md)：目录组织、API、页面、权限、测试与重构规则
- [根 README](../README.md)：统一环境、命令、契约开发与部署方式
- [领域与页面用例](../README.md#文档)
- [前端 API 配置](../docs/operations/frontend-api-configuration.md)

## License

MIT，见根目录 [LICENSE](../LICENSE)。
