# WFL 后端流程域

## 1. 领域边界

WFL（Workflow）负责跨多张 VOU 原子单据的流程编排。首个流程类型为
`INTERMEDIARY_TRADE`，定义版本为 `1`，固定包含客户订单、采购、收货、送货和签收五个阶段。
流程定义由代码注册，数据库只保存流程实例、阶段单据关联和追加式审计，不提供动态 BPM 配置。

WFL 是受管单据的唯一写入口。VOU 继续负责单据编号、乐观锁、BOB 快照、附件、单据审计和事务内事件；
LED 只消费 VOU 原子单据完成及反向事件。WFL、VOU、LED 使用同一个 `pgx.Tx`，任一环节失败整体回滚。

## 2. 原子单据和关系

流程使用五类独立 VOU 单据：

| 阶段 | VOU 实体 | 编号 |
| --- | --- | --- |
| 客户订单 | `customer-order` | `CO-YYYYMMDD-######` |
| 采购 | `procurement-order` | `PRO-YYYYMMDD-######` |
| 收货 | `goods-receipt` | `GR-YYYYMMDD-######` |
| 送货 | `delivery-note` | `DN-YYYYMMDD-######` |
| 签收 | `signoff-note` | `SN-YYYYMMDD-######` |

所有受管单据的 `controlDomain` 为 `WFL`。`parentDocumentId` 是服务端只读属性：

```text
采购单 -> 客户订单
收货单 -> 采购单
送货单 -> 客户订单
签收单 -> 送货单
```

底层 VOU 状态使用 `DRAFT -> REVIEWED -> APPROVED`。WFL 将 `REVIEWED` 显示为 `CHECKED`，
并将各阶段 `APPROVED` 分别显示为 `APPROVED/ORDERED/CONFIRMED/EXECUTED/CONFIRMED`。
最终动作操作者不得等于单据 `reviewedBy`。

## 3. 流程规则

流程状态为：

```text
DRAFT -> CHECKED -> APPROVED -> COMPLETED
                         \-> SHORT_CLOSE_REQUESTED -> SHORT_CLOSED
```

- 一个流程只能有一张有效采购单，收货、送货和签收可多张。
- 采购数量不得超过客户订购量；正数采购行必须填写采购价。
- 累计确认收货不得超过已下单采购量。
- 某日可送量为该日及之前确认收货减已执行送货加已确认拒收。
- 签收满足 `签收 + 拒收 + 损耗 = 送货`，损耗由服务端计算；拒收恢复可送量，损耗不恢复。
- 全部订购量签收且无未完成单据时自动完成；不足时使用申请、确认双人短结。
- 反向动作逐级执行并要求原因；存在下游依赖、短结未撤销或数量时间线变负时拒绝。
- 采购、收货、送货和签收草稿可在无附件、无下游时物理删除，编号不复用；删除摘要永久保存在 WFL 审计。

空桶按送货行计算 `ceil(送货量 / 每桶产品量)`，分别汇总 `SOLVENT/RESIN`。签收登记实收桶数，
少收时原因必填。确认签收后空桶增量为应收减实收。

## 4. API

业务入口为 `POST /wfl/intermediary-trade/{action}`。基础动作：

| 动作 | 必填请求字段 | 说明 |
| --- | --- | --- |
| `query` | 无 | 可选 `page`、`pageSize`、`keyword`、`statuses`；分页默认 1/20、最大 100 |
| `get` | `processId` | 返回完整流程、授权后的单据正文和余额 |
| `create` | `data` | `data` 为客户订单草稿 |
| `save` | `processId`、`processRevision`、`documentId`、`documentRevision`、`data` | 只保存根客户订单草稿 |
| `audit-history` | `processId` | 可选 `page`、`pageSize`，默认 1/20、最大 100 |

根流程动作：

| 动作 | 必填请求字段 | `reason` |
| --- | --- | --- |
| `check`、`approve`、`short-close-confirm` | `processId`、`processRevision` | 不使用 |
| `uncheck`、`unapprove` | `processId`、`processRevision` | 必填 |
| `short-close-request`、`short-close-cancel`、`short-close-unconfirm` | `processId`、`processRevision` | 必填 |

阶段动作矩阵：

| 阶段 | 查看 | 创建/保存/删除 | 核对/反核对 | 最终动作/反向动作 |
| --- | --- | --- | --- | --- |
| 采购 | `procurement-get` | `procurement-create`、`procurement-save`、`procurement-delete` | `procurement-check`、`procurement-uncheck` | `procurement-place`、`procurement-unplace` |
| 收货 | `receipt-get` | `receipt-create`、`receipt-save`、`receipt-delete` | `receipt-check`、`receipt-uncheck` | `receipt-confirm`、`receipt-unconfirm` |
| 送货 | `delivery-get` | `delivery-create`、`delivery-save`、`delivery-delete` | `delivery-check`、`delivery-uncheck` | `delivery-execute`、`delivery-unexecute` |
| 签收 | `signoff-get` | `signoff-create`、`signoff-save`、`signoff-delete` | `signoff-check`、`signoff-uncheck` | `signoff-confirm`、`signoff-unconfirm` |

