# DCL 人员变更页面用例

权威业务规则见 [DCL 员工申报](../../domains/dcl.md#36-员工申报)、[AUX 人员类别、部门与岗位](../../domains/aux.md#32-人员类别部门与岗位) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 页面与边界

1. 页面入口为 `/dcl/employee`，是员工新建、编辑、启停、提交、撤回、驳回、批准、反批、删除、版本与审计的唯一维护入口；工作台、审批待办和审批记录深链均进入本页。
2. 列表调用 `POST /dcl/employee/query`，详情、历史和审计分别调用 `get`、`versions`、`audit-history`；每个动作检查精确 `/dcl/employee/*` 权限。
3. 页面不调用 BOB employee 写路径；`/bob/employee` 仅浏览 current approved 档案或供其他页面引用。

## 新建、保存与启停申请

1. 新建选择已有 Party，或录入 `newParty`；员工 V1 的 `enabled` 默认 `true`。页面不创建裸 Party，也不提供 `employment` 路径或别名。
2. 保存页面按 [DCL 员工申报](../../domains/dcl.md#36-员工申报) 提交完整 `data` 与 `enabled`；Party identity 或姓名不进入 employee data。
3. 人员类别、部门、岗位与经营主体使用“编码 · 名称”的 current 候选项，页面只提交 stable ID；服务端解析并保留精确来源证据。保存后重新读取服务端完整 candidate。
4. 启用和停用都通过 `POST /dcl/employee/save` 保存完整 candidate；页面不调用 BOB `enable` 或 `disable`。

## 提交、批准、引用与历史

1. submit 和 approve 前要求关联 Party 已有 current approved 版本；页面将未获批 Party 显示为 blocker，后端独立复核。
2. 提交和批准时，服务端复核人员类别、部门、岗位与经营主体的已保存精确来源；来源漂移时保留 candidate 并返回稳定错误。
3. 批准和反批后的 BOB latest-approved 可见性、历史精确引用 blocker 与历史资料规则由 [DCL 员工申报](../../domains/dcl.md#36-员工申报) 统一定义。页面只展示结果，不自行迁移、清空或重建引用。
4. 保存或动作失败时保留输入、筛选和页面位置，显示稳定业务消息与 `requestId`。

## 验收场景

1. 员工所有维护请求只发送到 `/dcl/employee/*`；BOB current 页面没有写动作。
2. 真实 PostgreSQL 覆盖已有/new Party 创建、Party approval blocker、AUX stable-ID 快照不受 current 后续变化影响、经营主体来源漂移、V1/V2 current 切换与回落、精确引用 blocker 及事务回滚。
3. 历史 VOU/ACC 在员工后续改版、启停、反批或 Party 更新后仍保留原 stable ID、Approval Entry 与业务快照。

## 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与员工业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
