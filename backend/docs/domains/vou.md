# VOU 后端单据域

## 1. 领域边界

VOU（Voucher）负责销售、采购、资金及费用单据的制单、审核、批准、执行、反向流转、附件和审计。首批实体为：

```text
sale-order
purchase-order
intermediary-sale-order
receipt
payment
expense-reimbursement
other-income
```

WFL 管理的原子单据另包含 `customer-order`、`procurement-order`、`goods-receipt`、
`delivery-note` 和 `signoff-note`。它们复用 VOU 的编号、revision、引用快照、附件和审计，
但不开放普通 VOU 写入口；业务规则和流转统一由 WFL 编排。

业务 API 固定为 `POST /vou/{entity}/{action}`，使用 `application/json` 和统一响应包络。文件字节流是技术端点，使用短时令牌访问 `/files/attachments/*`。

VOU 自身不保存库存流水、资金余额、应收应付或往来核销数据。LED 领域同步消费已执行单据并在同一事务中生成库存、资金和往来流水；反执行必须同时生成 LED 反向流水，若会破坏严格库存约束则拒绝。

## 2. 通用契约

### 2.1 编号、金额和引用

单据号由服务端按类型和创建时业务日期生成：

```text
SO/PO/ISO/REC/PAY/ER/OI-YYYYMMDD-######
```

编号创建后不可修改或复用。数量以最多六位小数的十进制字符串传输，金额以两位小数的十进制字符串传输，后端使用定点整数计算。

所有 BOB 引用都传 `objectId` 和 `versionId`。VOU 在写事务内调用 `ResolveEffectiveReference`，并保存编码、名称、单位、币种、车牌等业务快照。之后 BOB 版本失效不改变历史单据。

客户、供应商可在 BOB 中不配置结算方式，但不能据此新建或保存贸易单据。贸易单据保存制单时生效的结算方式对象、版本、编码、名称和规则快照；联系人、电话、地址同样只从客户或供应商有效版本读取并保存快照，不接受客户端直接输入。

新建贸易单据时，客户的 `salespersonEmployeeId` 默认作为销售单或居间销售单的 `salesperson`，供应商的 `salespersonEmployeeId` 默认作为采购单或居间销售单的 `purchaser`。客户端显式传入人员引用时覆盖默认值。已有草稿保存时省略人员字段，保留单据原对象、版本、编码和名称快照，不因主数据或交易对方变化自动替换；显式传入时重新校验并替换。

后端不计算、不保存也不返回 `dueDate`。前端按单据业务日期和结算规则的自然日语义计算：

- `RELATIVE_DAYS`：业务日期加 `dayOffset`，此时 `monthOffset` 必须为 `0` 且无 `dayOfMonth`；
- `MONTH_END`：业务日期偏移 `monthOffset` 月，取该月月末后加 `dayOffset`；
- `FIXED_DAY`：业务日期偏移 `monthOffset` 月后取 `dayOfMonth`，目标月份没有该日时取月末，再加 `dayOffset`。

### 2.2 生命周期

```text
DRAFT ⇄ REVIEWED ⇄ APPROVED ⇄ EXECUTED
```

- `create` 创建草稿；`save` 只允许修改草稿。
- `review`、`approve`、`execute` 逐级前进。
- `unexecute`、`unapprove`、`unreview` 逐级退回，并要求原因。
- `unexecute` 清除当前执行结果，旧值保留在审计事件中。
- 不提供提交、物理删除、作废或更正单。
- 不比较动作操作者身份，只校验精确 APP 路径权限。
- 所有写动作携带文档 `revision`，使用乐观并发控制。

每类实体提供：

```text
query get create save
review unreview approve unapprove execute unexecute
audit-history
attachment-initiate attachment-download attachment-remove
```

### 2.3 通用请求与写入响应

BOB 引用结构固定为：

```json
{
  "objectId": "01J...",
  "versionId": "01J..."
}
```

`create` 只接收 `data`，`save` 在相同 `data` 外要求当前单据 ID 和 revision：

```json
{
  "documentId": "01J...",
  "revision": 3,
  "data": {
    "businessDate": "2026-07-26",
    "currency": "CNY"
  }
}
```

动作请求按下表固定，未列出的字段会被拒绝：

