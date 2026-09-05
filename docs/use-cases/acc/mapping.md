# 当前会计映射页面用例

## 范围

- 路由：`/acc/mapping`，由 `acc/mapping` 登记。
- ACC 与 DCL 的所有权边界以 [ACC 当前记账映射](../../domains/acc.md#7-当前记账映射) 为准。
- 页面只使用 `/acc/mapping/{query,get,catalog}` 与 `/acc/book/query` 可执行 Hono 路由。

## `ACC-MAPPING-01` 查询当前映射

1. 用户选择账簿并可按 VOU 类型筛选固定分页结果。
2. 列表只显示每个 `(bookId, vouEntity)` 最新 `APPROVED` 映射；开放候选和历史版本不在本页出现。

## `ACC-MAPPING-02` 查看规则

1. 详情读取服务端当前映射及稳定字段目录，展示默认 `POST | UN_POST`、匹配条件和凭证模板行。
2. 页面用业务表格展示规则、科目来源、借贷方向、金额、币种、辅助维度和数量字段，不使用原始 JSON 编辑器。

## 验收

1. 页面没有 create、save、submit、delete 或 Approval 动作。
2. 所有候选、版本、审批和审计入口均指向 DCL 会计映射申报专业页。
