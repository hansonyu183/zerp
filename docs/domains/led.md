# LED 业务账簿领域

## 1. 领域边界

LED（Ledger）负责把已执行 VOU 单据转换为可追溯的业务台账。固定领域标识为 `led`，首版包含：

```text
opening
inventory
fund
party
container
```

HTTP 路径和数据结构以根目录 OpenAPI 为准；本文只维护入账、启用、重开、余额和前端交互语义。

LED 提供库存、资金、往来流水与指定日期余额，并保存库存来源单据的价格快照；
不提供会计科目、复式记账、税额、成本计价算法、汇率折算、账龄、逐单核销、库存调拨或日常手工调整。

业务 API 使用 `POST /led/{entity}/{action}`、`application/json` 和统一业务响应包络。每条路径都是独立 APP 权限。

## 2. 入账规则

### 2.1 精度、方向和生效日期

- 数量按六位小数传输并保存为百万分之一整数。
- 金额按两位小数传输并保存为分。
- 数量乘单价沿用 VOU 的四舍五入到分规则。
- 库存方向为 `IN`、`OUT`，资金方向为 `IN`、`OUT`，往来方向为 `DEBIT`、`CREDIT`。
- 库存余额按仓库和商品聚合；资金余额按资金账户和币种聚合；往来余额按往来方和币种聚合。
- 往来净额大于零为 `RECEIVABLE`，小于零为 `PAYABLE`，等于零为 `ZERO`。
- 空桶按客户和 `SOLVENT/RESIN` 聚合；正数为客户欠桶，负数为客户多还形成的抵扣余额。

单据入账映射如下：

| VOU 实体                | 库存                   | 资金           | 往来                                     |
| ----------------------- | ---------------------- | -------------- | ---------------------------------------- |
| `sale-order`            | 无                     | 无             | 无                                       |
| `sale-outbound`         | 出库日按出库数量 `OUT` | 无             | 无                                       |
| `sale-delivery`         | 无                     | 无             | 无                                       |
| `sale-signoff`          | 无                     | 无             | 签收日按签收数量与销售单价借记客户       |
| `sale-return`           | 退货数量 `IN`          | 无             | 事后退货按原签收价贷记客户；拒收退货无   |
| `purchase-order`        | 无                     | 无             | 无                                       |
| `purchase-inbound`      | 入库日按实际数量 `IN`  | 无             | 入库日按实际数量与订单采购单价贷记供应商 |
| `purchase-return`       | 退货日按退货数量 `OUT` | 无             | 退货日按原入库价借记供应商，减少应付     |
| `order-production`      | 材料 `OUT`、成品 `IN`  | 无             | 无                                       |
| `self-production`       | 材料 `OUT`、成品 `IN`  | 无             | 无                                       |
| `receipt`               | 无                     | 业务日期 `IN`  | 业务日期贷记往来方                       |
| `payment`               | 无                     | 业务日期 `OUT` | 业务日期借记往来方                       |
| `expense-reimbursement` | 无                     | 业务日期 `OUT` | 无                                       |
| `other-income`          | 无                     | 业务日期 `IN`  | 无                                       |

销售库存由出库单扣减，拒收及签收后退货均由销售退货单重新入库；应收只按签收数量形成，
其中签收后退货按原价冲减应收，拒收和损耗不形成应收。
其他收入即使携带往来方也不改变往来余额。

### 2.2 最终处理与反最终处理

LED 在 VOU 写事务提交前同步订阅需要入账的单据最终处理和反最终处理事件，并使用事件携带的同一个 `pgx.Tx`：

- 最终处理追加 `POSTING` 流水；
- 反最终处理删除当前 generation 内该来源单据的库存、资金、往来和空桶流水；
- 重新最终处理按最新 VOU revision 重新生成流水；
- 同一 generation、来源单据、来源行和 VOU revision 具有幂等唯一约束；
- 任一 LED 校验或写入失败时，VOU 状态、VOU 审计和 LED 写入一起回滚。

VOU 审计保留最终处理、反最终处理的操作者、时间和原因。LED 只表达当前有效业务结果，
不再通过冲销行重复承担操作审计。

## 3. 启用、期初和重开

账簿控制状态为：

```text
DRAFT -> ACTIVE -> REOPENING -> ACTIVE
                       \---- cancel-reopen ----/
```