| 动作 | 请求字段 |
| --- | --- |
| `query` | `page`、`pageSize`、`filters`、最多一项 `sort` |
| `get` | `documentId` |
| `create` | `data` |
| `save` | `documentId`、`revision`、`data` |
| `review`、`approve` | `documentId`、`revision` |
| `unreview`、`unapprove`、`unexecute` | `documentId`、`revision`、`reason` |
| `execute` | `documentId`、`revision`，并按实体携带第 3.7 节执行字段 |
| `audit-history` | `documentId`、`page`、`pageSize` |
| 附件动作 | 见第 5 节 |

创建、保存和生命周期动作成功时，`data` 使用同一结构：

```json
{
  "documentId": "01J...",
  "documentNo": "SO-20260726-000001",
  "status": "DRAFT",
  "revision": 1
}
```

## 3. 单据字段

### 3.1 销售单

草稿包含客户、必填业务员、必填仓库、订购日期、币种、备注及至少一条产品明细。新建时省略业务员则从客户默认带入，显式传入可覆盖。明细包含产品、订购数量、含税单价和可选备注（最多 1000 字），行金额和总金额由后端计算。保存时自动快照客户联系人、电话、地址和客户结算方式。

签收完成后一次执行，执行请求包含出库日期、签收日期、物流平台、送货车辆以及每行的出库、签收、拒收和损耗数量。必须满足：

- `订购日期 <= 出库日期 <= 签收日期`；
- `0 < 出库数量 <= 订购数量`；
- `签收 + 拒收 + 损耗 = 出库`；
- 任一行出库少于订购数量时，整单差异原因必填；
- 车辆必须属于所选物流平台。

### 3.2 采购单

草稿包含普通供应商、必填采购员、必填仓库、订购日期、币种、备注及产品明细；新建时省略采购员则从供应商业务员默认带入，显式传入可覆盖。单据自动快照供应商联系人、电话和结算方式。执行请求包含入库日期和逐行入库数量。`订购日期 <= 入库日期`，且 `0 < 入库数量 <= 订购数量`；存在少收时差异原因必填。

### 3.3 居间销售单

草稿同时包含客户、普通供应商、必填业务员和必填采购员，不包含仓库。新建时省略人员字段，分别从客户和供应商默认带入；显式传入可独立覆盖。每条商品行的 `unitPrice` 为客户销售单价，`purchaseUnitPrice` 为必填供应商采购单价；单据抬头总额仍按销售单价计算。其余订购、金额和执行规则与销售单一致。保存时自动快照客户联系人、电话、地址及客户和供应商两套结算方式；供应商表示实际供货厂商，物流平台仍独立选择。

### 3.4 收款单与付款单

草稿包含一个客户或供应商、一个资金账户、必填经办人、业务日期、币种、金额和备注。单据币种必须与资金账户币种一致。首版不关联或核销来源单据；执行只确认单据已实际发生。

### 3.5 费用报销单

草稿包含员工、统一费用日期、统一支出账户、币种、备注及至少一条费用明细。员工即经办人，不增加重复的 `handler`。每条费用包含费用类别文本、说明、金额和可选备注（最多 1000 字）；总金额由后端汇总，币种必须与支出账户一致。

### 3.6 其它收入单

草稿包含来源名称、可选客户或供应商、资金账户、必填经办人、业务日期、币种、金额和备注。币种必须与资金账户一致。

日期仅校验字段先后关系，允许历史补录和未来计划日期。

新增人员、仓库和结算快照列允许整体为空，以兼容迁移前的历史单据。历史单据可正常读取；缺少当前必填属性时，`review`、`approve` 和 `execute` 均拒绝继续正向流转，必须逐级反向回到草稿并通过 `save` 补齐。所有新增人员和仓库仍必须由客户端传 `objectId + versionId`。

### 3.7 草稿与执行载荷

贸易单据草稿使用统一 `data` 结构。销售单示例：

```json
{
  "data": {
    "businessDate": "2026-07-26",
    "currency": "CNY",
    "customer": {"objectId": "01J...", "versionId": "01J..."},
    "salesperson": {"objectId": "01J...", "versionId": "01J..."},
    "warehouse": {"objectId": "01J...", "versionId": "01J..."},
    "remark": "客户要求分批送货",
    "productLines": [
      {
        "product": {"objectId": "01J...", "versionId": "01J..."},
        "orderedQuantity": "10.000000",
        "unitPrice": "25.50",
        "remark": "首批"
      }
    ]
  }
}
```

各实体在通用字段之外使用：

