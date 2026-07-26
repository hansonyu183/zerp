# ZERP 前端 API 配置说明

本文供 ZERP 前端开发、Cloudflare Pages 构建和联调使用。后端 API 地址为：

```text
https://zerp-api.bytesucceed.com
```

## 1. Cloudflare Pages 生产配置

在 Cloudflare Pages 项目的生产环境变量中配置：

```env
VITE_API_BASE_URL=https://zerp-api.bytesucceed.com
```

修改环境变量后必须重新部署前端。Vite 的 `VITE_*` 变量在构建时写入静态资源，仅修改 Pages 变量而不重新构建不会生效。

生产前端的自定义 Origin 示例为：

```text
https://zerp.bytesucceed.com
```

部署时必须把该精确 Origin 写入后端 `CORS_ALLOWED_ORIGINS`。Origin 不包含路径，也不能带结尾 `/`。
Cloudflare Pages 的原始域名和预览域名不会因为同属 `pages.dev` 自动获得授权；确需联调时逐个加入完整
Origin，并在联调结束后移除。

自定义前端域名和 API 都位于 `https://*.bytesucceed.com` 时属于同站部署，可以使用
`SameSite=Lax` 会话 Cookie，不需要为了生产环境改成第三方 Cookie。

## 2. 本地开发配置

仓库 `.env.example` 和主 Compose 默认允许以下本地 Origin：

```text
http://localhost:5173
http://localhost:4173
http://127.0.0.1:4173
```

推荐开发者统一在端口 `5173` 启动 Vite：

```bash
pnpm dev -- --host localhost --port 5173
```

协议、主机或端口任一不同都会产生不同的 Origin。例如以下地址当前不会被放行：

```text
http://localhost:5174
http://192.168.1.10:5173
```

如必须使用其他地址，需要把完整 Origin 加入本地后端的 `CORS_ALLOWED_ORIGINS`。这些默认值只描述仓库
配置，不代表任何生产环境当前允许的 Origin。

### 推荐：使用 Vite 开发代理

涉及登录 Cookie 时，让浏览器请求本地同源 `/api`，再由 Vite 转发到本机 API。前端开发环境配置：

```env
VITE_API_BASE_URL=/api
```

`vite.config.ts` 示例：

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

`strictPort: true` 可以避免 `5173` 被占用后 Vite 自动切换到未加入 CORS 白名单的其他端口。

本机后端使用纯 HTTP 时，在被 Git 忽略的 `.env.local` 中设置：

```env
APP_SESSION_COOKIE_SECURE=false
APP_SESSION_COOKIE_SAME_SITE=lax
```

`SameSite=None` 只用于前端与 API 真正跨站且必须携带 Cookie 的 HTTPS 场景，并强制要求
`APP_SESSION_COOKIE_SECURE=true`。同站生产部署和本机代理不应为了“保险”改成 `None`。

### 隔离 E2E

BOB、VOU、WFL 的 Playwright 流程会创建和流转真实业务数据，禁止连接生产或日常联调数据库。先在后端
仓库执行 `make e2e-env-init && make e2e-up`，再让前端测试使用：

```env
E2E_API_BASE_URL=http://127.0.0.1:18080
```

隔离后端的数据库、附件、Cookie 和端口均独立；重置与账号配置见后端 README 的“本机隔离 E2E 后端”。
生产 API 地址只供正式构建和经授权的只读探针使用，不作为本地破坏性业务测试目标。

## 3. 请求封装

所有业务 API 使用 `POST application/json`。前端必须启用 Cookie 凭证：

```ts
type ApiEnvelope<T> = {
  code: number
  message: string
  data: T | null
  requestId: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function postApi<T>(
  path: string,
  body: unknown,
  csrfToken?: string,
): Promise<ApiEnvelope<T>> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not configured')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`API transport error: HTTP ${response.status}`)
  }

  return (await response.json()) as ApiEnvelope<T>
}
```

注意：

- `credentials: 'include'` 必须用于登录、恢复会话和所有受保护请求。
- 登录和恢复会话成功后，把响应中的 `csrfToken` 保存在当前应用会话内。
- 受保护请求及退出登录必须发送 `X-CSRF-Token`。
- 不要把密码、Cookie 或 CSRF Token 写入日志、监控事件或错误上报。
- 建议仅在内存状态中保存 CSRF Token，刷新页面后通过会话恢复接口重新取得。

