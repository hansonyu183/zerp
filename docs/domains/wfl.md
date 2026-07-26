# WFL 前端业务流程域

WFL 是独立于 VOU 查询的流程领域。前端通过
`POST /wfl/intermediary-trade/{action}` 对接当前后端 WFL 契约，不把流程结果并入
`/vou/{entity}`，也不为流程内实体注册可直接调用的旧 VOU 页面。

## 通用流程层

`src/components/wfl` 提供配置驱动的流程列表、全屏工作区、阶段单据表、生命周期
动作、原因对话框和审计记录。流程定义声明阶段顺序、图标、语义终态及可用动作；
业务表单通过 slots 和事件接入。通用层只负责权限、revision、加载、脏数据保护及
动作编排，不实现动态 BPM/schema 引擎，也不理解居间数量规则。

WFL 动作值和权限路径始终使用后端 kebab-case 字面量。所有写请求分别携带
`processId/processRevision` 和需要变更的 `documentId/documentRevision`。
写操作和附件变更成功后重新读取完整 `ProcessView`，服务端状态、余额和 revision
是唯一事实来源。业务冲突保留后端 `requestId` 并提示刷新。

## 居间贸易

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

## 真实后端测试

WFL Playwright 不拦截业务请求。默认复用 `E2E_USERNAME`、
`E2E_REVIEWER_USERNAME` 双账号及 `E2E_VOU_*` 有效基础资料，在桌面和移动项目
执行五阶段、附件、反向动作、短结及 V1 边界。采购脱敏场景使用可选的
`E2E_WFL_REDACTED_*` 专用账号。

自动预置只有在 `E2E_WFL_BOOTSTRAP=true` 且目标明确为可按测试运行重置的隔离
测试库时才允许运行；凭证只来自 Git 忽略的 `.env.e2e.local` 或 `test-results` 临时
状态，不写入日志。未确认隔离属性时不得开启预置开关。
