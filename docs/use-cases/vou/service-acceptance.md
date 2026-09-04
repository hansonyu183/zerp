# 履约验收用例

## 范围

- 路由：`/vou/service-acceptance`。
- 可验收合同、履约事实、结算方向和 ACC 结果以 [VOU 领域](../../domains/vou.md#314-服务合同与履约验收) 为准；#366 前当前 live 线协议以 [OpenAPI](../../../contracts/openapi/openapi.yaml) 及 [VOU Schema](../../../contracts/openapi/schemas/vou.yaml) 为准，下文的本地 Draft、Submission 与 `submit-*` 描述由 Hono/Zod 路由生成的隔离 target。

## 列表与编辑

1. 页面初次进入及用户明确提交筛选后查询，固定每页 20 条；列表按稳定业务顺序展示单号、合同、相对方、日期、金额和状态。
2. 新建只查询当前已批准的 Other Unit 合同。选择合同后展示只读合同及相对方快照，用户录入履约和验收事实。
3. 新验收只在浏览器 IndexedDB 本地 Draft 中保存；首次提交调用目标 Hono `submit-new`，从开放 Submission 克隆改正后调用 `submit-change`，审批动作使用最新 revision。失败保留输入并显示业务错误与 `requestId`，成功后删除本地 Draft 并重新读取服务端详情。列表和详情只展示服务端返回的 `availableApprovalActions`。

## 验收场景

1. 销售合作合同、未批准合同、已反批准合同和错误相对方类型不能流转验收。
2. submit 和审核时重新锁定合同状态和类型；Draft 建立后合同被反批准的验收不能成功提交或通过审核。
3. 验收批准形成带 Other Unit stable ID 维度的其他应付或其他应收事实；RPT 不回写 BOB 档案。
