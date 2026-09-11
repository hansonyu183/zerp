# #423 当前初始化与历史机制清理（2026-09-11）

接续 #422 的 `c9c2d8fc`，本票保持当前业务、HTTP wire 契约及页面行为。验证入口沿用 [#422](validation-cost-issue-422-2026-09-11.md) 的 `make e2e`，不增加 CI 分级或长期升级链。

## 删除范围

从 package scripts、CLI import、普通集成收集、Service 调用、SQL/FK 和当前消费者追踪，移除 AUX 人员/资产、BOB 档案/产品/客户、ACC 映射、RPT/WFL 定义及 VOU 期初九组转换命令、实现和专属测试；移除菜单结构清理、用户拼音回填及其专属实现和测试。BOB 分阶段权限保留 helper、AUX `importCurrent` 及其专属校验、WFL 普通生命周期测试中的历史 schema 重建 helper 同步删除。四组迁移测试、固定历史 schema/data 基线及单独 runner 退役。

权限初始化只执行当前目录同步、ACC 单据类型目录同步及 Domain Service seed。目录同步按当前精确 path 保留 grant 和 permission status，保留动态 RPT query/export 目录，不自动授予新增权限；目录写入和有效授权校验仍在同一事务内。Service 方法改名为 `syncPermissionCatalog`，不再接受历史路径转换参数。

当前 schema 删除 `dcl_warehouse_idempotency`、`dcl_warehouse_reference_facts`、`dcl_warehouse_usage_facts` 及专属索引。它们没有当前业务读取或 FK 消费者，只由退役迁移夹具及清理代码访问；AUX 仓库 blocker 继续读取 ACC 库存、VOU 待处理单据和有效引用事实。对应无效 fixture 写入与清理一并移除。`make generate` 从空库重新生成 Kysely 类型；OpenAPI 与权限目录无变化。

## 必要保留事实

| 结构                                                                                                                                                    | 保留用途                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `dcl_subjects`、`dcl_employee_versions`、`dcl_operating_entity_versions`、`dcl_warehouse_versions`、`dcl_vehicle_versions`、`dcl_fund_account_versions` | 保存既有身份、编码和逐 Approval Entry 的原始人员/资产内容；与 Approval 审批及审计事实共同保留原解释，不作为当前 AUX 读取或写入入口。 |
| `bob_legacy_enablement_evidence`                                                                                                                        | 保存历史提交时的 enabled，不替代 BOB Subject 当前启用事实。                                                                          |
| `acc_mapping_history`、`acc_mapping_legacy_reference_facts`                                                                                             | 保存原会计映射内容与已采用该版本的单据证据，不参与当前映射选择。                                                                     |
| `rpt_definition_history`、`rpt_definition_validity_history`                                                                                             | 保存报表定义及其技术验证历史；当前执行使用 RPT 当前定义。                                                                            |
| `approval_entries`、`approval_events`、BOB/WFL typed versions、VOU reference/product snapshots                                                          | 当前业务公开版本/审计读取、WFL 实例固定版本、VOU 已采用内容及幂等重试仍依赖的事实。                                                  |
| BOB/VOU 的可空历史 Approval 引用列、RPT execution audit 的 Approval 来源                                                                                | 保留已经保存的精确来源与运行审计，不把历史事实重新解释为当前资料。                                                                   |

本票只在独占可丢弃 Target 库重建，不访问或修改共享开发/内测数据及生产环境；没有对任何既有业务库执行 DROP/转换。当前基线保留上述历史证据结构，不能将删除迁移工具理解为允许丢弃它们。

## 文档与覆盖归属

删除 DCL 现行领域墓碑及失效转换手册，各领域仅描述当前规则和历史不可变边界；不改变 ADR-0058、ADR-0060 或 AUX Stable-ID Direct CRUD 的归属。根 README 保留八份领域规则与分类入口，运行手册经 operations/README 导航。文档检查器从根入口验证分层可达性，缺失路径或遗漏报告均失败，原锚点校验继续执行。

