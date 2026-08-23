---
id: ADR-0028
date: 2026-08-22
status: accepted
---

# Order-owned delivery specifications and standard piece quantity

交付规格是销售订单行选项，不是产品属性；ZERP 不建立产品交付规格集合，也不建立客户、产品、交付规格三维配置表。产品版本只直接保存一个大于零的 `defaultPackagingSpec` 数值，它没有独立对象、版本、附表或接口。VOU 从同一客户结算子账户、同一产品最近一张已检查或已批准销售订单继承实际交付规格，并在订单保存标准计件口径快照：有包装订单无论客户选择大桶还是小桶，都按产品版本的 `defaultPackagingSpec` 折算；散水订单固定按每 1000 基准数量一标准件折算并要求槽车，槽车不承担数量换算。标准计件数允许小数，最多保留六位小数，不按整数件取整。
