# 当前页面状态

## #380 后的页面边界

正式入口仍是 `frontend/src/target/main.ts`，但业务资源页面已经收束为一个动态 Resource Host。登录、改密、无权访问和未知地址保留为独立页面；导航只从 Session Context 的非 Session `apiPaths` 装配。

本票 Registry 刻意为空。所有已授权资源都保留导航入口和既有 API、领域规则、服务端精确鉴权，但都只显示明确的尚未实现状态。尤其 `app/user` 的旧管理页已不再是当前页面；下一票才会交付用户页面的 Shell、VM 与 Registry 登记。

此前按静态资源页采集的页面、浏览器 E2E 和视觉记录仅是历史验证证据，不能证明当前 Resource Host 已实现某资源。当前路由、页面用例和实际登记状态以 [页面能力矩阵](PAGE-CAPABILITY-MATRIX.md) 及生成的 [页面用例覆盖率](COVERAGE.md) 为准。
