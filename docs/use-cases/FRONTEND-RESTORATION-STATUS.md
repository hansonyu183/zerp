# 当前页面状态

## 当前页面边界

正式入口仍是 `frontend/src/target/main.ts`，但业务资源页面已经收束为一个动态 Resource Host。登录、改密、无权访问和未知地址保留为独立页面；导航只从 Session Context 的非 Session `apiPaths` 装配。

Registry 已登记十二个 APP/AUX 直接维护资源、BOB 五类版本化档案、ACC 当前映射、RPT 按编码查询/导出页、WFL 流程定义与实例，以及共享目录内全部 VOU 列表与会计期初。资源 definition 由六类动态页面运行时承载，规则见 [ADR-0060](../adr/0060-dynamic-page-runtime.md)。32 类人工单据提供临时录入与提交，四类系统生成单据不开放人工新建，会计期初使用独立分类录入区块。实现和已有验收范围见 [2026-09-09 整改记录](../testing/dynamic-pages-review-fixes-2026-09-09.md)。其他已授权但未登记资源仍显示尚未实现。DCL 不再提供当前运行入口。

此前按静态资源页采集的页面、浏览器 E2E 和视觉记录仅是历史验证证据，不能证明当前 Resource Host 已实现某资源。当前路由、页面用例和实际登记状态以 [页面能力矩阵](PAGE-CAPABILITY-MATRIX.md) 及生成的 [页面用例覆盖率](COVERAGE.md) 为准。
