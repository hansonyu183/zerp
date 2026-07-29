# VOU 业务单据领域

## 1. 领域边界

VOU（Voucher）负责销售、采购、资金及费用单据的制单、审核、批准、执行、反向流转、附件和审计。首批实体为：

```text
sale-order
sale-outbound
sale-delivery
sale-signoff
purchase-order
purchase-inbound
receipt
payment
expense-reimbursement
other-income
```

HTTP 路径和数据结构以根目录 OpenAPI 为准；本文只维护单据生命周期、计算、快照、事务和前端交互语义。

十类原子单据均由 VOU 独立管理，唯一授权依据是精确的 VOU API 权限。WFL 只消费事件并维护
单据组合、跨单据规则和自动建单，不代理单据正文、生命周期、附件或审计。

业务 API 固定为 `POST /vou/{entity}/{action}`，使用 `application/json` 和统一响应包络。文件字节流是技术端点，使用短时令牌访问 `/files/attachments/*`。

VOU 自身不保存库存流水、资金余额、应收应付或往来核销数据。LED 领域同步消费已执行单据并在同一事务中生成库存、资金和往来流水；反执行必须同时生成 LED 反向流水，若会破坏严格库存约束则拒绝。

## 2. 通用业务规则

### 2.1 编号、金额和引用

单据号由服务端按类型和创建时业务日期生成：

```text
SO/PO/ISO/REC/PAY/ER/OI-YYYYMMDD-######
```

编号创建后不可修改或复用。数量以最多六位小数的十进制字符串传输，金额以两位小数的十进制字符串传输，后端使用定点整数计算。

所有 BOB 引用都传 `objectId` 和 `versionId`。VOU 在写事务内调用 `ResolveEffectiveReference`，并保存编码、名称、单位、币种、车牌等业务快照。之后 BOB 版本失效不改变历史单据。

客户、供应商可在 BOB 中不配置结算方式，但不能据此新建或保存贸易单据。贸易单据保存制单时生效的结算方式对象、版本、编码、名称和规则快照；联系人、电话、地址同样只从客户或供应商有效版本读取并保存快照，不接受客户端直接输入。

新建贸易单据时，客户的 `salespersonEmployeeId` 默认作为销售订单的 `salesperson`，供应商的 `salespersonEmployeeId` 默认作为采购订单的 `purchaser`。客户端显式传入人员引用时覆盖默认值。已有草稿保存时省略人员字段，保留单据原对象、版本、编码和名称快照，不因主数据或交易对方变化自动替换；显式传入时重新校验并替换。

后端按 AUX 结算规则计算、保存并返回 `dueDate`。`DUE_DAYS` 为业务日期加到期天数；`MONTH_END` 在超过截止日时先额外顺延一个月，再叠加结算月偏移并取目标月月末。

销售订单明细的客户端 `unitPrice` 表示基础单价。非包装物默认带入结算方式的元/kg 加价，允许制单时覆盖；包装物加价固定为零。后端保存基础单价、结算加价和两者相加后的实际单价，并按实际单价计算金额。客户变化时客户端清空旧加价，由新结算方式重新计算。

销售订单的每个非包装产品行保存独立配方快照，结构为基准产量和原料用量：

- 原材料自动生成“基准产量 1、自身用量 1”，不可编辑。
- 自制成品从所选产品版本复制固定配方，允许在草稿订单中调整，且不反写产品主数据。
- 客户定制品按同一客户和同一产品，依业务日期、单号倒序复制最近一张状态为 `CHECKED`、`APPROVED` 或 `FINALIZED` 的销售订单配方；无历史配方时手工维护。
- 包装物不适用配方。

销售订单创建或保存时，所有非包装产品行都必须有完整配方。新订单复制产品
固定配方或客户历史配方时，原料对象按当前有效版本重新解析，配方用量不变；
订单随后保存原料对象、当前版本、编码、名称和单位快照。产品、原料或历史订单
后续变化不修改已有订单。客户或产品发生变化时，客户端重新解析尚未保存行的
默认配方，后端仍对产品类型、原料类型和引用有效性做最终校验。

