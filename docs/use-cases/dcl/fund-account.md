# 资金账户申报页面用例

## 范围

- 路由：`/dcl/fund-account`，由 `dcl/fund-account` 登记。
- 账号规范化、唯一占用、经营主体精确引用与历史规则以 [DCL 资金账户申报](../../domains/dcl.md#33-资金账户申报) 为准。

## `DCL-FUND-ACCOUNT-01` 查询与本地 Draft

1. 页面固定分页查询 subject，一行呈现 current 与 candidate。
2. Draft 编辑领域文档定义的完整资金账户 snapshot；用例不另行复制字段规范。
3. 所属经营主体字段使用统一 BOB current 选择器；其版本语义直接链接上述领域规则，不在用例重复定义。

## `DCL-FUND-ACCOUNT-02` 提交与审批

1. submit 由服务端规范化账号、检查 current/open 唯一占用和 expected latest approved facts。
2. 失败保留本地 Draft；成功删除本次 Draft；revision 冲突刷新而不重放动作。
3. 审批与撤回只使用 DCL Submission 路由，不提供 BOB direct CRUD。

## 验收

1. 页面不允许手输经营主体 stable ID 或 Approval Entry。
2. 版本与审计按 subject 可读，历史账号和来源事实按服务器存量展示。
