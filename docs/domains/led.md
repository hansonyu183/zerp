# LED 业务账簿领域

## 1. 领域边界

LED（Ledger）负责把已批准 VOU 单据转换为可追溯的业务台账。固定领域标识为 `led`，首版包含：

```text
closing
inventory
fund
party
container
asset
```

HTTP 路径和数据结构以根目录 OpenAPI 为准；本文只维护入账、结账、期初、余额和前端交互语义。

LED 提供库存、资金、往来流水与指定日期余额，并保存库存来源单据的价格快照；
不提供会计科目、复式记账、税额、汇率折算、账龄、逐单核销或库存调拨；库存数量调整仅允许通过完成的库存盘点单产生。
库存成本仅在月末结账时按本期流水计算，不改变日常流水保存的来源价格快照。

业务 API 使用 `POST /led/{entity}/{action}`、`application/json` 和统一业务响应包络。每条路径都是独立 APP 权限。

## 2. 入账规则

### 2.1 精度、方向和生效日期

- 数量按六位小数传输并保存为百万分之一整数。
- 金额按两位小数传输并保存为分。
- 数量乘单价沿用 VOU 的四舍五入到分规则。
- 库存方向为 `IN`、`OUT`，资金方向为 `IN`、`OUT`，往来方向为 `DEBIT`、`CREDIT`。
- 库存余额按仓库和商品聚合；资金余额按资金账户和币种聚合；往来余额按往来方和币种聚合。
- 员工往来只接受日常员工借款、还款和核销，不提供期初录入。
- 往来净额大于零为 `RECEIVABLE`，小于零为 `PAYABLE`，等于零为 `ZERO`。
- 空桶按客户和 `SOLVENT/RESIN` 聚合；正数为客户欠桶，负数为客户多还形成的抵扣余额。

单据入账映射如下：

| VOU 实体                 | 库存                   | 资金                                   | 往来                                     |
| ------------------------ | ---------------------- | -------------------------------------- | ---------------------------------------- |
| `sale-order`             | 无                     | 无                                     | 无                                       |
| `sale-outbound`          | 出库日按出库数量 `OUT` | 无                                     | 无                                       |
| `sale-delivery`          | 无                     | 无                                     | 无                                       |
| `sale-signoff`           | 无                     | 无                                     | 签收日按签收数量与销售单价借记客户       |
| `sale-return`            | 退货数量 `IN`          | 无                                     | 事后退货按原签收价贷记客户；拒收退货无   |
| `purchase-order`         | 无                     | 无                                     | 无                                       |
| `purchase-inbound`       | 入库日按实际数量 `IN`  | 无                                     | 入库日按实际数量与订单采购单价贷记供应商 |
| `purchase-return`        | 退货日按退货数量 `OUT` | 无                                     | 退货日按原入库价借记供应商，减少应付     |
| `inventory-count`        | 盘点日按差异 `IN/OUT`  | 无                                     | 无                                       |
| `order-production`       | 材料 `OUT`、成品 `IN`  | 无                                     | 无                                       |
| `self-production`        | 材料 `OUT`、成品 `IN`  | 无                                     | 无                                       |
| `receipt`                | 无                     | 业务日期 `IN`                          | 业务日期贷记往来方                       |
| `payment`                | 无                     | 业务日期 `OUT`                         | 业务日期借记往来方                       |
| `employee-loan`          | 无                     | 业务日期 `OUT`                         | 业务日期借记员工                         |
| `employee-repayment`     | 无                     | 业务日期 `IN`                          | 业务日期贷记员工                         |
| `employee-loan-writeoff` | 无                     | 无                                     | 业务日期贷记员工                         |
| `expense-reimbursement`  | 无                     | 新单据无；历史直付单据为业务日期 `OUT` | 无                                       |
| `expense-payment`        | 无                     | 业务日期 `OUT`                         | 无                                       |
| `other-income`           | 无                     | 业务日期 `IN`                          | 无                                       |
| `asset-acquisition`      | 无                     | 无                                     | 按资产行原值贷记供应商，形成应付         |
| `asset-depreciation`     | 无                     | 无                                     | 无                                       |
| `asset-sale`             | 无                     | 无                                     | 按出让金额借记客户或其他往来方，形成应收 |
| `asset-liquidation`      | 无                     | 无                                     | 无                                       |

销售库存由出库单扣减，拒收及签收后退货均由销售退货单重新入库；应收只按签收数量形成，
其中签收后退货按原价冲减应收，拒收和损耗不形成应收。
其他收入即使携带往来方也不改变往来余额。
四类资产单据同时写入固定资产台账：购置创建在用资产卡片，折旧增加累计折旧，出让改为 `SOLD`，清算改为 `RETIRED`。资产卡片保留类别、部门、保管人、原值、残值、期限和来源快照；折旧采用 VOU 已确定的只读金额。

