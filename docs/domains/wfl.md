# WFL 业务流程领域

## 1. 领域边界

WFL（Workflow）负责跨多张 VOU 原子单据的流程编排。当前流程类型为：

- `INTERMEDIARY_TRADE`：客户订单、采购、收货、送货和签收；
- `SALES_FULFILLMENT`：销售订单、销售出库、销售配送和销售签收。

流程定义版本为 `1`。
流程定义由代码注册，数据库只保存流程实例、阶段单据关联和追加式审计，不提供动态 BPM 配置。

HTTP 路径和数据结构以根目录 OpenAPI 为准；本文只维护流程状态、原子单据协作、事务和前端交互语义。

WFL 是受管单据的唯一写入口。VOU 继续负责单据编号、乐观锁、BOB 快照、附件、单据审计和事务内事件；
LED 只消费 VOU 原子单据完成及反向事件。WFL、VOU、LED 使用同一个 `pgx.Tx`，任一环节失败整体回滚。

## 2. 原子单据和关系

流程使用五类独立 VOU 单据：

| 阶段     | VOU 实体            | 编号                  |
| -------- | ------------------- | --------------------- |
| 客户订单 | `customer-order`    | `CO-YYYYMMDD-######`  |
| 采购     | `procurement-order` | `PRO-YYYYMMDD-######` |
| 收货     | `goods-receipt`     | `GR-YYYYMMDD-######`  |
| 送货     | `delivery-note`     | `DN-YYYYMMDD-######`  |
| 签收     | `signoff-note`      | `SN-YYYYMMDD-######`  |

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

## 4. 动作语义

业务入口为 `POST /wfl/intermediary-trade/{action}`。基础动作：

| 动作            | 必填请求字段                                                             | 说明                                                                    |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `query`         | 无                                                                       | 可选 `page`、`pageSize`、`keyword`、`statuses`；分页默认 1/20、最大 100 |
| `get`           | `processId`                                                              | 返回完整流程、授权后的单据正文和余额                                    |
| `create`        | `data`                                                                   | `data` 为客户订单草稿                                                   |
| `save`          | `processId`、`processRevision`、`documentId`、`documentRevision`、`data` | 只保存根客户订单草稿                                                    |
| `audit-history` | `processId`                                                              | 可选 `page`、`pageSize`，默认 1/20、最大 100                            |

根流程动作：

| 动作                                                                 | 必填请求字段                   | `reason` |
| -------------------------------------------------------------------- | ------------------------------ | -------- |
| `check`、`approve`、`short-close-confirm`                            | `processId`、`processRevision` | 不使用   |
| `uncheck`、`unapprove`                                               | `processId`、`processRevision` | 必填     |
| `short-close-request`、`short-close-cancel`、`short-close-unconfirm` | `processId`、`processRevision` | 必填     |

阶段动作矩阵：