- 初始状态为 `DRAFT`。此时禁止新的 VOU 最终处理，但允许反最终处理部署前已有的 `FINALIZED` 单据；账簿查询不可用。
- `save` 完整替换期初草稿并递增 revision。库存、资金、往来各最多 1000 项，维度不得重复。
- `activate` 在一个事务内写入期初、重放当前 `FINALIZED` 单据、校验库存时间线并切换到新的 active generation。
- `reopen` 要求原因，复制当前 generation 的期初到草稿并进入维护模式；维护期间禁止 VOU 最终处理、反最终处理和账簿查询。
- `cancel-reopen` 放弃草稿并恢复原 active generation。
- 重开后可修改启用日；再次启用按当前 `FINALIZED` 单据全量重放，旧 generation 归档保留。

启用日表示当天开始时的期初。重放时，各类流水分别按自身生效日期决定是否纳入。账簿启用后，新执行单据只要存在早于启用日的应入账影响就拒绝；启用日前且未进入 active generation 的单据不得直接反执行。

期初引用使用 BOB `objectId + versionId`。新保存的引用必须是当前有效版本，并保存编码、名称、单位或币种快照。重开复制的历史快照不因 BOB 后续编辑而失效。

## 4. 严格库存

库存期初不得为负。每个仓库和商品维度的时间线按以下顺序计算：

```text
期初 -> 生效日期 -> 入账时间 -> 流水 ID
```

销售出库最终处理、采购反最终处理、历史重放及重开启用均要求每一个时点的运行余额不小于零。LED 使用控制行锁和仓库/商品维度事务 advisory lock 串行化竞争写入。发生冲突时返回业务冲突，不产生部分提交。

资金和往来余额允许为负。

## 5. 动作语义

期初与生命周期：

```text
POST /led/opening/get
POST /led/opening/save
POST /led/opening/activate
POST /led/opening/reopen
POST /led/opening/cancel-reopen
POST /led/opening/audit-history
```

流水和余额：

```text
POST /led/inventory/query
POST /led/inventory/balance
POST /led/fund/query
POST /led/fund/balance
POST /led/party/query
POST /led/party/balance
POST /led/container/query
POST /led/container/balance
```

`opening/save` 请求结构：

```json
{
  "revision": 1,
  "cutoverDate": "2026-01-01",
  "inventory": [
    {
      "warehouse": { "objectId": "01...", "versionId": "01..." },
      "product": { "objectId": "01...", "versionId": "01..." },
      "quantity": "10.000000",
      "unitPrice": "12.50",
      "currency": "CNY"
    }
  ],
  "fund": [
    {
      "fundAccount": { "objectId": "01...", "versionId": "01..." },
      "balanceType": "POSITIVE",
      "amount": "1000.00"
    }
  ],
  "party": [
    {
      "counterpartyType": "customer",
      "counterparty": { "objectId": "01...", "versionId": "01..." },
      "currency": "CNY",
      "balanceType": "RECEIVABLE",
      "amount": "500.00"
    }
  ],
  "container": [
    {
      "customer": { "objectId": "01...", "versionId": "01..." },
      "containerType": "SOLVENT",
      "quantity": 10
    }
  ]
}
```

`activate`、`cancel-reopen` 携带 `revision`；`reopen` 还要求不超过 1000 字的 `reason`。期初查询返回状态、revision、启用日、当前 generation 和全部期初草稿或 active 快照。

`opening/get` 使用空对象。生命周期请求及成功响应：

```json
{
  "revision": 2,
  "reason": "修正上线期初"
}
```

`reason` 只用于 `reopen`，去除首尾空白后为 1–1000 个 Unicode 字符。`activate` 和
`cancel-reopen` 只传 `revision`。成功 `data` 为：

```json
{
  "status": "ACTIVE",
  "revision": 3,
  "generationId": "01J..."
}
```

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
- `sourceEntity` 可为 `opening` 或七类当前记账 VOU 实体。后端继续接受
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

`opening/audit-history` 请求为 `{"page":1,"pageSize":20}`；两个分页字段均必填且为正数，
`pageSize` 最大 100。响应返回生命周期事件、前后状态、generation、revision、操作者、原因、
requestId 和摘要。

## 6. WFL 履约扩展

