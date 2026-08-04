# ZERP 全栈工程约束

## 仓库边界

- 本仓库是 ZERP 的唯一开发仓库；前端位于 `frontend/`，后端位于 `backend/`。
- `contracts/openapi/` 是 HTTP 线协议的唯一事实来源，`docs/domains/` 是业务规则的唯一事实来源。
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
- 开发 PR 必须直接以 `dev` 为基线和目标；依赖中的后续工作可以保留本地分支，但必须等前置 PR 合并后基于最新 `dev` 重放，再创建 PR，禁止堆叠 PR 重复触发完整门禁。`main` 只接受 head 为 `dev` 的汇总发布 PR，禁止功能分支直接向 `main` 提交 PR。
- 形成可验收提交后先运行 `make pre-push-plan` 核对检查矩阵，再运行 `make pre-push`；门禁按 `scripts/change-impact.sh` 的文档、验证工具和应用影响三级分类，并在应用影响内细分契约、前端、后端、容器、E2E 和预览。纯前端或纯后端变更本地只运行所属端完整质量门禁，PR CI 负责完整 E2E；契约、迁移、依赖、运行配置、跨端和未知变更本地仍必须通过隔离 E2E。需要保守复核时运行 `PRE_PUSH_FULL=1 make pre-push`。
- 本地门禁通过后先推送并创建目标为 `dev` 的草稿 PR。GitHub 的 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `full-validation` 必需检查全部通过后才允许合入 `dev`；合并后的准确 `dev` merge commit 由预览发布代理更新到固定预览，不得用包含未提交修改的工作区代替。
- 运行代码、契约、迁移、依赖、构建和预览工具变更在合入 `dev` 后必须完成固定预览人工验收；文档、普通验证工具、单元测试-only、E2E-only 和生产工具-only 变更无需部署应用预览。需要正式发布时，以已验收的 `dev` 向 `main` 创建汇总发布 PR；只有该发布 PR 的必需检查通过后才允许人工合并。
- 固定预览失败时必须区分构建、迁移/种子、本机容器健康和公网 Tunnel 四层。若本机 Web/API 已健康且运行准确 SHA，公网 `530`、TLS 或资源预热失败不得通过 `preview-reset`、清空数据或重复改代码处理；应核对 Tunnel ingress、edge 连接和准确服务实例，恢复入口后重新运行 `make preview-status`。
- 合并前必须基于 PR 最新提交确认所有可执行 review thread 均已解决；新提交引入或重新打开的反馈必须重新处理，不得只依赖汇总 review 状态。
- 生产可见问题必须核对真实 URL、浏览器实际请求目标、已加载资源和发布 SHA；不得仅凭本地代码或健康检查推断线上版本和行为。
- 禁止直接推送、强推或自动合并 `dev` 和 `main`。合并后的 `dev` 由预览发布代理自动部署，合并后的 `main` 由生产发布代理自动部署，不得从开发工作区直接上线。
- 需要完成合并交付时，必须等待生产发布代理处理 merge commit，并以 `make production-status` 确认 API、Web、公网入口和发布 SHA 一致后再结束；容器先切换而发布代理或公网标记尚未完成时不得提前宣称上线成功。
- 保留用户已有修改，只改任务相关文件。

运行环境、统一命令和部署方式见根目录 `README.md`；模块细则见 `frontend/AGENTS.md` 和 `backend/AGENTS.md`。
