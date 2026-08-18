# ZERP 全栈工程约束

## 仓库边界

- 本仓库是 ZERP 的唯一开发仓库；前端位于 `frontend/`，后端位于 `backend/`。
- `contracts/openapi/` 是 HTTP 线协议的唯一事实来源，`docs/domains/` 是业务规则的唯一事实来源。
- `docs/use-cases/` 按页面记录前端编排、后端协作流程、异常分支和验收场景；用例文档必须引用领域规则和 OpenAPI，不得复制或改写它们。
- 禁止在 `frontend/` 或 `backend/` 下复制领域文档或维护第二套接口说明。
- `frontend/AGENTS.md`、`backend/AGENTS.md` 只补充模块约束，不得覆盖本文件的全仓规则。
- 模块任务默认只修改所属目录；跨端契约、领域文档、根级编排或质量门禁任务可以按任务范围同时修改根目录和两个模块，无需把单仓边界误解为子目录隔离。
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

## 变更门禁

- 跨端契约变更必须同时包含 OpenAPI、后端适配、前端调用和对应测试。
- SQL 修改后运行 `make generate`，不得手改 sqlc 生成代码。
- 每项工作使用独立分支或工作树，不得把无关修改混入提交、预览、PR 或部署。
- PR 必须直接以 `main` 为基线和目标；依赖中的后续工作可以保留本地分支，但必须等前置 PR 合并后基于最新 `main` 重放，再创建 PR，禁止堆叠 PR 重复触发完整门禁。
- 人工工作在创建 PR 前获取最新 `origin/main` 并完成重放，然后运行 `make pre-push`；禁止先创建 PR 再常规强推。门禁范围由 `scripts/change-impact.sh` 判定。
- `validation` 是自动化门禁聚合，`full-validation` 是最终可合并证据。GitHub 的 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `validation` 必须按影响矩阵成功。需要预览的 PR 先发布 `preview-required`，再由配置的 release-verifier 对 exact SHA 验收并发布 `full-validation`。任何新提交都使旧 head 的远端证据失效。
- 运行代码、契约、迁移、依赖、构建和预览工具变更必须完成固定公网预览。文档、普通验证工具、单元测试-only、E2E-only 和生产工具-only 变更无需部署应用预览。固定预览一次只服务一个活跃 PR；关闭或拒绝时恢复基线，生产成功后释放。
- 固定预览失败时必须区分构建、迁移/种子、本机原生进程健康和公网 Tunnel 四层。若本机 Web/API 已健康且运行准确 SHA，公网 `530`、TLS 或资源预热失败不得通过 `preview-reset`、清空数据或重复改代码处理；应核对 Tunnel ingress、edge 连接和准确服务实例，恢复入口后重新运行 `make preview-status`。
- 合并前必须使用 `gh pr checks --required` 确认 PR 最新 SHA 的全部必需检查成功。
- 生产可见问题必须核对真实 URL、浏览器实际请求目标、已加载资源和发布 SHA；不得仅凭本地代码或健康检查推断线上版本和行为。
- 禁止直接推送或强推 `main`。全部 exact-SHA 证据成功后才可请求 squash auto-merge，GitHub ruleset 决定是否执行。合并后的 `main` 由生产发布代理自动部署，不得从开发工作区直接上线。
- 需要完成合并交付时，必须等待生产发布代理处理 squash 后的发布提交，并以 `make production-status` 确认 API、Web、公网入口和发布 SHA 一致后再结束；容器先切换而发布代理或公网标记尚未完成时不得提前宣称上线成功。
- 保留用户已有修改，只改任务相关文件。

运行环境、统一命令和部署方式见根目录 `README.md`；模块细则见 `frontend/AGENTS.md` 和 `backend/AGENTS.md`。

## Code Review Rules

### 发布证据来源

- 当代码把 GitHub check、commit status 或 deployment 作为验证、预览、合并或生产发布证据时，必须同时核对准确仓库、提交 SHA、事件/PR 绑定、预期提供者身份和不可变运行链接。安全路径：从 GitHub API 读取结构化来源并拒绝同名但来源不可信或提交不一致的证据。

### Domain docs

This repository uses a single-context domain-documentation layout. See `docs/agents/domain.md`.
