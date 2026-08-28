# 客户申报用例

## 页面范围

- 路由：`/dcl/customer`
- 领域规则：[DCL 领域](../../domains/dcl.md) 与 [BOB 领域](../../domains/bob.md)

## 创建与维护

1. 创建以已有 `partyId` 或 `newParty` 二选一，加经营主体和默认账户完整资料发起；Party、客户关系 V1 草稿和默认账户 V1 草稿的原子边界按 [DCL 客户申报规则](../../domains/dcl.md#361-客户与客户结算子账户申报) 执行。
2. Party 或经营主体一旦绑定只读。关系候选只维护 `enabled` 与关系附件；默认账户随后由独立 `/dcl/customer-account` 页面维护。
3. 关系附件初始化与移除只对其 `DRAFT` ownerApprovalEntryId 携带 approvalRevision 执行；历史和已批准附件仅可下载。

## 生命周期与验收

1. 页面编排 `query|get|create|save|submit|unsubmit|reject|approve|unapprove|delete|versions|audit-history`，并按每个动作独立权限显示。
2. 关系 V2 不影响 BOB V1 current；批准切换、反批回落和 current 写失败都必须原子。
3. 正式销售事实 blocker 与历史 exact entry 回读按 [DCL 引用规则](../../domains/dcl.md#361-客户与客户结算子账户申报) 验收。
