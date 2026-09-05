# 当前流程定义查询

## 页面与目标

- 页面：`/wfl/process-definition`
- 组件：`frontend/src/target/pages/wfl/process-definition/ProcessDefinition.vue`
- 目标：查询当前已批准且可用于 WFL 运行面的流程定义，并只读查看编译后的节点与边。

## 协作与编排

页面通过 `/wfl/process-definition/query|get` 读取服务器事实，固定每页 20 条并透传页码和关键字。页面不保存、审批或启停定义；这些动作只进入 `/dcl/wfl-process-definition`。业务规则见 [WFL 领域](../../domains/wfl.md) 与 [DCL 流程定义申报](../../domains/dcl.md#310-流程定义申报)。

## 异常与验收

- 缺少 query/get 权限时不发起相应请求。
- 查询竞态只接受最后一次响应；失败保留已展示内容并显示服务器错误。
- 验收覆盖分页、关键字、按 code 读取详情，以及节点和边的只读呈现。
