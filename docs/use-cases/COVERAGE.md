# 页面用例覆盖率

<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->

数据来源：[`frontend/src/target/router/index.ts`](../../frontend/src/target/router/index.ts) 的带标题路由，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。

统计口径：每个带 `meta.title` 的正式 target 路由必须声明 `meta.useCaseKey`；layout 与重定向不单独计数。

- 页面入口：22
- 已覆盖入口：22
- 已登记用例：22
- 缺少用例：0
- 孤儿用例：0

## APP

| 页面       | 路由                    | 来源                                                  | 状态                                |
| ---------- | ----------------------- | ----------------------------------------------------- | ----------------------------------- |
| 登录       | `/signin`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/signin.md)           |
| 修改密码   | `/change-password`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/change-password.md)  |
| 工作台     | `/home/dashboard`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/dashboard.md)        |
| 用户管理   | `/app/user`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/user.md)             |
| 角色管理   | `/app/role`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/role.md)             |
| 权限目录   | `/app/permission`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/permission.md)       |
| 系统参数   | `/app/system-parameter` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/system-parameter.md) |
| 菜单管理   | `/app/menu`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/menu.md)             |
| 无权访问   | `/forbidden`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/forbidden.md)        |
| 页面不存在 | `/:pathMatch(.*)*`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/not-found.md)        |

## AUX

| 页面     | 路由                       | 来源                                                  | 状态                                   |
| -------- | -------------------------- | ----------------------------------------------------- | -------------------------------------- |
| 产品分类 | `/aux/product-category`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/product-category.md)    |
| 产品类型 | `/aux/product-type`        | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/product-type.md)        |
| 员工分类 | `/aux/employee-category`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/employee-category.md)   |
| 部门     | `/aux/department`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/department.md)          |
| 岗位     | `/aux/position`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/position.md)            |
| 结算方式 | `/aux/settlement-method`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/settlement-method.md)   |
| 收款方式 | `/aux/payment-method`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/payment-method.md)      |
| 字典类型 | `/aux/dictionary-type`     | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/dictionary-type.md)     |
| 字典项   | `/aux/dictionary-item`     | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/dictionary-item.md)     |
| 计量单位 | `/aux/measurement-unit`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/measurement-unit.md)    |
| 收支类型 | `/aux/income-expense-type` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/income-expense-type.md) |
| 资产分类 | `/aux/asset-category`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/asset-category.md)      |