阶段动作字段规则：

- `*-get`：`processId`、`documentId`；
- `*-create`：`processId`、`processRevision`、对应阶段 `data`；
- `*-save`：在 create 字段上增加 `documentId`、`documentRevision`；
- `*-delete`、`*-uncheck` 和全部最终反向动作：`processId`、`processRevision`、`documentId`、
  `documentRevision`、1–1000 字的 `reason`；
- `*-check` 和正向最终动作：相同 ID/revision 字段，不使用 `data` 或 `reason`。

查询示例：

```json
{
  "page": 1,
  "pageSize": 20,
  "keyword": "CO-20260726",
  "statuses": ["DRAFT", "APPROVED"]
}
```

状态只允许 `DRAFT`、`CHECKED`、`APPROVED`、`COMPLETED`、`SHORT_CLOSE_REQUESTED`、
`SHORT_CLOSED`，同一状态不能重复。创建流程时只传客户订单草稿：

```json
{
  "data": {
    "businessDate": "2026-07-26",
    "currency": "CNY",
    "customer": {"objectId": "01J...", "versionId": "01J..."},
    "salesperson": {"objectId": "01J...", "versionId": "01J..."},
    "remark": "居间订单",
    "lines": [
      {
        "product": {"objectId": "01J...", "versionId": "01J..."},
        "orderedQuantity": "10.000000",
        "unitPrice": "30.00",
        "remark": "树脂"
      }
    ]
  }
}
```

阶段 create/save 的 `data` 按阶段固定。采购：

```json
{
  "supplier": {"objectId": "01J...", "versionId": "01J..."},
  "purchaser": {"objectId": "01J...", "versionId": "01J..."},
  "businessDate": "2026-07-27",
  "lines": [
    {"sourceLineId": "01J...", "quantity": "10.000000", "unitPrice": "20.00", "remark": "采购"}
  ],
  "remark": "向供应商下单"
}
```

收货只使用 `businessDate`、`lines[{sourceLineId,quantity,remark}]` 和 `remark`。送货在相同行结构外
要求 `platform`、`vehicle`。签收数据为：

```json
{
  "businessDate": "2026-07-29",
  "lines": [
    {
      "sourceLineId": "01J...",
      "signedQuantity": "9.000000",
      "rejectedQuantity": "1.000000",
      "remark": "拒收一件"
    }
  ],
  "returnedSolventContainers": 0,
  "returnedResinContainers": 8,
  "containerDifferenceReason": "客户少还一桶",
  "remark": "签收完成"
}
```

公共写入成功返回流程 revision、流程状态和本次单据信息：

```json
{
  "processId": "01J...",
  "processRevision": 6,
  "workflowStatus": "APPROVED",
  "documentId": "01J...",
  "documentNo": "PRO-20260727-000001",
  "documentRevision": 2,
  "documentStatus": "CHECKED",
  "parentDocumentId": "01J...",
  "balances": {
    "lines": [],
    "solventContainers": 0,
    "resinContainers": 0,
    "hasUnfinishedDocuments": true
  }
}
```

流程单据摘要统一返回 `currency`；授权后的单据正文 `data` 统一返回单据级 `remark`，空备注返回空字符串，
使五类草稿都能按读取值安全回写。采购正文、采购备注和采购价只对拥有 `procurement-get` 权限的用户返回。
附件继续使用 VOU 文件字节流令牌端点。每个采购、收货、送货和签收阶段都提供
`{stage}-attachment-initiate`、`{stage}-attachment-download`、`{stage}-attachment-remove`：

- initiate 要求流程与单据 ID/revision，以及 `fileName`、`contentType`、`size`、`sha256`；
- download 要求 `processId`、`documentId`、`fileId`；
- remove 要求流程与单据 ID/revision 以及 `fileId`；
- initiate 返回流程/单据 revision、`fileId`、`uploadUrl`、`expiresAt`；download 返回
  `downloadUrl`、`expiresAt`；remove 返回更新后的单据 revision 和状态。

## 5. 审计与验收

每个原子单据保存 VOU 审计，流程同时保存 WFL 审计。物理删除阶段草稿时删除其 VOU 审计，
但 WFL 删除事件必须保存单据 ID、单号、阶段、操作者、request ID 和摘要。

验收覆盖完整五阶段、多批与并发数量、双人控制、短结、全部反向阻断、附件、LED 正反向流水、
旧 V1 单据兼容以及迁移、生成、测试、vet、build、race 和 Compose 健康检查。
