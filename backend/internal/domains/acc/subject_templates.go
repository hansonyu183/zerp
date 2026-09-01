package acc

type subjectTemplateLine struct {
	Code              string
	Name              string
	ParentCode        string
	BalanceDirection  string
	Dimensions        []string
	InventoryQuantity bool
	SettlementPurpose string
}

var enterpriseSubjectTemplate = []subjectTemplateLine{
	{Code: "1000", Name: "资产类", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "1001", Name: "库存现金", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1002", Name: "银行存款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1012", Name: "其他货币资金", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1121", Name: "应收票据", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionCustomerAccount, DimensionBill}, SettlementPurpose: SettlementPurposeReceivable},
	{Code: "1122", Name: "应收账款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeReceivable},
	{Code: "1123", Name: "预付账款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionSupplier}, SettlementPurpose: SettlementPurposePrepaid},
	{Code: "1221", Name: "其他应收款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "122101", Name: "员工借款", ParentCode: "1221", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionEmployee}, SettlementPurpose: SettlementPurposeOther},
	{Code: "122102", Name: "服务往来", ParentCode: "1221", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionOtherUnit}, SettlementPurpose: SettlementPurposeOther},
	{Code: "1405", Name: "库存商品", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionProduct, DimensionWarehouse}, InventoryQuantity: true, SettlementPurpose: SettlementPurposeNone},
	{Code: "1601", Name: "固定资产", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1602", Name: "累计折旧", ParentCode: "1000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone},
	{Code: "2000", Name: "负债类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "2201", Name: "应付票据", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSupplier, DimensionBill}, SettlementPurpose: SettlementPurposePayable},
	{Code: "2202", Name: "应付账款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSupplier}, SettlementPurpose: SettlementPurposePayable},
	{Code: "2203", Name: "预收账款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeAdvanceReceipt},
	{Code: "2241", Name: "销售合作应付款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSalesPartner}, SettlementPurpose: SettlementPurposeOther},
	{Code: "3000", Name: "所有者权益类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "4001", Name: "实收资本", ParentCode: "3000", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "5000", Name: "成本类", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "5001", Name: "生产成本", ParentCode: "5000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionProduct}, SettlementPurpose: SettlementPurposeNone},
	{Code: "6000", Name: "损益类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "6001", Name: "主营业务收入", ParentCode: "6000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "6401", Name: "主营业务成本", ParentCode: "6000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "6601", Name: "销售费用", ParentCode: "6000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "6602", Name: "管理费用", ParentCode: "6000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "660201", Name: "折旧费", ParentCode: "6602", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
}

var smallBusinessSubjectTemplate = []subjectTemplateLine{
	{Code: "1000", Name: "资产类", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "1001", Name: "库存现金", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1002", Name: "银行存款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1101", Name: "短期投资", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "1121", Name: "应收票据", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionCustomerAccount, DimensionBill}, SettlementPurpose: SettlementPurposeReceivable},
	{Code: "1122", Name: "应收账款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeReceivable},
	{Code: "1123", Name: "预付账款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionSupplier}, SettlementPurpose: SettlementPurposePrepaid},
	{Code: "1221", Name: "其他应收款", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "122101", Name: "员工借款", ParentCode: "1221", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionEmployee}, SettlementPurpose: SettlementPurposeOther},
	{Code: "122102", Name: "服务往来", ParentCode: "1221", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionOtherUnit}, SettlementPurpose: SettlementPurposeOther},
	{Code: "1405", Name: "库存商品", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionProduct, DimensionWarehouse}, InventoryQuantity: true, SettlementPurpose: SettlementPurposeNone},
	{Code: "1601", Name: "固定资产", ParentCode: "1000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone},
	{Code: "1602", Name: "累计折旧", ParentCode: "1000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionAsset}, SettlementPurpose: SettlementPurposeNone},
	{Code: "2000", Name: "负债类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "2201", Name: "应付票据", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSupplier, DimensionBill}, SettlementPurpose: SettlementPurposePayable},
	{Code: "2202", Name: "应付账款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSupplier}, SettlementPurpose: SettlementPurposePayable},
	{Code: "2203", Name: "预收账款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeAdvanceReceipt},
	{Code: "2241", Name: "销售合作应付款", ParentCode: "2000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionSalesPartner}, SettlementPurpose: SettlementPurposeOther},
	{Code: "3000", Name: "所有者权益类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "3001", Name: "实收资本", ParentCode: "3000", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "5000", Name: "成本类", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "5001", Name: "生产成本", ParentCode: "5000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionProduct}, SettlementPurpose: SettlementPurposeNone},
	{Code: "5002", Name: "主营业务成本", ParentCode: "5000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "5003", Name: "税金及附加", ParentCode: "5000", BalanceDirection: BalanceDirectionDebit, SettlementPurpose: SettlementPurposeNone},
	{Code: "6000", Name: "损益类", BalanceDirection: BalanceDirectionCredit, SettlementPurpose: SettlementPurposeNone},
	{Code: "6001", Name: "主营业务收入", ParentCode: "6000", BalanceDirection: BalanceDirectionCredit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "5601", Name: "销售费用", ParentCode: "6000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "5602", Name: "管理费用", ParentCode: "6000", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
	{Code: "560201", Name: "折旧费", ParentCode: "5602", BalanceDirection: BalanceDirectionDebit, Dimensions: []string{DimensionDepartment}, SettlementPurpose: SettlementPurposeNone},
}

func subjectTemplateLines(template string) ([]subjectTemplateLine, bool) {
	switch template {
	case SubjectTemplateEnterprise:
		return enterpriseSubjectTemplate, true
	case SubjectTemplateSmallBusiness:
		return smallBusinessSubjectTemplate, true
	case SubjectTemplateEmpty:
		return nil, true
	default:
		return nil, false
	}
}
