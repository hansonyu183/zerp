# DCL 申报控制领域

## 1. 领域职责

DCL（Declaration Control）当前拥有 `rpt-definition` 与 `wfl-process-definition` 的稳定 subject、business code 与强类型 Submission snapshot：用户在本地 Draft 编辑，DCL 在 submit 时创建或删除开放 Submission，并读取版本历史和审计；中央 Approval 唯一拥有版本号、`PENDING | APPROVED | REJECTED`、revision、审批元数据和审批事件。Customer、Product、Supplier、Other Unit 与 Sales Partner 已迁入 BOB，DCL 不再注册它们的 subject、版本、资料或 HTTP 入口。Party 与独立 `customer-subunit` subject 不存在；客户子单位是 Customer Version 内的强类型子项。会计映射已回归 ACC 当前配置；报表定义和流程定义的既有领域边界不变。

### 1.1 本地 Draft 与 Submission 生命周期

当前 DCL 聚合采用同一生命周期：浏览器只在当前页面实例内保留临时输入、引用显示快照和未提交附件，不持久化草稿。确定提交失败保留当前输入；关闭、刷新、切换资源或账号后销毁，不恢复。克隆仅预填新临时表单，不请求业务写入，也不属于 Approval。WFL Process Definition 的领域特有规则见下文。

只有 `POST /dcl/{entity}/submit-new` 与 `POST /dcl/{entity}/submit-change`（可执行 Hono/Zod 目标路由）会为 DCL 当前实体在服务器事务中创建 Submission、版本 payload 和必要 stable subject。请求必须带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision`；服务端锁内重新读取历史和当前事实、权限及引用后决定这是 V1 还是最高已批准版本之后的 Vn，并拒绝与事实不符的 submit mode、过期 expected 值、重复开放候选或重复标识。浏览器规范化和决定只作提示，不能替代服务端复核。

Submission 一旦持久化即不可编辑，唯一状态是 `PENDING | APPROVED | REJECTED`。有效动作只有 `approve`、`reject`、`unreject`、`unapprove` 和开放 Submission `delete`；“撤回”只是页面对 `delete` 的编排，不产生 `WITHDRAWN`、`REVOKED` 或 `unsubmit`。`reject` 和 `unapprove` 要求非空 reason，`unreject` 将 `REJECTED` 恢复为 `PENDING`，`unapprove` 在领域补偿或 blocker 检查通过后将 `APPROVED` 恢复为 `PENDING`，删除只允许开放 `PENDING`/`REJECTED` Submission。每次动作携带 expected revision 并递增 revision；提交人不得自审。

当前有效态永远由最高 `APPROVED` 版本推导，不保存 current pointer。开放候选与当前态并存：`PENDING` 或 `REJECTED` 不会取代当前态，批准后自然切换，反批准最高版本后自然回落到上一最高批准版本，无批准版本时为空。路由、响应和权限目录从 Hono route metadata 生成。

`dcl_subjects` 是 DCL 当前版本化业务对象的通用稳定身份，最小保存不可变 ID、entity、nullable code、createdAt 与 createdBy；非空 `(entity, upper(code))` 唯一。只有 ACC Mapping 是合法的无编码 subject。RPT 与 WFL 编码规则不变。DCL 不复制 Approval 版本头，不保存 current pointer 或第二套 revision，也不提供 BOB 写入别名、双写、过渡视图或失败回退。

## 2. 经营主体与员工的归属

经营主体与员工归 [AUX 直接维护](aux.md#39-经营主体与员工)，不注册 DCL 路由、提交、审批或业务版本写入。迁移保留的旧 subject、版本与 Approval 仅为历史证据，不作为 current 或新引用来源。

## 3. 版本与当前读取

版本语义完全复用 [Approval Version](approval.md#6-approval-version)：

1. V1 的本地 Draft 或 `PENDING`/`REJECTED` Submission 没有 当前有效资料，不能被交易引用；
2. V1 批准后，领域当前读取直接连接 DCL subject、highest APPROVED Approval Entry 与对应 typed snapshot 读取；
3. V2 为 `PENDING` 或 `REJECTED` 时，当前查询仍读取 V1；
4. V2 批准后，领域下一次读取自然选择 V2，不执行额外 current 写入；
5. 反批准 V2 后，当前读取自然回到仍为 `APPROVED` 的 V1；
6. 反批准 V1 后，没有正式版本，领域查询自然不可见，但稳定 DCL subject、编码和审批历史保留。

`approval_entries.version_no` 是唯一版本号，`approval_entries.revision` 是唯一并发 revision。领域 response 的 `sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自查询选中的 Approval Entry，不持久化第二份来源指针。

