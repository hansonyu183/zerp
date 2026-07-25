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

业务入口为 `POST /wfl/intermediary-trade/{action}`：

```text
query get create save check uncheck approve unapprove audit-history
short-close-request short-close-cancel short-close-confirm short-close-unconfirm
procurement-create/get/save/delete/check/uncheck/place/unplace
receipt-create/get/save/delete/check/uncheck/confirm/unconfirm
delivery-create/get/save/delete/check/uncheck/execute/unexecute
signoff-create/get/save/delete/check/uncheck/confirm/unconfirm
{procurement|receipt|delivery|signoff}-attachment-initiate/download/remove
```

公共写请求携带 `processId`、`processRevision`、`documentId`、`documentRevision`、可选 `data` 和 `reason`；
创建流程时只传客户订单草稿。响应返回流程 revision、流程状态、阶段单据 ID/单号/revision/语义状态、
`parentDocumentId` 和累计数量与空桶余额。

流程单据摘要统一返回 `currency`；授权后的单据正文 `data` 统一返回单据级 `remark`，空备注返回空字符串，
使五类草稿都能按读取值安全回写。采购正文、采购备注和采购价只对拥有 `procurement-get` 权限的用户返回。
附件继续使用 VOU 文件字节流令牌端点。

## 5. 审计与验收

每个原子单据保存 VOU 审计，流程同时保存 WFL 审计。物理删除阶段草稿时删除其 VOU 审计，
但 WFL 删除事件必须保存单据 ID、单号、阶段、操作者、request ID 和摘要。

验收覆盖完整五阶段、多批与并发数量、双人控制、短结、全部反向阻断、附件、LED 正反向流水、
旧 V1 单据兼容以及迁移、生成、测试、vet、build、race 和 Compose 健康检查。
