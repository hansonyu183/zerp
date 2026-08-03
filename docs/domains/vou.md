# VOU 业务单据领域

## 1. 领域边界

VOU（Voucher）负责销售、采购、资金及费用单据的制单、审核、批准、执行、反向流转、附件和审计。首批实体为：

```text
sale-pricing
sale-order
sale-outbound
sale-delivery
sale-signoff
sale-return
purchase-order
purchase-inbound
purchase-return
purchase-inquiry
order-production
self-production
inventory-count
customer-receipt
supplier-receipt
other-receipt
customer-payment
supplier-payment
other-payment
expense-reimbursement
expense-payment
other-income
```

HTTP 路径和数据结构以根目录 OpenAPI 为准；本文只维护单据生命周期、计算、快照、事务和前端交互语义。

当前共 22 类原子单据，均由 VOU 独立管理，唯一授权依据是精确的 VOU API 权限。WFL 只消费事件并维护
单据组合、跨单据规则和自动建单，不代理单据正文、生命周期、附件或审计。

业务 API 固定为 `POST /vou/{entity}/{action}`，使用 `application/json` 和统一响应包络。文件字节流是技术端点，使用短时令牌访问 `/files/attachments/*`。

VOU 自身不保存库存流水、资金余额、应收应付或往来核销数据。LED 领域同步消费已执行单据并在同一事务中生成库存、资金和往来流水；反执行必须同时生成 LED 反向流水，若会破坏严格库存约束则拒绝。

## 2. 通用业务规则

### 2.1 编号、金额和引用

单据号由服务端按类型和创建时业务日期生成，格式为三位前缀、八位业务日期和四位流水号：

```text
SPR/SOR/SOB/SDL/SSF/SRT/PIQ/POR/PIN/PRT/MTO/MTS/IVC/REC/PAY/EXR/EXP/OIN-YYYYMMDD-####
```

前缀依次对应销售定价、销售订单、销售出库、销售送货、销售签收、销售退货、采购询价、采购订单、采购入库、
采购退货、生产配货、生产自制品、收款、付款、费用报销、费用付款和其他收入。三类收款共享 REC 序列，三类付款共享 PAY 序列；其他流水按实体和业务日期分别从 `0001` 开始，
达到 `9999` 后拒绝继续创建。编号创建后不可修改或复用。数量以最多六位小数的十进制字符串传输，金额以两位小数的十进制字符串传输，后端使用定点整数计算。

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

上述单据均提供查询、查看、保存、删除草稿、生命周期、审计和附件动作；实际可用性继续受单据
状态、上下级关系和精确权限约束。`sale-outbound`、`sale-delivery`、`sale-signoff` 和
`expense-payment` 不提供公开 `create` 权限，由 WFL 事件订阅自动创建；其他 OpenAPI 声明可创建的单据允许按各自规则创建。
`formula-default` 用于销售订单和生产自制品单解析默认配方。
`price-reference` 用于销售订单和采购订单批量解析产品参考价。

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

| 动作                                 | 请求字段                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| `query`                              | `page`、`pageSize`、`filters`、最多一项 `sort`              |
| `get`                                | `documentId`                                                |
| `formula-default`                    | 销售订单可选 `customer`，销售订单和生产自制品均传 `product` |
| `create`                             | `data`                                                      |
| `save`                               | `documentId`、`revision`、`data`                            |
| `delete`                             | `documentId`、`revision`、`reason`                          |
| `check`、`approve`                   | `documentId`、`revision`                                    |
| `uncheck`、`unapprove`、`unfinalize` | `documentId`、`revision`、`reason`                          |
| `finalize`                           | `documentId`、`revision`，并按实体携带第 3.9 节处理字段     |
| `audit-history`                      | `documentId`、`page`、`pageSize`                            |
| 附件动作                             | 见第 5 节                                                   |

创建、保存和生命周期动作成功时，`data` 使用同一结构：

```json
{
  "documentId": "01J...",
  "documentNo": "SOR-20260726-0001",
  "status": "DRAFT",
  "revision": 1
}
```

