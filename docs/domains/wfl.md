# WFL 前端业务流程域

WFL 是独立于 VOU 查询的流程领域。前端通过
`POST /wfl/intermediary-trade/{action}` 对接后端 PR #12，不把流程结果并入
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

| 阶段 | 实体 | 数量 |
| --- | --- | --- |
| 客户订单 | `customer-order` | 根单一张 |
| 居间采购 | `procurement-order` | 最多一张 |
| 收货 | `goods-receipt` | 可多张 |
| 送货 | `delivery-note` | 可多张 |
| 签收 | `signoff-note` | 可多张 |

查询只发送 `page`、`pageSize`、可选 `keyword` 和 `statuses`。客户订单创建业务
明细字段为 `data.lines`。采购和送货行的 `sourceLineId` 指向客户订单行；收货行
指向采购行；签收行指向送货行。创建收货、签收前必须分别通过
`procurement-get`、`delivery-get` 取得真实来源行；签收请求不发送
`deliveryChildId`。

采购正文和余额中的 `procurementQuantity` 可能因权限被省略。省略表示无权限，
不是零；前端不得推断供应商、采购价或采购数量。客户订单没有附件动作，只有采购、
收货、送货和签收阶段提供附件。

核对人与本阶段最终操作人必须不同。前端在已知同一用户时禁用最终动作并说明原因，
后端冲突是最终裁决。反核对、反批准、反下单、反确认、反执行、删除草稿以及短结
动作均要求 1–1000 字原因。

## 当前后端契约边界

PR #12 的 `DocumentSummary` 当前没有返回客户订单的 `currency`、`remark` 和
各阶段备注。前端不会伪造这些字段；重新打开的客户订单草稿在缺少币种时禁止保存，
已保存的阶段草稿在缺少备注时只读展示，直到后端补全可往返的编辑契约。新建后的
流程展示和后续阶段不使用本地数据兜底。

## 真实后端测试

WFL Playwright 不拦截业务请求。自动预置只有在
`E2E_WFL_BOOTSTRAP=true` 且目标明确为隔离测试库时才允许运行；凭证只来自
Git 忽略的本地环境文件或 `test-results` 临时状态，不写入日志。未开启安全开关
或缺少隔离库确认时，WFL 预置测试必须停止并报告配置缺失。
