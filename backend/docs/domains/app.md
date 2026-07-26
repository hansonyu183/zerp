# APP 后端业务域

## 1. 文档目的

本文定义 ZERP 后端 **APP（Application）** 领域的业务边界、数据模型、接口契约和安全约束，作为数据库迁移、Go 领域服务、HTTP Handler、权限中间件和测试的实现依据。

APP 使用固定领域标识 `app`。所有业务接口遵循：

```text
POST /app/{entity}/{action}
```

本文中的响应均使用项目统一业务包络：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "01J..."
}
```

## 2. 领域职责与边界

APP 负责：

- 用户身份认证和账号状态管理；
- 角色维护及用户与角色的关联；
- 后端 API 权限目录维护及角色授权；
- Cookie 会话的创建、恢复、续期和失效；
- CSRF 凭证签发与校验；
- 计算当前用户的最终 API 权限集合；
- 记录认证、授权和管理操作审计事件。
- 接收登录用户反馈，并可靠发布为待人工审核的 GitHub Issue。

APP 不负责：

- 客户、供应商、产品等业务主数据；
- 组织、岗位和数据范围规则，除非后续以独立需求纳入；
- 前端组件路径、页面路由实现、图标和菜单排序；
- 仅依靠前端菜单或按钮可见性实现安全控制。

## 3. 领域模型

### 3.1 核心实体

| 实体 | 建议表名 | 说明 |
| --- | --- | --- |
| 用户 | `app_users` | 可登录的身份主体，保存账号状态和密码摘要 |
| 用户资料 | `app_user_profiles` | 用户的一对一扩展资料，当前保存私有配置的 HTTPS 头像地址 |
| 角色 | `app_roles` | 可复用的权限集合 |
| 权限 | `app_permissions` | 后端可调用 API 的目录项，路径是业务唯一标识 |
| 用户角色 | `app_user_roles` | 用户与角色的多对多关联 |
| 角色权限 | `app_role_permissions` | 角色与权限的多对多关联 |
| 会话 | `app_sessions` | 服务端会话、到期和注销状态 |
| 审计事件 | `app_audit_events` | 登录、退出及授权变更的追加式记录 |
| 用户反馈 | `app_feedback` | 脱敏后的反馈内容、发布队列状态和 GitHub Issue 结果 |
| 反馈截图文件 | `app_feedback_files` | 反馈专用私有截图、上传状态、归属和过期时间 |
| 反馈附件快照 | `app_feedback_attachments` | 已提交附件的非敏感元数据快照；保留历史 VOU 来源标记 |

关系如下：

```text
User ──< UserRole >── Role ──< RolePermission >── Permission
  │
  ├──── UserProfile
  │
  └──< Session
