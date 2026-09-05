# 经营主体申报页面用例

## 范围

- 路由：`/dcl/operating-entity`，由 `dcl/operating-entity` 登记。
- 稳定主体、完整版本与生命周期以 [DCL 经营主体申报](../../domains/dcl.md#2-经营主体申报) 为准。

## `DCL-OPERATING-ENTITY-01` 查询与本地 Draft

1. 页面显式查询固定每页 20 个 subject，并在同一行呈现 latest approved 与 open candidate。
2. 用户可同时维护多个仅属于当前用户和浏览器的 Draft；编辑自动保存，提交前刷新最后一次保存。
3. 从最新正式版本克隆时建立 `CHANGE` Draft，保留 expected latest approved Submission 与 revision。

## `DCL-OPERATING-ENTITY-02` 提交与审批

1. 新增和变更分别调用 `submit-new`、`submit-change`，失败保留本地 Draft，成功只删除本次 Draft。
2. 审批按钮只来自 `availableApprovalActions`；驳回与反批准要求原因，开放 Submission 通过 `delete` 撤回。
3. 页面不提供服务器可编辑 DRAFT、`save`、`unsubmit` 或 BOB 维护动作。

## 验收

1. 刷新页面后本地 Draft 可恢复，不同用户不可见彼此 Draft。
2. 法定名称与简称都进入同一个不可变版本 snapshot；列表、详情与克隆不得从法定名称推导简称。
