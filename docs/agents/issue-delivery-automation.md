# 本地 Issue 批次自动交付

本流程面向单人、单台受信任 Mac。它不使用远端 Issue 队列、implementer/reviewer GitHub Apps 或定时轮询；多人协作需要另立工作流，不在这里保留兼容分支。

## 完整流程

1. `$to-tickets` 在主工作区生成 `.scratch/<feature>/issues/*.md`。整个目录是一项不可拆分的发布批次。
2. launchd 通过 `WatchPaths` 发现 `ready-for-agent` 批次，控制器领取整批并创建 `automation/local-<feature>` 独立 worktree。
3. 控制器为整批而非逐 ticket 启动临时 `codex exec`，明确要求使用 `$implement` 处理整个目录。`$implement` 在无网络 workspace sandbox 内负责 TDD、聚焦测试、双轴 `/code-review`、修复和提交，返回 `validation=not_run`、`review=passed` 和 commit SHA；它不运行最终门禁。只有失败修复轮次才会再次调用。
4. 控制器确认模型返回的 commit 与 clean candidate head 完全一致后，才在宿主环境精确运行一次 `scripts/change-gate.sh <base-sha>`。该 gate 可访问宿主 Docker 用于 integration/E2E，但该权限绝不授予 Codex sandbox；成功后写入候选 head、base 和运行时指纹。gate 失败会把日志末尾的根因写入修复证据并保存 exact-head attempt marker；修复轮次只运行与根因和改动相关的聚焦测试，不重复已经通过的无关阶段，并且只有产生新提交才可再次运行最终 gate。
5. 控制器使用受信任主工作区的预览脚本，将候选 worktree 构建到固定公网预览 `https://zerp-preview.bytesucceed.com`，并核对 exact SHA、浏览器 smoke 和运行时指纹。用户查看预览是可选的，不阻塞自动流程。
6. 到此之前不得调用 GitHub。预览通过后才 fetch 最新 `origin/main`；若 rebase 仅改变 SHA 且运行时指纹不变，复用门禁和预览。指纹改变或发生冲突时，再交给 `$implement` 修复并重新验证，最多三轮。发布工具自测必须使用隔离提交图，不得要求预览前的本地候选分支已包含实时 `origin/main`。
7. 控制器按本地编号创建远端 Issues、建立原生依赖、推送一个分支，并创建一个引用全部 Issues 的 Ready PR。PR 正文携带 exact head、预览 URL 和运行时指纹。
8. GitHub Actions 对 Ready head 运行适用矩阵。匹配 `automation/local-*` 分支和 exact-head 本地预览标记的 PR，在 CI 成功后直接获得 `full-validation`；普通人工 PR 仍使用原有 `preview-required` 路径。
9. 控制器请求 squash auto-merge，等待真实 merge SHA，再等待生产代理完成部署。`scripts/issue-local-production.sh` 必须同时验证 PR merge SHA、生产 release marker、API、Web 和公网入口。
10. 生产验证成功后，控制器关闭全部远端 Issues、把本地验收项勾选并标为 `done`，最后释放固定预览。

## 失败与恢复

- 实现、审查、门禁或 CI 失败最多进行三轮自动实现/修复；预览失败保留完整 stderr 和 exact-head gate evidence，并直接标为 `preview-blocked`，不会把宿主沙箱、网络或发布环境故障交给 `$implement` 改业务代码。环境恢复后显式 `retry` 会复用通过的 exact-head gate 直接重试预览；耗尽后整批标为 `blocked`，不会继续发布。
- `needs_input` 立即将整批标为 `needs-input`，不部署预览、不访问 GitHub。
- 进程崩溃后以批次运行目录中的 base、attempt、预览证据、远端 Issue 映射和 PR 编号恢复。远端对象带稳定 marker；重启必须复用，不得重复创建。已有 PR 时先校验它仍是预期的 open `automation/local-* -> main` PR；若本地候选因重放产生新 SHA，先写入新 head 的 PR marker，再使用旧远端 head 的精确 `--force-with-lease` 更新原分支，确保 GitHub 的 `synchronize` 事件读取到新 marker 后才等待新 head 的检查；推送失败必须恢复旧正文。
- 生产失败会把批次标为 `production-blocked`、写入本地停止开关并在 PR 通知。控制器不得自动执行数据库回滚、清库、恢复或继续下一批。
- 人工处理本地失败后可运行 `scripts/issue-local.sh retry <feature>`；若候选 clean、提交与 `implementation.json` 一致且已有 `review=passed`，控制器保留该提交并先恢复其宿主 gate。显式 retry 会清除同一 SHA 的 gate attempt marker，适用于已修复 Docker 等宿主基础设施；dirty、未审查或 SHA 不匹配的候选仍按完整实现轮次重跑。已经发布 PR 的批次不得本地重置。生产故障处理完成后由维护者运行 `scripts/issue-local.sh start`。

