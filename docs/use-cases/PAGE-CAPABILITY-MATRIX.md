# 当前页面能力矩阵

## 范围与判定规则

本矩阵登记当前 `frontend/src/target/router/index.ts` 的带 `meta.title` 正式路由及其页面用例。#380 已删除被替代资源页的静态路由、菜单模板与专属用例；资源页面统一由动态 Resource Host 承载，Registry 的当前登记见[当前页面状态](FRONTEND-RESTORATION-STATUS.md)。历史基线、先前测试和已移除页面不是当前实现证据。

- 正式路由与组件以当前 `frontend/src/target/router/index.ts` 的登记和导入为准；页面用例由 `meta.useCaseKey` 指向，并由生成的 `COVERAGE.md` 交叉核对。
- Resource Host 的存在不表示任一资源页面已实现。只有 Registry 明确登记的资源才有相应页面实现；当前登记以 Registry 为准；其中 `rpt/:code` 按受约束报表编码装配专用查询/导出页，ACC 当前映射与 BOB 档案使用各自页面。
- 保留的 API、领域规则、数据与精确鉴权不等于可用资源页面，不能拿历史 E2E 或被替代路由充当当前页面证据。

| 路由               | 当前组件             | 用例                  | 当前能力                                                                                                    |
| ------------------ | -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/signin`          | `SignIn.vue`         | `app/signin`          | 公开登录                                                                                                    |
| `/change-password` | `ChangePassword.vue` | `app/change-password` | 强制改密受限会话                                                                                            |
| `/:domain/:entity` | `ResourceHost.vue`   | `app/navigation`      | 从 Session `apiPaths` 装配入口；已登记资源进入对应页面；RPT 使用专用查询/导出页，其他未登记资源显示尚未实现 |
| `/forbidden`       | `Forbidden.vue`      | `app/forbidden`       | 无资源直达的反馈                                                                                            |
| `/:pathMatch(.*)*` | `NotFound.vue`       | `app/not-found`       | 未知地址反馈                                                                                                |

## 已移除的资源页

`/home/dashboard`、`/app/{user,role,permission,system-parameter,menu}`、各 DCL、ACC、AUX、VOU、WFL 和 RPT 的静态资源页均不再是当前页面。当前业务 API 与领域规则由各自 `docs/domains/` 和可执行 Hono/Zod 路由拥有；现有 Host 登记见[当前页面状态](FRONTEND-RESTORATION-STATUS.md)，旧 DCL API 已删除。被替代页面和先前浏览器证据不代表当前界面。
