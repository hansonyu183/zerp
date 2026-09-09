# 其他单位管理页面用例

## 范围

- 路由：`/bob/other-unit`，由 `bob/other-unit` Registry 资源以 `bob/other-unit-management` 登记。
- 其他单位的 current、Submission、独立启停、服务合同引用和权限规则以 [BOB](../../domains/bob.md#5-领域动作) 为准；请求及响应以可执行 BOB 路由为准。

## `BOB-OTHER-UNIT-01` 查询与独立启停

1. 页面拥有正式资料 `query` 权限时加载 current 列表，并按已提交的编码、名称或法定识别号关键词查询和翻页。
2. 每行展示对象启停状态。拥有对应精确权限时，用户可以对当前行执行启用或停用；请求使用该对象 revision。
3. 成功后重新读取列表；失败保留服务端反馈，不以本地状态推断操作成功。

## `BOB-OTHER-UNIT-02` 提交资料版本

1. 新增、克隆和提交变更只在临时表单中编辑身份资料、适用经营主体、默认经营主体、可选结算方式和备注。
2. 新增提交 `submit-new`；变更从 current 对象读取版本来源并提交 `submit-change`。经营主体候选必须由当前 AUX 读取获得。
3. 提交成功才关闭表单并刷新；取消或失败不写入本地 Draft，也不把未批准 Submission 当作 current。

## 验收

1. 其他单位的身份和合作资格随 BOB typed Submission snapshot 保存，服务合同和履约事实由 VOU 保存。
2. 新服务合同只采用当前启用、具有正式版本的其他单位；历史合同继续验证精确 Approval Entry。
3. 页面不调用旧 DCL 其他单位入口，也不将启停编排为版本提交。

## 动态版本档案交互（#410）

本资源从强类型 definition 经 Registry/Resource Host 装配统一版本档案页；页面生命周期、明细/详情/附件/历史区块及公开验收边界采用 [ADR-0060](../../adr/0060-dynamic-page-runtime.md)。上述业务用例在此真实入口验收，桌面和 390px 均覆盖，取消、未知写入、资源/Session 切换与迟到请求沿用全站规则。
