# DCL 员工变更页面用例

权威规则见 [DCL 员工申报](../../domains/dcl.md#36-员工申报) 与 [Approval Version](../../domains/approval.md#6-approval-version)。

## 页面与边界

目标线 HTTP 由可执行 Hono/Zod 路由提供；#366 前 live Go/OpenAPI 不变且不与 target 组合。页面使用 `query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete` 路由。

本地 Draft 可在 IndexedDB 并存多个；只有 `submit-new`/`submit-change` 携带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision` 并由服务端创建 `PENDING` V1/Vn。开放候选与最高 `APPROVED` 当前态同时展示；状态动作仅为 `approve|reject|unreject|unapprove`，开放候选删除使用 `delete`。

1. `/dcl/employee` 是员工身份、雇佣资料、启停、审批、版本、审计和当前资料的唯一页面；目标 Hono 提供上述 DCL 路由，`/bob/employee/query|get|reference` 只供内部 current 读取，不注册页面或菜单。
2. 新建直接在 IndexedDB 本地 Draft 录入员工自己的个人身份、唯一法定识别号、姓名、人员类别、部门、岗位、工作联系、入职日期、任职经营主体、备注与 `enabled`，不选择或创建 Party；同一页面可并存多个 Draft。
3. 员工当前设置一个任职经营主体，但该字段不限制其他经营主体的订单、采购、费用或往来单据选择该员工；选择资格只由单据规则和 APP 权限决定。
4. “提交”发送完整 Employee snapshot 到 `submit-new` 或 `submit-change`，并携带 expected latest approved 标识；服务端依据历史决定 V1/Vn，创建 `PENDING`，失败保留本地 Draft。批准后只影响新业务，历史继续保存原 Employee stable ID、精确 Approval Entry 和快照。

## 操作与验收

1. 生命周期按钮只采用服务端 `availableApprovalActions`；动作文案区分“编辑草稿”“发起变更”“继续编辑草稿”和“查看”。
2. 法定识别号只在 Employee 类型内唯一；与 Customer、Supplier 等档案不比较、同步或合并。
3. 验收覆盖经营主体来源有效、跨经营主体单据仍可选择、V1/V2 current 切换与回落、正式引用 blocker 及事务回滚。
