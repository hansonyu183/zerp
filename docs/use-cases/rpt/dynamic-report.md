# 动态报表执行

## 页面与目标

- 页面：`/rpt/{reportCode}`
- 组件：`frontend/src/target/pages/rpt/report/Report.vue`
- 目标：按当前目录定义渲染强类型参数，分页查询、加载引用选项并导出服务器返回的完整结果。

## 协作与编排

页面先调用 `/rpt/directory/query` 定位精确 code，再使用 `/rpt/{code}/query|reference-query|export`。TEXT、INTEGER、DECIMAL、BOOLEAN、DATE、DATE_RANGE、ENUM 与 REFERENCE 分别使用对应控件；引用选择固定携带 `parameterKey`，可携带 keyword 和 selectedId。非必填参数的空控件统一发送 `null`，其中 BOOLEAN 的 `false` 是明确值而不是空值；必填参数仍在请求前校验。查询固定每页 20 条；服务器多取一条并以 typed `hasMore` 明确是否存在下一页，页面不做 COUNT 或伪造总数。导出数据来自 export 响应并在浏览器生成 UTF-8 BOM CSV。业务规则见 [RPT 领域](../../domains/rpt.md)。

## 安全边界与验收

- 动态 code 必须匹配目录中的 `rpt-NNNNNN`，且路由由 APP available route 授权；不得以 code 拼接任意非 RPT API。
- query 与 export 权限独立。仅有 export 权限不能在页面泄露 rows。
- 必填、整数和日期范围先做交互校验，服务器仍是 SQL、参数和执行权限的最终裁决者。
- query/export/reference 失败保留参数；翻页必须复用同一参数快照。
