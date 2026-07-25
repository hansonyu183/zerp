# LED 后端账簿域

## 1. 领域边界

LED（Ledger）负责把已执行 VOU 单据转换为可追溯的业务台账。固定领域标识为 `led`，首版包含：

```text
opening
inventory
fund
party
container
```

LED 提供库存、资金、往来流水与指定日期余额，不提供会计科目、复式记账、税额、成本计价、汇率折算、账龄、逐单核销、库存调拨或日常手工调整。

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

| VOU 实体 | 库存 | 资金 | 往来 |
| --- | --- | --- | --- |
| `sale-order` | 出库日按出库数量 `OUT` | 无 | 业务日期按签收数量与销售单价借记客户 |
| `purchase-order` | 入库日按入库数量 `IN` | 无 | 业务日期按入库数量与采购单价贷记供应商 |
| `intermediary-sale-order` | 无 | 无 | 业务日期按签收数量与销售单价借记客户，同时按采购单价贷记供应商 |
| `receipt` | 无 | 业务日期 `IN` | 业务日期贷记往来方 |
| `payment` | 无 | 业务日期 `OUT` | 业务日期借记往来方 |
| `expense-reimbursement` | 无 | 业务日期 `OUT` | 无 |
| `other-income` | 无 | 业务日期 `IN` | 无 |

销售库存按出库数量扣减，应收只按签收数量计算。拒收和损耗不形成应收。其它收入即使携带往来方也不改变往来余额。

### 2.2 执行与反执行

LED 在 VOU 写事务提交前同步订阅七类单据的执行和反执行事件，并使用事件携带的同一个 `pgx.Tx`：

- 执行追加 `POSTING` 流水；
- 反执行追加金额或数量相反的 `REVERSAL` 流水，保留原流水；
- 同一 generation、来源单据、来源行、VOU revision 和事件类型具有幂等唯一约束；
- 任一 LED 校验或写入失败时，VOU 状态、VOU 审计和 LED 写入一起回滚。

## 3. 启用、期初和重开

账簿控制状态为：

```text
DRAFT -> ACTIVE -> REOPENING -> ACTIVE
                       \---- cancel-reopen ----/
```

- 初始状态为 `DRAFT`。此时禁止新的 VOU 执行，但允许反执行部署前已有的 EXECUTED 单据；账簿查询不可用。
- `save` 完整替换期初草稿并递增 revision。库存、资金、往来各最多 1000 项，维度不得重复。
- `activate` 在一个事务内写入期初、重放当前 EXECUTED 单据、校验库存时间线并切换到新的 active generation。
- `reopen` 要求原因，复制当前 generation 的期初到草稿并进入维护模式；维护期间禁止 VOU 执行、反执行和账簿查询。
- `cancel-reopen` 放弃草稿并恢复原 active generation。
- 重开后可修改启用日；再次启用按当前 EXECUTED 单据全量重放，旧 generation 归档保留。

启用日表示当天开始时的期初。重放时，各类流水分别按自身生效日期决定是否纳入。账簿启用后，新执行单据只要存在早于启用日的应入账影响就拒绝；启用日前且未进入 active generation 的单据不得直接反执行。

期初引用使用 BOB `objectId + versionId`。新保存的引用必须是当前有效版本，并保存编码、名称、单位或币种快照。重开复制的历史快照不因 BOB 后续编辑而失效。

## 4. 严格库存

库存期初不得为负。每个仓库和商品维度的时间线按以下顺序计算：

```text
期初 -> 生效日期 -> 入账时间 -> 流水 ID
```

销售执行、采购反执行、历史重放及重开启用均要求每一个时点的运行余额不小于零。LED 使用控制行锁和仓库/商品维度事务 advisory lock 串行化竞争写入。发生冲突时返回业务冲突，不产生部分提交。

资金和往来余额允许为负。

## 5. API 契约

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
      "warehouse": {"objectId": "01...", "versionId": "01..."},
      "product": {"objectId": "01...", "versionId": "01..."},
      "quantity": "10.000000"
    }
  ],
  "fund": [
    {
      "fundAccount": {"objectId": "01...", "versionId": "01..."},
      "balanceType": "POSITIVE",
      "amount": "1000.00"
    }
  ],
  "party": [
    {
      "counterpartyType": "customer",
      "counterparty": {"objectId": "01...", "versionId": "01..."},
      "currency": "CNY",
      "balanceType": "RECEIVABLE",
      "amount": "500.00"
    }
  ],
  "container": [
    {
      "customer": {"objectId": "01...", "versionId": "01..."},
      "containerType": "SOLVENT",
      "quantity": 10
    }
  ]
}
```

`activate`、`cancel-reopen` 携带 `revision`；`reopen` 还要求不超过 1000 字的 `reason`。期初查询返回状态、revision、启用日、当前 generation 和全部期初草稿或 active 快照。

流水查询使用统一分页结构，`pageSize` 为 `1–100`。过滤字段为日期范围、对象 ID、来源实体、单号和方向；排序白名单为 `effectiveDate`、`occurredAt`、`documentNo`。余额查询必须传 `asOfDate`，并按对应业务对象维度分页。

## 6. VOU 居间销售扩展

居间销售商品行新增 `purchaseUnitPrice`：

- `unitPrice` 始终表示客户销售单价；
- `purchaseUnitPrice` 表示供应商采购单价，仅居间销售必填；
- 单据抬头总额仍为销售总额；
- 数据库列允许为空以兼容存量数据，但新建、保存、审核、批准和执行均要求非空；
- 启用重放遇到启用日后缺失采购单价的 EXECUTED 居间单据时整体失败并返回待修复单据。

`workflowVersion=2` 的居间订单不使用根单执行事件。收货确认按实收数量和采购价贷记供应商，签收确认按签收数量和销售价借记客户，并写入空桶增量；反确认追加相反的不可变流水。来源单据为阶段子单，重开账簿时同时重放已确认的 V2 收货和签收。任何订阅失败均回滚 VOU 状态、审计和全部 LED 流水。

## 7. 验收

- 期初保存、首次启用、重开、取消和修改启用日均满足 revision 与原子性；
- 七类 VOU 按映射生成正确流水，执行和反执行与 VOU 保持同事务；
- 居间销售同时生成客户借记和供应商贷记；
- 任一历史时点负库存均阻止销售执行、采购反执行或账簿重建；
- active generation 切换原子完成，旧 generation 和生命周期审计保留；
- 查询严格执行分页、过滤、排序和 as-of 日期契约；
- sqlc 生成、单元测试、数据库集成测试、vet、build、race、迁移回滚和 Compose 健康检查通过。
