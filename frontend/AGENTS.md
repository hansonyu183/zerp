# ZERP 前端约束

- `src/target/` 是唯一生产入口；`main.ts` 只装配 Router、Pinia、Vuetify 与根页面，业务 HTTP 统一由 `api.ts` 调用生成客户端。
- 业务请求只通过 `src/target/api.ts` 消费 `@zerp/api-client`；禁止直接 `fetch`、手写 wire DTO 或任意字符串路径。
- Cookie、CSRF、统一响应与 `requestId` 由 API 适配层处理；页面只消费领域结果和稳定 `errorKey`。
- `availableActions` 由服务端生成。前端只负责呈现，执行时仍由服务端重新鉴权和校验业务事实。
- Wire 金额与数量保持十进制字符串精度；服务端响应是最终事实。
- 页面组件负责模板和交互装配；页面状态与动作放在该页面同目录 `vm.ts`，全站会话和品牌状态放在 `session/`。共享逻辑只在出现真实复用时抽取。
- 修改后至少运行 `pnpm typecheck`、相关单元测试与 `pnpm build:target`；关键业务流程运行根目录 `make e2e`。
- 浏览器 E2E 只连接 `compose.target.yaml` 的可丢弃 PostgreSQL/API/Web，不得指向开发测试公网库。
