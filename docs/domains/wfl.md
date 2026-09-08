# WFL 业务流程领域

## 1. 领域边界

WFL 是以 VOU 单据为节点的用户可管理流程引擎。VOU 独立负责单据正文、生命周期、附件、领域校验和审计；ACC 独立负责资金、库存和往来事实。WFL 拥有 Starlark 脚本与编译图领域能力、试算零写入 adapter、类型化 `WorkflowActions`、实际实例树、动作结果和运行审计；流程定义的稳定身份、临时编辑、Submission、审批、删除、版本历史和审计读取全部归 WFL，独立组合公共 Approval 与 Version 组件。WFL 不复制 VOU 正文或代理 VOU 正文权限。

临时编辑输入只属于当前页面，不使用 IndexedDB、localStorage 或服务端草稿；关闭、刷新、切换资源或账号即销毁。

销售定价 `sale-pricing`、采购询价 `purchase-inquiry` 和其他收入 `other-income` 不触发流程，也不能成为流程节点。

## 2. 定义与 Approval Version

Starlark 脚本是流程定义的唯一可编辑来源。`node` 声明稳定节点 key、名称和 VOU entity；`edge` 声明具名关系、分支条件和一个静态动作；`workflow` 声明稳定 code、名称、唯一根节点和可选启动条件。编译图只读展示；编译必须得到单根、单父、连通且无环的树，并拒绝重复 key、不兼容来源/目标动作和动态动作调用。

流程定义由 `wfl_definitions` 唯一持有 stable ID、code 与创建审计。WFL 以 `wfl_definition_runtime_states(subjectId, enabled, revision, updatedAt, updatedBy)` 保存独立运行开关。`/wfl/process-definition` 是唯一维护资源：`query/get` 读取当前最高已批准定义（包含停用项），`submission-query/submission-get` 读取提交，`versions` 读取完整历史，另有 submit、开放提交删除、审批、启停与审计动作。当前读取权限不推导提交读取权限；实例与执行继续使用 `process-instance` 的独立精确动作。不存在 DCL 流程入口或 BOB 流程资源。

WFL 在同一个领域事务中调用公共 Version 的提交准备、历史、最高已批准与开放提交检查，以及公共 Approval 的创建、转换、删除和审计持久化。提交按幂等键和包含操作者的请求摘要去重，冲突拒绝；未知结果只按本次精确操作事实核实，不自动重放。定义写入与新实例匹配串行读取当前定义；已存在的实例不重新匹配。

`workflow(code, name, root)` 中的 name 与成功编译图是唯一的版本化名称事实；每个脚本、名称、诊断和编译图属于一个中央 Approval Version Submission。`enabled` 是 stable definition 上独立的布尔开关，不是审批状态；不存在 publish、published revision、current revision、stable name 或任何 version pointer。前端只渲染 shared TypeScript model 的 View State，不另建状态、动作或文案推断。

脚本禁止 import、文件、网络、数据库、环境变量、附件内容、凭证、当前时间、随机数和直接持久化，并受脚本大小、节点数、边数及执行步数限制。试算是 WFL 领域能力，由浏览器临时编辑和服务器 submit/approve 共同调用；试算针对完整的临时输入或 Submission 事实，接受已存在的 `{entity, documentId}`，以完整冻结的 VOU 副本和零写入 adapter 执行；输入变更后此前成功试算失效。提交/批准前，目标 Submission 必须编译成功并完成至少一次成功真实单据试算。

enabled 只影响未来根单据匹配：启用要求存在 latest APPROVED entry，停用不修改 Approval entry 或既有实例。启用/停用由 WFL 执行，以独立 runtime revision 作 CAS，并验证调用者读取的 latest APPROVED entry 与 revision。相同状态拒绝，启停审计与开关更新同事务；批准、反批准与新版本都不能覆盖开关。

## 3. 静态动作边界

WFL 拥有最小、类型化的 `WorkflowActions` 接口，正式运行 adapter 和零写入试算 adapter 都实现 `expense_payment`、`purchase_inbound`、`sale_outbound`、`sale_delivery`、`sale_signoff` 和 `sale_return`。动作只接收来源引用和脚本计算的完整初始值；正式 adapter 复用 VOU Domain Service 的公共写入口，在当前写事务锁定并重读来源，由 VOU 重算业务快照、写入公共单据与 typed detail 并执行全部领域校验，不直接写 VOU 业务表。客户相对方 metadata 只接受 `customer-subunit`、稳定 `subunitId` 和精确 Customer Approval Entry，也不从多个启用子单位中推断。动作之间不互相调用，顺序仅由实例固定 entry 的脚本决定；不存在数据库动作目录、动态发现、反射或任意字符串分派。

