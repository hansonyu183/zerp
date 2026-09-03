# WFL 当前流程定义页面用例

权威业务规则见 [WFL 定义与 Approval Version](../../domains/wfl.md#2-定义与-approval-version) 与 [DCL 流程定义申报](../../domains/dcl.md#310-流程定义申报)，当前 live 线协议见 [OpenAPI](../../../contracts/openapi/openapi.yaml)，目标线协议从可执行 Hono/Zod 路由生成，维护编排见 [DCL 流程定义申报页面用例](../dcl/wfl-process-definition.md)。#366 前 live OpenAPI 不变且不与 target 组合。

## 1. 页面与权限边界

1. `/wfl/process-definition` 只读展示每个启用或筛选命中的 stable definition 的 latest APPROVED 版本，只调用 `POST /wfl/process-definition/query|get`。
2. 页面只检查 WFL `query|get` 权限，不因用户具有 DCL 权限而显示创建、保存、审批、启停或版本动作。
3. 页面与 DCL 维护页使用独立 ViewModel；候选版本和 DCL 编辑状态不得进入 WFL 当前读模型。

## 2. 查询与详情

1. 列表按编码或名称查询，显示名称、根单据、节点数、启停状态、Approval 版本身份和更新时间。
2. 详情展示 latest APPROVED 的冻结脚本、编译节点与边，只读字段不得触发保存请求。
3. 即使存在更高版本号的 `PENDING` 或 `REJECTED` Submission，列表和详情仍解析并显示 latest APPROVED。
4. “维护”与“前往维护”进入 `/dcl/wfl-process-definition?code={code}`，由 DCL 页面重新鉴权和读取。

## 3. 异常与验收

1. 不存在 latest APPROVED 时不返回该定义；无权限或读取失败时展示稳定业务消息与 `requestId`。
2. 浏览器网络记录中的定义维护请求只使用 DCL 路径。
3. 真实 PostgreSQL 覆盖候选存在时的 current 可见性与精确 Approval identity；真实 E2E 覆盖只读查询、详情和 DCL 维护深链。