```

### 3.2 通用字段约定

除关联表外，领域表至少包含：

- `id`：稳定唯一标识，建议使用 UUID 或 ULID；
- `created_at`、`created_by`：创建审计信息；
- `updated_at`、`updated_by`：最后修改审计信息；
- `revision`：从 1 开始递增的乐观并发版本号。

数据库时间统一保存为 `timestamptz`，由服务端生成或读取数据库当前时间。客户端传入的创建人、修改人、审核人和时间一律忽略。

### 3.3 用户

`app_users` 至少包含：

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 用户标识 |
| `username` | 非空、规范化后唯一 | 登录名 |
| `display_name` | 非空 | 显示名称 |
| `password_hash` | 非空 | 强密码哈希摘要，不保存明文或可逆密文 |
| `status` | 非空 | `ENABLED` 或 `DISABLED` |
| `failed_signin_count` | 非空、默认 0 | 连续失败次数，供防暴力破解使用 |
| `locked_until` | 可空 | 临时锁定截止时间 |
| `password_changed_at` | 非空 | 密码最后变更时间 |
| `revision` | 非空 | 并发控制版本 |

用户名入库和查询必须使用同一套规范化规则。是否区分大小写、允许字符、长度和锁定阈值应由配置或补充契约固定，不能在不同接口中使用不同规则。

用户停用或密码变更后，既有会话必须立即或通过同一请求事务失效。

### 3.4 角色

`app_roles` 至少包含：

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 角色标识 |
| `code` | 非空、唯一、不可随意变更 | 稳定角色编码 |
| `name` | 非空 | 显示名称 |
| `description` | 可空 | 角色说明 |
| `status` | 非空 | `ENABLED` 或 `DISABLED` |
| `revision` | 非空 | 并发控制版本 |

角色停用后不再参与权限并集计算。系统不得把角色名称当作接口授权依据。

角色代码 `superadmin` 是服务端保留的唯一通配角色。启用的 `superadmin` 不保存逐项角色权限关联，服务端在计算权限时将其展开为权限目录中全部 `ENABLED` API；客户端不能创建第二个 `superadmin`，也不能通过名称或自定义角色代码获得通配语义。

### 3.5 权限

`app_permissions` 至少包含：

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 权限标识 |
| `path` | 非空、唯一 | 标准 API 路径 |
| `domain` | 非空 | 领域标识，例如 `app`、`bob` |
| `entity` | 非空 | 实体标识，例如 `user`、`customer` |
| `action` | 非空 | 动作标识，例如 `query`、`approve` |
| `description` | 可空 | 权限说明 |
| `status` | 非空 | `ENABLED` 或 `DISABLED` |

权限路径必须由 `domain`、`entity`、`action` 规范化生成：

```text
/{domain}/{entity}/{action}
```

约束：

- 路径与三个拆分字段必须一致；
- 只允许小写字母、数字和单个连字符组成的段；
- 禁止空段、尾随斜杠、查询参数和 `*` 通配符；
- 权限目录以服务端已注册的受保护路由为来源，不接受前端创建任意路径；
- 路由下线时优先停用权限，保留历史授权与审计记录。

可在部署或受控管理命令中执行“路由目录同步”，但同步必须可审计，不得在普通请求中隐式创建权限。

### 3.6 关联表

`app_user_roles` 使用 `(user_id, role_id)` 唯一约束；`app_role_permissions` 使用 `(role_id, permission_id)` 唯一约束。两张表均保存 `created_at`、`created_by`。

关联删除表示撤销当前授权，不代表删除用户、角色、权限或审计历史。用户角色和角色权限的批量替换必须在单个事务中完成，避免出现部分授权状态。`superadmin` 是唯一例外：其有效权限由保留角色代码动态展开，`app_role_permissions` 中不得保存该角色的逐项关联。

### 3.7 会话

`app_sessions` 至少包含：

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 内部会话标识 |
| `user_id` | 外键、非空 | 所属用户 |
| `token_hash` | 非空、唯一 | Cookie 中随机会话令牌的安全摘要 |
| `csrf_token_hash` | 非空 | 当前 CSRF Token 的安全摘要 |
| `created_at` | 非空 | 创建时间 |
| `last_seen_at` | 非空 | 最近有效访问时间 |
| `idle_expires_at` | 非空 | 空闲到期时间 |
| `absolute_expires_at` | 非空 | 绝对到期时间 |
| `revoked_at`、`revoked_reason` | 可空 | 注销或服务端失效信息 |

数据库不得保存或记录 Cookie 中的原始会话令牌。令牌必须由密码学安全随机源生成，比较摘要时避免产生可利用的时序差异。

会话过期策略、单用户最大会话数以及是否续期由部署配置确定；绝对到期时间不得被滑动续期突破。

## 4. 最终权限计算

普通角色的最终权限是以下集合的去重并集：

```text
有效用户
  → 有效的用户角色关联
  → ENABLED 角色
  → 有效的角色权限关联
  → ENABLED 权限
  → permission.path 去重、升序输出
