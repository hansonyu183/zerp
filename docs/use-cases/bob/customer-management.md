# 客户正式资料页面用例

## 范围

- 路由：`/bob/customer`，Registry 资源 `bob/customer`，用例 `bob/customer-management`。
- 规则采用 [BOB](../../domains/bob.md)，维护边界采用 [DCL](../../domains/dcl.md)；HTTP 契约以可执行 Hono/Zod 路由为准。

## 正式查询与独立启停

1. 从“正式资料”菜单进入，按精确 query 权限查询当前资料；关键词显式提交，翻页保持已提交筛选。
2. 详情只读；启停按各自精确权限和 object revision 发起，失败显示服务端冲突或 blocker。
3. 对象详情按 versions 权限展示完整历史、状态、差异、只读快照及附件；跨对象 Entry 拒绝，不要求 DCL 审批权限，不显示维护或审批按钮。

## 验收

桌面和 390px 从实际菜单查询、查看对象历史及启停；待批仍显示旧正式版本，批准后采用新版，反批准回落不改变启停。历史明确标注状态，未批准记录不能被当作正式资料。权限不足不发请求，资源或 Session 切换忽略迟到结果。公共页面采用 [ADR-0060](../../adr/0060-dynamic-page-runtime.md)。
