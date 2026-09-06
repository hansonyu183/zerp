# 登录页面用例

## 范围

- 路由：`/signin`，由 `frontend/src/target/router/index.ts` 的 `app/signin` 登记。
- 认证、会话恢复和失败语义以 [APP 领域的登录规则](../../domains/app.md#51-登录) 为准；本页只编排输入、请求和可见反馈。

## `APP-SIGNIN-01` 登录

1. 页面启动时调用 `/session/app/get` 读取匿名且非敏感的企业名称展示；读取失败时显示可重试说明，但不伪造品牌资料或会话。
2. 用户输入账号编码和密码并提交 `/session/auth/signin`。
3. 成功后只接受服务端的唯一会话上下文；若 `passwordChangeRequired` 为真，进入 `/change-password`，否则由会话导航规则进入其允许的目标页面。
4. 登录失败时保留账号编码、清空密码并显示可重试的服务端说明；不得用本地假会话替代服务端结果。

## 验收

1. 未认证访问 `/signin` 显示登录表单。
2. 成功认证后页面只使用服务端返回的 `user`、`apiPaths`、`csrfToken`、`passwordChangeRequired` 和 `passwordMinLength`。
3. 账号切换、退出或乱序响应不得恢复先前账号的会话状态。

## `APP-PROFILE-01` 本人资料

1. 有效普通会话从顶栏打开个人资料弹窗时，调用 `/session/user/get` 获取本人非敏感资料。
2. 用户只可编辑 `name` 和既有合法 `avatarUrl`，提交 `/session/user/save` 后以服务端返回资料更新顶栏显示。
3. 加载或保存失败时保留当前可编辑资料并显示服务端错误；前端不提交用户 ID、账号编码、角色、启停状态、密码或 revision。
4. 强制改密受限会话不能打开或调用本人资料接口；资料弹窗关闭、退出或账号切换时清理临时编辑状态。
