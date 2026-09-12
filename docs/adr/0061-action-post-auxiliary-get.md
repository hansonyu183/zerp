---
id: ADR-0061
date: 2026-09-12
status: accepted
partially_supersedes: ADR-0052, ADR-0056
---

# POST 用户操作与 GET 辅助读取

## Decision

用户操作（包括正式查询、详情、试运行、版本和审计查看）使用 POST JSON，执行精确动作授权与 CSRF；辅助候选、回显和编辑目录使用所属实体的 GET，不增加 support 路径段。GET 复用 Session 认证与会话失效、停用、强制改密限制，不要求 CSRF、独立动作权限或替代 query/get 权限。保留领域已有账簿范围；不新增通用数据权限。

辅助 GET 不修改业务事实或用户设置，参数由 Hono/Zod 明确解析，不接受任意 JSON 查询对象。既有统一包络、稳定 errorKey 和中文反馈继续有效。目录无输入时使用严格空 query schema。

本决定部分替代 [ADR-0052](0052-session-dynamic-navigation-and-page-migration.md) 中将所有业务 API 视为授权路径的条款：Session apiPaths 保持字符串集合，仅代表授权操作及既有能力，辅助 GET 不进入该集合。导航仍按任一授权操作资源生成；菜单与直达共用资格，不与 Registry 求交，不增加 GET 清单或隐藏名单。保留其余 Session、领域归属与异步隔离规则，以及 [ADR-0060](0060-dynamic-page-runtime.md) 六类公共页面运行时约束。

同时部分替代 [ADR-0056](0056-acc-current-mapping.md) 中 catalog 精确授权条款，保留其当前配置、revision、账簿范围、保存校验及记账规则。

生成工具逐一对照实际 Hono method/path 与元数据，拒绝 GET 权限、普通 POST 漏权限、缺漏和重复元数据。超信用批准、客户子账户维护和流程子动作等既有能力继续登记，能力不得重新注册辅助路径。

## Explicit exceptions

| 入口                                                                                                                  | 用途与既有约束                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| POST /session/auth/signin                                                                                             | 匿名登录                                                               |
| POST /session/auth/restore                                                                                            | 恢复有效会话，无 CSRF                                                  |
| POST /session/auth/signout                                                                                            | 会话退出，保留 CSRF                                                    |
| POST /session/user/get                                                                                                | 本人资料，保留会话与 CSRF                                              |
| POST /session/user/save                                                                                               | 本人修改，保留会话与 CSRF                                              |
| POST /session/user/change-password                                                                                    | 本人改密，保留会话与 CSRF                                              |
| POST /session/app/get                                                                                                 | 匿名非敏感品牌展示                                                     |
| POST /app/workbench/query                                                                                             | 会话级工作台，按既有动作授权聚合，保留 CSRF                            |
| GET /healthz、GET /readyz                                                                                             | 平台存活、就绪检查                                                     |
| OPTIONS（CORS middleware）                                                                                            | 浏览器预检，不是业务动作                                               |
| POST /bob/customer/attachment-stage、attachment-read、attachment-cleanup                                              | JSON 暂存、授权读取和清理，保留精确动作权限与 CSRF                     |
| POST /vou/{entity}/attachment-stage、attachment-read、attachment-cleanup                                              | 按实际单据实体校验已登记能力和 CSRF                                    |
| GET /vou/attachment-download/{token}                                                                                  | 使用授权读取动作签发的一次性短期下载凭据，文件传输例外，不属于候选 GET |
| POST /vou/intermediary-calculation/source、script-get、script-save                                                    | 服务按同名既有能力精确授权，不是辅助读取                               |
| POST /vou/inventory-count/book-balance                                                                                | 用户主动读取账面，服务按同名能力授权                                   |
| POST /vou/source-line/query                                                                                           | 后续 #428 迁移；当前保留同名能力授权                                   |
| POST /vou/{entity}/query、get、audit-history、submit-new、submit-change、approve、reject、unreject、unapprove、delete | 动态路由按实际实体和动作执行既有能力授权                               |
| POST /wfl/process-instance/action                                                                                     | 按具体流程子动作能力授权                                               |
| POST /rpt/directory/query                                                                                             | 按现有报表访问权限过滤目录，无独立目录权限                             |
| POST /rpt/{code}/query、export                                                                                        | 按已发布报表编码的精确动作权限授权                                     |
| POST /rpt/{code}/reference-query                                                                                      | 后续 #428 迁移，当前沿用既有报表查询权限与参数约束                     |

APP 不整体豁免。其他文件读取入口以实际路由盘点为准，不将传输方式推导成授权豁免。

## Delivery

#425 在隔离集成分支按 #426、#427、#428 依次完成，每片直接删除其替代的旧入口，最终统一发布。#426 仅迁移 ACC mapping catalog；其余仍存续接口不属于新增兼容层。全量路由与消费者范围见[迁移盘点](../testing/auxiliary-read-migration-matrix.md)。