## 3.1 仓库

仓库直接维护及业务约束归 [AUX](aux.md#310-仓库资金账户与车辆)。DCL 不提供仓库入口、审批或新写入；必要旧版本仅作为历史证据。

## 3.2 车辆

车辆直接维护及承运归属归 [AUX](aux.md#310-仓库资金账户与车辆)。DCL 不提供车辆入口、审批或新写入。

## 3.3 资金账户

资金账户直接维护及账号唯一性归 [AUX](aux.md#310-仓库资金账户与车辆)。DCL 不提供资金账户入口、审批或新写入。

## 3.4 产品资料

产品归属 BOB，规则见 [BOB 产品](bob.md#33-产品版本与独立启停)。DCL 不注册产品 subject、版本或维护入口。

## 3.5 强类型业务身份

客户、供应商、其他单位与销售合作方的身份资料及类型内唯一性归 [BOB](bob.md#3-聚合模型)，不共享 Party。

## 3.6 员工

员工由 [AUX 直接维护](aux.md#39-经营主体与员工)。其他申报通过 stable ID 采用任职与身份的 typed snapshot，已保存的快照不回查 current。任职主体不限制其他主体单据选择员工。

## 3.6.1 客户与客户子单位申报

客户及全部子单位归 [BOB Customer 聚合](bob.md#34-客户与客户子单位)。DCL 不注册客户 subject、版本、附件或维护入口。

## 3.7 会计映射归属

会计映射由 [ACC 当前记账映射](acc.md#7-当前记账映射) 直接维护，不属于 DCL Submission 或 Approval Version。DCL 不注册映射维护、审批、版本或权限入口。历史批准、审计和记账来源仅保留为只读证据，不能成为当前配置的回退来源。

## 3.8 报表定义申报

报表定义的 stable subject 是 DCL 的 `(definitionId, code)`；`submit-new` 时由服务端按 `rpt-NNNNNN` 分配 `code`，提交审计与 code 永久冻结在 `dcl_subjects`。`dcl_rpt_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 `name`、`description`、`enabled`、`sql_text`、`parameters` 和 `columns`；所有可变字段随候选版本冻结。RPT 以 `rpt_definition_validities(approvalEntryId)` 保存 `VALID | INVALID` 及其技术失效审计，独立于 Approval 状态；`APPROVED + INVALID` 合法但不可执行。不存在 RPT root、root revision 或 current pointer。

`/dcl/rpt-definition/*` 是报表定义唯一维护 HTTP 边界；`/rpt/directory` 和 `/rpt/{code}/query|export` 只提供当前有效定义的查询和执行，不在 RPT 内创建、保存或审批候选。

`submit-new`/`submit-change` 时必须发送 `enabled`；已持久化 Submission 不可编辑，已经 `APPROVED` 的定义必须从本地 Draft 提交下一 Submission。批准或反批准在同一事务内原子注册或停用 RPT 的 `query`/`export` 使用权限：首次批准时 RPT 与 APP 在同一事务注册该 code 的精确权限；新版本批准后切换使用权限到新 entry；反批准后回落到上一正式版本或停用。已执行报表的 runtime audit 继续保存原 `approvalEntryId`，定义后续改版不重解释历史运行。execution 只使用当前最新 `APPROVED + enabled + VALID` 定义，不回退旧版本或候选。

## 3.9 流程定义申报

流程定义的 stable subject 是 `dcl_subjects(entity=wfl-process-definition)`，唯一持有 stable ID、code、createdAt 与 createdBy。`wfl_definition_runtime_states` 以 `subjectId` 持有 `enabled`、`updatedAt` 与 `updatedBy`；`dcl_wfl_process_definition_versions`、`wfl_definition_instances` 与 `wfl_create_child_requests` 都以该 subjectId 归属同一身份。`dcl_wfl_process_definition_versions` 以 `approvalEntryId` 为主键，保存完整的 Starlark 脚本、诊断、编译图和试算证据；这些版本化字段随候选版本冻结，不直接修改 WFL 当前执行面。`enabled` 是 runtime state 上的独立开关，不属于 Approval Version snapshot；启停必须携带 latest APPROVED 的 `approvalEntryId` 与 `approvalRevision`，DCL 不保存第二套 subject revision。

本地 Draft submit 固定在同一事务依次创建带 code 的 DCL subject、runtime state、中央 Approval V1 `PENDING` Submission 与 typed version。

`/dcl/wfl-process-definition/*` 是流程定义唯一维护 HTTP 边界。WFL 只提供当前定义的 `query|get` 和流程实例/执行，不在 WFL 内创建、保存或审批候选。

批准或反批准在同一事务内原子创建、替换、回落或移除 WFL 当前定义。已被任一持久化 WFL 实例以精确 `approvalEntryId` 引用的版本不得反批准，不存在强制反批准或自动回落；该 stable subject 的下一候选仍允许创建和审批。新实例固定启动时 latest APPROVED 的 `approvalEntryId`，既有实例继续固定自己的 entry，定义后续改版不改写历史实例及其 code/name 快照。试算是 WFL 领域能力，由 DCL 维护流程在保存或提交前调用，接受已存在的 `{entity, documentId}`，以完整冻结的 VOU 副本和零写入 adapter 执行；保存后此前成功试算失效。

Starlark 脚本、编译图、试算零写入 adapter、类型化 `WorkflowActions`、实例树、动作幂等和运行审计仍由 WFL 领域拥有，不迁入通用 DCL 引擎。

## 3.10 Domain ViewModel 动作与刷新

DCL 可变 subject 的根级 `Dcl*ListItem` 与根级 `Dcl*View` 必须返回必填 `availableApprovalActions`，其元素只取公共 `ApprovalLifecycleAction` 闭集。服务端按该 subject、版本、权限和当前事实计算可用生命周期动作；Domain ViewModel 将这一服务端生命周期动作投影与本领域业务动作组合，页面不得从本地状态、权限或版本元数据推导、补齐或猜测生命周期动作。版本 View、版本 Summary 和 Approval metadata 不携带该字段。

任何业务或生命周期动作成功后，调用方重新读取受影响查询和已打开对象，再显示成功结果；动作失败也以服务端 `errorKey` 和当前返回状态为准。revision 冲突只触发重新读取，不自动重放原请求；blocker 仍由动作执行时的服务端检查，调用方不以预检结果推断可以绕过或不再检查 blocker。

## 3.11 Subject code 的 nullable 查询边界

`dcl_subjects.code` 在数据库和查询边界保持 nullable 事实。DCL、BOB、APP 和 RPT 查询直接读取该值；要求业务编码的 Go Domain consumer 必须在消费处拒绝缺失的 `Subject code`，返回应用数据不变量错误。消费方不得把 `NULL` 转为空字符串、占位编码或 `COALESCE` 结果，也不得静默过滤缺失 code 的 subject。ACC Mapping 是合法的无编码例外，支持该实体的消费方必须保留空值语义。

DCL 写入路径仍负责为要求编码的实体分配并校验业务编码，但不依赖数据库函数在读取时抛出业务异常；查询层只返回事实，缺失事实的拒绝属于对应 Go Domain consumer 的职责。

## 4. 原子性与引用

DCL application service 创建 PostgreSQL transaction，并在同一事务内调用中央 Approval、写入 DCL 类型化快照并同步发布强类型事件。任一 Approval subscriber 或领域内同步写入失败时，subject、entry、event 与 typed snapshot 必须全部回滚。BOB 五类档案的聚合、引用及独立即时启停由 [BOB](bob.md) 拥有。

## 5. 权限

DCL 当前资源按各自 query、get、submit、review、versions、audit 与 delete 路径精确授权。查询权限不授予写入或审批资格。客户、产品、供应商、其他单位与销售合作方的权限随归属转入 BOB，不保留 DCL 许可或入口。

## 6. 验收边界

真实 PostgreSQL 验收必须覆盖最高已批准版本的切换与回落、同一 subject 唯一开放 Submission、submit 幂等、旧 revision 冲突及 subscriber 失败整笔回滚。报表定义与流程定义还需覆盖各自执行面、精确引用和权限的同事务规则。客户与全部子单位的完整验收归 [BOB 客户管理](../use-cases/bob/customer-management.md)。