```

若有效用户关联了启用的 `superadmin`，最终权限改为权限目录中全部 `ENABLED` 权限，并继续以完整 API 路径去重、升序输出。通配语义只存在于服务端，不在会话响应中返回 `"*"`；登录和会话恢复仍返回展开后的 `permissions: string[]`，因此权限停用会立即从管理员权限中消失。

每个受保护 API 请求必须校验：

1. 会话存在、未注销且未过期；
2. 用户仍为 `ENABLED`；
3. CSRF 校验通过；
4. 用户当前最终权限包含请求的精确路径；
5. 用例自身要求的数据范围和状态规则通过。

允许使用权限缓存，但必须具有可靠的版本号或失效机制，保证用户、角色、权限停用以及关联撤销能及时生效。不能只信任登录时写入会话或返回给前端的权限快照。

`/app/user/signin` 和 `/app/user/session` 是认证入口，不要求已有 API 权限；`signin` 不要求已有 CSRF Token。`session` 只能恢复已有 Cookie 会话并签发或返回当前 CSRF Token。有效会话执行 `signout` 时要求 CSRF 校验和 `/app/user/signout` 精确权限；系统必须保证每个可登录用户的最终权限都包含该权限，避免形成无法安全退出的授权状态。

`/app/feedback/attachment-initiate`、`/app/feedback/attachment-remove`、`/app/feedback/create` 和 `/app/feedback/get` 是登录用户自助接口，只要求有效会话和 CSRF，不进入 `app_permissions`，也不参与角色逐项授权。该例外只允许操作当前主体的未提交附件、提交反馈和查询本人反馈，不能读取其他用户数据。

会话接口只返回用户资料、CSRF Token 和 API 权限数组。菜单标题、图标、顺序、组件和动态路由由前端本地注册表生成，后端不得通过权限数据指定可执行的前端组件路径。

## 5. API 契约

### 5.1 登录 `POST /app/user/signin`

请求：

```json
{
  "username": "alice",
  "password": "本次登录密码"
}
```

成功处理必须：

1. 规范化用户名并读取用户；
2. 使用固定成本流程校验密码，避免通过响应差异枚举用户；
3. 校验用户状态和临时锁定状态；
4. 创建新会话并设置 Cookie；
5. 计算当前权限数组；
6. 记录成功审计事件。

成功响应 `data`：

```json
{
  "user": {
    "id": "01J...",
    "username": "alice",
    "displayName": "Alice"
  },
  "csrfToken": "仅返回给当前客户端的凭证",
  "permissions": [
    "/app/user/signout",
    "/bob/customer/get",
    "/bob/customer/query"
  ]
}
```

Cookie 至少设置 `HttpOnly`、`Secure`、适当的 `SameSite`、受限的 `Path` 和明确的有效期。跨域部署时必须联合验证 Cookie、CORS 和 HTTPS 配置。

登录失败统一返回认证失败业务结果，不区分“用户不存在”“密码错误”“账号停用”等外部消息。内部日志和审计事件可以记录受控原因，但不得记录密码、原始 Cookie 或 CSRF Token。

### 5.2 恢复会话 `POST /app/user/session`

请求体使用空对象：

```json
{}
```

有效会话返回与登录相同的数据结构，并使用最新用户资料和最新权限计算结果。会话无效、用户停用或到期统一返回“未登录/会话失效”业务码，并清除失效 Cookie。

若采用 CSRF Token 轮换，接口必须原子更新会话中的摘要后再返回新 Token。

### 5.3 退出登录 `POST /app/user/signout`

请求体使用空对象。有效会话必须通过 CSRF 和精确权限校验，然后撤销当前会话并清除 Cookie。对已注销、不存在或已自然到期且不再能引发服务端状态变更的会话，可清除 Cookie 并返回成功，以保证客户端清理流程幂等；有效会话的 CSRF 或权限失败不能伪装为成功。

### 5.4 当前用户自助接口

`POST /app/user/profile` 使用空对象请求体时返回当前会话用户的非敏感资料：

```json
{
  "id": "01J...",
  "username": "alice",
  "displayName": "Alice",
  "avatarUrl": "https://images.example.com/alice.png",
  "passwordChangedAt": "2026-07-22T10:00:00Z",
  "revision": 2
}
```

携带资料字段时，同一路径保存当前用户资料：

```json
{
  "displayName": "Alice",
  "avatarUrl": "https://images.example.com/alice.png"
}
```

`displayName` 去除首尾空白后必须为 1–128 个 Unicode 字符。`avatarUrl` 省略、为 `null`
或为空字符串时清除头像；非空时必须是不含用户凭证和 Fragment 的 HTTPS 绝对地址，最长 500 个字符。
保存不接受用户 ID、角色、状态、密码或客户端 `revision`，不会撤销现有会话；成功响应与空对象读取结构一致。
无实际变化时幂等返回且不增加 `revision`。实际修改在同一事务内更新显示名称、头像和审计事件，
审计只记录字段是否变化，不记录头像地址。

该接口只读取或修改当前登录用户，不返回角色、密码摘要、失败登录计数或会话信息。

`POST /app/user/change-password` 请求：

```json
{
  "currentPassword": "当前密码",
  "newPassword": "符合当前密码策略的新密码"
}
```

后端必须重新校验当前密码，新密码不得与当前密码相同。修改密码、撤销该用户全部会话及成功审计事件必须在同一事务中完成；成功后清除当前 Cookie，客户端必须重新登录。该接口不接受用户 ID、密码摘要、`revision` 或任何管理员代改目标。

两个接口均要求有效会话、CSRF Token 和对应的精确 API 权限。

### 5.5 用户反馈

`POST /app/feedback/attachment-initiate` 使用有效会话和 CSRF 创建反馈专用上传：

```json
{
  "fileName": "screen.png",
  "contentType": "image/png",
  "size": 128000,
  "sha256": "64位小写十六进制摘要"
}
```

成功返回 `fileId`、15 分钟有效的一次性 `uploadUrl` 和 `expiresAt`。客户端以声明的
`Content-Type`、`Content-Length` 对 `uploadUrl` 执行 `PUT`，上传成功返回 204。
只允许 PNG、JPEG，每张 1 字节至 10 MiB；后端同时校验长度、SHA-256 和文件魔数。
每个用户最多保留 3 个未提交文件，滚动 24 小时最多初始化 60 次。
`POST /app/feedback/attachment-remove` 请求 `{"fileId":"01J..."}`，只能删除当前用户尚未提交的文件。

`POST /app/feedback/create` 请求：

```json
{
  "category": "BUG",
  "title": "销售订单保存失败",
  "content": "点击保存后提示失败",
  "pagePath": "/vou/sale-order",
  "clientVersion": "1.2.3",
  "relatedRequestId": "01J...",
  "attachmentIds": ["01J..."]
}
```

`category` 只允许 `BUG`、`SUGGESTION`、`OTHER`；标题 1–120 个 Unicode 字符，正文 1–4000 个 Unicode 字符。`pagePath` 只能是不带查询串和 Fragment 的站内绝对路径；最多引用 3 个不重复的严格 ULID。附件必须来自上述反馈专用流程、归属当前用户且状态为 `READY`；VOU 附件 ID 不再接受。提交后保存文件和文件名、MIME、大小、SHA-256 快照，但不生成公开地址，也不把截图内容或地址写入 GitHub Issue。已上传但 24 小时内未提交的文件由清理任务删除；已提交截图私有长期保留，当前不提供 HTTP 查看或下载接口。

后端在持久化前清除常见令牌、Cookie、CSRF、密码赋值、JWT 和私钥内容。每个用户滚动 24 小时最多提交 20 条。成功响应：

```json
{
  "feedbackId": "01J...",
  "status": "PENDING",
  "submittedAt": "2026-07-25T10:00:00Z"
}
```

`POST /app/feedback/get` 请求 `{"feedbackId":"01J..."}`，只允许提交者查询，返回分类、标题、`PENDING | PUBLISHED | FAILED`、公开 Issue URL 和时间。内部 `PROCESSING` 对外仍显示 `PENDING`，他人查询与记录不存在使用相同错误。

反馈由数据库租约队列异步发布到配置的 GitHub 仓库。Issue 必须原子附带 `automation:blocked`，正文不包含用户身份、IP、UA 或凭证；只有人工审核并移除阻塞标签后，自动 Issue 处理任务才能领取。暂时性错误指数退避，最多 10 次；永久 GitHub 4xx 或重试耗尽进入 `FAILED`。

### 5.6 用户管理

| 路径 | 说明 | 关键约束 |
| --- | --- | --- |
| `/app/user/query` | 分页查询用户 | 过滤、排序字段白名单；不返回密码摘要 |
| `/app/user/get` | 查询用户详情及角色 | 不返回会话令牌、密码摘要 |
| `/app/user/create` | 创建用户并分配初始角色 | 用户名唯一；密码强度校验；单事务 |
| `/app/user/save` | 修改资料或角色 | 携带 `revision`；角色必须存在且有效 |
| `/app/user/enable` | 启用用户 | 携带 `revision`，记录审计 |
| `/app/user/disable` | 停用用户 | 携带 `revision`，同时撤销全部会话 |

管理员重置密码和账号恢复仍属于独立安全流程，不得复用普通 `save` 接口直接传递新密码。

### 5.7 角色管理

| 路径 | 说明 | 关键约束 |
| --- | --- | --- |
| `/app/role/query` | 分页查询角色 | 支持状态等显式白名单条件 |
| `/app/role/get` | 查询角色详情及权限 | 权限按路径稳定排序 |
| `/app/role/create` | 创建角色及初始权限 | 权限必须存在且有效；单事务 |
| `/app/role/save` | 修改角色及权限集合 | 携带 `revision`；单事务替换授权 |
| `/app/role/enable` | 启用角色 | 携带 `revision` |
| `/app/role/disable` | 停用角色 | 携带 `revision`，授权立即失效 |

分配某实体的非 `query` 动作时，角色原则上也必须包含该实体的 `query` 权限；否则返回参数校验错误，防止生成无法进入页面的孤立权限。认证入口等非页面接口可列入依赖规则的显式例外。

### 5.8 权限目录

| 路径 | 说明 | 关键约束 |
| --- | --- | --- |
| `/app/permission/query` | 查询权限目录 | 可按 domain/entity/status 过滤 |
| `/app/permission/get` | 查询权限及被引用情况 | 不泄露无关用户敏感信息 |

权限创建、同步、停用属于部署或高权限管理能力，只有在路由注册机制和审计要求确定后才开放 API；普通管理员不能创建指向不存在路由的权限。

## 6. 管理接口通用结构

分页查询沿用项目统一结构：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "status": "ENABLED"
  },
  "sort": [
    { "field": "createdAt", "order": "desc" }
  ]
}
```