### 2.2 批准入账与反审撤销

LED 在 VOU 写事务提交前同步订阅需要入账的单据批准和反审事件，并使用事件携带的同一个 `pgx.Tx`：

- 批准追加 `POSTING` 流水；
- 反审删除当前 generation 内该来源单据的库存、资金、往来、空桶、票据和固定资产当前态；
- 重新批准按最新 VOU revision 重新生成流水；
- 同一 generation、来源单据、来源行和 VOU revision 具有幂等唯一约束；
- 任一 LED 校验或写入失败时，VOU 状态、VOU 审计和 LED 写入一起回滚。

VOU 审计保留批准、反审的操作者、时间和原因。LED 只表达当前有效业务结果，
不再通过冲销行重复承担操作审计。由 VOU 事件自动生成的流水、操作字段和 LED 审计事件统一归属系统用户；VOU 源动作的人工操作人仅保留在 VOU 审计中。

### 2.3 票据台账

LED 使用 `led_bills` 保存票据稳定身份与固定资料，使用 `led_bill_entries` 保存当前 generation 的位置、方向和用途流水；可用状态不作为可变列保存，而是按同票据、同位置的有效 `IN - OUT` 流水计算。收票完成以 `ASSET/IN` 写入，付票完成以 `PRIMARY/ASSET/OUT` 写入并借记供应商往来；开票完成创建票据主档并以 `PRIMARY/LIABILITY/IN` 写入，同样借记供应商；贴现完成锁定未到期资产票据并以 `PRIMARY/ASSET/OUT` 写入。到期收款完成锁定已到期资产票据并以 `PRIMARY/ASSET/OUT` 写入，到期付款完成锁定已到期负债票据并以 `PRIMARY/LIABILITY/OUT` 写入；两者按真实现金方向形成资金流水且不形成往来流水。付票/贴现入账时逐张锁定可用票据，因此同票据并发操作只有一个事务可成功；开票或贴现的第三方应付利息仅写其他往来贷方流水，不伪造资金流水。反完成仅删除该 generation 的来源流水，若存在下游有效流水则拒绝。票据资料的业务重复键由 `led_bills` 唯一约束保护。

## 3. 月末结账与期初

LED 以当前活动 generation 的切换日和库存、资金、往来、空桶期初为基线，按批准时间重放切换日及以后的已入账单据，之后持续接收入账事件并保留完整历史流水。尚无活动 generation 时才以公元 `0001-01-01` 的零余额初始化。入账时点升级等系统重建必须继承原活动 generation 的切换日和四类期初，不得把既有期初改成零余额。

- 结账日必须是早于当天的自然月末、晚于最近结账日；允许跳过月份。
- 结账前，结账日及以前的全部 VOU 单据必须为 `FINALIZED`。
- 最近一次有效结账的库存、资金、往来和空桶余额是下一期只读期初，期初日为结账日次日。
- 尚无结账时四类期初均为空并视为零，单据业务日期不受期初日限制。
- 结账日及以前禁止新增回填、保存、删除、状态流转、批准/反审和附件增删；查询、审计和附件下载不受影响。
- 允许具有独立权限的用户填写原因后反结最近一期；反结后冻结边界退回上一有效结账日。
- 结账与所有单据写操作共享数据库事务锁和最终数据库触发器，避免并发越过冻结边界。

结账不切断或删除历史流水。结账快照引用使用流水中最新的 BOB `objectId + versionId` 与编码、名称、单位快照。

## 4. 严格库存

库存期初不得为负。每个仓库和商品维度的时间线按以下顺序计算：

```text
生效日期 -> 入账时间 -> 流水 ID
```

销售出库批准、采购反审、历史重放及结账成本计算均要求每一个时点的运行余额不小于零。LED 使用控制行锁和仓库/商品维度事务 advisory lock 串行化竞争写入。发生冲突时返回业务冲突，不产生部分提交。

资金和往来余额允许为负。

## 5. 动作语义

结账与期初：

```text
POST /led/closing/get
POST /led/closing/close
POST /led/closing/unclose
POST /led/closing/history
```

流水和余额：

```text
POST /led/inventory/query
POST /led/inventory/balance
POST /led/fund/query
POST /led/fund/balance
POST /led/customer/query
POST /led/customer/balance
POST /led/supplier/query
POST /led/supplier/balance
POST /led/other/query
POST /led/other/balance
POST /led/employee/query
POST /led/employee/balance
POST /led/asset/query
POST /led/asset/get
POST /led/container/query
POST /led/container/balance
POST /led/bill/query
```

