# APP 领域描述

## 1. 领域定义

**APP（Application）** 是 ZERP 的应用访问与权限管理领域，负责用户身份认证、角色管理、权限分配、登录会话建立，以及向前端提供当前用户可调用的 API 权限集合。

APP 只负责识别用户“是谁”和“允许执行什么操作”，不承载客户、产品、单据等业务数据。

## 2. 领域目标

- 使用统一的用户登录入口建立安全会话。
- 通过角色集中分配和维护权限。
- 向当前登录用户返回完整、稳定的 API 权限数组。
- 以前端本地页面注册表和 API 权限数组共同生成动态菜单。
- 保证前端权限控制与后端接口鉴权使用同一套权限标识。

## 3. 业务实体

| 实体 | 标识 | 说明 |
| --- | --- | --- |
| 用户 | `user` | 可登录系统的身份主体，关联一个或多个角色 |
| 角色 | `role` | 一组权限的集合，用于批量授权用户 |
| 权限 | `permission` | 对一个 API 的调用授权，使用标准 API 路径作为唯一标识 |

## 4. 核心关系

```text
用户（User） ── 多对多 ── 角色（Role） ── 多对多 ── 权限（Permission）
```

- 一个用户可以拥有多个角色。
- 一个角色可以分配给多个用户。
- 一个角色可以包含多个权限。
- 一个权限可以被多个角色引用。
- 当前用户的最终权限是其全部有效角色权限的去重并集。
- 用户、角色或权限被停用后，不再参与后续授权计算。

## 5. 权限标识

权限使用不带域名的标准 API 路径表示，格式为：

```text
/{domain}/{entity}/{action}
```

示例：

```text
/app/user/query
/app/user/create
/app/role/query
/app/permission/query
/bob/customer/query
/bob/customer/create
/bob/customer/approve
```

权限数组必须满足以下规则：

- 每一项只代表一个可调用的 API。
- 路径必须精确匹配，不使用 `*` 等前端通配符。
- 数组中的路径必须去重。
- 权限判断区分完整的 `domain`、`entity` 和 `action`。
- 后端是权限校验的最终安全边界，不能因为前端隐藏了按钮就省略鉴权。

## 6. 用户登录

### 6.1 登录接口

用户通过以下接口登录：

```text
POST /app/user/signin
```

请求示例：

```json
{
  "username": "用户名",
  "password": "密码"
}
```

登录成功后，后端建立 Cookie 会话，并在响应中返回当前用户资料、CSRF 凭证和 API 权限数组。

响应 `data` 示例：

```json
{
  "user": {
    "id": "用户标识",
    "username": "用户名",
    "displayName": "显示名称"
  },
  "csrfToken": "CSRF 凭证",
  "permissions": [
    "/bob/customer/query",
    "/bob/customer/get",
    "/bob/customer/create",
    "/app/user/signout"
  ]
}
```

安全约束：

- 会话 Cookie 由后端设置，使用 `Secure`、`HttpOnly` 和适当的 `SameSite` 属性。
- 前端不得读取、复制或持久化会话 Cookie。
- 前端只在内存中保存当前用户、CSRF Token 和权限数组。
- 密码只能用于本次登录请求，不得记录、缓存或写入日志。
- 登录失败不得返回可用于判断用户是否存在的差异化敏感信息。

### 6.2 会话恢复

页面刷新后，通过以下接口恢复登录状态：

```text
POST /app/user/session
```

会话有效时，返回与登录成功相同的数据结构；会话无效时，返回统一的未登录业务错误。

会话恢复成功后，前端重新保存权限数组并生成动态菜单。前端不得依赖刷新前保存在本地的数据恢复权限。

### 6.3 退出登录

```text
POST /app/user/signout
```

退出成功或会话失效时，前端必须清空：

- 当前用户；
- CSRF Token；
- 权限数组；
- 由权限生成的动态菜单和动态路由。

随后跳转到登录页面。

## 7. 登录状态

登录状态属于应用级全局状态，建议包含：

| 状态 | 说明 |
| --- | --- |
| `initialized` | 是否已经完成会话恢复 |
| `loading` | 是否正在执行登录、恢复或退出操作 |
| `user` | 当前用户；为空表示未登录 |
| `csrfToken` | 当前会话的 CSRF 凭证 |
| `permissions` | 当前用户获准调用的 API 路径数组 |

系统根据登录状态自动响应：

- 尚未完成会话恢复时，显示初始化状态，不提前显示登录页或 Home 页。
- 未登录时只允许访问登录页。
- 已登录时进入 Home 页。
- 已登录用户访问登录页时跳转到 Home 页。
- 任一业务请求返回未登录错误时，立即清空登录状态并跳转到登录页。

## 8. 动态菜单

### 8.1 生成原则

动态菜单由“当前用户的 API 权限数组”和“前端本地页面注册表”共同生成。

