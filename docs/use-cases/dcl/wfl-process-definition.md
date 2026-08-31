# DCL 流程定义变更页面用例

权威业务规则见 [DCL 流程定义申报](../../domains/dcl.md#310-流程定义申报)、[WFL 定义与 Approval Version](../../domains/wfl.md#2-定义与-approval-version) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI](../../../contracts/openapi/openapi.yaml)，边界决定见 [ADR-0045](../../adr/0045-wfl-process-definition-declarations-are-dcl-owned.md) 与 [ADR-0046](../../adr/0046-dcl-is-the-only-approval-version-writer.md)。

## 1. 页面与权限边界

1. `/dcl/wfl-process-definition` 是流程定义唯一维护入口，覆盖新建、编辑、提交、撤回、驳回、批准、反批准、候选删除、版本历史、审批审计和启停。
2. 列表调用 `POST /dcl/wfl-process-definition/query`，区分 latest approved 与唯一 open candidate；打开详情时携带精确 `code` 与可选 `approvalEntryId`。
3. 生命周期动作只检查精确 `/dcl/wfl-process-definition/*` 权限；试运行保留为独立 WFL 领域能力并检查 `/wfl/process-definition/trial`。

## 2. 新建、保存与试运行

1. 新建提交完整 Starlark 脚本，创建顺序、原子性和身份归属遵循 [DCL 流程定义申报](../../domains/dcl.md#310-流程定义申报)；保存携带 `code`、`approvalEntryId`、当前 Approval revision 和完整脚本。
2. 页面展示该 entry 的脚本、诊断和冻结编译图。编译失败保留草稿及诊断，不覆盖上一份有效编译结果。
3. 管理员选择存在的 VOU entity 与 documentId 试运行当前 DRAFT；页面只展示匹配结果、计划动作和未覆盖分支，不读取或展示 VOU 正文。
4. 每次保存都会使此前试运行证明失效；提交和批准使用服务端返回的新 revision。

## 3. 审批、版本与启停

1. 页面按统一 Approval 动作显示 `submit|unsubmit|reject|approve|unapprove`，驳回与反批准要求非空原因。
2. 已批准版本通过 `create-next` 创建唯一候选；版本历史和审计分别调用 DCL `versions` 与 `audit-history`，历史详情始终显示当时冻结的脚本和编译图。
3. 只有存在 latest APPROVED 时才能启用；启停携带该 entry 的 `approvalEntryId` 与 `approvalRevision`，不改变版本 payload。
4. 批准、反批准和回落的原子性、实例钉住及 blocker 以领域规则为准，页面不推导当前版本或自动解除引用。

## 4. 异常分支

1. 编译失败、缺少有效试运行、试运行 revision 过期或根单据类型不匹配时，保留编辑上下文并展示稳定 `errorKey` 与 `requestId`。
2. Approval revision 冲突时重新读取服务端状态，不覆盖候选。
3. 任一持久化实例引用目标 `approvalEntryId` 时，反批准展示结构化实例 blocker，不提供强制反批准或自动迁移。
4. 非 DRAFT 保存或删除、非最新批准反批准、无已批准版本启用均由服务端拒绝。

## 5. WFL 当前页面协作

1. `/wfl/process-definition` 独立显示当前 latest APPROVED，只提供 `query|get`；维护按钮深链到 `/dcl/wfl-process-definition?code={code}`。
2. 两个页面使用独立 ViewModel、权限和路由；DCL 候选不得泄漏到 WFL 当前页面。

## 6. 验收场景

1. 所有维护与生命周期请求只发送到 `/dcl/wfl-process-definition/*`，仅试运行发送到 `/wfl/process-definition/trial`。
2. 真实 PostgreSQL 覆盖 V1/V2 当前切换与回落、候选存在时 WFL 当前仍可读、历史冻结图、试运行 revision、实例钉住和反批准 blocker。
3. 真实串行 E2E 覆盖编辑、试运行、提交、批准、启用、WFL 当前只读查询与维护深链，并继续跑通实例执行。

## 7. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与流程定义业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