`closing/close` 请求结构：

```json
{
  "revision": 1,
  "closingDate": "2026-06-30"
}
```

`closing/unclose` 携带 revision 和去除首尾空白后 1–1000 字的 reason。`closing/get`
使用空对象，返回 revision、最近结账日、期初日，以及库存、资金、往来和空桶非零余额快照。
库存期初包含数量、固定 `CNY` 和结账成本金额。结账成功响应：

```json
{
  "revision": 2,
  "latestClosingDate": "2026-06-30",
  "openingDate": "2026-07-01"
}
```

结账成本按上次结账次日至本次结账日的库存流水顺序集中计算；首次结账以当前 generation 的库存期初数量和成本金额为初始余额，并处理切换日至结账日的库存流水。
顺序为生效日期、入账时间、来源单据和流水 ID。采购入库按采购金额入账，出库按当时移动加权平均成本，
销售退货转回原出库成本，生产先计算实际领料成本再归集到对应成品。部分出库四舍五入到分，全部出清时
取走剩余全部成本。当前版本成本币种仅支持 CNY；无法完整计价时拒绝结账。

流水查询使用统一分页结构，`pageSize` 为 `1–100`，`dateFrom`、`dateTo` 必填：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "dateFrom": "2026-07-01",
    "dateTo": "2026-07-31",
    "objectId": "01J...",
    "sourceEntity": "sale-order",
    "documentNo": "SOR-20260726",
    "direction": ["OUT"]
  },
  "sort": [{ "field": "effectiveDate", "order": "desc" }]
}
```

- `objectId` 按实体匹配仓库/商品、资金账户、往来方或客户任一相关对象；
- `sourceEntity` 可为 `opening` 或第 6 节所列当前会记账的 VOU 实体。后端继续接受
  `intermediary-receipt`、`intermediary-signoff` 两个历史值以兼容旧客户端，但迁移已删除
  对应流水，当前页面不再提供这两个筛选项；
- inventory/fund 的 `direction` 只允许 `IN`、`OUT`，party 只允许 `DEBIT`、`CREDIT`，
  container 不接受方向过滤；
- `documentNo` 最多 200 个 Unicode 字符；
- `sort` 最多一项，字段白名单为 `effectiveDate`、`occurredAt`、`documentNo`，方向严格为
  `asc` 或 `desc`；省略时使用 `effectiveDate desc`。

查询成功返回 `{items,total,page,pageSize}`。各实体 item 的稳定字段：

| 实体      | 公共来源字段之外的字段                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| inventory | `direction`、`quantity`、`warehouse`、`product`、`unitPrice`、`amount`、`currency`、`remark` |
| fund      | `direction`、`amount`、`fundAccount`、`currency`                                             |
| party     | `direction`、`amount`、`counterpartyType`、`counterparty`、`currency`                        |
| container | `customer`、`containerType`、有符号整数 `quantity`，以及可选根流程单号                       |

公共来源字段为 `id`、`entryType`、`sourceEntity`、来源单据/行/revision、`effectiveDate`、
`occurredAt` 和可选 `remark`。金额、单价及普通数量仍以十进制字符串返回；空桶数量为整数。
库存价格是来源单据价格快照：销售出库与销售退货保存销售价，采购入库与采购退货保存采购价。
它不等同于系统计算的出库成本。

余额查询必须传 `asOfDate`：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "asOfDate": "2026-07-31",
    "objectId": "01J..."
  }
}
```

余额同样返回统一分页结构。inventory 按 `warehouse + product` 返回 `quantity`；fund 按
`fundAccount + currency` 返回 `balanceType + amount`；party 按
`counterpartyType + counterparty + currency` 返回 `balanceType + amount`；container 按
`customer + containerType` 返回整数 `quantity`。

`closing/history` 请求为 `{"page":1,"pageSize":20}`；两个分页字段均必填且为正数，
`pageSize` 最大 100。响应返回生命周期事件、前后状态、generation、revision、操作者、原因、
requestId 和摘要。

## 6. WFL 履约扩展

LED 订阅会记账 VOU 原子单据的批准与反审事件：销售出库、销售签收、
销售退货、采购入库、采购退货、库存盘点、生产配货、生产自制品、六类往来收付款、员工借款、员工还款、
员工借款核销、费用报销、费用付款、其他收入，以及资产购置、折旧、出让和清算。
已删除的居间流程和五类居间单据不再作为流水来源；迁移同时删除其既有 LED 流水。
两类生产单按实际领料生成无价格的材料出库流水，并按成品数量生成无价格的成品入库流水；
两组流水必须同事务成功或回滚。

