# Issue 自动交付

本文件是 `automation:*` 工作流、授权证据和发布权限的唯一操作说明。业务规则仍以 `docs/domains/` 为准，HTTP 线协议仍以 `contracts/openapi/` 为准。

## 状态机

每个自动化 Issue 必须恰好带一个状态标签：

| 状态                      | 含义                                     | 离开条件                                      |
| ------------------------- | ---------------------------------------- | --------------------------------------------- |
| `automation:ready`        | 维护者已经授权不可变快照，等待依赖和容量 | 原生依赖关闭且实现槽可用                      |
| `automation:implementing` | 实现者正在改代码或修复                   | 本地门禁成功                                  |
| `automation:reviewing`    | 标准与规格两个只读审查并行运行           | 两者通过，或派发下一轮修复                    |
| `automation:release`      | 等待唯一发布通道完成 Ready、预览和合并   | 生产验证成功                                  |
| `automation:needs-input`  | 需求或验收条件不完整                     | 维护者取消、修正并重新添加 `automation:ready` |
| `automation:blocked`      | 三轮代码修复或 24 小时基础设施预算耗尽   | 维护者重新定界并授权                          |
| `automation:cancelled`    | 授权快照作废                             | 维护者编辑后重新授权                          |
| `automation:incident`     | 生产恢复尚未建立，全局开关已关闭         | 维护者完成恢复并显式重开                      |
| `automation:done`         | 精确生产 SHA 和公网健康已验证            | Issue 同时关闭                                |

优先级标签是 `priority:p0` 至 `priority:p3`；缺省为 `priority:p2`。队列先等待 GitHub 原生依赖全部关闭，再按优先级和最近授权时间排序。实现与审查合计最多两个并发 Issue；Ready、固定预览、合并和生产组成一个串行发布通道。

## 授权与不可变输入

新工作使用 `.github/ISSUE_TEMPLATE/authorized-change.yml`。维护者检查 Outcome、Scope、Exclusions、Acceptance criteria 和关联规范；高风险工作还必须给出具体 Risks 与 Recovery conditions。添加 `automation:ready` 是唯一人工授权。

`issue-authorize.yml` 验证授权者是仓库 owner 或 `ZERP_AUTOMATION_AUTHORIZERS` 明确列出的维护者，并验证唯一状态标签；不为实现者 App 增加 Administration 权限。它冻结 Issue 正文哈希、授权者、默认分支 SHA 以及反引号引用的仓库规范文件哈希。快照作为运行 artifact 保存，并由绑定仓库、运行、Issue 和正文哈希的 `issue-authorization-<number>` Deployment 记录来源。之后的编辑和评论不改变本轮范围；变更范围必须先转为 `automation:cancelled`，再编辑并重新授权。

仓库变量 `ZERP_AUTOMATION_ENABLED` 是全局 kill switch。值不为 `true` 时，授权、队列和本地发布控制器都停止。生产 Incident 自动把它写为 `false`；只有维护者完成恢复后可以重新设为 `true`。

## 实现、审查与证据

`issue-queue.yml` 只派发拥有成功授权 Deployment 的候选。`issue-implement.yml` 从授权 artifact 构造受限提示，在 GitHub-hosted runner 上使用 Codex workspace 权限实现；实现者不能合并、写验证证据或部署。候选先形成干净提交，再运行 `make pre-push-plan` 和 `make pre-push`。代码或测试失败最多修复三轮。

自动 PR 使用 `Refs #<issue>`，不使用自动关闭关键字。`issue-review.yml` 为 exact head 同时运行：

- `automation-standards-review`：逐项应用仓库约束；
- `automation-spec-review`：逐项核对不可变 Issue 快照和关联规范。

两个审查均为只读，结构化结果保存在各自 artifact 和不可变 Actions 运行中。任何发现都会交回实现者；第三轮仍失败则转为 `automation:blocked`。两者通过后才把 PR 转为 Ready 并进入 `automation:release`。

## 发布与生产

