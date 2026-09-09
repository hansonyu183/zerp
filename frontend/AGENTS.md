# ZERP 前端约束

- `src/target/` 是唯一生产入口；`main.ts` 只装配 Router、Pinia、Vuetify 与根页面，业务 HTTP 统一由 `api.ts` 调用生成客户端。
- 业务请求只通过 `src/target/api.ts` 消费 `@zerp/api-client`；禁止直接 `fetch`、手写 wire DTO 或任意字符串路径。
- Cookie、CSRF、统一响应与 `requestId` 由 API 适配层处理；页面只消费领域结果和稳定 `errorKey`。
- `availableActions` 由服务端生成。前端只负责呈现，执行时仍由服务端重新鉴权和校验业务事实。
- Wire 金额与数量保持十进制字符串精度；服务端响应是最终事实。
- 全部已登记业务入口只提供强类型 definition，由直接维护、版本档案、单据、配置、报表、流程运行六类页面拥有查询、编辑、精确权限、写入与刷新。业务定义不持有 VM、响应式状态、模板、slot/render、任意请求或布局回调；局部专用区块只接收所辖值、目录及模式，不接整页运行时。接口与例外见 [ADR-0060](../docs/adr/0060-dynamic-page-runtime.md)。系统登录与改密页保留本地 VM；全站会话和品牌状态放在 `session/`。
- 修改后至少运行 `pnpm typecheck`、相关单元测试与 `pnpm build:target`；关键业务流程运行根目录 `make e2e`。
- 浏览器 E2E 只连接 `compose.target.yaml` 的可丢弃 PostgreSQL/API/Web，不得指向开发测试公网库。