LED 订阅十一类会记账 VOU 原子单据的最终处理与反最终处理事件：销售出库、销售签收、
销售退货、采购入库、采购退货、生产配货、生产自制品、往来收款、往来付款、费用报销和其他收入。
已删除的居间流程和五类居间单据不再作为流水来源；迁移同时删除其既有 LED 流水。
两类生产单按实际领料生成无价格的材料出库流水，并按成品数量生成无价格的成品入库流水；
两组流水必须同事务成功或回滚。

采购履约中，`purchase-order` 不记账；`purchase-inbound` 最终处理时按实际仓库和数量增加库存，
并按订单继承的采购单价贷记供应商。反最终处理追加反向流水，订单自动完成或重新打开不产生流水。

## 7. 验收

- 期初保存、首次启用、重开、取消和修改启用日均满足 revision 与原子性；
- 需要记账的 VOU/WFL 原子单据按映射生成正确流水，执行和反执行与 VOU 保持同事务；
- 九类会记账 VOU 单据生成各自正确的库存、资金和往来流水；
- 任一历史时点负库存均阻止销售执行、采购反执行或账簿重建；
- active generation 切换原子完成，旧 generation 和生命周期审计保留；
- 查询严格执行分页、过滤、排序和 as-of 日期契约；
- sqlc 生成、单元测试、数据库集成测试、vet、build、race、迁移回滚和 Compose 健康检查通过。

## 8. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

LED（Ledger）把已经执行或最终确认的 VOU/WFL 业务结果展示为可追溯台账。前端通过 `POST /led/{entity}/{action}` 连接真实后端，不在浏览器计算或持久化权威余额。

### 8.1 实体与页面

| 实体        | 页面       | 主要能力                                     |
| ----------- | ---------- | -------------------------------------------- |
| `opening`   | 期初与启用 | 维护期初、启用账簿、重开、取消重开和查看审计 |
| `inventory` | 库存台账   | 查询仓库与商品流水、指定日期余额             |
| `fund`      | 资金台账   | 查询资金账户流水、指定日期余额               |
| `party`     | 往来台账   | 查询客户或供应商借贷流水、指定日期余额       |
| `container` | 空桶台账   | 查询客户空桶增量和指定日期欠桶余额           |

页面路由分别为 `/led/opening`、`/led/inventory`、`/led/fund`、`/led/party` 和 `/led/container`。每个动作使用独立 APP 权限；没有 `query` 或 `balance` 权限时，不发起对应请求。

### 8.2 期初与生命周期

账簿状态为：

```text
DRAFT -> ACTIVE -> REOPENING -> ACTIVE
                       \---- cancel-reopen ----/
```

- `get` 使用空对象读取当前状态、revision、启用日、generation 和期初明细。
- `save` 完整提交库存、资金、往来和空桶期初，并携带当前 revision。
- `activate` 启用或重新启用账簿；存在未保存修改时前端阻止直接启用。
- `reopen` 必须填写原因；`cancel-reopen` 放弃本次重开维护。
- `audit-history` 使用分页请求读取生命周期审计。
- 期初引用只从当前有效 BOB 对象中选择，并同时提交 `objectId` 和 `versionId`。

前端只在 `DRAFT` 或 `REOPENING` 状态开放编辑。服务端状态、revision、generation 和重新加载后的完整响应始终是唯一事实来源。

### 8.3 流水与余额

四类台账共用查询工作区：

- 流水查询需要 `dateFrom` 和 `dateTo`，默认本月第一天至今天；
- 余额查询需要 `asOfDate`，默认今天；
- 两种查询均支持分页和可选对象过滤；
- 流水可按来源实体、来源单号和适用方向过滤；
- 金额及普通数量保持后端返回的十进制字符串，不转换为浮点数；
- 反最终处理删除来源单据当前有效流水；操作原因仍保留在 VOU 审计中。

库存按仓库与商品聚合；资金按账户与币种聚合；往来按往来方与币种聚合；空桶按客户与桶型聚合。负库存、入账原子性及历史重放由后端裁决，前端不得根据当前列表自行推断可执行性。

### 8.4 真实后端测试

Playwright 不拦截 LED 请求。只有设置 `E2E_LED_READONLY=1` 且目标为已启用账簿的隔离后端时才运行 LED 场景；测试仅执行查询和余额读取，不保存期初、不启用或重开账簿。缺少条件时应明确跳过，不能以模拟响应替代。