| 实体 | 草稿专用字段 |
| --- | --- |
| `sale-order` | `customer`、可省略并从客户带入的 `salesperson`、`warehouse`、`productLines` |
| `purchase-order` | `supplier`、可省略并从供应商带入的 `purchaser`、`warehouse`、`productLines` |
| `intermediary-sale-order` | `customer`、`supplier`、`salesperson`、`purchaser`、`productLines`；每行还要求 `purchaseUnitPrice` |
| `receipt`、`payment` | `counterpartyType`、`counterparty`、`fundAccount`、`handler`、`amount` |
| `expense-reimbursement` | `employee`、`fundAccount`、`expenseLines` |
| `other-income` | `sourceName`、可选 `counterpartyType`/`counterparty`、`fundAccount`、`handler`、`amount` |

销售和居间销售执行请求：

```json
{
  "documentId": "01J...",
  "revision": 4,
  "outboundDate": "2026-07-27",
  "signoffDate": "2026-07-28",
  "platform": {"objectId": "01J...", "versionId": "01J..."},
  "vehicle": {"objectId": "01J...", "versionId": "01J..."},
  "differenceReason": "客户少收一件",
  "saleLines": [
    {
      "lineId": "01J...",
      "outboundQuantity": "10.000000",
      "signedQuantity": "9.000000",
      "rejectedQuantity": "1.000000",
      "lossQuantity": "0.000000"
    }
  ]
}
```

采购执行改用 `inboundDate` 和非空 `purchaseLines`：

```json
{
  "documentId": "01J...",
  "revision": 4,
  "inboundDate": "2026-07-27",
  "purchaseLines": [
    {"lineId": "01J...", "inboundQuantity": "10.000000"}
  ]
}
```

收付款、费用报销和其它收入执行只传 `documentId`、`revision`，不接受日期、车辆或行字段。反向动作的
`reason` 去除首尾空白后必须为 1–1000 个 Unicode 字符。

## 4. 查询与响应

