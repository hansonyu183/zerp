# DCL 仓库 Draft 与 Submission 页面用例

权威业务规则见 [DCL 仓库申报](../../domains/dcl.md#31-仓库申报)、[BOB 当前有效资料职责](../../domains/bob.md) 与 [Approval Version](../../domains/approval.md#6-approval-version)。#362 的目标线协议由 `apps/api/src/app/contract.ts` 的可执行 Hono/Zod 路由生成；#366 前它只属于隔离 target，不与 live OpenAPI、Go 路由或权限目录组合。

## 1. 页面、Draft 与列表

1. 隔离 target 页面入口为 `/target.html`。页面通过 `frontend/src/target/api.ts` 使用从 Hono `AppType` 推导的客户端，不调用或代理 live Go API。
2. 新建和编辑均先创建当前登录用户、当前设备命名空间内的 IndexedDB Draft。Draft 使用客户端生成的 draft ID、stable subject ID、Submission ID 与 idempotency key，记录完整仓库表单和引用显示值；自动持久化、刷新恢复和本地删除不发送 HTTP 请求。
3. 页面明确提示 Draft 仅保存在当前设备。已持久化 Submission 不可原地编辑；变更正式仓库或修正开放 Submission 时，先克隆为新的本地 Draft。
4. 列表与详情同时展示 latest `APPROVED` 和唯一开放的 `PENDING`/`REJECTED` Submission。`REJECTED` 必须持续可查询、查看、克隆和按权限删除或恢复审核。

## 2. 提交与服务端权威复核

1. 提交前浏览器以共享 TypeScript model 规范化 `name`、`address`、`contactName`、`contactPhone`、`managerEmployeeId`、`remark` 与 `enabled`，刷新需要的引用事实并给出即时建议；浏览器结果不授予权限。
2. 新 stable subject 使用 `POST /dcl/warehouse/submit-new`；已有正式仓库的下一版本使用 `POST /dcl/warehouse/submit-change`。`submit` 只是页面意图，不是持久化 Submission action。
3. Hono 重新认证会话、校验 CSRF 与精确路由权限，在同一 PostgreSQL transaction 内锁定 subject、读取当前版本与引用事实、再次运行同一个共享 model，再分配服务端 code、version、revision 与时间并写入 stable subject、不可变 typed snapshot、`PENDING` Approval Entry 与 `SUBMITTED` event。
4. 服务器从当前事实判断 `submit-new` 或 `submit-change`，拒绝错误模式、重复 client ID、开放候选、旧 latest-approved fact 和不可用引用。稳定错误和结构化 blocker 由响应 `errorKey`/`data` 表达，不按 `message` 分支，也不自动替换引用或重放请求。
5. Submission ID 同时作为 idempotency key。相同 key 与相同规范化请求返回第一次结果；相同 key 携带不同请求返回稳定冲突。任何失败都不得留下 subject、snapshot、Approval Entry、event 或半成品版本，且本地 Draft 保留。

## 3. 审批、删除、回落与引用

1. 唯一持久状态是 `PENDING | APPROVED | REJECTED`。页面只按共享 model View State 和服务端当前事实展示 `approve`、`reject`、`unreject`、`unapprove`；每个 HTTP action 仍重新校验精确权限、actor、状态和 expected revision。
2. `reject` 与 `unapprove` 要求 trim 后非空 reason；`approve`、`unreject` 与 `delete` 不接受 reason。提交人不得批准、驳回或恢复审核自己的 Submission。
3. “撤回”调用 `POST /dcl/warehouse/delete`。只有提交人可删除自己的 `PENDING`/`REJECTED` Submission；删除 snapshot 与 Approval Entry，保留 `DELETED` audit，不产生 `WITHDRAWN`、`REVOKED` 或 `unsubmit`。
4. 批准 V2 后 BOB/reference 读取 highest `APPROVED` V2；反批准 V2 后自然回落到 V1；反批准 V1 后 BOB/reference 查询结果为空。开放候选存在时拒绝反批准，删除开放候选后允许版本号复用。
5. 任何下游事实精确引用目标 Warehouse Submission 时，反批准返回 `warehouse_unapprove_blocked` 及引用明细。批准 disabled snapshot 或反批准后会回落到 disabled/absent 时，库存、进行中单据、来源和当前正式引用 blocker 返回 `warehouse_disable_blocked`；整笔事务保持原状。

## 4. 验收场景

1. 浏览器离线创建与编辑多个 Draft，刷新后按当前用户恢复；切换用户不可见；删除本地 Draft 不产生服务器业务行。
2. 真实页面经 typed client 和 Hono 提交一次后，PostgreSQL 恰好出现一个 stable subject、一个 V1 `PENDING` Submission、一个 typed snapshot 与一个 `SUBMITTED` event；成功后才删除本地 Draft。
3. 同请求重试幂等；不同 payload 复用 key、重复 ID、错误 submit mode、旧 latest-approved/revision、恶意客户端 decision、权限不足与失效引用都返回稳定错误且无部分写入。
4. `approve`、`reject`、`unreject`、`unapprove` 与 `delete` 覆盖成功、完整 actor/permission matrix、stale revision、reason 规则、结构化 blocker 和 audit/revision；`REJECTED` 仍可发现和审阅。
5. canonical 业务规则语料在浏览器与 Node 服务端运行结果一致；真实 PostgreSQL 测试覆盖并发 submit 冲突、版本号分配、highest-approved 回落与精确引用 blocker。
6. target OpenAPI、Hono client type 和目标权限目录从同一完整路由图生成。`compose.target.yaml` 装载完整隔离 target schema；#366 前生产 Go route、live schema、契约和权限保持不变。
