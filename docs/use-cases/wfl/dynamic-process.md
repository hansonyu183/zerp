# 动态流程入口

## 页面与目标

- 页面：`/wfl/{processCode}`
- 组件：`frontend/src/target/pages/wfl/dynamic/DynamicProcess.vue`
- 目标：从 APP 动态菜单进入单一流程定义的实例工作区。

## 协作与安全边界

动态段只作为 `code` 传给 `/wfl/process-instance/query`，不能拼接 API 路径或权限字符串；HTTP 始终使用固定的 `/wfl/process-instance/*` 路由。APP 从当前 latest-approved 且 enabled 的流程定义实时派生 `/wfl/{code}` available route，名称取定义名称，permissionCode 复用 `/wfl/process-instance/query`；不创建假的 `/wfl/{code}/query` HTTP permission。路由注册时必须排除静态 `process-definition`、`process-instance` 及系统保留段，并以 APP 返回的 exact available route 与 generic instance-query permission 共同判定可进入。实例动作继续遵守 [流程实例用例](process-instance.md) 的服务器权威动作边界，完整业务不变量见 [WFL 领域](../../domains/wfl.md)。

## 验收

- 动态入口查询请求必须携带精确 `code`，翻页和搜索不能丢失该过滤。
- 未知、禁用或不在 APP available routes 中的 code 进入 404/403，不向任意字符串开放动态页面；既有停用流程实例仍可从静态实例页查询和运行。
- 同名静态路径必须优先于动态路由。
