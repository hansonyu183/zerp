---
id: ADR-0051
date: 2026-09-03
status: accepted
partially_supersedes: ADR-0004, ADR-0032, ADR-0045, ADR-0046, ADR-0047, ADR-0048
---

# 共享 TypeScript 模型、本地 Draft 与 Hono 一次性切换

## Decision

ZERP 的目标业务模型是同仓、纯 TypeScript 模块：它不依赖 Vue、Hono、Kysely、Node、浏览器存储、环境变量或外部 I/O。浏览器以缓存或刚读取的事实运行它来计算 View State、合法性、blocker、动作资格和强类型意图；Hono 服务重新认证、授权、读取并锁定当前 PostgreSQL 事实，在同一模型上得到唯一权威的领域 Result 与持久化 Plan。领域保留自己的强类型命令、事实、稳定错误与 Plan；不建立 metadata 驱动的通用业务引擎或网络中台。

Draft 与 Submission 是不同对象。Draft 只在已认证用户的当前浏览器 IndexedDB 中保存，支持多个草稿、刷新恢复、同设备用户隔离、克隆已持久化 Submission 与本地附件；它从不创建 Approval Entry 或永久业务附件。提交在一个服务器事务中规范化输入、重验当前引用和权限、分配服务器事实，并直接创建不可变的 `PENDING` Submission。提交失败保留本地 Draft；重复的相同提交意图必须幂等。

Approval 持久状态只有 `PENDING | APPROVED | REJECTED`。`approve` 使 `PENDING` 成为 `APPROVED`；`reject` 使 `PENDING` 成为 `REJECTED` 并要求原因；`unreject` 使 `REJECTED` 恢复 `PENDING` 并仅清除当前拒绝元数据；`unapprove` 使 `APPROVED` 恢复 `PENDING`，在同一事务撤销其业务效果并要求原因。开放 Submission 的删除是资源动作；界面“撤回”只编排该删除，不产生 `WITHDRAWN`。`DRAFT`、`WITHDRAWN`、`REVOKED` 和 `unsubmit` 均不是目标持久化状态或动作。拒绝的 Submission 不可编辑；改正先克隆为本地 Draft，再显式删除开放 Submission 并重新提交。

HTTP 目标契约由可执行 Hono/Zod 路由定义：内部客户端类型来自 Hono route type，目标 OpenAPI 由同一批路由生成。它不是手写 YAML，也不与 live YAML 合成。Hono route metadata 在隔离数据库副本中生成完整目标 APP 权限/菜单目录；该目录不与 live 目录合并。Kysely 的服务器数据库类型通过完整 SQL schema 建立的可丢弃数据库内省生成，且始终是服务器专用类型。

## Topology and cutover boundary

本 ADR 的目标路径在 #361–#365 仅运行于隔离、生产形态的拓扑：target frontend → generated Hono client → Hono → shared model → PostgreSQL copy。Hono 不暴露给生产、不代理 Go、不接收 Go 代理流量，也不与 Go 共享一个事务或共同写入一个 live 聚合。#366 前，完整 live Go API、live schema、handwritten OpenAPI、生成客户端和权限目录维持不变；它们不是本 ADR 的第二运行时，而是尚未切换的唯一线上栈。

Approval、DCL、VOU、ACC、WFL 与 RPT 必须作为一个事务连接的切换单元。切换前，具有服务端 `DRAFT` 的 live 条目必须由授权业务决定提交、删除或导出；不得自动迁入浏览器。旧审批审计作为只读档案保留，但不得扩展目标状态联合。#366 在写冻结下以经验证的数据库与附件备份、一次完整应用切换和旧体系删除完成；回滚恢复匹配备份与完整旧镜像，目标代码不实现旧 schema 的兼容读取、双读写、代理、别名或临时路由。

WFL 的 Starlark 语义不是本票可假定迁移的实现细节。#361 必须以完整现有有效/无效 Starlark 语料、编译图、条件、初始值、资源上限和确定性结果，对一个受维护的 Node/浏览器兼容运行时取得可复现的语义 parity 证据；未通过即为 #365/#366 的硬 blocker，必须先获得单独的 WFL DSL 规格，不得手写解释器或静默改变工作流语义。

## Superseded clauses

本 ADR 显式取代 ADR-0004、ADR-0032、ADR-0045、ADR-0046、ADR-0047 与 ADR-0048 中关于服务端 `DRAFT`、候选保存/删除、`unsubmit`、旧 Approval 动作资格、前端仅展示 Approval、Go/OpenAPI YAML 为长期目标契约来源的条款。那些 ADR 仍保留其未冲突的业务所有权、精确引用、事务原子性、职责分离和 WFL/VOU 业务规则；当前领域规则以本 ADR 与 `docs/domains/` 为准。