## 3. 单据字段

### 3.1 销售定价与采购询价

销售定价保存业务日期、币种、备注和一至两百条不重复产品价格；采购询价在相同字段外必须选择
当前有效的普通供应商。两类单据不录数量，价格必须大于零，单据金额固定为零；完成和反完成不产生
WFL 流程或 LED 流水。

状态为 `APPROVED` 或 `FINALIZED` 的价格单可供订单引用。销售订单按产品、币种查询，采购订单按
供应商、产品、币种查询；只使用业务日期不晚于订单日期的记录，并按业务日期、单号倒序逐产品取
最近价格。没有来源时参考价为 `0.00`。订单将参考价、来源单号和来源日期保存为快照，同时允许用户
覆盖实际单价；后续价格单反批准、删除或新增不改变已保存订单。订单及其销售、采购履约链允许零价，
库存数量正常流转，零金额不生成应收应付流水。

### 3.2 销售四单

销售履约由 `SALES_FULFILLMENT` 编排为
`sale-order -> sale-outbound -> sale-delivery -> sale-signoff`。销售订单保存客户、
业务员、订购日期、计划仓库、币种、备注和产品明细。新订单的计划仓库必填；销售出库继承该仓库且不可修改。
迁移前的历史订单若已有且仅有一个出库仓库则自动回填；没有出库仓库时由第一次出库绑定；存在多个历史出库仓库时继续兼容读取，但不计算缺货摘要。批准上级单据时由服务端自动创建下级草稿；
来源 ID 和来源单号为只读关系。销售出库从已批准订单复制可出库行和仓库，并补充出库数量；
一张订单可多次出库。销售送货完整承接一张已批准出库单并保存物流平台和车辆，
一张出库单最多一张销售送货。销售签收完整覆盖一张已发运送货单的全部行，一张送货单最多一张销售签收。

日期必须满足 `订单日期 <= 出库日期 <= 配送日期 <= 签收日期`。可再出库量等于订购量减已签收量
再减未签收在途量，最终处理出库单时在事务内锁定并重算。签收满足
`签收 + 拒收 + 损耗 = 出库`，其中损耗由服务端计算；拒收和损耗释放订单需求，拒收恢复库存，
损耗不回库，只有签收量形成客户应收。

销售订单的 `fulfillmentStatus` 为 `OPEN`、`FULFILLED`、`SHORT_CLOSE_REQUESTED` 或
`SHORT_CLOSED`。全部订购量签收后自动履约完成；无在途单据时允许申请短结，由另一操作者确认，
并支持取消申请和带原因反确认。

### 3.3 采购订单、采购入库与采购退货

采购履约由 `PURCHASE_FULFILLMENT` 编排为采购订单、采购入库和采购退货三个阶段。
采购订单只保存供应商、采购员、供应商结算快照、
计划仓库、订购日期、币种、备注、商品、订购数量和采购单价，不保存实际入库日期或入库数量。
采购订单批准后才能显式创建一张或多张采购入库草稿。

采购入库从订单只读继承供应商、商品和采购单价，默认使用计划仓库，但可选择实际仓库；
每张入库可只包含部分订单行。所有未删除入库单的累计数量不得超过订购数量，创建、保存和删除
均在锁定父订单的同一事务内重算；已最终处理的采购退货数量会恢复相应订单行的可入库量。
草稿删除或减少数量会立即释放占用量。采购订单不记账；
采购入库最终处理时按实际数量增加库存并贷记供应商应付，反最终处理追加反向流水。

全部订购量最终入库后订单自动完成；撤销最终入库会重新打开自动完成的订单。存在未完成入库单时
不得短结；不足量订单由一人申请、另一人确认短结，反短结后恢复入库。

采购退货只能引用已最终处理的采购入库行，一张退货单可汇总同一采购订单下多张入库单，
不得跨订单。退货日期不得早于任一来源入库日期，仓库默认来源入库仓库但允许重新选择。
所有未删除退货单对来源入库行的累计占用不得超过入库数量；退货原因必填且不超过 1000 字。
最终处理按原入库价从所选仓库出库并借记供应商往来，减少应付；退款仍由独立资金单据处理。

