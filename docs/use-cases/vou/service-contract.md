# 服务合同用例

## 范围

- 路由：`/vou/service-contract`。
- 合同相对方、结算快照、销售合作能力和生命周期规则以 [VOU 领域](../../domains/vou.md#314-服务合同与履约验收) 为准；#366 前当前 live 线协议以 [OpenAPI](../../../contracts/openapi/openapi.yaml) 及 [VOU Schema](../../../contracts/openapi/schemas/vou.yaml) 为准，下文的本地 Draft、Submission 与 `submit-*` 描述由 Hono/Zod 路由生成的隔离 target。

## 列表与编辑

1. 页面初次进入及用户明确提交筛选后查询，固定每页 20 条；关键词、状态和相对方筛选不在输入时自动请求。
2. 新建时互斥选择有效 Other Unit 或 Sales Partner，并选择当前有效 Employee。页面只提交强类型 stable ID；相对方和经办人资料采用 [VOU 服务合同规则](../../domains/vou.md#314-服务合同与履约验收)，不提交 `partyId`。
3. Other Unit 合同优先带入其默认结算方式；Sales Partner 合同填写覆盖能力和适用日期，不显示履约验收入口。
4. 新合同只在浏览器 IndexedDB 本地 Draft 中保存；首次提交调用目标 Hono `submit-new`，从开放 Submission 克隆改正后调用 `submit-change`。失败时保留表单及筛选并显示业务错误与 `requestId`；成功后删除本地 Draft，并使用服务端响应重新读取详情和列表。列表和详情只展示服务端返回的 `availableApprovalActions`。

## 验收场景

1. Customer、Supplier 和已失效档案不能作为此合同相对方。
2. 合同批准前重新校验相对方、Employee、结算快照及销售合作能力；Employee 任职经营主体不限制选择。
3. Other Unit 合同可进入履约验收；Sales Partner 合同只供居间收益自动匹配。
