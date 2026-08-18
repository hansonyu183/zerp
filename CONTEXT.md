# ZERP Domain Language

ZERP uses shared business terms across its auxiliary-data, business-object, voucher, workflow, and business-ledger domains. This glossary fixes the meaning of terms that cross those domain boundaries.

## Navigation

**APP Page Route（APP 页面路由）**:
APP 领域管理页面在菜单目录和前端路由中使用的稳定 `routeKey` 与 `routePath`。用户、角色、权限、系统参数和菜单均属于 APP 领域；“管理”是职责描述，不是 `admin` 领域或路由命名空间。
_Avoid_: admin 领域、`admin/*` 管理页面路由、把页面路由等同于 API 动作路径

## Configuration

**Configured Value（配置值）**:
已登记系统参数当前持久化的目标值。保存或恢复默认值只更新配置值；其是否已被运行实例采用由生效模式决定。
_Avoid_: 当前值、已生效值

**Running Value（运行值）**:
运行实例已经采用的系统参数值。仅当部署范围内全部运行实例已被证明采用同一最新配置版本时，才更新为配置值。
_Avoid_: 推测已生效的配置值

**Effect Mode（生效模式）**:
系统参数值从配置值影响运行行为的既定方式；包括立即生效、下次请求生效和重启后生效。
_Avoid_: 页面重启、未说明的生效时机

## Accounting

**Accounting Subject（会计科目）**:
归 ACC 领域和单本会计账簿所有的分层会计分类。不同账簿的科目相互独立，AUX 不维护全局会计科目或收支类型到科目的直接映射。
_Avoid_: AUX 会计科目、全局会计科目

## Voucher Lifecycle

**Voucher Posting（单据入账）**:
会产生业务台账流水的 VOU 单据进入 `APPROVED` 时，将业务事实写入库存、资金、往来、空桶等 LED 台账；`unapprove` 撤销同一批台账流水。没有台账流水的单据仍可进入 `APPROVED`。
_Avoid_: 最终处理、业务完成

## Other Dealings

**Other Dealings Ledger（其他往来台账）**:
记录销售、采购往来之外的其他债权与债务；余额按主体等既有账簿维度计算，类别只作为流水属性和筛选条件。
_Avoid_: 其他单位台账、员工借款台账

**Other Dealings Subject（其他往来主体）**:
其他往来的权利义务对象，可以是客户、供应商、其他单位或员工；主体身份不因进入其他往来台账而被复制或改变。
_Avoid_: 其他往来单位

**Other Dealings Category（其他往来类别）**:
其他往来流水的可选业务分类，例如提成、居间或返点；类别不参与余额维度，工资也不属于其他往来类别。
_Avoid_: 单据类型、主体类型