| 阶段 | 查看              | 创建/保存/删除                                                 | 核对/反核对                                | 最终动作/反向动作                          |
| ---- | ----------------- | -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| 采购 | `procurement-get` | `procurement-create`、`procurement-save`、`procurement-delete` | `procurement-check`、`procurement-uncheck` | `procurement-place`、`procurement-unplace` |
| 收货 | `receipt-get`     | `receipt-create`、`receipt-save`、`receipt-delete`             | `receipt-check`、`receipt-uncheck`         | `receipt-confirm`、`receipt-unconfirm`     |
| 送货 | `delivery-get`    | `delivery-create`、`delivery-save`、`delivery-delete`          | `delivery-check`、`delivery-uncheck`       | `delivery-execute`、`delivery-unexecute`   |
| 签收 | `signoff-get`     | `signoff-create`、`signoff-save`、`signoff-delete`             | `signoff-check`、`signoff-uncheck`         | `signoff-confirm`、`signoff-unconfirm`     |

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
    "customer": { "objectId": "01J...", "versionId": "01J..." },
    "salesperson": { "objectId": "01J...", "versionId": "01J..." },
    "remark": "居间订单",
    "lines": [
      {
        "product": { "objectId": "01J...", "versionId": "01J..." },
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
  "supplier": { "objectId": "01J...", "versionId": "01J..." },
  "purchaser": { "objectId": "01J...", "versionId": "01J..." },
  "businessDate": "2026-07-27",
  "lines": [
    {
      "sourceLineId": "01J...",
      "quantity": "10.000000",
      "unitPrice": "20.00",
      "remark": "采购"
    }
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

## 5. 销售履约流程

销售履约入口为 `POST /wfl/sales-fulfillment/{action}`。根销售订单使用
`query/get/create/save/audit-history` 和标准生命周期动作。下级阶段只提供
`{outbound|delivery|signoff}-get/save/check/uncheck/approve/unapprove/finalize/unfinalize`，
不提供 create 或 delete；`sourceDocumentId` 由服务端写入，客户端发送时拒绝。

销售订单批准时幂等创建一张出库草稿；出库批准创建配送草稿；配送批准创建签收草稿。
出库草稿复制当时可出库行并继承日期、币种，仓库待补；配送继承出库快照，物流平台和车辆待补；
签收默认全部签收、拒收为零。系统草稿不可手工删除。反批准只会移除从未保存或流转的系统草稿，
存在保存或流转审计时拒绝反向操作。

子单据进入 `CHECKED`、`APPROVED`、`FINALIZED` 时，直接上级至少处于相同层级。上级反向流转
不得低于任一下级状态。分批出库后仍有可出库量，或签收拒收、损耗释放需求量时，事务内保证
存在且仅存在一张未处理出库草稿；父级、阶段唯一约束和行锁共同保证批准重试及并发不重复建单。

`ProcessView.documents` 对每张阶段单据统一返回 `parentDocumentId`、`sourceDocumentNo`、
业务日期、币种、金额、状态和 revision。来源是可跳转的只读信息，不是编辑字段。迁移将已有
销售四单回填为 `SALES_FULFILLMENT`，保留单据 ID、单号、revision 和审计；孤儿或非法链条
使迁移失败。旧 `/vou/sale-*` 查询、读取和历史接口保留兼容，写入统一拒绝并引导 WFL。

## 6. 审计与验收

每个原子单据保存 VOU 审计，流程同时保存 WFL 审计。物理删除阶段草稿时删除其 VOU 审计，
但 WFL 删除事件必须保存单据 ID、单号、阶段、操作者、request ID 和摘要。

验收覆盖完整五阶段、多批与并发数量、双人控制、短结、全部反向阻断、附件、LED 正反向流水、
旧 V1 单据兼容以及迁移、生成、测试、vet、build、race 和 Compose 健康检查。

## 7. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

WFL 是独立于 VOU 单据读取的流程组织领域。前端通过
`POST /wfl/{process}/{action}` 完成流程创建、编排和受控写入；流程内每张原子单据仍通过
`POST /vou/{entity}/{query|get|audit-history|attachment-download}` 提供独立只读入口。
独立单据页不得调用 VOU 写动作，也不得绕过流程的来源关系和生命周期约束。

### 7.1 通用流程层

`src/components/wfl` 提供配置驱动的流程列表、全屏工作区、阶段单据表、生命周期
动作、原因对话框和审计记录。流程定义声明阶段顺序、图标、语义终态及可用动作；
业务表单通过 slots 和事件接入。通用层只负责权限、revision、加载、脏数据保护及
动作编排，不实现动态 BPM/schema 引擎，也不理解居间数量规则。

WFL 动作值和权限路径始终使用后端 kebab-case 字面量。所有写请求分别携带
`processId/processRevision` 和需要变更的 `documentId/documentRevision`。
写操作和附件变更成功后重新读取完整 `ProcessView`，服务端状态、余额和 revision
是唯一事实来源。业务冲突保留后端 `requestId` 并提示刷新。

### 7.2 居间贸易

页面为 `/wfl/intermediary-trade`，由五类独立原子单据组成：

| 阶段     | 实体                | 数量     |
| -------- | ------------------- | -------- |
| 客户订单 | `customer-order`    | 根单一张 |
| 居间采购 | `procurement-order` | 最多一张 |
| 收货     | `goods-receipt`     | 可多张   |
| 送货     | `delivery-note`     | 可多张   |
| 签收     | `signoff-note`      | 可多张   |

查询只发送 `page`、`pageSize`、可选 `keyword` 和 `statuses`。客户订单创建业务
明细字段为 `data.lines`。采购和送货行的 `sourceLineId` 指向客户订单行；收货行
指向采购行；签收行指向送货行。创建收货、签收前必须分别通过
`procurement-get`、`delivery-get` 取得真实来源行；签收请求不发送
`deliveryChildId`。

创建和保存时，客户订单的 `businessDate`、`currency` 位于请求 `data` 中；读取
`ProcessView` 时，它们和 `amount` 一样位于各 `DocumentSummary` 顶层。各阶段
业务快照及备注位于 `DocumentSummary.data`，前端按真实响应重建可编辑草稿。

采购正文和余额中的 `procurementQuantity` 可能因权限被省略。省略表示无权限，
不是零；前端不得推断供应商、采购价或采购数量。客户订单没有附件动作，只有采购、
收货、送货和签收阶段提供附件。

核对人与本阶段最终操作人必须不同。前端在已知同一用户时禁用最终动作并说明原因，
后端冲突是最终裁决。反核对、反批准、反下单、反确认、反执行、删除草稿以及短结
动作均要求 1–1000 字原因。

### 7.3 销售履约

页面为 `/wfl/sales-fulfillment`。四个阶段在同一流程工作区展示；批准后生成的下级草稿立即
出现在对应阶段，来源单号只读且可跳回上级单据。VOU 导航提供销售订单、出库、配送、签收
四个独立只读入口，但不提供独立新建、编辑或流转。下级保存请求只发送阶段业务资料，永不发送
`sourceDocumentId`。

### 7.4 真实后端测试

WFL Playwright 不拦截业务请求。默认复用 `E2E_USERNAME`、
`E2E_REVIEWER_USERNAME` 双账号及 `E2E_VOU_*` 有效基础资料，在桌面和移动项目
执行五阶段、附件、反向动作、短结及 V1 边界。采购脱敏场景使用可选的
`E2E_WFL_REDACTED_*` 专用账号。

自动预置只有在 `E2E_WFL_BOOTSTRAP=true` 且目标明确为可按测试运行重置的隔离
测试库时才允许运行；凭证只来自 Git 忽略的 `.env.e2e.local` 或 `test-results` 临时
状态，不写入日志。未确认隔离属性时不得开启预置开关。
