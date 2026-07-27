# 固定外网开发预览

固定预览用于人工验收当前工作区代码，独立于开发、生产形态和 E2E。桌面、手机和本机统一访问：

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
make preview-status
make preview-password
make preview-down
make preview-reset
```

- `preview-up`：首次生成本地环境文件，构建当前工作区，自动迁移、初始化管理员与 BOB 演示数据，等待健康后输出固定网址；
- `preview-down`：停止预览容器，保留 PostgreSQL 与附件卷；
- `preview-reset`：只删除 `zerp-fullstack-preview` 的容器和卷，并重建干净预览；
- `preview-status`：检查 Compose 状态、本机 Web/API 健康端点和公网 HTTPS；
- `preview-password`：只把管理员密码写入 macOS 剪贴板，不在终端打印。

本地凭证仅保存在被 Git 忽略的 `backend/.env.preview.local`，初始化脚本会将其权限设为 `600`。不得把该文件内容写入日志、聊天、截图或提交。

## 3. Cloudflare Tunnel

本机 `~/.cloudflared/config.yml` 的最终 `http_status:404` 规则前必须存在：

```yaml
- hostname: zerp-preview.bytesucceed.com
  service: http://127.0.0.1:15176
- service: http_status:404
```

修改前备份配置；通过现有 Tunnel 创建代理 DNS CNAME；运行 `cloudflared tunnel ingress validate` 后重载现有 launchd 服务。不得复制或输出 Tunnel 凭据。

## 4. 验收

```bash
docker compose --env-file backend/.env.preview.example \
  -p zerp-fullstack-preview \
  -f compose.yaml -f compose.preview.yaml config --quiet
sh -n backend/scripts/init-preview-env.sh scripts/preview.sh
make generate-check
make check
make preview-status
```

人工验收必须通过固定 HTTPS 入口登录，分别以桌面和手机视口打开销售订单、销售出库单、销售配送单和销售签收单页面。公网探测应从本机网络以外执行，不能用本机 Tunnel 进程的成功状态代替。

日志和验收记录不得包含密码、Cookie、CSRF Token、附件或敏感业务数据。