`query` 支持分页、单号或往来方关键字、状态、业务日期起止和客户/供应商对象 ID。排序字段白名单为 `updatedAt`、`documentNo`、`businessDate`、`status`、`amount`。

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "keyword": "SO-20260726",
    "status": ["DRAFT", "REVIEWED"],
    "dateFrom": "2026-07-01",
    "dateTo": "2026-07-31",
    "partyObjectId": "01J..."
  },
  "sort": [{"field": "updatedAt", "order": "desc"}]
}
```

`page` 和 `pageSize` 均必须为正数，`pageSize` 最大 100，`sort` 最多一项；省略排序时按
`updatedAt desc`。查询成功返回统一分页结构，单项至少包含 `documentId`、`entity`、`documentNo`、
`status`、`revision`、`businessDate`、`currency`、`amount` 和 `updatedAt`。

```json
{
  "items": [
    {
      "documentId": "01J...",
      "entity": "sale-order",
      "documentNo": "SO-20260726-000001",
      "status": "DRAFT",
      "revision": 2,
      "businessDate": "2026-07-26",
      "partyName": "示例客户",
      "currency": "CNY",
      "amount": "255.00",
      "updatedAt": "2026-07-26T08:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

`get` 返回抬头、明细、人员、仓库、联系人、结算规则等 BOB 快照、执行结果、审计字段和附件摘要。金额、数量仍以规范化十进制字符串返回；联系人和结算快照是只读字段，响应中不包含 `dueDate`。

```json
{"documentId": "01J..."}
```

成功 `data` 示例：

```json
{
  "documentId": "01J...",
  "entity": "sale-order",
  "documentNo": "SO-20260726-000001",
  "status": "DRAFT",
  "revision": 2,
  "amount": "255.00",
  "data": {
    "businessDate": "2026-07-26",
    "currency": "CNY",
    "remark": "客户要求分批送货",
    "customer": {
      "objectId": "01J...",
      "versionId": "01J...",
      "entity": "customer",
      "code": "CUS-001",
      "name": "示例客户"
    },
    "productLines": [
      {
        "lineId": "01J...",
        "lineNo": 1,
        "product": {
          "objectId": "01J...",
          "versionId": "01J...",
          "entity": "product",
          "code": "PRD-001",
          "name": "示例商品",
          "unit": "件"
        },
        "orderedQuantity": "10.000000",
        "unitPrice": "25.50",
        "lineAmount": "255.00"
      }
    ]
  },
  "attachments": [],
  "createdAt": "2026-07-26T08:00:00Z",
  "createdBy": "01J...",
  "updatedAt": "2026-07-26T08:05:00Z",
  "updatedBy": "01J..."
}
```

`audit-history` 使用 `{"documentId":"01J...","page":1,"pageSize":20}`，`pageSize` 最大 100。

## 5. 附件

- 七类单据均支持附件；每单最多 10 个，单文件最多 10 MiB。
- 只允许 PDF、JPEG 和 PNG，并同时校验声明 MIME、文件魔数、大小和 SHA-256。
- 只有草稿可发起或移除附件；审核前不能存在未完成上传。
- 上传令牌一次性且默认 15 分钟；下载令牌一次性且默认 5 分钟。
- 文件保存在配置的本地根目录，使用随机键和原子重命名；用户文件名只能作为下载元数据，不能参与磁盘路径。
- 下载强制 `Content-Disposition: attachment` 和 `X-Content-Type-Options: nosniff`。
- 生产运行限定单 API 实例，并把数据库和附件持久卷作为同一备份恢复边界。

发起上传：

```json
{
  "documentId": "01J...",
  "revision": 2,
  "fileName": "contract.pdf",
  "contentType": "application/pdf",
  "size": 102400,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

成功返回 `fileId`、一次性 `uploadUrl`、`expiresAt` 和递增后的 `revision`。客户端随后对技术端点执行
`PUT uploadUrl`，请求头中的 MIME 和长度必须与发起请求一致。

下载令牌请求为 `{"documentId":"01J...","fileId":"01J..."}`，成功返回一次性 `downloadUrl` 和
`expiresAt`；移除附件请求还要求当前 `revision`。发起和移除只允许草稿，文件名不得包含路径，
`sha256` 必须为 64 位十六进制字符串。

## 6. 事务与审计

创建、保存、状态变化、执行结果、反向动作和附件关联都在文档锁及 revision 校验下完成。编号计数器按实体和业务日期加锁，允许业务上出现号码间隙但禁止重复。

审计事件追加保存事件类型、前后状态、操作者、发生时间、反向原因、请求 ID 和必要的变更摘要。反向动作清理当前态字段，但不得删除历史事件。

单据 `execute` 和 `unexecute` 在完成 VOU 当前态及审计写入后、提交事务前，分别发布 `DocumentExecutedEvent` 和 `DocumentUnexecutedEvent`。主题同时包含生命周期动作和单据实体，库存、账簿等下游领域按指定单据类型订阅。事件携带单据实体、ID、单号、新 revision、操作者和 request ID；反执行事件还携带原因。订阅者通过事件获得的同一个 `pgx.Tx` 查询所需单据快照并写入下游数据。

所有订阅者按启动时的注册顺序同步执行并采用 fail-fast。任一订阅者主动拒绝、返回故障或发生 panic 时，VOU 执行或反执行、审计记录以及此前订阅者的数据库写入全部回滚；没有订阅者时保持现有执行行为。业务拒绝返回冲突响应，其他订阅故障返回内部错误。订阅者不得产生不能由数据库事务回滚的外部副作用。

## 7. 验收

- 七类单据均能完成正向和完整反向链路；
- 销售、采购、居间销售的人员、仓库、联系人和结算规则按制单版本稳定快照；
- 新建贸易单据能从客户或供应商默认带入人员，显式覆盖生效，保存草稿省略人员时保持原快照；
- 缺少结算方式不能创建或保存贸易单据，迁移前缺少新增字段的历史单据不能正向流转；
- 商品和费用明细备注可保存、读取并拒绝超过 1000 字的输入；
- BOB 无效引用、平台车辆不匹配、资金账户币种不匹配被拒绝；
- 数量、金额、日期和差异原因约束同时由服务测试和数据库约束覆盖；
- 并发编号唯一，过期 revision 不产生部分写入；
- 执行与反执行事件按单据类型精确投递，任一订阅失败不产生 VOU 或下游部分写入；
- 居间销售采购单价只允许用于居间商品行，缺失时不能完成正向流转；
- 附件大小、类型、哈希、令牌、路径和权限规则可验证；
- 迁移、sqlc 生成、单元测试、数据库集成测试、vet、build、race、Compose 健康检查全部通过。

## 8. WFL 受管单据

WFL 可复用本域的编号、状态、审计、附件和精确数值基础设施，但受管单据不可通过
`/vou/*` 写入。居间贸易流程由 `customer-order`、`procurement-order`、`goods-receipt`、
`delivery-note`、`signoff-note` 五类独立原子单据组成。

这些单据使用 `parentDocumentId` 保存直接业务来源，并以 `controlDomain=WFL` 标记唯一写入方。
完整流程、状态、权限和数量契约以 [WFL 文档](wfl.md) 为准。
