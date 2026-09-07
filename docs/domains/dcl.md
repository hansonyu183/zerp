# DCL 历史归属

DCL 已无生产业务路由、维护页或当前资料消费者。员工、经营主体、仓库、资金账户、车辆归 [AUX](aux.md)，产品、客户、供应商、其他单位、销售合作方归 [BOB](bob.md)，会计映射归 [ACC](acc.md)，报表定义归 [RPT](rpt.md)，流程定义及实例归 [WFL](wfl.md)。

`dcl_subjects` 中尚存的会计映射、报表身份及其历史快照仅为一次性转换前的只读审计证据，不承载当前配置或生命周期。迁移命令在对应领域 Service 的事务内转换身份、引用与精确授权，保持历史事实。审批与版本的公共规则见 [Approval](approval.md)。

旧 DCL 稳定身份与唯一写入方 ADR 的相关条款已由各领域迁移决定部分替代；WFL 的替代范围见 [ADR-0058](../adr/0058-wfl-owns-versioned-definitions.md)。