并发写请求必须携带目标当前 `revision`。更新 SQL 同时匹配 `id` 和 `revision`，成功后将 `revision` 加一；未更新任何行时重新判断“不存在”或“数据冲突”，禁止后写静默覆盖先写。

所有 ID、状态、分页范围、字符串长度和关联对象都必须在进入核心用例前校验。客户端字段名、排序方向和过滤表达式不得直接拼接 SQL。

## 7. 事务与一致性

以下操作必须使用单个数据库事务：

- 创建用户及分配初始角色；
- 替换用户角色集合；
- 创建或修改角色及替换权限集合；
- 停用用户并撤销其会话；
- 修改密码并撤销旧会话；
- 创建、轮换或撤销会话与写入对应关键审计事件。
- 创建反馈、附件元数据快照及滚动窗口限流判断。

授权关联变更成功提交后，权限缓存才能失效。若缓存失效失败，必须采用版本号校验或默认回源数据库，不能继续把旧权限作为有效授权。

新增领域权限的迁移只负责登记 `app_permissions`；不得再为 `superadmin` 逐项插入 `app_role_permissions`。普通角色仍通过显式关联授权。

## 8. 安全与审计

- 密码使用当前认可的自适应强哈希算法，并在配置中固定参数和升级策略；
- 登录接口实施速率限制、失败计数和必要的临时锁定；
- Cookie 会话令牌、CSRF Token、密码和密码摘要禁止进入响应日志；
- 除认证入口和反馈自助接口的明确例外外，所有业务 `POST` 请求同时校验会话、CSRF 和精确 API 权限；
- 管理员不能停用最后一个可执行核心授权管理的有效账号，具体防锁死规则在初始化方案中固定；
- 审计记录至少包含事件类型、操作者、目标、结果、时间、`requestId` 和必要的变更摘要；
- 审计摘要不得包含密码、令牌、Cookie 或完整敏感数据；
- 权限不足与未登录使用不同的稳定业务码；内部异常不暴露 SQL、堆栈和数据库对象名。

