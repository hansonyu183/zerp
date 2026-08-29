# 客户结算子账户当前有效资料用例

## 页面范围

- 路由：`/bob/customer-account`
- 领域规则：[BOB 领域](../../domains/bob.md) 与 [DCL 领域](../../domains/dcl.md)

页面只读当前有效的账户资料。它只调用 `query|get|reference`，不会读取 DCL candidate，也不提供创建、保存、审批、删除或附件写入。

## 查询与详情

1. 列表展示账户编码、名称、客户关系、经营主体、客户类型、启停状态和 current 来源 Approval Entry。
2. 详情展示账户完整当前业务 snapshot，包括经营主体、结算方式、收款方式和主要业务归属的精确来源；信用额度实时占用仍由 ACC 返回。
3. 行操作只提供查看、交易引用和按权限进入 `/dcl/customer-account` 的申报深链。

## 验收场景

1. V2 草稿或待审时，BOB 仍读取 V1 current；V2 批准后才切换。
2. BOB 响应不包含 `openVersion`、候选附件或候选生命周期数据。
3. 历史销售事实以精确 DCL Approval Entry 校验，不能被 current 切换改写。