本地 `com.hansonyu.zerp-issue-release` 控制器使用独立 release-controller GitHub App，每分钟从当前 `origin/main` 的受信任 checkout 检查一个候选。它核对 PR、exact head、两个审查运行和质量运行的仓库、SHA、事件、工作流路径、提供者及固定运行链接。

无需固定预览的变更可复用 Actions 签发的 `full-validation`。需要固定预览的变更只接受 `preview-required`，随后由控制器部署 exact head，使用受信任的浏览器 smoke 验证登录、API、Web、公网入口和 release marker，最后由配置的 release-verifier App Bot 写 Preview Deployment 与 `full-validation`。实现者和审查者不能签发该证据。

证据齐全后，控制器只请求 squash auto-merge；它不直接推送 `main`。生产代理继续验证 merge tree、`full-validation`、Cloudflare Deployment、容器、API、Web、公网入口和发布 SHA。全部成功后才写 `automation:done` 并关闭 Issue。生产切流后的失败不猜测数据库兼容性：代理创建 P0 Incident、把原 Issue 转为 `automation:incident` 并关闭 kill switch，等待维护者建立恢复方案。

## 凭证与仓库设置

Actions 使用以下配置：

| 名称                               | 类型     | 用途                                       |
| ---------------------------------- | -------- | ------------------------------------------ |
| `OPENAI_API_KEY`                   | secret   | Codex Action 的 Responses API 代理         |
| `ZERP_IMPLEMENTER_APP_ID`          | variable | 实现者 App ID                              |
| `ZERP_IMPLEMENTER_APP_PRIVATE_KEY` | secret   | 实现者 App 私钥                            |
| `ZERP_IMPLEMENTER_BOT_LOGIN`       | variable | 允许触发 Codex 的精确实现者 Bot login      |
| `ZERP_REVIEWER_APP_ID`             | variable | 审查协调 App ID                            |
| `ZERP_REVIEWER_APP_PRIVATE_KEY`    | secret   | 审查协调 App 私钥                          |
| `ZERP_RELEASE_VERIFIER_BOT_LOGIN`  | variable | 唯一可签发预览证据的 Bot login             |
| `ZERP_AUTOMATION_ENABLED`          | variable | 全局 kill switch，初次部署保持 `false`     |
| `ZERP_AUTOMATION_AUTHORIZERS`      | variable | 额外维护者 login，逗号分隔；owner 自动包含 |

实现者 App 只授予 Actions write、Contents write、Issues write、Pull requests write 和 Metadata read；Actions write 仅用于对同一 Issue 的失败基础设施作业执行有界重跑，它没有 Statuses、Checks、Deployments 或 Administration write。审查 App 只授予 Contents read、Issues write、Pull requests write、Actions read 和 Metadata read；没有代码写入、合并或部署权限。

release-controller App 只安装到 `hansonyu183/zerp`，授予 Actions read、Checks read、Contents write、Deployments write、Issues write、Pull requests write、Commit statuses write、Variables write 和 Metadata read。本机凭证放在 `/Users/hansonyu/.secrets/zerp-release-controller/`：`app-id`、`private-key.pem`、`bot-login`，权限为 `0600`。运行 `make issue-release-install` 安装长期 LaunchAgent；重新安装会原子替换控制脚本。

`main` ruleset 必须要求 PR、线性历史、禁止 force push/delete，并要求现有质量矩阵最终聚合到 `full-validation`。仓库只允许 squash merge，启用 auto-merge；release-controller App 不获得规则绕过，只有全部 required checks 成功后 GitHub 才执行合并。公共仓库不注册可执行任意 PR 代码的 self-hosted runner。

上线顺序固定为：先合并代码但保持 kill switch 为 `false`，配置三个 App、Actions secret/variables、状态与优先级标签、ruleset 和 auto-merge；安装并验证本地控制器；最后由维护者把 `ZERP_AUTOMATION_ENABLED` 改为 `true`。旧 Codex `auto-issue-processing` 与 `zerp-back-issue` 计划任务保持暂停并删除，不保留转发或兼容路径。
