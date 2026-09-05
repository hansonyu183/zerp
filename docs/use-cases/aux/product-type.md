# 产品类型页面用例

## 范围

- 路由：`/aux/product-type`，由 `aux/product-type` 登记。
- 对象字段、引用与 direct CRUD 规则以 [AUX 辅助对象领域](../../domains/aux.md) 为准。

## `AUX-PRODUCT-TYPE-01` 查询与维护

1. 页面按编码、名称和启用状态显式查询固定分页列表。
2. 详情维护 名称、行为模板和说明，关联字段只选择当前可用的稳定对象。
3. 创建或保存成功后重新读取对象；启停成功也读取新 revision。
4. 删除需用户确认；存在引用 blocker 或 revision 冲突时保留详情并显示服务端错误。

## 验收

1. 页面只调用 `/aux/product-type/*` direct CRUD，不出现草稿、Submission 或审批操作。
2. code、启用状态与 revision 以服务端读回结果为准。