### 2.2 生命周期

```text
DRAFT ⇄ CHECKED ⇄ APPROVED ⇄ FINALIZED
```

- `create` 创建草稿；`save` 只允许修改草稿。
- `check`、`approve`、`finalize` 逐级前进。
- `unfinalize`、`unapprove`、`uncheck` 逐级退回，并要求原因。
- `unfinalize` 清除当前最终处理结果，旧值保留在审计事件中。
- 不提供提交、作废或更正单。草稿可携带原因删除，但有附件或下级单据时拒绝删除。
- 不比较动作操作者身份，只校验精确 APP 路径权限。
- 所有写动作携带文档 `revision`，使用乐观并发控制。

VOU 路由动作集合如下；各实体实际开放的动作按后文创建例外和精确权限确定：

```text
query get create save delete
check uncheck approve unapprove finalize unfinalize
audit-history
attachment-initiate attachment-download attachment-remove
```

十类单据均提供查询、查看、保存、删除草稿、生命周期、审计和附件动作；实际可用性继续受单据
状态、上下级关系和精确权限约束。`sale-outbound`、`sale-delivery`、`sale-signoff` 不提供
公开 `create` 权限，由 WFL 事件订阅自动创建；其余七类单据允许按各自规则创建。
`formula-default` 仅用于销售订单解析默认配方。

### 2.3 通用写入语义

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

| 动作                                 | 请求字段                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `query`                              | `page`、`pageSize`、`filters`、最多一项 `sort`          |
| `get`                                | `documentId`                                            |
| `formula-default`                    | 销售订单的 `customer`（可选）和 `product`               |
| `create`                             | `data`                                                  |
| `save`                               | `documentId`、`revision`、`data`                        |
| `delete`                             | `documentId`、`revision`、`reason`                      |
| `check`、`approve`                   | `documentId`、`revision`                                |
| `uncheck`、`unapprove`、`unfinalize` | `documentId`、`revision`、`reason`                      |
| `finalize`                           | `documentId`、`revision`，并按实体携带第 3.6 节处理字段 |
| `audit-history`                      | `documentId`、`page`、`pageSize`                        |
| 附件动作                             | 见第 5 节                                               |

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

### 3.1 销售四单

销售履约由 `SALES_FULFILLMENT` 编排为
`sale-order -> sale-outbound -> sale-delivery -> sale-signoff`。销售订单保存客户、
业务员、订购日期、币种、备注和产品明细，不锁定仓库。批准上级单据时由服务端自动创建下级草稿；
来源 ID 和来源单号为只读关系。销售出库从已批准订单复制可出库行，补充仓库和出库数量；
一张订单可多次出库。销售送货完整承接一张已批准出库单并保存物流平台和车辆，
一张出库单最多一张销售送货。销售签收完整覆盖一张已发运送货单的全部行，一张送货单最多一张销售签收。

日期必须满足 `订单日期 <= 出库日期 <= 配送日期 <= 签收日期`。可再出库量等于订购量减已签收量
再减未签收在途量，最终处理出库单时在事务内锁定并重算。签收满足
`签收 + 拒收 + 损耗 = 出库`，其中损耗由服务端计算；拒收和损耗释放订单需求，拒收恢复库存，
损耗不回库，只有签收量形成客户应收。

销售订单的 `fulfillmentStatus` 为 `OPEN`、`FULFILLED`、`SHORT_CLOSE_REQUESTED` 或
`SHORT_CLOSED`。全部订购量签收后自动履约完成；无在途单据时允许申请短结，由另一操作者确认，
并支持取消申请和带原因反确认。

### 3.2 采购订单与采购入库

