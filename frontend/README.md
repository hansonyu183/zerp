# ZERP Frontend

ZERP 前端是单仓中的 Vue SPA，负责页面交互、会话状态、动态菜单和业务 ViewModel。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

普通 JSON 业务请求统一通过 `src/api/client.ts` 的 `postContract` 或其领域封装发起，path、request 与 response 均从生成 OpenAPI 类型推导。文件上传、下载和 CSV 导出使用客户端的专用方法。

## 常用命令

在 `frontend/` 目录运行：

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:vue-template-typecheck
pnpm test:coverage
pnpm check
```

`pnpm dev` 只启动 Vite；完整环境、API 和数据库按[根 README](../README.md)启动。`pnpm typecheck` 检查前端源码和 Vue template；`pnpm test:vue-template-typecheck` 是隔离 template fixture 的工具链回归测试，`pnpm check` 会自动运行它。

真实全栈 Playwright 从仓库根目录运行：

```bash
make e2e
```

## 文档导航

- [前端工程约束](AGENTS.md)：目录组织、API、页面、权限、测试与重构规则
- [根 README](../README.md)：统一环境、启动、公共工具链、契约开发与部署方式
- [领域与页面用例](../README.md#文档)
- [前端 API 配置](../docs/operations/frontend-api-configuration.md)

## License

MIT，见根目录 [LICENSE](../LICENSE)。
