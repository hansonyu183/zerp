# ZERP 全栈工程约束

## 仓库边界

- 本仓库是 ZERP 的唯一开发仓库；前端位于 `frontend/`，后端位于 `backend/`。
- `contracts/openapi/` 是 HTTP 线协议的唯一事实来源，`docs/domains/` 是业务规则的唯一事实来源。
- 禁止在 `frontend/` 或 `backend/` 下复制领域文档或维护第二套接口说明。
- `frontend/AGENTS.md`、`backend/AGENTS.md` 只补充模块约束，不得覆盖本文件的全仓规则。
- 模块任务默认只修改所属目录；跨端契约、领域文档、根级编排或质量门禁任务可以按任务范围同时修改根目录和两个模块，无需把单仓边界误解为子目录隔离。
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
- 每项工作使用独立分支或工作树，不得把无关修改混入提交、预览、PR 或部署。
- PR 必须直接以 `main` 为基线和目标；依赖中的后续工作可以保留本地分支，但必须等前置 PR 合并后基于最新 `main` 重放，再创建 PR，禁止堆叠 PR 重复触发完整门禁。
- 形成可验收提交后运行 `make pre-push`；非纯文档变更必须通过生成检查、全栈质量门禁和隔离 E2E。
- 本地门禁通过后使用 `make preview-deploy PREVIEW_REF=<commit>` 发布准确提交；不得用包含未提交修改的工作区代替。
- 推送后创建草稿 PR；GitHub 必需检查全部通过且固定预览完成人工验收后，才允许人工合并。
- 禁止直接推送、强推或自动合并 `main`。合并后的 `main` 由生产发布代理自动部署，不得从开发工作区直接上线。
- 保留用户已有修改，只改任务相关文件。

运行环境、统一命令和部署方式见根目录 `README.md`；模块细则见 `frontend/AGENTS.md` 和 `backend/AGENTS.md`。
