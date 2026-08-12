//go:build integration

package acc

import "testing"

func TestAccountingSubjectTemplatesAreCopiedOncePerBook(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)

	enterprise, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "企业账簿", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: SubjectTemplateEnterprise,
	}, adminID)
	if err != nil {
		t.Fatalf("create enterprise book: %v", err)
	}
	small, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "小企业账簿", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: SubjectTemplateSmallBusiness,
	}, adminID)
	if err != nil {
		t.Fatalf("create small-business book: %v", err)
	}
	empty, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "空白账簿", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create empty book: %v", err)
	}

	enterprisePage, err := service.QuerySubjects(t.Context(), QuerySubjectsInput{
		BookID: enterprise.ID, Page: 1, PageSize: 200,
	}, adminID)
	if err != nil || len(enterprisePage.Items) < 20 {
		t.Fatalf("enterprise subjects = %d, err = %v", len(enterprisePage.Items), err)
	}
	smallPage, err := service.QuerySubjects(t.Context(), QuerySubjectsInput{
		BookID: small.ID, Page: 1, PageSize: 200,
	}, adminID)
	if err != nil || len(smallPage.Items) < 20 {
		t.Fatalf("small-business subjects = %d, err = %v", len(smallPage.Items), err)
	}
	emptyPage, err := service.QuerySubjects(t.Context(), QuerySubjectsInput{
		BookID: empty.ID, Page: 1, PageSize: 200,
	}, adminID)
	if err != nil || emptyPage.Total != 0 {
		t.Fatalf("empty subjects = %+v, err = %v", emptyPage, err)
	}

	target := enterprisePage.Items[len(enterprisePage.Items)-1]
	updated, err := service.SaveSubject(t.Context(), SaveSubjectInput{
		CreateSubjectInput: CreateSubjectInput{
			BookID: enterprise.ID, Code: target.Code,
			Name: target.Name + "（内部）", BalanceDirection: target.BalanceDirection,
			Enabled: target.Enabled, RequiredDimensions: target.RequiredDimensions,
			InventoryQuantity: target.InventoryQuantity, SettlementPurpose: target.SettlementPurpose,
		},
		SubjectID: target.ID,
		Revision:  target.Revision,
	}, adminID)
	if err != nil || updated.Name == target.Name {
		t.Fatalf("update copied enterprise subject = %+v, err = %v", updated, err)
	}
	smallAfter, err := service.QuerySubjects(t.Context(), QuerySubjectsInput{
		BookID: small.ID, Page: 1, PageSize: 200, Keyword: target.Name + "（内部）",
	}, adminID)
	if err != nil || smallAfter.Total != 0 {
		t.Fatalf("template copies are not isolated: %+v, err = %v", smallAfter, err)
	}
}

func TestAccountingSubjectHierarchyDimensionsUsageAndScopes(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "科目测试", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: SubjectTemplateEmpty,
		QueryUserIDs:    []string{queryID}, OperateUserIDs: []string{operatorID},
	}, adminID)
	if err != nil {
		t.Fatalf("create book: %v", err)
	}

	root, err := service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1000", Name: "资产",
		BalanceDirection: BalanceDirectionDebit, Enabled: true,
		SettlementPurpose: SettlementPurposeNone,
	}, operatorID)
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	inventory, err := service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1405", Name: "库存商品", ParentSubjectID: &root.ID,
		BalanceDirection: BalanceDirectionDebit, Enabled: true,
		RequiredDimensions: []string{DimensionProduct, DimensionWarehouse},
		InventoryQuantity:  true, SettlementPurpose: SettlementPurposeNone,
	}, operatorID)
	if err != nil || !inventory.Leaf {
		t.Fatalf("create inventory leaf = %+v, err = %v", inventory, err)
	}
	rootAfter, err := service.GetSubject(t.Context(), book.ID, root.ID, queryID)
	if err != nil || rootAfter.Leaf {
		t.Fatalf("root after child = %+v, err = %v", rootAfter, err)
	}
	if _, err = service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1122", Name: "应收账款",
		BalanceDirection: BalanceDirectionDebit, Enabled: true,
		SettlementPurpose: SettlementPurposeReceivable,
	}, operatorID); !IsKind(err, ErrorValidation) {
		t.Fatalf("receivable without customer dimension error = %v", err)
	}
	if _, err = service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "1406", Name: "错误库存",
		BalanceDirection: BalanceDirectionDebit, Enabled: true,
		RequiredDimensions: []string{DimensionProduct}, InventoryQuantity: true,
		SettlementPurpose: SettlementPurposeNone,
	}, operatorID); !IsKind(err, ErrorValidation) {
		t.Fatalf("inventory without warehouse error = %v", err)
	}
	if err = service.RegisterSubjectUsage(t.Context(), book.ID, inventory.ID, "OPENING", "opening-1"); err != nil {
		t.Fatalf("register subject usage: %v", err)
	}
	if _, err = service.SaveSubject(t.Context(), SaveSubjectInput{
		CreateSubjectInput: CreateSubjectInput{
			BookID: book.ID, Code: inventory.Code,
			Name: "修改已引用科目", BalanceDirection: inventory.BalanceDirection,
			ParentSubjectID: inventory.ParentSubjectID,
			Enabled:         true, RequiredDimensions: inventory.RequiredDimensions,
			InventoryQuantity: true, SettlementPurpose: inventory.SettlementPurpose,
		},
		SubjectID: inventory.ID,
		Revision:  inventory.Revision,
	}, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("referenced structural save error = %v", err)
	}
	disabled, err := service.SaveSubject(t.Context(), SaveSubjectInput{
		CreateSubjectInput: CreateSubjectInput{
			BookID: book.ID, Code: inventory.Code,
			Name: inventory.Name, BalanceDirection: inventory.BalanceDirection,
			ParentSubjectID: inventory.ParentSubjectID,
			Enabled:         false, RequiredDimensions: inventory.RequiredDimensions,
			InventoryQuantity: true, SettlementPurpose: inventory.SettlementPurpose,
		},
		SubjectID: inventory.ID,
		Revision:  inventory.Revision,
	}, operatorID)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable referenced subject = %+v, err = %v", disabled, err)
	}
	if err = service.DeleteSubject(t.Context(), book.ID, inventory.ID, disabled.Revision, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("delete referenced subject error = %v", err)
	}
	if _, err = service.QuerySubjects(t.Context(), QuerySubjectsInput{BookID: book.ID, Page: 1, PageSize: 20}, outsiderID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("outside query error = %v", err)
	}
	if _, err = service.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "2000", Name: "负债",
		BalanceDirection: BalanceDirectionCredit, Enabled: true,
		SettlementPurpose: SettlementPurposeNone,
	}, queryID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("query-only create error = %v", err)
	}
}
