# ZERP 全栈工程约束

## 仓库边界

- 本仓库是 ZERP 的唯一开发仓库；前端位于 `frontend/`，后端位于 `backend/`。
- `contracts/openapi/` 是 HTTP 线协议的唯一事实来源，`docs/domains/` 是业务规则的唯一事实来源。
- 禁止在 `frontend/` 或 `backend/` 下复制领域文档或维护第二套接口说明。
- 不得提交密码、Cookie、CSRF Token、数据库连接串、API Token、测试账号、附件或生产数据。

## 契约优先

- 新增或修改接口时先修改 OpenAPI 和领域文档，再运行 `make generate`。
- `frontend/src/api/generated/`、`backend/internal/api/generated/`、`contracts/openapi/dist/` 均为生成物，禁止手工编辑。
- 业务接口继续使用 `POST application/json` 和 `/{domain}/{entity}/{action}`，响应包络为 `{code, message, data, requestId}`。
- 前端业务代码只能通过 `src/api/client.ts` 及其领域封装调用生成客户端，不得直接使用 `fetch` 或拼接任意 API 路径。
- 后端 Handler 只做协议适配、权限、校验和领域模型映射；事务及业务规则继续位于领域 Service。

## 变更门禁

- 跨端契约变更必须同时包含 OpenAPI、后端适配、前端调用和对应测试。
- SQL 修改后运行 `make generate`，不得手改 sqlc 生成代码。
- 提交前至少运行 `make generate-check`、`make check`；影响真实流程时运行 `make e2e`。
- 保留用户已有修改，只改任务相关文件。

更具体的规则见 `frontend/AGENTS.md`、`backend/AGENTS.md` 和根目录 `README.md`。
