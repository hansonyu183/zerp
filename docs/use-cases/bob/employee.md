# BOB 员工当前有效资料页面用例

权威业务规则见 [DCL 员工申报](../../domains/dcl.md#36-员工申报)、[BOB 对象与引用规则](../../domains/bob.md#2-领域职责与边界) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 页面边界

1. 页面入口为 `/bob/employee`，只调用 `POST /bob/employee/query`、`POST /bob/employee/get` 与 `POST /bob/reference/query` 的 `employee` 候选查询；它展示 DCL 当前有效资料。
2. 列表与详情展示 Employee 自有身份、编码、任职经营主体、人员类别、部门、岗位、工作联系、入职日期、备注、启停状态、Stable ID 与 `sourceApprovalEntryId`。
3. 页面没有新建、编辑、启停、删除、提交、撤回、审核、反批准、驳回、版本或审计动作，不请求任何 BOB employee 写路径。维护深链统一进入 `/dcl/employee`。

## 可见性与异常

1. 加载列表、详情与引用候选分别要求 BOB `employee/query`、`employee/get` 与 `employee/reference` 权限；DCL 权限不会隐式授予当前有效资料读取权限。
2. DCL 候选待审、驳回或撤回期间，BOB 持续显示上一正式版本；批准后显示新 current，反批准后显示上一 approved version 或移除 current。
3. 页面不使用当前 AUX 或经营主体资料重写 Employee snapshot；任职经营主体不限制其他经营主体的业务单据选择该员工。
4. 请求失败时显示稳定业务消息与 `requestId`，并保留当前页面上下文。

## 验收场景

1. BOB employee 只开放 current `query/get/reference`，没有 create/save/enable/submit/unsubmit/reject/approve/unapprove/delete/versions/audit-history。
2. DCL V1/V2 批准与反批准切换或回落 current source；首版反批准后 BOB employee 不再可读或引用。
3. VOU/ACC 历史持续保留当时采用的 Employee stable ID、精确 Approval Entry 与业务快照，不因后续版本改变。
