# 居间订单 V2 前端契约

本文对应后端 PR #11 合并后的真实契约。新建居间订单固定发送
`workflowVersion: 2`；查询结果同时包含 V1 和 V2，历史 V1 单据继续进入原工作区。

## 根单

根单使用通用路径：

```text
query get create save approve unapprove
audit-history
attachment-initiate attachment-download attachment-remove
```

创建请求的版本号位于顶层，业务数据位于 `data`：

```json
{
  "workflowVersion": 2,
  "data": {
    "businessDate": "2026-07-25",
    "currency": "CNY",
    "customer": { "objectId": "...", "versionId": "..." },
    "salesperson": { "objectId": "...", "versionId": "..." },
    "productLines": []
  }
}
```

保存额外发送 `documentId`、`rootRevision` 和顶层 `workflowVersion: 2`。
根状态为：

```text
DRAFT -> CHECKED -> APPROVED -> COMPLETED
```

未完全履约时可执行：

```text
APPROVED -> SHORT_CLOSE_REQUESTED -> SHORT_CLOSED
```

核对使用 `check/uncheck`，短结使用 `short-close-*`。批准人与根核对人必须不同；
短结确认人与申请人必须不同。短结申请人不在 `get` 响应中，前端不伪造该字段，
同人确认冲突以后端响应及 requestId 为准。

## 子单

采购、收货、送货、签收分别使用以下动作：

```text
{stage}-create/get/save/delete/check/uncheck
procurement-place/unplace
receipt-confirm/unconfirm
delivery-execute/unexecute
signoff-confirm/unconfirm
```

子单写请求携带 `documentId/rootRevision/childId/childRevision`；创建时省略子单
字段。删除和全部反向动作要求 1–1000 字原因。子单最终操作人与本阶段核对人
必须不同。

真实子单业务字段为：

- 采购：`purchaseDate`，供应商、采购员，行 `rootLineId/quantity/unitPrice`；
- 收货：`receiptDate`，行 `rootLineId/quantity`；
- 送货：`deliveryDate`，物流平台、车辆，行 `rootLineId/quantity`；
- 签收：`deliveryChildId/signoffDate`，行签收数和拒收数，以及两类实还桶数。

损耗由后端计算，客户端不得发送 `lossQuantity`。子单详情响应固定为
`{ documentId, child, data, lines, balances, attachments }`。

## 余额、附件和权限

根详情返回 `data + children + balances + attachments`。数量余额使用后端字段
`procurementQuantity`、`confirmedReceiptQuantity`、
`availableToDeliverQuantity` 等；空桶余额由 `balances.containers` 提供，正数
表示客户欠桶，负数表示客户多还。

采购子单及采购余额受 `procurement-get` 权限脱敏。前端缺少权限时显示明确说明，
不得推断供应商、采购价格或采购数量。

根附件使用通用附件路径；子单附件使用：

```text
{stage}-attachment-initiate
{stage}-attachment-download
{stage}-attachment-remove
```

子单附件初始化和移除同时携带根、子 revision。草稿子单存在附件时必须先移除
附件才能删除。

## 查询限制

当前后端查询仅接受关键字、通用状态、业务日期和往来方对象 ID，不接受
`workflowVersion`、`workflowStatus`、`pendingStage` 或供应商名称过滤。前端
不得发送这些字段，也不在当前分页结果上制造错误的总数和分页。

VOU 响应不返回 LED 应收应付明细，因此工作区不展示虚构的
`financialPostings`；应收应付和空桶流水仍由后端在事务内完成。

## 验证门槛

Playwright 真实流程需要两套账号，以及当前有效的客户、普通供应商、员工、
溶剂桶产品、树脂桶产品、物流平台和匹配车辆。测试不得拦截 VOU 或 BOB 请求。