## 安装与操作

安装前需要现有的 ChatGPT Codex 登录、`gh` 登录，以及本机可读的 `implement`、`tdd`、`code-review` skills。运行：

```sh
make issue-local-install
scripts/issue-local.sh status
scripts/issue-local.sh stop
scripts/issue-local.sh start
scripts/issue-local.sh retry <feature>
```

安装器只复制控制脚本和 JSON schema，不复制 Codex `auth.json`、GitHub token 或私钥。实现阶段使用 `workspace-write`、`never` approval、`gpt-5.6-sol` high reasoning 和 `ignore-user-config`，并禁用命令网络、Web 和 App 工具；因此不能访问 GitHub、推送、部署或用户凭证。为使独立 linked worktree 能提交，控制器只额外授予该 worktree 的 Git 目录及共享 Git 元数据目录写权限，不授予主工作区文件写权限；启动 Codex 前会以临时索引和临时 ref 验证这两处可写并立即清理。

实现前控制器必须离线复用主工作区已安装的 pnpm 依赖：只有候选与主工作区的 `pnpm-lock.yaml` 完全一致，且主工作区根目录和 `frontend/` 的依赖目录完整，才会继续。候选根 `node_modules` 是指向主工作区根依赖的受控符号链接；候选 `frontend/node_modules` 通过 `rsync` 复制，排除 `.pnpm`、`.tmp`、`.vite`、`.vite-temp` 和 `.pnpm-store` 后单独创建本地 `.tmp`，从而让 Vite 和 TypeScript 缓存只写入候选。控制器还会读取 `packageManager` 中锁定的精确 pnpm 版本，只从本机 pnpm store 找到同版本的唯一缓存入口，并在候选 `.scratch` 中生成受控包装器供 Codex 和宿主 gate 共用；提示词要求每次 pnpm 调用都显式前置该包装器目录，因为 Codex 的登录 shell 会重建 `PATH`，仓库脚本也会递归调用 pnpm。缓存缺失或版本不唯一时在启动模型前阻塞。控制器会确认仓库现有 `.gitignore` 忽略这些依赖，不修改共享 Git 元数据。主工作区依赖只通过该符号链接只读复用，Codex 不会获得额外的 `--add-dir` 依赖目录授权；`COREPACK_ROOT=1` 阻止 pnpm 在无网络沙箱中自行切换版本。预览前控制器要求候选 clean，暂时移除此符号链接，使预览沙箱只能在候选内安装依赖；预览结束后删除该临时安装并恢复受控链接。控制器会删除候选的 `.pnpm-store`。前置条件不满足时，批次会在启动模型前标为 `blocked`。预览和发布动作由控制器分别使用本机现有环境与 `gh` 登录态完成。现有生产代理继续只处理通过 `full-validation` 合入 `main` 的提交。

`backend/.env.local` 只在宿主最终 gate 的子进程生命周期内，以指向主工作区受控环境文件的符号链接临时挂载到候选；退出时无论成功、失败或中断都删除。启动任何 Codex 实现轮次前，控制器会先删除上次崩溃遗留的受控链接，并拒绝未知候选环境文件，因此模型不会读取该文件。新增或修改静态后端领域错误时，实现提示还要求把全站业务错误映射覆盖测试纳入聚焦测试。
