# 员工用例

## 范围

- 路由：`/bob/employee`。
- 任职关系规则以 [BOB 领域](../../domains/bob.md) 为准；线协议以 [OpenAPI](../../../contracts/openapi/openapi.yaml) 及 [BOB Schema](../../../contracts/openapi/schemas/bob.yaml) 为准。

## 新建

1. 用户在同一表单选择已有 Party，或填写新 Party 和首条 Employment Relationship；保存调用 `POST /bob/employee/create`，两者原子完成，不允许先创建裸 Party。
2. Party 只保存身份事实：类型、法定名称、显示名称、税号和强标识。任职关系只提交经营主体、部门、岗位、工作电话、工作邮箱、入职日期和备注；不得把 Party 身份字段带入关系保存。
3. 选择已有 Party 需要 Party 查询及读取权限；新建 Party 需要 Party 创建权限。经营主体、部门和岗位均为最小引用投影；引用加载失败时保留输入并阻止空经营主体提交。

## 列表与验收

1. 初次查询及用户明确提交筛选后调用 employee query，固定每页 20 条，按编码升序。筛选可按部门和岗位，关键词不自动请求。
2. 列表只显示编码、主体、部门、岗位和当前状态；身份详情不因任职列表权限外溢。
3. 创建成功后关闭工作区并刷新列表。失败显示后端业务消息，保留当前输入；并发查询只接受最新请求结果。
