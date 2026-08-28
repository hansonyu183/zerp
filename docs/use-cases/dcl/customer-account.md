# 客户结算子账户申报用例

## 页面范围

- 路由：`/dcl/customer-account`
- 领域规则：[DCL 领域](../../domains/dcl.md) 与 [BOB 领域](../../domains/bob.md)

## 创建与维护

1. 创建只传 `customerRelationshipId` 和完整 account input；经营主体由关系推导，页面不得重复传入或编辑它。
2. 保存始终提交顶层 `enabled` 与完整账户资料：名称、简称、客户类型、联系人、地址、结算、收款、运输、定价、信用额度、主要业务归属、内部提醒和默认订单备注。
3. 读取资料展示服务端解析并冻结的经营主体、结算方式、收款方式、主要业务归属 exact snapshot；来源对象改名、停用或换版不改写版本。
4. 账户附件通过 `/dcl/customer/attachment-*` 且 `scope=CUSTOMER_ACCOUNT` 操作，ownerApprovalEntryId 仍精确指向账户 version。

## 生命周期与验收

1. 页面编排该独立 subject 的全套 DCL 动作；账户 V2 draft/pending 不影响 BOB V1 current。
2. 账户 candidate 附件独立复制和只读，不能与关系附件混用。
3. 当前投影失败必须使 entry、账户 snapshot、附件变化和事件一并回滚；正式交易 exact 引用阻止反批，V1 历史 snapshot 在 V2 批准后仍可校验。