采购退货最终处理后，正常完成或已短结的订单均重新打开，清除短结申请人和原因，并恢复净退货
数量对应的可入库量。撤销退货最终处理前，若新增入库已使用这部分恢复容量则拒绝撤销；否则按
“最终入库减最终退货”重算 `OPEN/FULFILLED`。此前短结状态不会自动恢复。存在未完成采购退货时
禁止短结；`SHORT_CLOSE_REQUESTED` 状态禁止创建采购退货。来源入库一旦被任一退货单引用，
必须先删除草稿退货或撤销并删除已完成退货，才能删除或反最终处理来源入库。

旧 `intermediary-sale-order` 聚合、居间贸易流程及其五张专用原子单据均已删除。

### 3.4 生产配货与生产自制品

生产单分为 `order-production`（生产配货单）和 `self-production`（生产自制品单）。
两类单据都保存材料仓库、成品仓库、一至两百条成品行、逐行配方快照和实际材料领用；
最终处理在一个事务内完成材料出库和成品入库，反最终处理同步删除两类库存流水。

生产配货单必须直接引用一张已最终确认的销售订单，可同时选择该订单内多条自制成品或
定制成品行。成品、基准产量和原始材料均复制销售订单配方快照。所有未删除生产配货单
都会占用来源行数量；创建、保存和删除时锁定来源订单重算，累计产量不得超过订购数量。
来源订单存在生产单时不得反最终处理或删除。生产单作为 `PRODUCTION` 阶段链接展示在
销售履约中，但不改变履约状态，也不限制销售出库。

生产自制品单不引用销售订单，只允许选择当前有效且维护固定配方的自制成品；一张单据
可包含多个不重复成品。保存时复制产品版本的固定配方，产品或材料后续变更不影响历史单据。

每条成品行保存大于零的成品数量和 `0` 至 `100` 的损耗百分比。每条材料的建议领料量为
`配方用量 / 基准产量 * 成品数量 * (1 + 损耗比例 / 100)`，按六位小数四舍五入。
实际材料默认等于原配方材料，实际数量默认等于建议量；用户可以修改数量或把该行替换为
另一当前有效的原材料，但不能增删配方行。替换材料或修改数量必须填写调整原因，并保留
原配方材料、实际材料和计算结果快照。

生产单是非金额单据，币种为空且金额固定为零。LED 只记录材料 `OUT` 和成品 `IN` 数量，
不为生产流水生成价格、金额、往来或资金影响；成本归集不属于当前范围。

### 3.5 销售退货

销售退货是销售履约的 `RETURN` 阶段。每张退货单直接归属根销售订单，每条明细精确引用
一条已最终处理的销售签收行；人工退货可汇总同一履约内多张签收单的明细。客户、币种、
商品、单位和销售单价均从签收链快照，客户端不可覆盖。退货日期不得早于任一来源签收日期。

`REFUSAL` 退货由签收最终处理按拒收数量幂等生成草稿，来源行和数量不可修改；签收单继续
记录拒收数量，但拒收库存只在退货单最终处理后恢复，且不冲减应收。`AFTER_SALE` 退货由
用户从签收单或销售履约发起，累计占用不得超过签收行已签收且未退数量；最终处理按实际
退回仓库增加库存，并按原签收价冲减客户应收。退货单金额使用正数展示。

退货单必须填写 1–1000 字的 `returnReason`，每行可附加备注。单据使用统一生命周期；
自动拒收草稿不得人工删除。撤销签收前必须先删除人工退货，并将自动退货逐级退回草稿，
随后系统删除自动草稿。反最终处理退货时必须满足严格库存时间线约束。

### 3.6 往来收款与往来付款

往来收付款按客户、供应商和其他往来单位拆为六个独立实体：`customer-receipt`、`supplier-receipt`、`other-receipt`、`customer-payment`、`supplier-payment`、`other-payment`。各实体拥有独立路由与权限，往来方类型由实体固定，草稿不再提交 `counterpartyType`。草稿包含对应往来方、一个资金账户、必填经办人、业务日期、币种、金额和备注。单据币种必须与资金账户币种一致。首版不关联或核销来源单据；执行只确认单据已实际发生。

