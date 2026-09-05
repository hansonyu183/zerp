# 客户申报页面用例

## 范围

- 路由：`/dcl/customer`，由 `dcl/customer` 登记。
- Customer 聚合、子单位、附件和引用规则以 [DCL Customer 申报](../../domains/dcl.md#361-客户与客户子单位申报) 与 [BOB 领域边界](../../domains/bob.md#2-领域职责与边界) 为准。
- Customer 是唯一 Approval subject；不注册独立 `customer-subunit` 页面、生命周期或服务器 Draft。

## `DCL-CUSTOMER-01` 根资料与权限分离

1. 专属编辑器维护法定身份、名称、单一法定识别号、联系/开票资料、汇款识别档案、默认经营主体、启用状态与身份税务附件。
2. `submit-new` 必须同时具备 Customer 新建与 `/dcl/customer/save-subunits`；已有 Customer 的根资料变更只要求 `submit-change` 及其引用读取权限。
3. 无 `save-subunits` 时子单位区域只读；若请求实际改变完整 subunits 集合，服务端仍按 latest approved snapshot 比较并拒绝越权。

## `DCL-CUSTOMER-02` 完整子单位集合

1. 子单位随 Customer Version 完整保存稳定 ID、顺序 code、客户类型、结算/收款快照、运输政策、定价政策、逐币种信用额度、主销售归属、提醒、默认订单备注、业务附件与启用状态。
2. 已批准子单位不能物理删除；下一 candidate 只可停用或从完整集合移除。只有 `intent=NEW` 且仍为本地 Draft 的子单位显示物理删除动作。
3. 客户类型选择任一当前启用 `dictionary-item`；权威文档未定义固定 dictionary-type ID/code，页面和服务端不得臆造第二层类型身份。

## `DCL-CUSTOMER-03` 本地 Blob 与提交

1. PDF/JPEG/PNG 附件 Blob 与 Draft 一起保存在当前用户、当前浏览器的 IndexedDB；保存 Draft 不调用服务端 staging。
2. submit 时页面逐个调用 `/dcl/customer/attachment-stage`，仅在提交副本中加入 `stagingId`，再提交完整 Customer snapshot。
3. staging 或 submit 失败保留本地 Draft 与 Blob；成功后删除本次 Draft 及其 Blob。服务端引用与附件事务边界直接遵循 [DCL Customer 申报](../../domains/dcl.md#361-客户与客户子单位申报)。

## 验收

1. 页面不出现 Party、relationship、独立 customer-subunit、通用 JSON 编辑器、BOB direct CRUD 或服务器 DRAFT。
2. Model 与 PostgreSQL/HTTP 回读覆盖完整 typed policies、根/子单位权限、附件保留与入库、伪造引用展示字段被服务器事实覆盖、无效引用稳定拒绝。
