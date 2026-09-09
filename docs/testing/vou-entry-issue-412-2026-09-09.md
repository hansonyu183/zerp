# #412 人工单据录入验收

本票基于 `c5f6ede0`（#411 动态订单录入）顺序交付四组。当前前两组实现及验收完成，后续两组仍待实施；不包含生产部署或数据迁移。提交标识以本文件所在提交及 Git 历史为准。

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

## 第二组：资金费用

实现基于第一组提交 `bf431919`。销售收款、采购退款、其他收款、销售退款、采购付款、其他付款、员工借款、员工还款、员工借款核销、费用报销、其他收入共 11 类，桌面 1280px 和窄屏 390px 均完成菜单、真实候选、录入、提交持久化、get 相等及克隆独立身份验收。其他付款额外验证相对方切换为员工及居间费类别；四种非默认相对方通过公开 Resource Host 验证切换后的候选及载荷。

金额以字符串传输，分摊合计用整数计算。后台修复销售退款的精确客户子单位引用解释，拒绝把客户根当子单位；保存收款校验分摊合计和客户归属。该修复保持字段名及协议结构，引用解析显式传入单据类型。资金账户币种和经营主体继续由既有 AUX 采用路径核对；新增金额合计错误及资金不足均有中文提示。

- `make generate`（同一独占 Compose）：退出 0，生成物无漂移。
- 前端与 API `typecheck`、前端 `lint`、`format:check`、`build:target`、`test:unit`，模型 `test` 与 `docs:check`：退出 0。公开单据页测试 35 项，模型 32 项。
- `node --test --test-concurrency=1 apps/api/tests/integration/vou-financial.int.test.ts apps/api/tests/integration/vou-catalog.int.test.ts`（独占数据库）：退出 0，3 项；跨客户分摊、金额不符、退款引用和币种、Hono 资金入账及已支用来款反批准 blocker 均有实际回读。第一组生产和库存相关 4 项也继续通过。
- `e2e:vou-entry`：前两组合计 36 场景，首轮 34 项通过；其他付款的 Vuetify 选择控件改用键盘后，以 `node apps/api/scripts/run-vou-entry-e2e.mjs --grep other-payment` 重跑两项，退出 0。所有 18 类两个宽度均有完整成功证据，没有跳过失败场景。
- Standards/Spec 独立审查完成；相对方类型切换未刷新候选的问题已通过红绿测试修复并复查关闭。
- 第二组完成后的 `e2e:vou-catalog`：退出 0，36 类目录与审批权限专项 2 项通过。