订单批准只读取当日 ACC 可用净余额而不预留。采购入库或销售签收批准时，在同一 PostgreSQL 事务锁定往来方与币种、重算实际金额、读取最新 ACC 事实并写入 VOU/ACC 流水；结算规则属于 VOU/ACC，不由脚本替代。

## 4. 事件、实例与幂等

WFL 复用 VOU 的同步事务事件总线。根单据批准时允许零个或一个 `enabled` 且拥有 latest APPROVED entry 的定义匹配：零匹配正常批准且不创建实例，多匹配使整个批准失败。创建实例时必须保存该 latest APPROVED 的 `approvalEntryId`；实例及其节点之后只按这个 immutable entry 的脚本运行。定义后续 create-version、approve、unapprove 或 enabled 变更都不改写旧实例。

实例只记录实际节点、业务父级、具名关系、触发事件、动作和运行审计，不推导完成、当前节点、进度或短结状态。启动时从固定 entry 的编译图写入 definition code/name 快照；历史实例绝不追随新版本名称。每个动作有规范指纹；同一实例、来源节点和脚本位置只保留一个有效结果。反批准按 VOU 普通删除规则删除仍可删除的直属下级，任一下级不可删除则阻断整个反批准。删除根 VOU 只清除活动引用；历史节点、动作和审计保留。重新批准沿用原实例及其 `approvalEntryId`；已删除的自动结果可以在新的批准意图中由同一位置重建。

手工 `create-child` 接受实例、父节点、当前固定 entry 下满足条件的目标节点及 16–64 位 `requestKey`。写事务会重锁来源、重算条件并执行同一动作路径；同一 key 只能复用原意图和结果，旧结果删除后不能用旧 key 重建。

## 5. 普通种子、权限与页面边界

新环境由受控初始化提供费用、采购和销售三条普通 Starlark 定义；它们与管理员定义使用同一模型和路由元数据，无系统类型、保护位、隐藏 converter 或专用运行时。默认不启用，不创建实例或业务单据，删除/修改后也不会自动补回。

公开路径和数据结构由可执行 Hono/Zod 路由生成。定义管理、当前定义读取、提交读取和实例执行的精确权限由 APP route metadata 分别生成。停用保留既有角色关联，使已有实例仍可查询和运行。`/wfl/process-definition/*` 是定义维护与读取的 HTTP 边界；迁移保留旧授权对应的精确能力，普通目录同步不得在迁移前丢弃旧授权。WFL 结构不按节点 VOU 详情权限裁剪；打开正文和创建下级仍由相应 VOU/WFL 操作精确鉴权。流程定义页由当前 Registry 真实登记。

## 6. 验收边界

真实 PostgreSQL 验收覆盖 current 定义切换与回落、任一持久化实例精确 `approvalEntryId` blocker、新实例固定 latest APPROVED、既有实例继续固定原 entry、code/name 快照不变、回滚、历史审计身份保留、单/零/多匹配、六个动作、重试、反批准、删除、并发与任一失败全事务回滚。#361 的 WFL parity 门槛已由 [专项证据](../testing/wfl-starlark-parity-issue-361.md) 记录，并以同一完整 Starlark 语料验证 Node 与浏览器的编译、条件、初始值、资源上限和确定性结果。Hono 生成契约、客户端、API、前端、领域文档和 ADR 统一描述当前模型。

## 7. 迁移与验收

一次性转换保留 stable ID、code、全部 Approval Entry/版本/脚本/编译图、试算事实和审批事件，仅改变身份归属与精确权限路径；实例外键转向 WFL 身份，节点、动作指纹、结果和审计不重建。历史不完整或目标已存在时拒绝转换。不保留运行时兼容读取或别名。

状态闭集保持 `PENDING/APPROVED/REJECTED`（待批准/已批准/已驳回）；审批动作保持 `approve/reject/unreject/unapprove`（批准/驳回/恢复审核/反批准），启停为 `enable/disable`（启用/停用）。错误沿用公共审批、版本与 WFL 稳定 errorKey，页面用中文说明，blocker 保持结构化。版本反批准要求最高已批准、无开放提交且无精确实例引用。

验收覆盖临时编辑、编译试算、提交重试、审批职责分离、新旧版本、运行开关、新实例选择与旧实例继续执行，真实 VOU 下级写入、create-child 幂等、根单据重新批准、迁移及审计失败回滚。页面编排见[流程定义管理](../use-cases/wfl/process-definition.md)。
