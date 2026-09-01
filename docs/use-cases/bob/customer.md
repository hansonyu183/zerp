# 客户当前有效资料用例

## 页面范围

- 路由：`/bob/customer`
- 领域规则：[BOB 领域](../../domains/bob.md) 与 [DCL 客户申报](../../domains/dcl.md#361-客户与客户核算账户申报)

页面只读取 Customer 的 current approved 完整档案，包括客户身份、税务、汇款识别、默认经营主体和当前版本内全部客户核算账户。账户不是独立 BOB 页面。

## 查询与详情

1. 列表调用 Customer `query`，详情重新调用 Customer `get`；不从列表行拼装详情。
2. 详情按账户子表展示 code、名称、业务资料、启停状态和实时信用占用入口；全部账户共享同一个 `sourceApprovalEntryId`。
3. 页面不展示 open candidate、审批控件或独立账户维护动作；具有 DCL 权限时只提供进入 `/dcl/customer` 的深链。
4. 交易引用返回 `customerId + accountId + customerApprovalEntryId` 和必要快照；客户默认经营主体只用于预填，不过滤经营主体候选。

## 验收场景

1. Customer candidate 待审时继续读取上一 approved 客户及其账户集合，批准后整体切换。
2. BOB 不存在 Party、独立 Customer Account route、写请求、版本或审计弹窗。
3. 读取失败保留筛选和位置并显示 `requestId`，不得回退列表数据或旧账户接口。
