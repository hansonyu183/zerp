# 开发、PR 与自动上线规范

本规范覆盖从可验收提交到正式上线的完整路径。开发变更先以 squash merge 合入受保护的 `dev`，需要应用预览时再部署准确的 `dev` 提交；正式环境只从 `dev` 汇总进入受保护 `main` 的 squash 发布提交上线，固定预览和生产发布不得构建包含未提交修改的开发工作区。

## 1. 开发与推送

每项工作使用独立分支或工作树。创建 PR 前必须先获取最新 `origin/dev`，将功能提交重放到该提交并解决全部冲突；确认工作区干净后再执行：

```bash
make pre-push-plan
make pre-push
```

`pre-push` 会再次获取对应的最新远端基线，拒绝未包含最新基线、使用 merge 代替 rebase 或工作区不干净的开发分支，再按 `scripts/change-impact.sh` 分层：

- 文档变更运行差异、格式和文档完整性检查；
- 本地门禁、CI 工作流和文档检查器等验证工具变更，运行逐文件 Shell 语法、ShellCheck、Actionlint 和门禁行为检查，不要求固定预览或应用测试；只有需要验证完整编排时才通过 `workflow_dispatch` 显式跑一次全套作业；
- 应用影响变更继续细分契约、前端、后端、后端全量、容器、E2E、本地 E2E 和预览标记，只运行能够验证当前变更的门禁；
- 普通纯前端源码在本地运行前端门禁，Draft 阶段不运行 Playwright，Ready 后对最终版本运行一次完整 E2E；普通纯后端源码在本地运行格式、普通测试、vet 和构建，PR CI 再补充静态与安全检查；
- 契约、SQL/迁移、依赖、运行配置、跨端、E2E 工具及未知变更继续运行后端全量集成/race 与适用的隔离全栈 E2E；
- 单元测试-only 只运行所属端门禁，E2E-only 运行隔离 E2E，二者都不部署应用预览。

`scripts/change-impact.sh --checks` 还会输出 `frontend_full`、`backend_deps`、`api_image` 和 `web_image`：`frontend_full` 控制完整前端门禁，`backend_deps` 标记后端依赖文件变化；所有后端源码 PR 都会校验模块完整性。后两项只在对应镜像真实输入变化或 `main` 发布 PR 时开启。这样 Draft/Ready 分层不会因为文档、验证工具或未变化的一侧而重复构建镜像。

前端生产依赖审计只在 workspace、锁文件或前端依赖清单变化时运行；普通前端源码变化继续运行 lint、覆盖率和构建，但不重复执行只依赖锁文件的审计。后端数据库门禁会从上一迁移版本加载 `backend/db/migration-tests/<version>_{before,after}.sql` 夹具后升级到最新版本；每个新迁移必须同时提供对应升级夹具，不能只证明空库可迁移。

`make pre-push-plan` 只显示将执行的阶段和预览要求；需要忽略细分结果并保守执行全部门禁时运行 `PRE_PUSH_FULL=1 make pre-push`。任何失败都必须修复并形成新提交，不得推送红色分支。

E2E 只有一条原生路径：使用一次性 PostgreSQL 容器和本机 Go API、Web 进程启动完整隔离栈，再由 Playwright 使用 3 个 worker 并行运行桌面和手机项目；修改系统级共享状态的用例单独串行。E2E 不再构建或依赖专用 CI Dockerfile，也不把容器镜像缓存当作测试结果。后端集成测试复用模板库准备的数据库夹具，并行运行相互独立的测试包；共享状态的场景必须显式串行化，避免并发污染。CI 重试后通过的 flaky 用例按失败处理；失败时保留 Playwright HTML、trace、截图和测试结果 14 天。

本地门禁默认比较最新 `origin/dev`。通过后推送分支并创建目标为 `dev` 的 Draft PR；有依赖的后续分支等前置 PR 合并后基于最新 `dev` 重放，再创建新的 PR，禁止堆叠 PR。CI 会先校验目标分支、当前 `dev` ancestry、分支没有 merge commit、其他未合并 PR head 和检查矩阵，再决定是否启动重任务。禁止先创建 PR，再因分支落后执行 rebase 和强推。只有 head 恰好为 `dev` 的汇总发布 PR 才能以 `main` 为目标；发布前需要比较生产差异时显式运行 `PRE_PUSH_BASE_REF=origin/main make pre-push-plan` 和 `PRE_PUSH_BASE_REF=origin/main make pre-push`。

应用变更分 Draft/Ready 两层：Draft 只运行格式、静态检查、聚焦单元测试、前端构建和可静态验证的契约/流程检查，延后后端集成/race、完整前端覆盖率和隔离全栈 E2E；`full-validation` 按设计保持失败，明确表示尚不可合并。Draft 创建后立即请求 Codex Review，并在同一等待周期内持续检查 required checks、新增 review、未解决 review threads 和分支是否落后于 `dev`。出现可执行意见时立即停止等待旧 CI，转回或保持 Draft，修复并补充回归测试后推送；`cancel-in-progress` 会取消同一 PR ref 的过期 run。全部可执行意见和 conversation 解决、再次确认分支基于最新 `dev` 后，最后才转为 Ready。Ready head 才运行完整前端覆盖率、后端模板库并行集成/race 及一次原生全栈 E2E；登录、路由、契约、迁移、依赖、跨端和其他高风险变更继续使用其完整矩阵。Ready 后如需再提交，先转回 Draft 处理并重新请求 Review，只等待最终版本的门禁；禁止在 CI 全绿后才首次读取 review threads。