### 3.7 费用报销

草稿包含员工、统一费用日期、币种、备注及至少一条费用明细，不再选择资金账户。员工即经办人，不增加重复的 `handler`。每条费用包含费用类别文本、说明、金额和可选备注（最多 1000 字）；总金额由后端汇总。新单据使用 `FLOW_PAYMENT` 结算模式，批准后由已启用的 WFL 定义生成费用付款；迁移前单据保留 `LEGACY_DIRECT` 模式和原资金账户快照。

### 3.8 费用付款

费用付款只能由 WFL 从费用报销批准事件生成，不提供公开 `create`。单据继承来源报销、员工、币种和金额，目标流程节点提供资金账户；草稿只允许修改业务日期、备注和资金账户。资金账户币种必须与报销币种一致，最终处理后由 LED 产生资金支出。

### 3.9 其他收入

草稿包含来源名称、可选客户或供应商、资金账户、必填经办人、业务日期、币种、金额和备注。币种必须与资金账户一致。

日期仅校验字段先后关系，允许历史补录和未来计划日期。

新增人员、仓库和结算快照列允许整体为空，以兼容迁移前的历史单据。历史单据可正常读取；缺少当前必填属性时，`check`、`approve` 和 `finalize` 均拒绝继续正向流转，必须逐级反向回到草稿并通过 `save` 补齐。所有新增人员和仓库仍必须由客户端传 `objectId + versionId`。

### 3.10 库存盘点

`inventory-count` 为单仓盘点单，保存盘点日期、仓库、备注和一至两百条不重复商品实盘数量。
实盘数量允许为零但不得为负；币种固定为 `CNY`，单据不产生资金或往来。

草稿可手动选择商品，也可通过 `book-balance` 按仓库和盘点日期分页读取非零账面商品。该结果只用于
录入预览。完成时服务端在同一事务内锁定仓库/商品维度、重新计算账面数量，并固定
`bookQuantity`、`actualQuantity` 与 `differenceQuantity`。正差异盘盈，负差异盘亏，零差异不生成库存流水。
反完成删除该单库存流水并清除固定结果；若会破坏任一历史时点的严格库存约束则拒绝。

### 3.11 草稿与执行载荷

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
| `sale-pricing`          | `priceLines`（产品、销售基准价、可选备注）                                               |
| `sale-order`            | `customer`、可省略并从客户带入的 `salesperson`、`productLines`                           |
| `sale-outbound`         | WFL 注入来源；客户端只传 `warehouse`、`sourceLines`                                      |
| `sale-delivery`         | WFL 注入来源；客户端只传 `platform`、`vehicle`                                           |
| `sale-signoff`          | WFL 注入来源；客户端只传 `signoffLines`                                                  |
| `order-production`      | 销售订单来源、`materialWarehouse`、`finishedWarehouse`、`productionLines`                |
| `self-production`       | `materialWarehouse`、`finishedWarehouse`、`productionLines`                              |
| `purchase-order`        | `supplier`、可省略并从供应商带入的 `purchaser`、`warehouse`、`productLines`              |
| `purchase-inquiry`      | 必填 `supplier`、`priceLines`（产品、采购询价、可选备注）                                |
| `purchase-inbound`      | WFL 注入订单来源；客户端只传实际 `warehouse` 和 `sourceLines`                            |
| 六类往来收付款实体      | 对应类型 `counterparty`、`fundAccount`、`handler`、`amount`                              |
| `expense-reimbursement` | `employee`、`expenseLines`                                                               |
| `expense-payment`       | WFL 注入来源、员工和金额；草稿只提交 `fundAccount`                                       |
| `other-income`          | `sourceName`、可选 `counterpartyType`/`counterparty`、`fundAccount`、`handler`、`amount` |

