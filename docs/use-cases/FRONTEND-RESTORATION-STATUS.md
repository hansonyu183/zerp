# 当前页面状态

## 当前页面边界

正式入口仍是 `frontend/src/target/main.ts`，但业务资源页面已经收束为一个动态 Resource Host。登录、改密、无权访问和未知地址保留为独立页面；导航只从 Session Context 的非 Session `apiPaths` 装配。

Registry 已登记用户、角色、员工类别、岗位、计量单位、收款方式、资产类别、经营主体和员工九页，均由公共 ListPage 和模块 VM 承载。其他已授权但未登记资源显示尚未实现。经营主体和员工通过 AUX 直接维护，旧 DCL/BOB 两实体入口已移除。

此前按静态资源页采集的页面、浏览器 E2E 和视觉记录仅是历史验证证据，不能证明当前 Resource Host 已实现某资源。当前路由、页面用例和实际登记状态以 [页面能力矩阵](PAGE-CAPABILITY-MATRIX.md) 及生成的 [页面用例覆盖率](COVERAGE.md) 为准。
