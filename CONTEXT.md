# ZERP Domain Language

ZERP uses shared business terms across its auxiliary-data, business-object, voucher, workflow, and business-ledger domains. This glossary fixes the meaning of terms that cross those domain boundaries.

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