会计期初手册中的独占验收与共享服务故障背景移至[期初历史验收](vou-opening-validation-2026-09-08.md)，保留原日期及数量。#366 的执行与整体恢复记录移至 [历史切换记录](issue-366-cutover-record.md)，内容保持当时语义。退役手册的历史证据链接固定到本票基线提交；不再作为当前命令入口。补齐 #416/#417/#418 三份报告索引，原页面用例反链保持不变。逐份检查 testing 目录：短篇 #400/#401 仍有独占执行环境、失败语义和验收事实，保留；全量报告与复验记录分别保留原失败原因和复验结果。没有仅因未入索引删除报告，也不把日期快照改写为当前测试数量。

混合覆盖分别处理：AUX 两个当前持久化形状检查迁至 `aux-persistence.test.ts`；权限同步精确授权案例保留，并改用实际 Session 登录返回的 apiPaths 验证有效权限，覆盖禁用与重复同步；WFL ownership 保留固定旧版本、CAS、实例、动作重试和审计断言，仅去掉转换步骤。AUX 当前 CRUD/blocker、BOB 审批、VOU/ACC 原子事务与 RPT/WFL 历史读取继续进入原集成入口。

## 验证记录

- 文档分层导航回归先因缺少校验函数失败，实现后正常分层、未索引手册与失效链接三种行为通过。
- 权限同步真实 PostgreSQL 聚焦案例通过：登录实际 apiPaths 仅包含已授予的启用 path，连续两次同步不扩大权限、不激活禁用 grant，superadmin 不生成冗余逐项授权。
- 完整候选 `c633302e` 的 `make e2e` 退出 0，墙钟时间 **964.262 秒**。完整验收后仅补充本报告，不改变运行时代码。
- 格式、文档/生成物检查器 15 项、CI 配置与分类/汇总 15 项、生成物差异、全包类型、前端 lint、架构 8 项、API artifact/CLI 21 项、编排与实际收集 CLI 2 项均通过。
- model 单测 37 项、API 单测 66 项、前端纯单测 69 项、普通组件 171 项、真实 Vuetify 13 项通过。API 单测从 #422 的 85 项减为 66 项，删除 19 项转换专属行为；两个当前持久化形状检查保留。
- 真实 PostgreSQL **103 项全部通过，无跳过**；#422 的 113 项中 10 项转换专属案例退役，独立迁移 runner 的 6 项也不再收集。其余当前业务案例保持，混合用例按上文保留当前断言。
- WFL Node/browser 共享 corpus 均通过；通用浏览器 27 项、WFL 1 项、VOU catalog 2 项、VOU opening 2 项、VOU entry 66 项通过，加上 parity 共 **99 次浏览器案例执行**。五组业务浏览器测试保持独占数据库与串行执行。
- 从当前 schema 初始化得到 137 张表；初始化、目录同步、seed、服务启动与登录导航成功。运行前后生成物无漂移，HTTP OpenAPI 和权限目录与基线一致。
- 使用占位环境值执行 `compose.yaml + compose.production.yaml` 和 `compose.target.yaml` 的 `config --quiet` 均通过，不读取生产凭证或启动生产服务。

## 审查与资源回收

Standards 独立只读审查 0 项发现。Spec 审查发现会计期初手册内的独占历史验收段需要保留，已完整移入 testing 并复核；未解决发现 0。

最终回读 Target DB/API/Web 均 healthy，`/healthz`、`/readyz` 均 HTTP 200；随后显式执行 `make target-down`，确认 Target 容器、网络和卷均为零，18082、18083、55439 无监听。测试及浏览器 fixture 进程已退出，未留下临时服务。原有三个 `zerp-back` 容器仍运行且 healthy。未推送、未发布生产，也未对共享业务库执行转换。