采购履约由 `PURCHASE_FULFILLMENT` 编排为
`purchase-order -> purchase-inbound`。采购订单只保存供应商、采购员、供应商结算快照、
计划仓库、订购日期、币种、备注、商品、订购数量和采购单价，不保存实际入库日期或入库数量。
采购订单批准后才能显式创建一张或多张采购入库草稿。

采购入库从订单只读继承供应商、商品和采购单价，默认使用计划仓库，但可选择实际仓库；
每张入库可只包含部分订单行。所有未删除入库单的累计数量不得超过订购数量，创建、保存和删除
均在锁定父订单的同一事务内重算。草稿删除或减少数量会立即释放占用量。采购订单不记账；
采购入库最终处理时按实际数量增加库存并贷记供应商应付，反最终处理追加反向流水。

全部订购量最终入库后订单自动完成；撤销最终入库会重新打开自动完成的订单。存在未完成入库单时
不得短结；不足量订单由一人申请、另一人确认短结，反短结后恢复入库。

旧 `intermediary-sale-order` 聚合、居间贸易流程及其五张专用原子单据均已删除。

### 3.3 往来收款与往来付款

草稿包含一个客户或供应商、一个资金账户、必填经办人、业务日期、币种、金额和备注。单据币种必须与资金账户币种一致。首版不关联或核销来源单据；执行只确认单据已实际发生。

### 3.4 费用报销

草稿包含员工、统一费用日期、统一支出账户、币种、备注及至少一条费用明细。员工即经办人，不增加重复的 `handler`。每条费用包含费用类别文本、说明、金额和可选备注（最多 1000 字）；总金额由后端汇总，币种必须与支出账户一致。

### 3.5 其他收入

草稿包含来源名称、可选客户或供应商、资金账户、必填经办人、业务日期、币种、金额和备注。币种必须与资金账户一致。

日期仅校验字段先后关系，允许历史补录和未来计划日期。

新增人员、仓库和结算快照列允许整体为空，以兼容迁移前的历史单据。历史单据可正常读取；缺少当前必填属性时，`check`、`approve` 和 `finalize` 均拒绝继续正向流转，必须逐级反向回到草稿并通过 `save` 补齐。所有新增人员和仓库仍必须由客户端传 `objectId + versionId`。

### 3.6 草稿与执行载荷

贸易单据草稿使用统一 `data` 结构。销售订单示例：

```json
{
  "data": {
    "businessDate": "2026-07-26",
    "currency": "CNY",
    "customer": { "objectId": "01J...", "versionId": "01J..." },
    "salesperson": { "objectId": "01J...", "versionId": "01J..." },
    "remark": "客户要求分批送货",
    "productLines": [
      {
        "product": { "objectId": "01J...", "versionId": "01J..." },
        "orderedQuantity": "10.000000",
        "unitPrice": "25.50",
        "remark": "首批"
      }
    ]
  }
}
```

各实体在通用字段之外使用：

| 实体                    | 草稿专用字段                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `sale-order`            | `customer`、可省略并从客户带入的 `salesperson`、`productLines`                           |
| `sale-outbound`         | WFL 注入来源；客户端只传 `warehouse`、`sourceLines`                                      |
| `sale-delivery`         | WFL 注入来源；客户端只传 `platform`、`vehicle`                                           |
| `sale-signoff`          | WFL 注入来源；客户端只传 `signoffLines`                                                  |
| `purchase-order`        | `supplier`、可省略并从供应商带入的 `purchaser`、`warehouse`、`productLines`              |
| `purchase-inbound`      | WFL 注入订单来源；客户端只传实际 `warehouse` 和 `sourceLines`                            |
| `receipt`、`payment`    | `counterpartyType`、`counterparty`、`fundAccount`、`handler`、`amount`                   |
| `expense-reimbursement` | `employee`、`fundAccount`、`expenseLines`                                                |
| `other-income`          | `sourceName`、可选 `counterpartyType`/`counterparty`、`fundAccount`、`handler`、`amount` |

往来收付款、费用报销和其他收入执行只传 `documentId`、`revision`，不接受日期、车辆或行字段。反向动作的
`reason` 去除首尾空白后必须为 1–1000 个 Unicode 字符。

