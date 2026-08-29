---
id: ADR-0046
date: 2026-08-29
status: accepted
---

# DCL 是申报版本的唯一写入方

ZERP 的申报版本切换以 DCL 为唯一写入边界。中央 Approval 统一拥有版本头、状态迁移、revision、授权与审计；DCL 拥有 stable subject 及与每个 `approvalEntryId` 一一对应的不可变领域 payload。任何需要候选编辑、提交、撤回、驳回、批准、反批、候选删除、版本历史或审批审计的申报对象都只能通过 `/dcl/{entity}/{action}` 写入，不允许消费领域直接创建或改变 Approval Version。

AUX 固定为 Stable-ID Direct CRUD，不使用 Approval Version。BOB 只读取 DCL highest APPROVED typed snapshot 形成的当前有效业务资料，不保存 stable identity、current payload、候选、历史版本或审批状态机。ACC、RPT 与 WFL 只拥有各自当前解释、查询、试算或运行时能力；它们不拥有本地版本表、生命周期接口、审批写权限或版本事件。VOU 等交易领域仍可拥有自己的单据审批，但不得写入申报对象的版本。

切换后的权威结构不保留旧表、旧路由、旧权限、旧事件、旧错误语义、旧维护页面、双写、兼容读取或 fallback。生产代码、契约、生成物和 seed 中的旧入口必须删除；测试中只允许保留明确证明旧入口未注册、旧表不存在或旧协议不可用的墓碑断言。`backend/db/cutovers/` 可保存一次性原位切换记录，用于保留切换前已有身份与审计证据，但不得被运行时代码调用或形成兼容层；数据库 schema、OpenAPI 和领域文档只描述当前结构。

最终验收同时覆盖 OpenAPI lint/bundle 与前后端生成、sqlc 与 schema 校验、后端单元测试和真实 PostgreSQL 集成、前端类型检查/单元测试/构建、串行真实 E2E、文档检查及旧标识精确搜索。任一消费领域重新出现本地版本写入、候选生命周期或旧协议，即违反本 ADR。

## 切片验收记录

| 切片      | 最终写边界                                                              | 数据与契约证据                                                                                                                  | 运行与墓碑证据                                                                                             |
| --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| #278–#282 | 经营主体、仓库、车辆、资金账户、产品版本由 DCL 写入，BOB 只保留 current | 对应 `backend/db/cutovers/issue-278-*` 至 `issue-282-*` 一次性切换记录、DCL/BOB OpenAPI 与 `dcl_*_versions`                     | 各 DCL PostgreSQL lifecycle/current integration 与 BOB 旧写路由墓碑测试                                    |
| #283–#287 | Party、员工、供应、服务/销售合作、客户与客户账户版本由 DCL 写入         | `issue-283-*` 至 `issue-286-*` 切换记录；#287 以独立 DCL customer/customer-account payload 和 current source 约束收口           | 关系、客户、账户 PostgreSQL integration、schema identity 检查与 BOB current-only HTTP 测试                 |
| #288–#290 | BOB 最终 current-only；AUX 最终 Stable-ID Direct CRUD                   | `issue-289-*`、`issue-290-*` 一次性切换记录，AUX OpenAPI 与单表 current schema                                                  | AUX 无 Approval/Version/approvalEntryId/lifecycle 搜索与引用 blocker integration                           |
| #291      | ACC Mapping 版本由 DCL 写入，ACC 只读取当前解释                         | `issue-291-dcl-acc-mapping.sql`、DCL/ACC contract 与 `dcl_acc_mapping_versions`                                                 | 映射切换/回落/引用 blocker/rollback PostgreSQL integration 与 ACC 旧 lifecycle 墓碑                        |
| #292      | RPT Definition 版本由 DCL 写入，RPT 只执行当前 VALID 版本               | `issue-292-dcl-rpt-definition.sql`、DCL/RPT contract 与 `dcl_rpt_definition_versions`                                           | current 执行、INVALID 停止、回落/rollback integration 与 RPT 旧 lifecycle 墓碑                             |
| #293      | WFL Process Definition 版本由 DCL 写入，WFL 只读取当前定义并执行实例    | `issue-293-dcl-wfl-process-definition.sql`、DCL/WFL contract、`dcl_wfl_process_definition_versions` 与 stable identity 原位保留 | current 切换/回落、候选可见性、实例 pinning、任一持久化实例 blocker、rollback、公开试运行与旧 WFL 路由墓碑 |
| #294      | 全仓只有 DCL 写入 Approval Version                                      | OpenAPI 与 sqlc 重新生成无漂移；权威 schema 只包含 DCL 版本 payload                                                             | 后端单元/真实 PostgreSQL、前端 unit/build/E2E、文档/schema gate 与精确 tombstone 搜索共同验收              |
| #307      | 五类核心 typed master 的 stable identity 与 code 归 DCL                 | `dcl_subjects` 保存 ID/code；BOB 直接读取 latest APPROVED typed snapshot；五张 BOB current 表删除                               | 五类真实 PostgreSQL lifecycle/read/reference 与旧 identity/current writer 墓碑                             |

本 ADR 收束 [ADR-0032](0032-central-approval-persistence-and-lifecycle.md) 建立的中央 Approval 边界，以及 [ADR-0033](0033-dcl-operating-entity-declaration-and-bob-read-boundary.md) 至 [ADR-0045](0045-wfl-process-definition-declarations-are-dcl-owned.md) 的逐域切换。对应 GitHub [#293](https://github.com/hansonyu183/zerp/issues/293) 与 [#294](https://github.com/hansonyu183/zerp/issues/294)；父任务 [#276](https://github.com/hansonyu183/zerp/issues/276) 仍保持开放，不由本次终态验收关闭。