往来收付款、费用报销、费用付款和其他收入执行只传 `documentId`、`revision`，不接受日期、车辆或行字段。反向动作的
`reason` 去除首尾空白后必须为 1–1000 个 Unicode 字符。

## 4. 查询与展示语义

`query` 支持分页、单号或往来方关键字、状态、业务日期起止和客户/供应商对象 ID。排序字段白名单为 `updatedAt`、`documentNo`、`businessDate`、`status`、`amount`。
销售订单和采购订单列表额外返回 KG 履约摘要。摘要排除包装物，并使用订单行保存的
`pricingQuantityPerInventoryUnit` 将库存单位数量换算为 KG；原计量单位明细仍由 WFL 流程列表展开查看。
销售订单摘要显示订购、累计完成出库和净签收；采购订单摘要显示订购和净入库。

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "keyword": "SOR-20260726",
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
      "documentNo": "SOR-20260726-0001",
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
  "documentNo": "SOR-20260726-0001",
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

- 全部 VOU 单据均支持附件；每单最多 10 个，单文件最多 10 MiB。
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

- 全部 VOU 原子单据均能独立查询和查看，销售三类下级单据及费用付款不开放人工创建入口；
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

人工创建或执行的源单据保留当前会话用户为操作人。由订单批准、履约重算或拒收等规则自动创建、更新或删除的派生单据及其审计事件，统一归属系统用户；不将触发该规则的人工用户记为派生单据的创建人或修改人。

## 9. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

VOU 前端对接后端 `POST /vou/{entity}/{action}` 契约，为所有独立单据提供查询、查看、
审核、批准、执行、反向流转、附件和审计界面；OpenAPI 标记可创建的实体提供人工制单入口。后端领域文档和
实际请求/响应类型是业务规则来源；本文只记录前端映射和交互边界。

VOU 组件提供可嵌入的原子单据标题、状态、动作、详情、附件和审计展示。
旧居间单据和 `/wfl/intermediary-trade` 均不再注册，访问进入未找到页面。所有保留单据均按
VOU 权限提供完整能力；销售出库、销售送货和销售签收不注册公开创建 API，由 WFL 事件订阅
自动创建；费用付款由费用报销流程自动创建。采购入库允许人工创建。

### 9.1 实体与页面

| 实体                    | 页面            | 创建入口 |
| ----------------------- | --------------- | -------- |
| `sale-pricing`          | 销售定价        | 公开     |
| `sale-order`            | 销售订单        | 公开     |
| `sale-outbound`         | 销售出库        | WFL 自动 |
| `sale-delivery`         | 销售送货        | WFL 自动 |
| `sale-signoff`          | 销售签收        | WFL 自动 |
| `sale-return`           | 销售退货        | 公开     |
| `purchase-order`        | 采购订单        | 公开     |
| `purchase-inbound`      | 采购入库        | 公开     |
| `purchase-return`       | 采购退货        | 公开     |
| `purchase-inquiry`      | 采购询价        | 公开     |
| `order-production`      | 生产配货        | 公开     |
| `self-production`       | 生产自制品      | 公开     |
| `inventory-count`       | 库存盘点        | 公开     |
| `customer-receipt`      | 往来收款-客户   | 公开     |
| `supplier-receipt`      | 往来收款-供应商 | 公开     |
| `other-receipt`         | 往来收款-其他   | 公开     |
| `customer-payment`      | 往来付款-客户   | 公开     |
| `supplier-payment`      | 往来付款-供应商 | 公开     |
| `other-payment`         | 往来付款-其他   | 公开     |
| `expense-reimbursement` | 费用报销        | 公开     |
| `expense-payment`       | 费用付款        | WFL 自动 |
| `other-income`          | 其他收入        | 公开     |

实体名包含连字符，前端路由、权限路径和 API 路径必须原样使用，不得改写为 `saleorder` 等别名。

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
- 销售定价和采购询价使用无数量的价格明细。订单选择产品后批量解析参考价；业务日期、币种或采购
  供应商变化时，只自动更新尚未手工改价的行，已改价行保留实际输入并刷新参考来源提示。
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