## 4. 登录与会话流程

以下示例使用的会话类型：

```ts
type SessionData = {
  user: {
    id: string
    username: string
    displayName: string
  }
  csrfToken: string
  permissions: string[]
}
```

### 登录

```ts
const result = await postApi<SessionData>('/app/user/signin', {
  username,
  password,
})
```

登录成功时：

- 后端通过 `Set-Cookie` 写入 HttpOnly 会话 Cookie；
- `data.csrfToken` 供后续受保护请求使用；
- `data.permissions` 是当前用户可调用的 API 路径数组。

### 恢复会话

应用启动或页面刷新后调用：

```ts
const result = await postApi<SessionData>('/app/user/session', {})
```

业务码 `1001` 表示未登录或会话已失效，前端应清理用户状态并进入登录页。

### 受保护请求

```ts
const result = await postApi<unknown>(
  '/app/user/query',
  { page: 1, pageSize: 20, filters: {}, sort: [] },
  csrfToken,
)
```

### 退出登录

```ts
await postApi('/app/user/signout', {}, csrfToken)
```

无论退出请求结果如何，前端都应在最终清理本地用户资料、权限和 CSRF Token。

### 当前用户资料

```ts
const result = await postApi<{
  id: string
  username: string
  displayName: string
  passwordChangedAt: string
  revision: number
}>('/app/user/profile', {}, csrfToken)
```

### 修改密码

```ts
await postApi(
  '/app/user/change-password',
  { currentPassword, newPassword },
  csrfToken,
)
```

修改成功后后端会撤销该用户全部会话并清除当前 Cookie，前端应清理本地状态并进入登录页。

## 5. 响应与错误处理

业务请求通常返回 HTTP 200，前端必须根据响应包络的 `code` 判断业务结果：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "01J..."
}
```

当前公共业务码：

| `code` | 含义 | 前端建议 |
| ---: | --- | --- |
| `0` | 成功 | 使用 `data` |
| `1001` | 未登录或会话失效 | 清理会话并进入登录页 |
| `1002` | 无操作权限 | 显示无权限提示，不自动重试 |
| `2001` | 参数校验失败或数据不存在 | 显示校验提示 |
| `3001` | 并发更新或数据冲突 | 提示刷新后重试 |
| `5000` | 服务内部错误 | 显示通用错误并保留 `requestId` |

以下属于传输层错误，不保证返回业务包络：

- CORS 拒绝；
- TLS 或网络连接失败；
- Cloudflare 或上游服务不可用；
- HTTP 404、502、503、504。

前端错误上报应包含 `requestId`、API 路径和业务码，但不得包含密码、Cookie、CSRF Token 或完整敏感请求体。

## 6. 健康检查

无需登录即可检查：

```text
GET https://zerp-api.bytesucceed.com/healthz
GET https://zerp-api.bytesucceed.com/readyz
```

- `/healthz` 表示 API 进程存活；
- `/readyz` 表示 API 已连接数据库。

健康检查成功不代表业务 API 已部署，也不代表当前用户具有业务权限。

## 7. 联调验证清单

部署状态会随发布变化，不在仓库文档中保存“当前已部署”快照。每次联调按目标环境重新验证：

1. `GET /healthz` 和 `GET /readyz` 均成功；
2. 使用目标前端的精确 `Origin` 发起预检，确认 `Access-Control-Allow-Origin` 不使用通配符且允许凭证；
3. 登录响应写入 `HttpOnly` Cookie，生产必须带 `Secure`，`SameSite` 与实际站点拓扑一致；
4. 刷新后通过 `/app/user/session` 恢复用户、权限和新的 CSRF Token；
5. 受保护请求携带 `X-CSRF-Token`，未登录、无权限和参数错误分别映射到稳定业务码；
6. 使用真实已注册路径验证目标领域，而不是只以健康检查判断业务版本已部署；
7. 注销后原会话不能继续访问受保护接口。

记录验证环境、版本或提交、时间和 `requestId`，但不得记录密码、Cookie 或 CSRF Token。
