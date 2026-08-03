# 固定外网开发预览

固定预览独立于开发、生产形态和 E2E：`preview-up` 用于临时检查当前工作区，`preview-deploy` 用于人工验收准确提交。桌面、手机和本机统一访问：

```text
https://zerp-preview.bytesucceed.com
```

该入口复用本机现有 Cloudflare Tunnel，只使用 ZERP 自身登录，不配置 Cloudflare Access。

## 1. 隔离边界

| 资源              | 值                                     |
| ----------------- | -------------------------------------- |
| Compose 项目      | `zerp-fullstack-preview`               |
| PostgreSQL 数据库 | `zerp_preview`                         |
| PostgreSQL 端口   | `127.0.0.1:55436`                      |
| API 端口          | `127.0.0.1:18082`                      |
| Web 端口          | `127.0.0.1:15176`                      |
| Cookie            | `zerp_preview_session`                 |
| Cookie 属性       | `Secure=true`、`SameSite=Lax`          |
| CORS Origin       | `https://zerp-preview.bytesucceed.com` |
| GitHub 反馈发布   | 关闭                                   |

预览使用自己的 PostgreSQL、附件卷和 Cookie。`make e2e` 只操作 `zerp-fullstack-e2e`，不会读取或清理预览卷。

## 2. 日常命令

```bash
make preview-up
make preview-deploy PREVIEW_REF=<commit>
make preview-status
make preview-password
make preview-down
make preview-reset
```

- `preview-up`：首次生成本地环境文件，构建当前工作区，自动迁移、初始化管理员，并按 AUX、BOB、VOU/WFL、LED 顺序补齐全业务测试数据，等待健康后输出固定网址；
- `preview-deploy`：从隔离工作树构建指定 commit，不读取当前工作区的未提交修改，并保留现有人工测试数据；
- `preview-down`：停止并删除预览容器，保留 PostgreSQL 与附件卷；容器不存在时不会随 Colima 自动恢复，重新运行 `preview-up` 后恢复常驻；
- `preview-reset`：只删除 `zerp-fullstack-preview` 的容器和卷，并重建干净预览；
- `preview-status`：检查 Compose 状态、本机 Web/API 健康端点和公网 HTTPS；
- `preview-password`：只把管理员密码写入 macOS 剪贴板，不在终端打印。

本地凭证仅保存在被 Git 忽略的 `backend/.env.preview.local`，初始化脚本会将其权限设为 `600`。不得把该文件内容写入日志、聊天、截图或提交。

## 3. 登录后常驻与代码更新

本机容器运行时使用 Colima。通过 Homebrew 用户服务注册登录自启：

```bash
brew services start colima
brew services info colima
```

用户登录 macOS 后，Colima 会自动启动；预览的 DB、API 和 Web 容器使用 `restart: unless-stopped`，会在 Docker 就绪后恢复。Cloudflare Tunnel 由独立的系统 launchd 服务保持常驻。

固定预览保持为稳定构建，不自动监听工作区文件。日常临时检查可运行 `make preview-up` 构建当前工作区；需要固定预览的变更先通过本地门禁、推送草稿 PR 并等待五项必需检查全绿，再运行 `make preview-deploy PREVIEW_REF=<PR-head-full-sha>`。新提交会使旧预览验收失效。文档、普通验证工具、单元测试-only、E2E-only 和生产工具-only 变更无需部署应用预览。两种预览方式都不会删除 PostgreSQL 或附件卷中的人工测试数据，只有 `make preview-reset` 会清空预览数据。

`make preview-down` 用于有意停止预览。它会删除容器，因此即使 Colima 常驻也不会自动恢复预览；需要再次运行 `make preview-up`。

## 4. Cloudflare Tunnel

本机 `~/.cloudflared/config.yml` 的最终 `http_status:404` 规则前必须存在：

```yaml
- hostname: zerp-preview.bytesucceed.com
  service: http://127.0.0.1:15176
- service: http_status:404
```

修改前备份配置；通过现有 Tunnel 创建代理 DNS CNAME；运行 `cloudflared tunnel ingress validate` 后重载现有 launchd 服务。不得复制或输出 Tunnel 凭据。

## 5. 故障分层与凭证安全

`preview-deploy` 同时覆盖构建、迁移、seed、本机健康和公网资源预热。失败时按层定位，避免把入口故障误判为应用故障：

1. 先从命令输出确认镜像构建、migration 和 preview seed 是否成功；
2. 检查本机端点：`http://127.0.0.1:15176/healthz` 与 `http://127.0.0.1:18082/readyz`；
3. 检查预览容器的 `io.zerp.release` 是否为本次 PR head 完整 SHA；
4. 本机健康但公网返回 `530`、TLS 失败或资源预热失败时，运行 `cloudflared tunnel ingress validate` 和 `cloudflared tunnel ingress rule https://zerp-preview.bytesucceed.com`，再核对实际承载该配置的 launchd 服务及日志是否仍有已注册 edge 连接；
5. 只有确认准确的 Tunnel 实例丢失全部 edge 连接且未自行恢复时才重启该实例。不得停止其他 Tunnel，不得用 `preview-reset`、清空卷或重建测试数据修复公网入口；
6. 入口恢复后重新运行 `make preview-status`，同时确认本机、公网和发布 SHA。

预览登录凭证只从 `backend/.env.preview.local` 读取，并通过 `make preview-password` 放入剪贴板。浏览器自动化或人工调试应在填写密码前采集页面结构，登录后再采集业务页面；禁止在敏感输入框已填充时输出 DOM 快照、截图、表单值或网络请求。若凭证意外进入输出，立即通过 `/app/user/change-password` 轮换、撤销旧会话、同步本地预览环境并用新密码重新登录验证。

## 6. 验收

需要固定预览的变更在草稿 PR 五项必需检查全绿后执行：

```bash
docker compose --env-file backend/.env.preview.example \
  -p zerp-fullstack-preview \
  -f compose.yaml -f compose.preview.yaml config --quiet
sh -n backend/scripts/init-preview-env.sh scripts/preview.sh
make preview-deploy PREVIEW_REF=<PR-head-full-sha>
make preview-status
brew services info colima
```

人工验收必须通过固定 HTTPS 入口登录，确认业务单据菜单与当前会话的有效权限及前端注册页面一致。桌面和手机视口均覆盖销售订单、销售签收、销售退货、生产配货、生产自制品、采购订单、采购入库、采购退货、费用报销、费用付款和其他收入；销售定价、采购询价以及客户、供应商、其他三类往来收付款至少验证菜单与页面可加载。销售出库和销售送货随销售链验证，采购履约和销售履约流程均可进入。全部旧居间单据及 `/wfl/intermediary-trade` URL 必须进入未找到页面。验证原子单据按钮逐项受 VOU 权限控制，销售出库、销售送货、销售签收和费用付款没有人工创建入口，其余 OpenAPI 声明可创建的单据可以人工创建。公网探测应从本机网络以外执行，不能用本机 Tunnel 进程的成功状态代替。

日志和验收记录不得包含密码、Cookie、CSRF Token、附件或敏感业务数据。