## 4. 查询与展示语义

`query` 支持分页、单号或往来方关键字、状态、业务日期起止和客户/供应商对象 ID。排序字段白名单为 `updatedAt`、`documentNo`、`businessDate`、`status`、`amount`。

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "keyword": "SO-20260726",
    "status": ["DRAFT", "CHECKED"],
    "dateFrom": "2026-07-01",
    "dateTo": "2026-07-31",
    "partyObjectId": "01J..."
  },
  "sort": [{ "field": "updatedAt", "order": "desc" }]
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

`get` 返回抬头、明细、人员、仓库、联系人、结算规则、`dueDate`、基础单价和结算加价等快照、执行结果、审计字段和附件摘要。金额、数量仍以规范化十进制字符串返回。

```json
{ "documentId": "01J..." }
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

- 十类单据均支持附件；每单最多 10 个，单文件最多 10 MiB。
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

单据 `finalize` 和 `unfinalize` 在完成 VOU 当前态及审计写入后、提交事务前，分别发布
`DocumentFinalizedEvent` 和 `DocumentUnfinalizedEvent`。主题同时包含生命周期动作和单据实体，
库存、账簿等下游领域按指定单据类型订阅。事件携带单据实体、ID、单号、新 revision、操作者和
request ID；反向事件还携带原因。订阅者通过同一个 `pgx.Tx` 查询快照并写入下游数据。

所有订阅者按启动时的注册顺序同步执行并采用 fail-fast。任一订阅者主动拒绝、返回故障或发生 panic 时，VOU 执行或反执行、审计记录以及此前订阅者的数据库写入全部回滚；没有订阅者时保持现有执行行为。业务拒绝返回冲突响应，其他订阅故障返回内部错误。订阅者不得产生不能由数据库事务回滚的外部副作用。

## 7. 验收

- 十类原子单据均能独立查询和查看，销售三类下级单据不开放人工创建入口；
- 销售订单可分批出库，销售出库、销售送货、销售签收严格追溯来源且并发不超量；
- 销售和采购流程的人员、仓库、联系人和结算规则按制单版本稳定快照；
- 新建贸易单据能从客户或供应商默认带入人员，显式覆盖生效，保存草稿省略人员时保持原快照；
- 缺少结算方式不能创建或保存贸易单据，迁移前缺少新增字段的历史单据不能正向流转；
- 商品和费用明细备注可保存、读取并拒绝超过 1000 字的输入；
- BOB 无效引用、平台车辆不匹配、资金账户币种不匹配被拒绝；
- 数量、金额、日期和差异原因约束同时由服务测试和数据库约束覆盖；
- 并发编号唯一，过期 revision 不产生部分写入；
- 执行与反执行事件按单据类型精确投递，任一订阅失败不产生 VOU 或下游部分写入；
- 采购入库只读继承采购单价，累计占用和并发写入均不能超过采购订单；
- 附件大小、类型、哈希、令牌、路径和权限规则可验证；
- 迁移、sqlc 生成、单元测试、数据库集成测试、vet、build、race、Compose 健康检查全部通过。

## 8. 上级单据与 WFL 组合

所有单据统一提供可空的 `parentEntity + parentDocumentId`。两者必须同时为空或同时存在；
创建时校验上级实体和 ID 匹配、上级存在且不能自引用，创建后不可修改。VOU 不限制固定父子
实体组合，也不保存流程 ID、控制域、自动生成标记或完整来源链。父单号按需关联查询。

VOU 在同一事务内发布创建、保存、状态变化和删除事件。WFL 可据此维护组合，但不能以流程
归属或流程角色拒绝已获得 VOU API 权限的用户。完整组合规则见 [WFL 文档](wfl.md)。

## 9. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

VOU 前端对接后端 `POST /vou/{entity}/{action}` 契约，提供十类独立单据的查询、查看、
审核、批准、执行、反向流转、附件和审计界面；其中七类提供人工制单入口。后端领域文档和
实际请求/响应类型是业务规则来源；本文只记录前端映射和交互边界。

VOU 组件提供可嵌入的原子单据标题、状态、动作、详情、附件和审计展示。
旧居间单据和 `/wfl/intermediary-trade` 均不再注册，访问进入未找到页面。所有保留单据均按
VOU 权限提供完整能力；销售出库、销售送货和销售签收不注册公开创建 API，由 WFL 事件订阅
自动创建。采购入库允许人工创建。

### 9.1 实体与页面

| 实体                                                                                         | 页面     |
| -------------------------------------------------------------------------------------------- | -------- |
| `sale-order`                                                                                 | 销售订单 |
| `sale-outbound`                                                                              | 销售出库 |
| `sale-delivery`                                                                              | 销售送货 |
| `sale-signoff`                                                                               | 销售签收 |
| `purchase-order`                                                                             | 采购订单 |
| `purchase-inbound`                                                                           | 采购入库 |
| `receipt`                                                                                    | 往来收款 |
| `payment`                                                                                    | 往来付款 |
| `expense-reimbursement`                                                                      | 费用报销 |
| `other-income`                                                                               | 其他收入 |
| 实体名包含连字符，前端路由、权限路径和 API 路径必须原样使用，不得改写为 `saleorder` 等别名。 |

### 9.2 通用交互

- 实体页由列表和全屏单据工作区组成；页面状态由同目录 VM 和 VOU 共享 VM 管理，不进入 Pinia。
- 单据状态固定为 `DRAFT ⇄ CHECKED ⇄ APPROVED ⇄ FINALIZED`。`check/uncheck`、`approve/unapprove`、
  `finalize/unfinalize` 是统一后端动作；页面按单据类型显示审核、出库、配送、签收等业务文案。
  所有反向动作必须填写原因。
- 仅草稿可编辑和增删附件。所有写操作使用详情响应中的当前 `revision`，冲突后由用户重新加载，不自动覆盖。
- BOB 新引用必须来自当前 `EFFECTIVE` 版本，并同时提交 `objectId` 和 `versionId`。详情中的历史快照可以展示，但不会被转换成新的有效引用。
- 已有贸易草稿的业务员和采购员没有被用户改动时，保存请求省略该字段，以保留后端人员快照；新建时留空则由后端使用客户或供应商默认值。
- 金额和数量始终保留为十进制字符串。产品行金额使用与后端相同的定点半向上取整，仅作界面反馈，最终金额以后端响应为准。
- 采购订单的 `unitPrice` 是供应商采购单价；采购入库只读继承，客户端不得修改。
- 到期日由后端根据业务日期和结算规则计算、保存并在 `dueDate` 返回；前端不提交该字段，
  展示时以后端值为准，仅对缺少该字段的历史记录按结算快照计算回退值。

### 9.3 附件

附件业务动作仍通过三级 JSON API 发起。后端返回的上传和下载令牌 URL 只能交给 `ApiClient` 的受限文件方法处理：

- 每单最多 10 个；单文件最多 10 MiB；
- 只接受 PDF、JPEG 和 PNG；
- 浏览器计算 SHA-256 后发起上传，多个文件按 revision 顺序上传；
- 技术 URL 必须与 API 基址同源，且路径只能位于 `/files/attachments/upload/*` 或 `/files/attachments/download/*`；
- 上传失败后重新获取详情，保留后端的待上传项供用户移除，不伪造成功状态。

### 9.4 测试后端资料

Playwright 不拦截 VOU 或 BOB 请求。真实测试库需要预置有效客户、供应商、员工、仓库、产品、物流平台、属于该平台的车辆和资金账户；本地关键字通过 Git 忽略的 `.env.e2e.local` 中 `E2E_VOU_*` 变量提供。客户必须配置结算方式，资金账户币种必须与 `E2E_VOU_CURRENCY` 一致。
