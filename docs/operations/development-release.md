# 开发、PR 与自动上线规范

本规范覆盖从可验收提交到正式上线的完整路径。开发变更先合入受保护的 `dev`，需要应用预览时再部署准确的 `dev` merge commit；正式环境只从 `dev` 汇总进入受保护 `main` 的 merge commit 上线，固定预览和生产发布不得构建包含未提交修改的开发工作区。

## 1. 开发与推送

每项工作使用独立分支或工作树，形成可验收提交后执行：

```bash
make pre-push-plan
make pre-push
```

`pre-push` 要求工作树干净，并按 `scripts/change-impact.sh` 分层：

- 文档变更运行差异、格式和文档完整性检查；
- 本地门禁、CI 工作流和文档检查器等验证工具变更，运行逐文件 Shell 语法、ShellCheck、Actionlint 和门禁行为检查，不要求固定预览或应用测试；只有需要验证完整编排时才通过 `workflow_dispatch` 显式跑一次全套作业；
- 应用影响变更继续细分契约、前端、后端、后端全量、容器、E2E、本地 E2E 和预览标记，只运行能够验证当前变更的门禁；
- 普通纯前端源码在本地运行前端门禁；普通纯后端源码在本地运行格式、普通测试、vet 和构建，PR CI 再补充静态与安全检查，不默认构建后端容器、启动测试 PostgreSQL 或运行 Playwright；
- 契约、SQL/迁移、依赖、运行配置、跨端、E2E 工具及未知变更继续运行后端全量集成/race 与适用的隔离全栈 E2E；
- 单元测试-only 只运行所属端门禁，E2E-only 运行隔离 E2E，二者都不部署应用预览。

前端生产依赖审计只在 workspace、锁文件或前端依赖清单变化时运行；普通前端源码变化继续运行 lint、覆盖率和构建，但不重复执行只依赖锁文件的审计。后端数据库门禁会从上一迁移版本加载 `backend/db/migration-tests/<version>_{before,after}.sql` 夹具后升级到最新版本；每个新迁移必须同时提供对应升级夹具，不能只证明空库可迁移。

`make pre-push-plan` 只显示将执行的阶段和预览要求；需要忽略细分结果并保守执行全部门禁时运行 `PRE_PUSH_FULL=1 make pre-push`。任何失败都必须修复并形成新提交，不得推送红色分支。

本地 E2E 按后端与 Web 的真实构建输入分别计算指纹，复用未变化一侧的已标记镜像；需要排除缓存时运行 `E2E_FORCE_REBUILD=1 make e2e`。CI 使用 `backend/Dockerfile.ci` 把 Go module 下载固化为只由依赖文件失效的可导出镜像层，并在单个构建层内连续产出全部后端二进制，再由 GitHub Actions 层缓存跨 runner 复用；这种结构不依赖无法直接导出的 BuildKit cache mount，也没有额外缓存回写尾巴。CI 一次安装 Chromium、构建与生产镜像内容对齐的 API/Web 镜像并启动隔离全栈，然后以单 worker 依次运行桌面和手机 Playwright 项目，避免重复构建和共享数据库并发污染。验证工具会拒绝 CI 镜像的二进制集合、运行时阶段或依赖层约定与标准约定漂移。CI 重试后通过的 flaky 用例按失败处理；失败时保留 Playwright HTML、trace、截图和测试结果 14 天。

本地门禁默认比较 `origin/dev`。通过后推送分支并创建目标为 `dev` 的草稿 PR；有依赖的后续分支等前置 PR 合并后基于最新 `dev` 重放，再创建新的 PR，禁止堆叠 PR。CI 会先校验目标分支、当前 `dev` ancestry、其他未合并 PR head 和检查矩阵，再决定是否启动重任务。只有 head 恰好为 `dev` 的汇总发布 PR 才能以 `main` 为目标；发布前需要比较生产差异时显式运行 `PRE_PUSH_BASE_REF=origin/main make pre-push-plan` 和 `PRE_PUSH_BASE_REF=origin/main make pre-push`。

应用变更的草稿 PR 只运行契约、前端、后端静态检查、容器配置和聚合检查，延后后端测试与隔离全栈 E2E；此时独立的 `full-validation` 检查按设计保持失败，明确表示尚不可合并。自动评审和修正稳定后将 PR 转为 Ready：普通单端源码只启动所属端普通测试与静态检查，高风险或跨端矩阵才启动后端全量集成/race 和隔离全栈 E2E。对应检查未成功前不得合并或部署固定预览。Ready 后的新提交仍会按同一影响矩阵重跑；需要多轮大改时应先转回草稿，批量完成修正后再转为 Ready。

文档和普通验证/发布工具变更不属于应用影响：无论 Draft 或 Ready，都只运行文档格式、actionlint、ShellCheck、流程自检以及变更直接要求的容器配置检查，`full-validation` 聚合这些轻量结果后通过，不启动后端集成/race、应用构建或隔离全栈 E2E。需要验证完整工作流编排时使用 `workflow_dispatch` 明确触发一次全套检查，不把该验证扩散为流程类 PR 的固定合并成本。

开发 PR 当前 head 在 Ready 状态下运行的 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `full-validation` 必须全部成功，随后才能人工合入 `dev`。合并后 `dev` 门禁验证 merge commit 与 PR head 的 Git tree 一致并复用这些成功检查；需要固定预览时，从准确的 `dev` merge commit 手动执行：

```bash
make preview-deploy PREVIEW_REF=<dev-merge-full-sha>
make preview-status
```

预览部署会先获取 `origin/dev`，并拒绝非 40 位 SHA、非当前 `origin/dev` head 或非 merge commit；后续适用的 PR 合入 `dev` 后，旧预览验收立即失效，需要重新部署新的 merge commit。固定预览是本机原生 PostgreSQL、Go API 和 Web 进程，部署阶段只做本机构建、迁移/种子、健康检查和准确 SHA 校验，不运行容器镜像门禁或测试套件。运行代码、契约、迁移和依赖变更要求固定预览；文档、普通验证工具、native preview 工具、单元测试-only、E2E-only 和生产工具-only 不要求应用预览。适用的预览人工验收完成后，才能把已验收的多个 `dev` 变更汇总到一个 `dev` → `main` 发布 PR；禁止直接推送、强推或自动合并 `dev` 和 `main`。

`dev` 合并后不重复运行整套质量与 E2E，而是通过 GitHub API 验证 merge commit 与开发 PR head 的 Git tree 完全一致，并复用该 PR 的六项成功检查。`dev` → `main` 汇总发布 PR 按相对 `main` 的整体差异运行一次对应检查矩阵，可把多个已在预览验收的开发 PR 合为一个正式发布；`main` 合并后同样只复用这条发布 PR 的检查。树不一致、不是关联 PR 合并提交、任一必需检查缺失、`main` PR 不是来自 `dev`，或只存在草稿快速门禁时立即失败。

已经合并的 PR 不执行“取消合并”或改写历史。需要撤销时创建新的 revert PR：开发阶段的 revert 目标为 `dev`，合并后按适用性部署该前向恢复提交；已经进入生产的变更先在 `dev` 撤销并验收，再通过新的 `dev` → `main` 发布 PR 上线。只有需要撤销整个汇总版本时，才在 `main` revert 对应发布 PR，并同步把 `dev` 修正到一致状态。

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
