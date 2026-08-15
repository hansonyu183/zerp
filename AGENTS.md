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
- 后端 Handler 只做协议适配、权限、校验和领域模型映射；事务及业务规则继续位于领域 Service。

## 变更门禁

- 跨端契约变更必须同时包含 OpenAPI、后端适配、前端调用和对应测试。
- SQL 修改后运行 `make generate`，不得手改 sqlc 生成代码。
- 每项工作使用独立分支或工作树，不得把无关修改混入提交、预览、PR 或部署。
- PR 必须直接以 `main` 为基线和目标；依赖中的后续工作可以保留本地分支，但必须等前置 PR 合并后基于最新 `main` 重放，再创建 PR，禁止堆叠 PR 重复触发完整门禁。
- 形成可验收提交后只运行一次最终门禁。`$to-tickets` 本地批次由 `$implement` 在代码审查和修复后运行 `scripts/change-gate.sh <base-sha>` 并写 exact-head 证据；控制器不得先运行计划命令或重复门禁。普通人工工作在获取最新 `origin/main` 并重放后运行一次 `make pre-push`。门禁按 `scripts/change-impact.sh` 的文档、验证工具和应用影响三级分类，并在应用影响内细分契约、前端、后端、后端全量、容器、E2E 和预览。需要保守复核时使用 `PRE_PUSH_FULL=1` 执行同一次最终门禁。
- 本地批次必须先在没有 GitHub 读写的情况下完成实现、最终门禁和公网 exact-SHA 预览，再获取最新 `origin/main`。若重放只改变提交 SHA 且运行时指纹不变，复用已有门禁和预览；若运行时指纹改变或发生冲突，必须再次交给 `$implement` 修复并重新生成门禁和预览证据。通过后按依赖创建远端 Issues、推送一个分支并直接创建目标为 `main` 的 Ready PR。普通人工开发仍须在创建 PR 前重放最新 `main`，禁止先创建 PR 再常规强推。
- `validation` 是自动化门禁聚合，`full-validation` 是最终可合并证据。GitHub 的 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `validation` 必须按影响矩阵成功。受信任本地批次的 Ready PR 必须使用同仓 `automation/local-*` 分支，并在 PR 正文携带与事件 head 完全一致的批次 marker 和运行时指纹；GitHub Actions 核对这些条件后，只有完整矩阵成功才发布 `full-validation`。普通需要预览的 PR 仍先发布 `preview-required`，再由配置的 release-verifier 对 exact SHA 验收并发布 `full-validation`。任何新提交都使旧 head 的远端证据失效。
- 运行代码、契约、迁移、依赖、构建和预览工具变更必须完成固定公网预览。受信任本地批次在创建任何 GitHub 对象前，由主工作区控制脚本对候选 worktree 执行 exact-SHA 浏览器验收；普通 PR 继续使用独立 release-verifier。文档、普通验证工具、单元测试-only、E2E-only 和生产工具-only 变更无需部署应用预览。固定预览一次只服务一个活跃批次或 PR；关闭或拒绝时恢复基线，生产成功后释放。
- 固定预览失败时必须区分构建、迁移/种子、本机原生进程健康和公网 Tunnel 四层。若本机 Web/API 已健康且运行准确 SHA，公网 `530`、TLS 或资源预热失败不得通过 `preview-reset`、清空数据或重复改代码处理；应核对 Tunnel ingress、edge 连接和准确服务实例，恢复入口后重新运行 `make preview-status`。
- 合并前必须确认 PR 最新 SHA 的全部必需检查成功；本地批次控制器使用 `gh pr checks --required` 等待分支保护要求的检查。
- 生产可见问题必须核对真实 URL、浏览器实际请求目标、已加载资源和发布 SHA；不得仅凭本地代码或健康检查推断线上版本和行为。
- 禁止直接推送或强推 `main`。只有本地批次控制器可以在全部 exact-SHA 证据成功后请求 squash auto-merge；GitHub ruleset 决定是否执行。合并后的 `main` 由生产发布代理自动部署，不得从开发工作区直接上线。
- 需要完成合并交付时，必须等待生产发布代理处理 squash 后的发布提交，并以 `make production-status` 确认 API、Web、公网入口和发布 SHA 一致后再结束；容器先切换而发布代理或公网标记尚未完成时不得提前宣称上线成功。
- 保留用户已有修改，只改任务相关文件。

运行环境、统一命令和部署方式见根目录 `README.md`；模块细则见 `frontend/AGENTS.md` 和 `backend/AGENTS.md`。

## Code Review Rules

### 发布证据来源

- 当代码把 GitHub check、commit status 或 deployment 作为验证、预览、合并或生产发布证据时，必须同时核对准确仓库、提交 SHA、事件/PR 绑定、预期提供者身份和不可变运行链接。安全路径：从 GitHub API 读取结构化来源并拒绝同名但来源不可信或提交不一致的证据。

## Agent skills

### Issue tracker

Development tickets are local `$to-tickets` batches under `.scratch/<feature>/issues`; GitHub Issues are published only after the complete batch passes its public preview. See `docs/agents/issue-tracker.md`.

When work changes local batch claiming, automated implementation/review, preview publication, GitHub mirroring, auto-merge, stop behavior, or production closure, follow `docs/agents/issue-delivery-automation.md` completely.

### Domain docs

This repository uses a single-context domain-documentation layout. See `docs/agents/domain.md`.
