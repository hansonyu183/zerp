# 流程实例查询与执行

## 页面与目标

- 页面：`/wfl/process-instance`
- 组件：`frontend/src/target/pages/wfl/process-instance/ProcessInstance.vue`
- 目标：查询流程实例，查看其单据节点，并执行服务器声明可用的节点动作。

## 协作与编排

页面通过 `/wfl/process-instance/query|get|action` 协作。列表固定每页 20 条。详情使用服务器返回的 `availableActions` 和 `availableTargets`；页面再叠加精确 capability permission，但不自行推导动作。创建下级由 VM 为一次用户意图生成 16 至 64 位 requestKey，失败重试复用同一键、成功后清除，不向用户暴露技术键输入；请求同时传递目标节点和节点 revision。驳回或取消传递原因。OPEN_DOCUMENT 先执行服务器 action，再从服务器返回的目标 node 取 typed VOU entity/documentId 导航只读详情，不能用任意字符串拼路径。业务规则见 [WFL 领域](../../domains/wfl.md)。

## 异常与验收

- action 失败时保留详情、目标、请求键和原因，允许按服务器最新事实重试。
- 不在 `availableActions` 中的动作不得发出；权限不能补出服务器未声明的动作。
- 验收覆盖查询/详情、创建下级、批准/驳回/重试/取消，以及并发 revision 冲突。
