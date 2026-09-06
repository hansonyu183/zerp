# 菜单结构受控清理

本流程用于 #378 集成分支最终切换时移除菜单模板的持久化结构。日常启动只同步当前权限目录，不自动执行结构删除。隔离环境直接使用当前 schema；本流程不表示已经获得生产部署授权。

发布方先按既有发布流程保存数据库备份、确认恢复方式，并停止使用菜单模板的 API 实例。凭证通过受控环境注入 `TARGET_DATABASE_URL`；`TARGET_DATABASE_SCOPE` 明确指定 `isolated` 或 `production`，不在命令输出中打印连接串。

按顺序执行：

1. `pnpm --filter @zerp/api sync:catalog`。
2. `ZERP_LEGACY_MENU_CLEANUP=confirm pnpm --filter @zerp/api cleanup:legacy-menu`。 <!-- docs-check: legacy-exception=release-cutover ref=ADR-0052 -->

目录同步只恢复当前登记路径的授权交集；被删除的菜单管理权限及其角色关联随目录删除，其他资源的有效精确授权保持不变。结构清理要求菜单权限已经移除，并验证菜单两表和展示列的完整基线；遇到部分结构或额外菜单表字段时拒绝执行，需先核查真实基线。

清理在一个事务和事务级 advisory lock 内删除 `app_business_menu_items`、`app_menu_settings` 及权限表的 `menu_group/menu_order`，保留用户、角色、其他授权、业务事实和独立审计。重复执行返回零删除量。命令失败不得绕过基线检查；先修复原因或恢复匹配备份。

成功后启动匹配当前 schema 的 API，核对健康状态、Session 恢复及导航。需要回滚时恢复匹配的完整数据库备份和应用版本，不保留请求期兼容读取。

隔离库的真实清理、事实保留、幂等和不完整基线拒绝由 [CLI 集成测试](../../apps/api/tests/integration/legacy-menu-cleanup.int.test.ts) 验证。 <!-- docs-check: legacy-exception=release-cutover ref=ADR-0052 -->
