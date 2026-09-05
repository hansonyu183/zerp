# 车辆申报页面用例

## 范围

- 路由：`/dcl/vehicle`，由 `dcl/vehicle` 登记。
- 车辆版本、承运归属与精确引用规则以 [DCL 车辆申报](../../domains/dcl.md#32-车辆申报) 为准。

## `DCL-VEHICLE-01` 查询与本地 Draft

1. 页面按关键字、审批状态和启用状态显式查询固定分页 subject，一行区分 current 与 candidate。
2. 本地 Draft 完整编辑车辆名称、车牌、车型、承运归属、VIN、发动机号、载重、散水能力、备注和启用状态。
3. 车型来自 AUX reference；`INTERNAL` 只选经营主体，`EXTERNAL` 只选其他单位，页面不允许手输 Approval Entry。

## `DCL-VEHICLE-02` 提交与生命周期

1. 提交失败保留 Draft；成功删除本次 Draft并刷新服务端列表。
2. 克隆只从最新正式版本建立 `CHANGE` Draft；引用漂移由 submit/approve 的服务端 blocker 拒绝。
3. 审批只使用服务端 `availableApprovalActions`，驳回与反批准要求原因。

## 验收

1. 页面不注册 `/bob/vehicle` 维护入口，不出现服务器 DRAFT、`save` 或 `unsubmit`。
2. 历史展示实际版本 snapshot，不回查当前承运资料改写旧事实。
