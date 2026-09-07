# 页面用例覆盖率

<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->

数据来源：[`frontend/src/target/router/index.ts`](../../frontend/src/target/router/index.ts) 的带标题路由、[动态资源登记](../../frontend/src/target/navigation/registry.ts) 的显式页面用例，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。

统计口径：每个带 `meta.title` 的正式 target 路由必须声明 `meta.useCaseKey`；动态 Resource Host 的已实现资源以 Registry 显式 `useCaseKey` 计入。layout 与重定向不单独计数。

- 页面入口：17
- 已覆盖入口：17
- 已登记用例：17
- 缺少用例：0
- 孤儿用例：0

## APP

| 页面       | 路由               | 来源                                                  | 状态                               |
| ---------- | ------------------ | ----------------------------------------------------- | ---------------------------------- |
| 登录       | `/signin`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/signin.md)          |
| 修改密码   | `/change-password` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/change-password.md) |
| 无权访问   | `/forbidden`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/forbidden.md)       |
| 业务功能   | `/:domain/:entity` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/navigation.md)      |
| 页面不存在 | `/:pathMatch(.*)*` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/not-found.md)       |

## VOU

| 页面               | 路由                  | 来源                                                         | 状态                              |
| ------------------ | --------------------- | ------------------------------------------------------------ | --------------------------------- |
| vou/sale-order     | `/vou/sale-order`     | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](vou/sale-order.md)     |
| vou/purchase-order | `/vou/purchase-order` | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](vou/purchase-order.md) |
| vou/:entity        | `/vou/:entity`        | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](vou/catalog.md)        |

## WFL

| 页面                   | 路由                      | 来源                                                         | 状态                                  |
| ---------------------- | ------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| wfl/process-instance   | `/wfl/process-instance`   | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](wfl/process-instance.md)   |
| wfl/process-definition | `/wfl/process-definition` | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](wfl/process-definition.md) |

## ACC

| 页面        | 路由           | 来源                                                         | 状态                                  |
| ----------- | -------------- | ------------------------------------------------------------ | ------------------------------------- |
| acc/mapping | `/acc/mapping` | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](acc/mapping-management.md) |

## BOB

| 页面              | 路由                 | 来源                                                         | 状态                                        |
| ----------------- | -------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| bob/customer      | `/bob/customer`      | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](bob/customer-management.md)      |
| bob/product       | `/bob/product`       | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](bob/product-management.md)       |
| bob/supplier      | `/bob/supplier`      | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](bob/supplier-management.md)      |
| bob/other-unit    | `/bob/other-unit`    | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](bob/other-unit-management.md)    |
| bob/sales-partner | `/bob/sales-partner` | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](bob/sales-partner-management.md) |

## RPT

| 页面      | 路由         | 来源                                                         | 状态                            |
| --------- | ------------ | ------------------------------------------------------------ | ------------------------------- |
| rpt/:code | `/rpt/:code` | [资源登记](../../frontend/src/target/navigation/registry.ts) | [已文档化](rpt/report-query.md) |
