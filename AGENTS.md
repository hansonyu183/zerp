# ZERP 全栈工程约束

## 仓库边界

- 本仓库是 ZERP 的唯一开发仓库；前端位于 `frontend/`，后端位于 `backend/`。
- `contracts/openapi/` 是 HTTP 线协议的唯一事实来源，`docs/domains/` 是业务规则的唯一事实来源。
- `docs/use-cases/` 按页面记录前端编排、后端协作流程、异常分支和验收场景；用例文档必须引用领域规则和 OpenAPI，不得复制或改写它们。
- 禁止在 `frontend/` 或 `backend/` 下复制领域文档或维护第二套接口说明。
- `frontend/AGENTS.md`、`backend/AGENTS.md` 只补充模块约束，不得覆盖本文件的全仓规则。
- 模块任务默认只修改所属目录；跨端契约、领域文档、根级编排或质量检查任务可以按任务范围同时修改根目录和两个模块，无需把单仓边界误解为子目录隔离。
- Agent 主动创建、修改或删除的文件必须位于解析真实路径后的仓库根目录内，禁止通过符号链接或路径穿越写入仓库外；仓库外只读检查和开发工具自动管理的缓存不受此限制。
- 不得提交密码、Cookie、CSRF Token、数据库连接串、API Token、测试账号、附件或生产数据。
- 结构清理必须从真实入口、路由或注册表以及导入引用确认旧实现不可达；不可达生产代码应连同专属测试、导出和相关文档一起删除，不得保留第二套实现或用死代码测试充当质量覆盖。
- 仅做结构重构时必须保持现有 HTTP 契约、领域规则和用户可见行为；需要改变这些内容时，按对应契约或领域任务单独定界和验证。
- 本地凭证只可通过受控环境文件、剪贴板或进程内变量传递；不得打印环境文件，不得在密码、Token、Cookie 等敏感字段已填充后采集或输出 DOM 快照、截图、请求体或调试日志。若敏感值意外进入任何可见输出，必须立即轮换凭证、撤销相关会话并重新验证。

## 契约优先

- 新增或修改接口时先修改 OpenAPI 和领域文档，再运行 `make generate`。
- `frontend/src/api/generated/`、`backend/internal/api/generated/`、`contracts/openapi/dist/` 均为生成物，禁止手工编辑。
- 业务接口继续使用 `POST application/json` 和 `/{domain}/{entity}/{action}`，响应包络为 `{code, message, data, requestId}`。
- 前端业务代码只能通过 `src/api/client.ts` 及其领域封装调用生成客户端，不得直接使用 `fetch` 或拼接任意 API 路径。
- 新增或修改用户可见的状态、枚举、类型、实体标识或后端业务错误前，先列出完整 wire value 集合并确定最小共享范围的中文映射；选择项从同一映射派生，已知值不得回退显示协议原码。
- 后端 Handler 只做协议适配、权限、校验和领域模型映射；事务及业务规则继续位于领域 Service。

## 开发质量

- 跨端契约变更必须同时包含 OpenAPI、后端适配、前端调用和对应测试。
- SQL 修改后运行 `make generate`，不得手改 sqlc 生成代码。
- 修改后运行与变更相关的生成、测试和静态检查；涉及运行环境时额外验证 Docker Compose 配置与服务健康。
- 保留用户已有修改，只改任务相关文件。

运行环境、统一命令和部署方式见根目录 `README.md`；模块细则见 `frontend/AGENTS.md` 和 `backend/AGENTS.md`。

### Domain docs

This repository uses a single-context domain-documentation layout. See `docs/agents/domain.md`.

页面用例讨论直接采用已经确立的全站规则、当前领域不变量和成熟 CRUD 默认值；只向用户询问会改变业务语义、授权或安全边界、不可逆结果，或存在真实产品取舍的未决问题。确认后立即更新权威用例或领域文档。
