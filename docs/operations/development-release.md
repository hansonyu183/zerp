# 开发、PR 与自动上线规范

本规范覆盖从可验收提交到正式上线的完整路径。代码和配置只能从受保护的 `main` merge commit 上线；固定预览和生产发布不得构建包含未提交修改的开发工作区。

## 1. 开发与推送

每项工作使用独立分支或工作树，形成可验收提交后执行：

```bash
make pre-push-plan
make pre-push
```

`pre-push` 要求工作树干净，并按 `scripts/change-impact.sh` 分层：

- 文档变更运行差异、格式和文档完整性检查；
- 本地门禁和文档检查器等验证工具变更，额外运行逐文件 Shell 语法、ShellCheck、Actionlint 和门禁行为检查；CI 工作流自身发生变化时不要求固定预览，但 PR 转为 Ready 后必须实际跑完五项完整 CI 作业；
- 应用影响变更继续细分契约、前端、后端、容器、E2E、本地 E2E 和预览标记，只运行能够验证当前变更的门禁；
- 纯前端或纯后端运行代码在本地运行所属端完整质量门禁，完整 E2E 由 PR CI 执行；
- 契约、迁移、依赖、运行配置、跨端、E2E 工具及未知变更在本地继续运行隔离全栈 E2E；
- 单元测试-only 只运行所属端门禁，E2E-only 运行隔离 E2E，二者都不部署应用预览。

前端生产依赖审计只在 workspace、锁文件或前端依赖清单变化时运行；普通前端源码变化继续运行 lint、覆盖率和构建，但不重复执行只依赖锁文件的审计。后端数据库门禁会从上一迁移版本加载 `backend/db/migration-tests/<version>_{before,after}.sql` 夹具后升级到最新版本；每个新迁移必须同时提供对应升级夹具，不能只证明空库可迁移。

`make pre-push-plan` 只显示将执行的阶段和预览要求；需要忽略细分结果并保守执行全部门禁时运行 `PRE_PUSH_FULL=1 make pre-push`。任何失败都必须修复并形成新提交，不得推送红色分支。

本地 E2E 按后端与 Web 的真实构建输入分别计算指纹，复用未变化一侧的已标记镜像；需要排除缓存时运行 `E2E_FORCE_REBUILD=1 make e2e`。CI 使用 `backend/Dockerfile.ci` 的 BuildKit Go module/build cache mount、`actions/cache` 与 cache dance 显式导入/导出跨 runner 的 Go 缓存，并同时保留 GitHub Actions 层缓存；一次安装 Chromium、构建与生产镜像内容对齐的 API/Web 镜像并启动隔离全栈，然后以单 worker 依次运行桌面和手机 Playwright 项目，避免重复构建和共享数据库并发污染。验证工具会拒绝 CI 镜像的二进制集合、运行时阶段或缓存导入路径与标准约定漂移。CI 重试后通过的 flaky 用例按失败处理；失败时保留 Playwright HTML、trace、截图和测试结果 14 天。

本地门禁通过后推送分支并创建草稿 PR。PR 必须直接以 `main` 为基线和目标；有依赖的后续分支等前置 PR 合并后基于最新 `main` 重放，再创建新的 PR，禁止堆叠 PR。CI 会先校验目标分支、当前 `main` ancestry、其他未合并 PR head 和检查矩阵，再决定是否启动重任务。

应用变更的草稿 PR 只运行契约、前端、后端静态检查、容器配置和聚合检查，延后耗时的后端集成/race 与隔离全栈 E2E；此时独立的 `full-validation` 检查按设计保持失败，明确表示尚不可合并。自动评审和修正稳定后将 PR 转为 Ready，`ready_for_review` 事件会对当前 head 启动完整 backend 与 E2E，并在五项门禁成功后将 `full-validation` 转绿；完整检查未成功前不得合并或部署固定预览。Ready 后的新提交仍会重新运行完整门禁；需要多轮大改时应先转回草稿，批量完成修正后再转为 Ready，避免每次小提交重复运行全套门禁。

文档和普通验证/发布工具变更不属于应用影响：无论 Draft 或 Ready，都只运行文档格式、actionlint、ShellCheck、流程自检以及变更直接要求的容器配置检查，`full-validation` 聚合这些轻量结果后通过，不启动后端集成/race、应用构建或隔离全栈 E2E。需要验证完整工作流编排时使用 `workflow_dispatch` 明确触发一次全套检查，不把该验证扩散为流程类 PR 的固定合并成本。

PR 当前 head 在 Ready 状态下运行的 `contracts`、`frontend`、`backend`、`containers` 和 `e2e` 必须全部成功。需要固定预览时，在这轮五项完整检查全绿后执行：

```bash
make preview-deploy PREVIEW_REF=<PR-head-full-sha>
make preview-status
```

