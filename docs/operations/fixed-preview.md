# 固定外网开发预览

固定预览完全运行在 macOS 本机，不依赖 Docker 或 Colima：独立 PostgreSQL cluster、Go API 和轻量静态 Web/反向代理均由 launchd 常驻。桌面、手机和本机统一访问：

```text
https://zerp-preview.bytesucceed.com
```

该入口复用现有 Cloudflare Tunnel，只使用 ZERP 自身登录，不配置 Cloudflare Access。

## 1. 隔离边界

| 资源              | 值                                     |
| ----------------- | -------------------------------------- |
| 运行目录          | `backend/var/preview-native`           |
| PostgreSQL 数据库 | `zerp_preview`                         |
| PostgreSQL 端口   | `127.0.0.1:55436`                      |
| API 端口          | `127.0.0.1:18082`                      |
| Web 端口          | `127.0.0.1:15176`                      |
| Cookie            | `zerp_preview_session`                 |
| Cookie 属性       | `Secure=true`、`SameSite=Lax`          |
| CORS Origin       | `https://zerp-preview.bytesucceed.com` |
| GitHub 反馈发布   | 关闭                                   |

数据库文件、附件、构建版本、备份和代理状态全部位于被 Git 忽略的仓库 `backend/var/` 下。E2E 仍使用自己的 Compose 项目，不读取或清理固定预览。

## 2. 日常命令

```bash
make preview-up
make preview-deploy PREVIEW_REF=<commit>
make preview-status
make preview-password
make preview-rollback
make preview-retry
make preview-down
make preview-reset
```

- `preview-up`：构建当前工作区，启动本机数据库/API/Web，迁移、初始化管理员并补齐测试数据；
- `preview-deploy`：从隔离工作树构建完整 commit SHA，不读取未提交修改；
- `preview-status`：核对三个 launchd job、数据库、本机端点、公网端点和发布标记；
- `preview-rollback`：原子切回上一版二进制和 Web，并熔断当前 `dev` SHA，避免代理立即重新部署；
- `preview-retry`：外部问题修复后清除熔断并立即重试当前 `dev`；
- `preview-down`：停止三个 launchd job，保留数据库、附件和所有版本；
- `preview-reset`：把当前数据库和附件移动到时间戳备份目录，再建立干净环境；
- `preview-password`：只把管理员密码写入 macOS 剪贴板，不在终端打印。

本地凭证仅保存在权限为 `600` 的 `backend/.env.preview.local`。不得把其内容写入日志、聊天、截图或提交。

## 3. 首次迁移与常驻

本机需要 Homebrew PostgreSQL、Go、pnpm、`gh` 和 `jq`。`preview-up` 使用 `pg_config` 找到当前 PostgreSQL 二进制，并在 `backend/var/preview-native/postgres-data` 初始化独立 cluster，不改动 Homebrew 默认的 `127.0.0.1:5432` 数据库。

若首次启动时检测到旧 `zerp-fullstack-preview` Compose 数据库，脚本会：

1. 启动旧数据库并生成 PostgreSQL custom-format dump；
2. 复制旧 API 附件目录；
3. 停止旧 DB/API/Web 容器，但保留容器、镜像和 volume 作为一次性恢复后路；
4. 启动本机 cluster，导入数据库和附件；
5. 迁移到当前版本并切换本机 API/Web。

迁移或首次切换失败时，脚本停止本机服务并恢复旧 Compose 服务。成功后数据库/API/Web 的 launchd job 在用户登录时自动恢复，不依赖 Colima。

## 4. `dev` 合并后自动更新

首次安装代理：

```bash
make preview-install-agent
```

代理每 60 秒读取 `origin/dev`。只有准确的 `dev` merge SHA 上 `contracts`、`frontend`、`backend`、`containers`、`e2e` 和 `full-validation` 全部成功时才继续：

- 文档和普通验证工具变更记录为 no-op，不重建应用；
- 应用变更从隔离工作树构建该 SHA，迁移、seed、切换并核对本机与公网 `_zerp-release`；
- 同一 SHA 失败后熔断，不每分钟重复破坏性尝试；
- 新 SHA 或人工执行 `make preview-retry` 后才继续；
- 每次切换保留上一版本，失败自动恢复，人工可执行 `make preview-rollback`。

因此开发 PR 在合入 `dev` 前只承担代码门禁；固定预览更新发生在合并后，预览人工验收通过后再把一个或多个 `dev` 变更汇总到 `main` 发布 PR。

## 5. Cloudflare Tunnel

本机 `~/.cloudflared/config.yml` 的最终 `http_status:404` 规则前必须存在：

```yaml
- hostname: zerp-preview.bytesucceed.com
  service: http://127.0.0.1:15176
- service: http_status:404
```

修改前备份配置；运行 `cloudflared tunnel ingress validate` 后重载准确的现有 launchd 服务。不得复制或输出 Tunnel 凭据。

## 6. 故障分层与验收

失败时按以下层次定位：

1. 检查 `backend/var/preview-agent/agent.log` 的 GitHub 检查读取、构建、migration 和 seed；
2. 检查本机 PostgreSQL、`http://127.0.0.1:18082/readyz` 和 `http://127.0.0.1:15176/healthz`；
3. 对比本机与公网 `/_zerp-release` 是否为同一完整 `dev` merge SHA；
4. 本机健康但公网返回 `530`、TLS 失败或标记未更新时，核对 Tunnel ingress、edge 连接和准确服务实例，不得用 `preview-reset` 或清空数据修复入口；
5. 入口恢复后执行 `make preview-retry` 或 `make preview-status`。

变更验收至少运行：

```bash
sh -n scripts/preview.sh scripts/preview-deploy.sh scripts/preview-watch.sh
shellcheck -x scripts/preview*.sh scripts/install-preview-agent.sh
go -C backend test ./cmd/preview-web
make preview-status
```

人工验收必须通过固定 HTTPS 入口登录，并覆盖变更影响的桌面和手机流程。禁止在密码、Cookie 或 CSRF Token 已填充后输出 DOM、截图、请求体或日志；若凭证意外进入输出，立即轮换密码并撤销旧会话。