## 9. 测试验收

至少覆盖：

1. 登录成功、统一失败消息、锁定、停用账号和密码变更后的旧会话失效；
2. Cookie 属性、会话到期、注销幂等和 CSRF 校验/轮换；
3. 多角色权限去重并集，以及用户、角色、权限停用后的即时失效；
4. 精确路径鉴权，拒绝前缀、大小写变化和通配符匹配；
5. `superadmin` 无逐项关联仍获得全部启用权限，新增和停用权限能即时反映在展开后的登录权限数组；
6. 用户角色和角色权限批量替换的事务回滚；
7. 并发修改相同用户或角色时只允许一个版本成功；
8. `query` 权限依赖校验；
9. 所有管理接口均不返回或记录敏感字段；
10. 未登录、无权限、参数错误、数据冲突和内部异常映射到稳定业务错误类别。
11. 普通登录用户无需角色反馈权限即可提交和查询本人反馈，且不能查询他人反馈；
12. 反馈限流、附件归属、敏感信息清洗、发布租约、重试终态和 `automation:blocked` 标签可验证。

## 10. 已配置策略与待决事项

当前实现已经固定：

- 用户名在比较和保存前去除首尾空白并转为小写，长度为 3–64 个 Unicode 字符；
- 密码最小长度由 `APP_PASSWORD_MIN_LENGTH` 配置，默认 12、允许 8–128，实际密码最长 256 个字符，
  并且必须同时包含 ASCII 小写、大写、数字和符号；
- 连续失败锁定阈值和锁定时间分别由 `APP_SIGNIN_LOCK_THRESHOLD`、`APP_SIGNIN_LOCK_DURATION` 配置，
  默认 5 次和 15 分钟；进程内还按规范化用户名限制每分钟最多 30 次登录请求；
- 会话空闲和绝对有效期分别由 `APP_SESSION_IDLE_TIMEOUT`、`APP_SESSION_ABSOLUTE_TIMEOUT` 配置，
  默认 30 分钟和 12 小时；受保护请求延长空闲期限，但不得突破绝对期限。

仍待产品或安全方案明确：

- 用户名允许字符、国际化用户名及保留名称策略；
- 单用户最大并发会话数；
- 管理员重置密码和账号恢复流程；
- 是否引入组织、岗位、租户和数据范围授权；
- 权限路由目录的构建期生成、启动期校验或部署期同步方案；
- 审计数据保留期限和查询权限。