预览必须使用当前 PR head 的完整 SHA；推送新提交后，旧预览验收立即失效，必须等待新 SHA 的五项检查全绿后重新部署。运行代码、契约、迁移、依赖、构建和预览工具变更要求固定预览；文档、普通验证工具、单元测试-only、E2E-only 和生产工具-only 不要求应用预览。适用的预览人工验收完成后才可人工合并，禁止直接推送、强推或自动合并 `main`。

合并后不重复运行整套质量与 E2E。main 门禁通过 GitHub API 验证合并提交与 PR head 的 Git tree 完全一致，并复用该 PR 的五项成功检查及 `full-validation` 成功证据。树不一致、不是关联 PR 合并提交、任一检查缺失或只存在草稿快速门禁时立即失败，避免 Ready 后立刻合并绕过完整 E2E。main 仍保留原有五个分支保护检查名，生产发布代理通过它们间接依赖已验证的完整门禁。

## 2. 自动上线

正式环境由同一 merge commit 统一发布：

1. Cloudflare Pages Git 集成构建并发布同一 `main` commit；
2. 本机发布代理确认 `main` 已复用的五项 PR 检查和 `Cloudflare Pages` 全部成功；
3. 从独立干净仓库构建带完整 commit SHA 的 API、migrate、Web 镜像和前端产物；
4. 备份 PostgreSQL、附件及上一版发布清单；
5. 运行向后兼容的 Goose migration；
6. 更新本机 `zerp-back` API 与 Web，验证本机和公网健康；
7. 验证 Pages 的精确 commit 标记、`https://zerp.bytesucceed.com` 与 `https://zerp-api.bytesucceed.com`，并写回 GitHub Production Deployment 状态。

发布代理是用户级 launchd 服务，每 60 秒检查一次 `origin/main`。Mac 离线或未登录时发布保持排队，Colima 恢复后继续。代理复用 `scripts/change-impact.sh`：文档和验证工具提交不等待已跳过的 Pages 检查，直接记录为成功 no-op；应用发布成功后自动更新已安装的控制器脚本。代理为每个目标 SHA 复用同一条 GitHub Deployment，Pages 未完成时标记 `queued`，明确失败时标记 `failure` 并继续观察同一检查的恢复，不再每分钟创建空记录；GitHub fetch、检查读取和 Deployment 写回使用有界指数退避。代理单独记录已处理提交，`current-sha` 始终指向最后一次成功发布的应用版本，日志行使用 UTC 时间戳。

合并后的交付确认必须等待发布代理完整结束，不能在 API 容器刚切换时提前完成。最终运行 `make production-status`，确认 `current-sha`、API 和 Web 容器标签、Cloudflare Pages 精确 commit 标记及两个公网入口均指向同一 merge commit。若构建和容器已健康，但公网出现瞬时 TLS、`530` 或 release 标记尚未更新，应先查看发布代理日志，区分“仍在发布”“Tunnel/网络抖动”和“已写入失败标记”；仅外部入口瞬时失败时重新验证入口，只有代理明确熔断该 SHA 后才使用 `make production-retry`。

## 3. 生产隔离与凭证

- Production Compose 项目固定为 `zerp-back`，环境文件固定为 `backend/.env.production.local`，权限必须为 `600`。
- 开发、E2E、固定预览和生产必须使用不同 Compose 项目、端口、数据库、卷和 Cookie。
- Cloudflare Pages 继续复用仓库现有 Git 集成，不新增、不复制 Pages API Token。
- 发布备份保存在被 Git 忽略的 `backend/var/production/releases/`，保留最近七次成功版本。

## 4. 失败与回滚

构建、备份或 migration 失败时不更新应用。Pages 失败会在本机发布前阻断流程，并在同一 GitHub Deployment 上保留失败原因；Pages 状态恢复后代理自动继续。API rollout 或公网健康检查失败时，发布代理自动恢复上线前的应用镜像并标记 GitHub Deployment 失败。

同一 main SHA 首次发布失败后，发布代理写入失败标记并停止自动重试，避免确定性错误每分钟重复构建、备份和迁移。修复外部状态并完成必要的数据确认后，运行 `make production-retry` 清除该 SHA 的熔断标记并立即重试；新的 main SHA 不受旧失败标记影响。

数据库不得自动执行 down migration，也不得自动恢复备份，以免覆盖上线后的业务写入。所有 migration 必须兼容上一版应用；数据库恢复只能在明确停写和人工确认后执行。

人工回滚到已验证版本：

```bash
make production-rollback PRODUCTION_REF=<full-commit-sha>
make production-status
```

该命令只切换本机应用镜像，不修改 Pages 或数据库。需要回退前端时，通过 revert PR 恢复 `main`；Cloudflare Pages 与本机代理会按新 merge commit 自动完成协调发布。

## 5. 安装与验收

首次安装前准备生产环境文件，然后运行：

```bash
scripts/install-production-agent.sh
make production-status
```

验收必须覆盖：直接推送 `main` 被拒绝、失败检查阻止合并、精确 SHA 预览不包含脏工作区、合并后自动发布、数据库和附件备份、应用失败自动回滚，以及本机、公网和 `al-sz-root` 健康探测。
