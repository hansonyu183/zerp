# 开发、PR 与自动上线规范

所有变更通过独立分支直接向受保护的 `main` 提交 PR。固定预览和生产都只构建 Git 提交，不构建含未提交修改的开发工作区。

## 1. 本地门禁

创建 PR 前获取最新 `origin/main`，用 rebase 把提交重放到该基线。检查相对 `origin/main` 的完整差异；工作区干净后执行：

```bash
make pre-push-plan
make pre-push
```

`scripts/change-impact.sh` 把差异分为文档、验证工具和应用三类，并为应用变更输出契约、前端、后端、后端全量、依赖、容器、镜像、E2E 和预览标记。普通前端或后端源码只运行所属端聚焦门禁；契约、迁移、依赖、运行配置、跨端和未知变更运行完整隔离门禁。需要保守复核时运行 `PRE_PUSH_FULL=1 make pre-push`。

E2E 使用一次性 PostgreSQL 容器加本机 Go API/Web，并由 Playwright 并行运行桌面和手机项目。后端集成测试使用模板数据库并行执行独立包；共享状态场景必须显式串行。测试、迁移和断言失败不自动重试，只有 GitHub、Cloudflare 和公网健康等外部瞬态步骤允许有界重试。

## 2. Draft、Ready 与证据复用

本地门禁通过后推送并创建目标为 `main` 的 Draft PR。应用 Draft 运行格式、静态、聚焦单元测试和构建，产出成功的 `draft-validation`；它不会用故意失败的 `full-validation` 表示未就绪。

确认分支基于最新 `main` 后转为 Ready。Ready 的最新 SHA 运行完整前端覆盖率、后端集成/race、需要的镜像验证和一次真实 E2E。相同 PR 在不改变 SHA 的 Ready 转换中，只有输入指纹完全相同的组件证据可以复用；第一阶段仅复用等价的 `contracts` 作业，其他风险矩阵继续执行。依赖和构建缓存可跨运行复用，但不当作测试成功证据。

`validation` 是自动化门禁聚合。无需预览的 Ready PR 在自动门禁成功后获得 `full-validation`。需要预览的 PR 只获得 `preview-required`，随后执行：

```bash
make preview-deploy PREVIEW_PR=<number> PREVIEW_REF=<pr-head-full-sha>
make preview-status
make preview-accept PREVIEW_PR=<number>
```

`preview-deploy` 在构建前后各读取一次 GitHub PR，要求 PR 为 Ready、仍打开、目标为 `main`、包含最新 `origin/main`、head SHA 未变化且 `validation` 成功。人工验收人从当前 `gh` 登录态读取，调用方不能自报或冒用其他身份，且只能由仓库 write 及以上权限的非 Bot 用户确认；成功后写入绑定 PR、SHA、状态代次和验收人的 GitHub Preview Deployment，并为同一 SHA 发布 `full-validation` 状态。合并证据会再次核对状态创建者、验收人权限、Preview Deployment 的 PR/SHA/代次/验收人及其成功状态，单独伪造同名 commit status 不能触发生产发布。新提交会使旧预览和验收失效。

预览命令必须从 `HEAD == origin/main` 的受信任控制 checkout 运行，不能在 PR worktree 运行；PR checkout 只作为无密钥编译输入。

合并前必须确认最新 SHA 的全部 required checks 成功。需要固定预览的变更在自动门禁就绪后部署并完成人工验收。禁止直接推送、强推或自动合并 `main`。

## 3. 合并与生产

PR squash merge 后，`main` 工作流校验 merge tree 与被合并 PR 的 exact head tree 相同，并复用该 head 的 `full-validation`，而不是重复执行完整矩阵。生产发布代理只依赖合并提交上的 `full-validation`：文档和验证工具提交记录成功 no-op；应用提交等待 Cloudflare Pages 后执行备份、迁移、镜像切换、本机与公网健康检查，并写 GitHub Production Deployment。

需要完成合并交付时，必须等待发布代理处理 merge commit，再运行：

```bash
make production-status
```

确认 API、Web、公网入口和发布 SHA 一致后才可结束。公网 `530`、TLS 或资源预热失败应先核对 Tunnel 和代理状态，不得通过清空数据库或重复改代码处理。

已合并变更不改写历史。需要撤销时创建新的 revert PR，走相同的自动门禁、适用预览和生产路径。

## 4. 指标

使用 `scripts/release-metrics.sh` 只读统计最近 20 个合并 PR 的重复验证、系统时间和完整流转时间。指标定义、迁移前基线和第一阶段目标见[测试与发布流程指标](release-metrics.md)。