`app` 领域用于认证、会话、用户资料和权限控制等系统能力，不进入 Home
动态菜单，也不注册为 Home 下的动态业务路由。Home 动态菜单仅从其他业务领域生成。

```text
登录/恢复会话
    ↓
获得 permissions API 数组
    ↓
按 /{domain}/{entity}/{action} 解析并分组
    ↓
筛选本地已注册的 domain/entity 页面
    ↓
至少具有该实体的菜单准入权限
    ↓
生成一级领域菜单和二级实体菜单
    ↓
注册对应动态路由并在 Home 中显示
```

### 8.2 菜单准入权限

每个业务实体使用其 `query` 权限作为菜单准入条件：

```text
/{domain}/{entity}/query
```

例如，权限数组包含：

```text
/bob/customer/query
```

并且前端本地注册了 `bob/customer` 页面时，菜单中显示：

```text
BOB
└── 客户
```

只有 `create`、`approve` 等动作权限而没有 `query` 权限时，不生成该实体菜单。后端在分配动作权限时也应校验依赖关系，避免产生无法进入页面的孤立权限。

### 8.3 本地页面注册表

权限数组只描述“允许调用哪些 API”，不包含可由后端任意指定的前端组件路径。页面标题、图标、顺序和组件加载器由前端本地注册表维护，例如：

```ts
{
  domain: 'bob',
  domainTitle: '基础业务对象',
  entity: 'customer',
  entityTitle: '客户',
  icon: 'mdi-account-group',
  order: 10,
  component: () => import('@/pages/bob/customer/Customer.vue'),
}
```

约束如下：

- 后端权限不能加载本地未注册的页面。
- 本地存在页面但用户没有对应 `query` 权限时，不显示菜单也不注册可访问路由。
- 菜单点击后由 Home 内容区域加载对应的业务实体组件。
- 页面内按钮根据完整的动作权限判断是否显示或可用。
- 用户直接访问无权限路由时，前端显示无权限结果；后端仍必须拒绝相关 API 调用。

### 8.4 权限判断

前端提供统一判断函数：

```ts
can('/bob/customer/create')
can('/bob/customer/approve')
```

禁止页面自行使用字符串模糊匹配、前缀匹配或角色名称判断权限。

## 9. 角色管理

角色至少包含：

- 角色标识；
- 角色编码；
- 角色名称；
- 状态；
- 权限集合；
- 创建和修改审计信息。

主要领域能力：

```text
POST /app/role/query
POST /app/role/get
POST /app/role/create
POST /app/role/update
POST /app/role/enable
POST /app/role/disable
POST /app/role/permissions
```

`permissions` 动作用于更新角色的完整权限集合。后端必须校验权限是否存在且有效。

## 10. 用户管理

用户至少包含：

- 用户标识；
- 用户名；
- 显示名称；
- 状态；
- 角色集合；
- 创建和修改审计信息。

主要领域能力：

```text
POST /app/user/query
POST /app/user/get
POST /app/user/create
POST /app/user/update
POST /app/user/enable
POST /app/user/disable
POST /app/user/roles
POST /app/user/password
POST /app/user/signin
POST /app/user/session
POST /app/user/signout
```

停用用户后，该用户已有会话应立即失效，或在下一次请求时被后端拒绝。

## 11. 权限管理

权限由系统已发布的 API 能力产生，至少包含：

- 权限标识，即标准 API 路径；
- 权限名称；
- 所属领域；
- 所属实体；
- 动作；
- 状态。

主要领域能力：

```text
POST /app/permission/query
POST /app/permission/get
```

权限原则上由系统注册或发布流程维护，不允许普通管理员随意创建一个后端不存在的 API 权限。

## 12. 权限变更与会话一致性

- 用户角色或角色权限变更后，后端必须确保后续请求使用最新权限。
- 前端的权限数组用于交互控制，不得作为后端继续授权的缓存依据。
- 为及时刷新菜单，后端可以使相关用户会话失效，或通过权限版本号通知前端重新调用 `user.session`。
- 权限被撤销后，即使旧页面仍在显示，后端也必须立即拒绝无权限 API 请求。

## 13. 与其他领域的关系

- APP 为 BOB 及其他业务领域提供用户身份和 API 权限判断。
- 其他领域只声明自身 API 所需的权限，不自行维护角色体系。
- APP 不根据角色名称生成菜单；菜单始终根据最终 API 权限数组生成。
- 业务领域的创建、编辑、提交、审核等动作分别对应独立 API 权限。

## 14. 待补充事项

- 用户名、密码和锁定策略；
- 多角色权限是否支持显式拒绝规则；
- 角色和用户是否具有组织或数据范围；
- 权限注册、下线和版本升级机制；
- 超级管理员的授权方式；
- 权限变化后的会话刷新策略和时效要求。