文档和普通验证/发布工具变更不属于应用影响：无论 Draft 或 Ready，都只运行文档格式、actionlint、ShellCheck、流程自检以及变更直接要求的容器配置检查，`full-validation` 聚合这些轻量结果后通过，不启动后端集成/race、应用构建或隔离全栈 E2E。需要验证完整工作流编排时使用 `workflow_dispatch` 明确触发一次全套检查，不把该验证扩散为流程类 PR 的固定合并成本。

开发 PR 当前 head 在 Ready 状态下运行的 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `full-validation` 必须全部成功，随后才能使用 squash merge 人工合入 `dev`。普通文档、验证工具和单元测试-only 变更不构建 API/Web 镜像；应用 PR 仅在真实镜像输入变化时设置 `api_image` 或 `web_image` 并构建对应镜像。合并后 `dev` 门禁验证当前 `dev` 提交与 PR head 的 Git tree 一致并复用这些成功检查；需要固定预览时，从准确的 `dev` 提交手动执行：

```bash
make preview-deploy PREVIEW_REF=<dev-full-sha>
make preview-status
```

预览部署会先获取 `origin/dev`，并拒绝非 40 位小写 SHA 或非当前 `origin/dev` head；随后复用 `verify-merged-pr.sh`，要求该 SHA 来自已合入 `dev` 的 PR、Git tree 与 PR head 一致且六项 required checks 全部成功，才开始构建。后续适用的 PR 合入 `dev` 后，旧预览验收立即失效，需要重新部署新的 dev 提交。固定预览是本机原生 PostgreSQL、Go API 和 Web 进程，部署阶段只做本机构建、迁移/种子、健康检查和准确 SHA 校验，不运行容器镜像门禁或测试套件。运行代码、契约、迁移和依赖变更要求固定预览；文档、普通验证工具、native preview 工具、单元测试-only、E2E-only 和生产工具-only 不要求应用预览。适用的预览人工验收完成后，才能把已验收的多个 `dev` 变更汇总到一个 `dev` → `main` 发布 PR；禁止直接推送、强推或自动合并 `dev` 和 `main`。

`dev` 合并后不重复运行整套质量与 E2E，而是通过 GitHub API 验证当前 `dev` 提交与开发 PR head 的 Git tree 完全一致，并复用该 PR 的六项成功检查。`dev` → `main` 汇总发布 PR 按相对 `main` 的整体差异运行一次对应检查矩阵，可把多个已在预览验收的开发 PR 合为一个正式发布；`main` 合并后同样只复用这条发布 PR 的检查。树不一致、不是关联 PR 的 `dev` 提交、任一必需检查缺失、`main` PR 不是来自 `dev`，或只存在草稿快速门禁时立即失败。

已经合并的 PR 不执行“取消合并”或改写历史。需要撤销时创建新的 revert PR：开发阶段的 revert 目标为 `dev`，合并后按适用性部署该前向恢复提交；已经进入生产的变更先在 `dev` 撤销并验收，再通过新的 `dev` → `main` 发布 PR 上线。只有需要撤销整个汇总版本时，才在 `main` revert 对应发布 PR，并同步把 `dev` 修正到一致状态。

## 2. 自动上线

正式环境由同一 `main` 发布提交统一发布：

1. Cloudflare Pages Git 集成构建并发布同一 `main` commit；
2. 本机发布代理确认 `main` 已复用的五项 PR 检查和 `Cloudflare Pages` 全部成功；
3. 仅 `main` 发布 PR（或 API/Web 镜像输入发生变化）才从独立干净仓库构建带完整 commit SHA 的 API、migrate、Web 镜像和前端产物；文档、验证工具和 native preview 不构建生产镜像；
4. 备份 PostgreSQL、附件及上一版发布清单；
5. 运行向后兼容的 Goose migration；
6. 更新本机 `zerp-back` API 与 Web，验证本机和公网健康；
7. 验证 Pages 的精确 commit 标记、`https://zerp.bytesucceed.com` 与 `https://zerp-api.bytesucceed.com`，并写回 GitHub Production Deployment 状态。

发布代理是用户级 launchd 服务，每 60 秒检查一次 `origin/main`。Mac 离线或未登录时发布保持排队，Colima 恢复后继续。代理复用 `scripts/change-impact.sh`：文档和验证工具提交不等待已跳过的 Pages 检查，直接记录为成功 no-op；应用发布成功后自动更新已安装的控制器脚本。代理为每个目标 SHA 复用同一条 GitHub Deployment，Pages 未完成时标记 `queued`，明确失败时标记 `failure` 并继续观察同一检查的恢复，不再每分钟创建空记录；GitHub fetch、检查读取和 Deployment 写回使用有界指数退避。代理单独记录已处理提交，`current-sha` 始终指向最后一次成功发布的应用版本，日志行使用 UTC 时间戳。

合并后的交付确认必须等待发布代理完整结束，不能在 API 容器刚切换时提前完成。最终运行 `make production-status`，确认 `current-sha`、API 和 Web 容器标签、Cloudflare Pages 精确 commit 标记及两个公网入口均指向同一 `main` 发布提交。若构建和容器已健康，但公网出现瞬时 TLS、`530` 或 release 标记尚未更新，应先查看发布代理日志，区分“仍在发布”“Tunnel/网络抖动”和“已写入失败标记”；仅外部入口瞬时失败时重新验证入口，只有代理明确熔断该 SHA 后才使用 `make production-retry`。

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
