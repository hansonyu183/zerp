# 员工申报页面用例

## 范围

- 路由：`/dcl/employee`，由 `dcl/employee` 登记。
- 员工完整身份、雇佣 snapshot 与精确引用规则以 [DCL 员工申报](../../domains/dcl.md#36-员工申报) 为准。

## `DCL-EMPLOYEE-01` 查询与本地 Draft

1. 页面固定分页查询 employee subject，一行呈现 latest approved 与 open candidate。
2. Draft 完整编辑身份、法定识别号、姓名、类别、部门、岗位、电话、邮箱、入职日期、经营主体、备注和启用状态。
3. 类别、部门和岗位从 AUX reference 选择；经营主体从 BOB current reference 选择。

## `DCL-EMPLOYEE-02` 提交与生命周期

1. 新增不创建 Party；submit/approve 由服务端校验引用并冻结完整 snapshot。
2. 失败保留 Draft，成功删除本次 Draft；克隆只基于最新正式版本。
3. 页面只显示服务端审批动作，正式引用 blocker 不在前端推断。

## 验收

1. 页面不出现 Party、关系、BOB direct CRUD、服务器 DRAFT 或 `unsubmit`。
2. 历史正式事实继续显示实际采用的 employee Approval Entry。