采购履约中，`purchase-order` 不记账；`purchase-inbound` 批准时按实际仓库和数量增加库存，
并按订单继承的采购单价贷记供应商。反审删除该来源的当前有效流水，订单自动完成或重新打开不产生流水。

库存盘点单批准时按固定差异生成库存流水。盘亏在月末结账时按当时移动加权平均成本出库；盘盈前
存在库存时按当时移动加权平均成本入库。盘盈前数量为零时，取盘点日及之前该商品跨仓最近一次
采购入库价；没有可用采购价时拒绝结账并返回来源盘点单和商品行。

## 7. 验收

- 首次结账、跳月结账、反结最近一期和四类期初快照满足 revision 与原子性；
- 需要记账的 VOU/WFL 原子单据按映射生成正确流水，批准入账和反审撤销与 VOU 保持同事务；
- 各类会记账 VOU 单据生成正确的库存、资金、往来或固定资产流水；
- 任一历史时点负库存均阻止销售批准、采购反审或账簿重建；
- 完整历史 generation、结账快照和结账审计均保留且相互一致；
- 查询严格执行分页、过滤、排序和 as-of 日期契约；
- sqlc 生成、单元测试、数据库集成测试、vet、build、race、迁移回滚和 Compose 健康检查通过。

## 8. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

LED（Ledger）把已经执行或最终确认的 VOU/WFL 业务结果展示为可追溯台账。前端通过 `POST /led/{entity}/{action}` 连接真实后端，不在浏览器计算或持久化权威余额。

### 8.1 实体与页面

| 实体        | 页面            | 主要能力                                           |
| ----------- | --------------- | -------------------------------------------------- |
| `closing`   | 期初与结账      | 查看只读期初、执行月末结账、反结最近一期和查看历史 |
| `inventory` | 库存台账        | 查询仓库与商品流水、指定日期余额                   |
| `fund`      | 资金台账        | 查询资金账户流水、指定日期余额                     |
| `customer`  | 往来台账-客户   | 查询客户借贷流水、指定日期余额                     |
| `supplier`  | 往来台账-供应商 | 查询供应商借贷流水、指定日期余额                   |
| `other`     | 往来台账-其他   | 查询其他往来单位借贷流水、指定日期余额             |
| `employee`  | 往来台账-员工   | 查询员工借还及核销流水、指定日期余额               |
| `container` | 空桶台账        | 查询客户空桶增量和指定日期欠桶余额                 |
| `asset`     | 固定资产台账    | 查询资产卡片、折旧余额、状态和完整变动历史         |

页面路由分别为 `/led/closing`、`/led/inventory`、`/led/fund`、`/led/customer`、`/led/supplier`、`/led/other`、`/led/employee`、`/led/container`、`/led/asset` 和 `/led/bill`。四类往来台账由服务端固定隔离往来方类型。每个动作使用独立 APP 权限；没有相应权限时不发起请求，其中员工台账没有 `query` 或 `balance` 权限时不发起对应请求。

### 8.2 期初与结账

- `get` 使用空对象读取 revision、最近结账日、期初日和四类只读期初。
- `close` 选择已过去的自然月末并携带当前 revision。
- `unclose` 只反结最近一期且必须填写原因。
- `history` 使用分页请求读取有效和已反结记录。
- 无结账时页面明确显示期初为零且日期不限；期初数据没有编辑入口。
- 服务端 revision、结账边界和重新加载后的完整响应始终是唯一事实来源。

### 8.3 流水与余额

四类台账共用查询工作区：

- 流水查询需要 `dateFrom` 和 `dateTo`，默认本月第一天至今天；
- 余额查询需要 `asOfDate`，默认今天；
- 两种查询均支持分页和可选对象过滤；
- 流水可按来源实体、来源单号和适用方向过滤；
- 金额及普通数量保持后端返回的十进制字符串，不转换为浮点数；
- 反审删除来源单据当前有效流水；操作原因仍保留在 VOU 审计中。

库存按仓库与商品聚合；资金按账户与币种聚合；往来按往来方与币种聚合；空桶按客户与桶型聚合。负库存、入账原子性及历史重放由后端裁决，前端不得根据当前列表自行推断可执行性。

### 8.4 真实后端测试

Playwright 不拦截 LED 请求。只有设置 `E2E_LED_READONLY=1` 且目标为隔离后端时才运行 LED
只读场景；测试仅读取期初、结账历史、流水和余额，不执行结账或反结账。缺少条件时应明确跳过，
不能以模拟响应替代。
