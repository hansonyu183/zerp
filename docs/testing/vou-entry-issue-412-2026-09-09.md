# #412 人工单据录入验收

本票基于 `c5f6ede0`（#411 动态订单录入）顺序交付四组。当前第一组实现及验收完成，后续三组仍待实施；不包含生产部署或数据迁移。提交标识以本文件所在提交及 Git 历史为准。

## 第一组：采购履约、退货与生产库存

| 实体             | 桌面 1280px | 窄屏 390px | 完整路径                                                    |
| ---------------- | ----------- | ---------- | ----------------------------------------------------------- |
| sale-return      | 通过        | 通过       | 菜单、来源候选、原因与数量、提交、get、克隆再提交           |
| purchase-inbound | 通过        | 通过       | 菜单、供应商、来源候选、数量、提交、get、克隆再提交         |
| purchase-return  | 通过        | 通过       | 菜单、供应商、来源候选、原因与数量、提交、get、克隆再提交   |
| purchase-inquiry | 通过        | 通过       | 菜单、供应商、产品、单价、提交、get、克隆再提交             |
| order-production | 通过        | 通过       | 菜单、仓库、订单配方行、材料量、提交、get、克隆再提交       |
| self-production  | 通过        | 通过       | 菜单、仓库、自制成品固定配方、材料量、提交、get、克隆再提交 |
| inventory-count  | 通过        | 通过       | 菜单、仓库、产品和单位、零实盘量、提交、get、克隆再提交     |

浏览器使用本任务独占 `compose.target.yaml` 项目 `zerp-issue-412`，PostgreSQL/API/Web 端口分别为 55443/18090/18091。运行器只连接这套 Compose，测试事实通过公开领域服务创建；连接在 `finally` 关闭，数据库随整套可丢弃环境回收。浏览器不采集登录后截图、视频或 trace。

公开 Resource Host 单元测试 20 项通过，包含同源精确引用、六位数量字符串、原因校验、固定配方采用及调整原因、盘点预览、未知结果锁定、权限、取消和成功刷新、历史附件只读与克隆不继承附件。所有业务编辑器共用 DocumentPage 的单一判别联合草稿；组件只承担有限业务输入。

真实 PostgreSQL 测试确认生产按实际材料消耗和成品产出入账、反批准删除数量流水，盘点在批准时固定账面/实盘/差异，已被生产耗用的盘盈拒绝反批准，解除后成功。生产批准通过真实会话、CSRF 与 Hono 接口验证；来源/固定配方校验和库存写入由对应领域服务完成。

## 验证记录

- `pnpm --dir frontend exec vitest run tests/unit/target/document-page.component.spec.ts`：退出 0，20 项。
- `pnpm --dir frontend typecheck`、`pnpm --dir apps/api typecheck`、`pnpm --dir frontend lint`、`pnpm docs:check`：退出 0。
- `make check-common check-ci-workflow`：退出 0。
- `node --test apps/api/tests/integration/vou-stock.int.test.ts`（本任务数据库）：退出 0，2 项，包含 Hono 批准及逆向库存 blocker。
- `node apps/api/scripts/run-vou-entry-e2e.mjs`（本任务数据库及 Compose API/Web）：退出 0，14 项。
- `make e2e` 使用 `TARGET_COMPOSE` 覆盖为本任务项目及上述端口；生成检查、WFL 双运行时、全部类型检查、lint、格式、构建、前端单元、API 单元 82 项、工件 19 项、集成 90 项及迁移测试全部通过。通用 E2E 的金额科目夹具错误地为数量单据选择金额映射，首次退出 1；已修正该夹具，续跑通用浏览器 28 项通过（退出 0），WFL 专项 1 项、36 类目录专项 2 项、期初专项 2 项、新增制单最终候选 14 项均通过（退出 0）。完整门禁的各步骤已全部完成；未因测试夹具修正重跑仍覆盖候选的前置检查。

数量单据的真实入账在专属库存账簿测试中验证，通用金额科目夹具不把数量当金额。通用浏览器集合排除专属制单夹具；根 `make e2e` 在末尾显式执行 `e2e:vou-entry`。
