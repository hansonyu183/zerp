# 固定外网开发预览

固定预览运行在 macOS 本机，使用独立 PostgreSQL cluster、Go API 和静态 Web/反向代理。桌面、手机和本机统一访问：

```text
https://zerp-preview.bytesucceed.com
```

## 1. 单槽状态模型

固定 URL 一次只服务一个活跃 PR。状态保存在权限为 `700` 的 `backend/var/preview-native/state/`，记录文件权限为 `600`。

- 首次启用时把现有 native preview 数据库和附件原样接管为已验收 `main` 基线，不重新 seed、不删除数据；旧 Compose 只用于这次导入，不作为运行时 fallback。
- 新 PR 从当前已验收基线克隆专属数据库和附件目录。同一 PR 的新 SHA 复用它自己的状态并增加 generation；其他 PR 在槽被占用时被拒绝。
- 24 小时无活动会释放槽并恢复基线，但保留 PR 数据；`preview-touch` 可更新活动时间。
- 关闭或拒绝 PR 后恢复基线。合并后只有 exact tree 和 `full-validation` 证据通过时才能把已验收 PR 状态晋升为新的 `main` 基线。
- 保留 current、active、最近 3 个已验收基线；failed、closed 和 expired PR 保留 7 天，随后同时删除专属数据库、附件和元数据。

## 2. 命令

```bash
make preview-deploy PREVIEW_PR=<number> PREVIEW_REF=<pr-head-full-sha>
make preview-status
make preview-touch PREVIEW_PR=<number>
make preview-accept PREVIEW_PR=<number>
make preview-close PREVIEW_PR=<number>
make preview-reap
make preview-promote PREVIEW_PR=<number> PREVIEW_MERGE=<main-merge-full-sha>
make preview-gc
```

PR 控制面命令必须从无跟踪修改且 `HEAD == origin/main` 的受信任控制 checkout 运行，只把 PR 编号和 head SHA 当输入；禁止在 PR worktree 中执行 `make preview-deploy`。`preview-deploy` 会为 exact PR SHA 创建隔离 worktree，并在首次接管时缓存受信任的 `main` 基线 release，保证任何关闭或失效恢复都能同时切回基线代码和数据。控制器、状态机和旧环境导入只执行受信任控制 checkout 中的脚本与 Compose 配置，PR worktree 仅作为编译输入；所有 Go、pnpm 安装和前端构建都在 macOS sandbox 内运行。对用户数据，构建进程只能读取一次性源码 worktree，只能写入该 worktree、release 输出和当前 SHA 的专用临时缓存；sandbox 明确禁止读取用户主目录中的其他文件、受信任 checkout、`.env.preview.local` 和系统钥匙串，也禁止写入上述三个构建目录之外的位置。成功产出 release 后立即删除当前 SHA 的构建缓存，避免后续 PR 复用不受信任内容；进程环境同时使用 `env -i` 和最小白名单，不继承数据库密码、管理员密码、Token 或当前 shell 的其他秘密。完成第二次 PR head 校验后，运行阶段才读取环境文件，停止当前 API/Web、克隆状态、执行迁移/seed 并原子切换。失败会恢复之前的状态和服务，不执行 down migration。

`preview-accept` 是发布控制器的内部验收动作，会从当前 `gh` 登录态读取身份，只接受 `ZERP_RELEASE_VERIFIER_ACTOR` 指定的专用 GitHub App Bot。它再次验证 PR、自动门禁和 SHA，在受信任浏览器 smoke 通过后写 GitHub Preview Deployment 与 `full-validation`。合并后的证据复用要求 `full-validation` 的创建者、目标和描述与同一 verifier 创建的成功 Preview Deployment 完整对应，并重新确认该 App 在仓库中具有所需权限。`preview-promote` 只在 PR 已合并、merge tree 等于验收 head tree 且合并证据完整时成功；晋升复用已验收的 exact-tree 构建产物，但会把运行标记、current release、数据库和附件一起原子切换到 merge SHA。关闭、失效和超时恢复也会同步切回基线 release，不允许状态与运行版本分离。

临时维护命令仍包括 `preview-up`、`preview-down`、`preview-rollback`、`preview-password` 和显式破坏性的 `preview-reset`。其中 `preview-up` 从当前工作区构建，不要求控制 checkout，且其结果不得作为 PR 的 exact-SHA 验收证据。日常 PR 流程不得用 `preview-reset` 解决构建、Tunnel 或状态锁问题。

## 3. 隔离边界

| 资源            | 值                                     |
| --------------- | -------------------------------------- |
| 运行目录        | `backend/var/preview-native`           |
| PostgreSQL 端口 | `127.0.0.1:55436`                      |
| API 端口        | `127.0.0.1:18082`                      |
| Web 端口        | `127.0.0.1:15176`                      |
| Cookie          | `zerp_preview_session`                 |
| CORS Origin     | `https://zerp-preview.bytesucceed.com` |

本地凭证只保存在权限为 `600` 的 `backend/.env.preview.local`。不得输出环境文件、密码、Cookie、CSRF Token、请求体或包含这些值的截图。

## 4. 故障分层

固定预览失败时依次区分：构建、迁移/seed、本机 PostgreSQL/API/Web、公网 Tunnel。若本机健康且运行 exact SHA，而公网返回 `530`、TLS 失败或资源尚未预热，应检查 Tunnel ingress、edge 连接和准确服务实例，恢复入口后重新执行 `make preview-status`；不得清空预览数据或重复修改应用代码。

静态和状态机验收：

```bash
scripts/preview-state-test.sh
sh -n scripts/preview.sh scripts/preview-deploy.sh scripts/preview-state.sh
shellcheck -x scripts/preview.sh scripts/preview-deploy.sh scripts/preview-state.sh
go -C backend test ./cmd/preview-web
```

受信任浏览器验收必须通过固定 HTTPS 入口登录，核对 exact-SHA release marker，并由 PR 中的隔离 E2E 覆盖受影响的桌面和手机流程。敏感值填充后不得采集 DOM、截图或调试日志。
