package bobseed

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestSamplesCoverEveryEntityAndLifecycleState(t *testing.T) {
	entityCounts := make(map[string]int)
	statusCounts := make(map[string]int)
	for _, item := range samples {
		entityCounts[item.entity]++
		statusCounts[item.status]++
	}
	expectedEntityCounts := map[string]int{
		bob.EntityCustomer:         2,
		bob.EntitySupplier:         3,
		bob.EntityEmployee:         2,
		bob.EntityProduct:          4,
		bob.EntityService:          2,
		bob.EntityWarehouse:        2,
		bob.EntityVehicle:          2,
		bob.EntityFundAccount:      2,
		bob.EntityCategory:         2,
		bob.EntityDepartment:       2,
		bob.EntityPosition:         2,
		bob.EntitySettlementMethod: 1,
	}
	for entity, expected := range expectedEntityCounts {
		if entityCounts[entity] != expected {
			t.Errorf("%s sample count = %d, want %d", entity, entityCounts[entity], expected)
		}
	}
	for _, status := range []string{bob.StatusEffective, bob.StatusDraft, bob.StatusPending} {
		if statusCounts[status] == 0 {
			t.Errorf("missing %s sample", status)
		}
	}
}

func TestSeedCreatesLifecycleDataAndIsIdempotent(t *testing.T) {
	store := newFakeStore()
	seeder := &Seeder{service: store, lookup: store}

	first, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("first seed: %v", err)
	}
	if first != (Result{Created: len(samples)}) {
		t.Fatalf("first result = %+v", first)
	}
	if store.createCalls != 26 || store.submitCalls != 19 || store.approveCalls != 16 || store.rejectCalls != 0 {
		t.Fatalf(
			"calls create=%d submit=%d approve=%d reject=%d",
			store.createCalls,
			store.submitCalls,
			store.approveCalls,
			store.rejectCalls,
		)
	}

	second, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if second != (Result{Skipped: len(samples)}) {
		t.Fatalf("second result = %+v", second)
	}
	if store.createCalls != 26 || store.submitCalls != 19 || store.approveCalls != 16 || store.rejectCalls != 0 {
		t.Fatal("idempotent seed performed extra lifecycle mutations")
	}
}

func TestSeedResumesPartialLifecycle(t *testing.T) {
	store := newFakeStore()
	item := samples[0]
	created, err := store.Create(t.Context(), item.entity, bob.CreateInput{Data: item.data}, submitterID, "partial")
	if err != nil {
		t.Fatalf("create partial sample: %v", err)
	}
	if created.Status != bob.StatusDraft {
		t.Fatalf("partial status = %s", created.Status)
	}

	result, err := (&Seeder{service: store, lookup: store}).Seed(t.Context())
	if err != nil {
		t.Fatalf("resume seed: %v", err)
	}
	if result != (Result{Created: len(samples) - 1, Resumed: 1}) {
		t.Fatalf("result = %+v", result)
	}
	view := store.byKey[key(item.entity, item.data.Code)]
	if view.Version.Status != bob.StatusEffective {
		t.Fatalf("resumed status = %s", view.Version.Status)
	}
}

func TestSeedRejectsOccupiedDemoCode(t *testing.T) {
	store := newFakeStore()
	item := samples[0]
	changed := item.data
	changed.Name = "其他客户"
	if _, err := store.Create(t.Context(), item.entity, bob.CreateInput{Data: changed}, submitterID, "occupied"); err != nil {
		t.Fatalf("create occupied sample: %v", err)
	}

	_, err := (&Seeder{service: store, lookup: store}).Seed(t.Context())
	if err == nil {
		t.Fatal("seed succeeded with occupied demo code")
	}
}

func TestDetailInputOnlySetsFieldsAllowedForEntity(t *testing.T) {
	input := bob.CreateDetailInput{
		Name: "演示资料", Description: "说明", Remark: "备注",
		DepartmentID: "department", SettlementMethodID: "settlement",
	}
	customer := detailInput(bob.EntityCustomer, input)
	if !customer.SettlementMethodID.Set || !customer.Remark.Set ||
		customer.DepartmentID.Set || customer.Description.Set {
		t.Fatalf("customer detail input over-posted fields: %+v", customer)
	}
	settlement := detailInput(bob.EntitySettlementMethod, input)
	if !settlement.Description.Set || settlement.Remark.Set ||
		settlement.SettlementMethodID.Set || settlement.DepartmentID.Set {
		t.Fatalf("settlement detail input over-posted fields: %+v", settlement)
	}
}

func TestSeedUpgradesLegacyDemoSupplierToLogisticsPlatform(t *testing.T) {
	store := newFakeStore()
	legacy, err := store.Create(t.Context(), bob.EntitySupplier, bob.CreateInput{Data: bob.CreateDetailInput{
		Code: "DEMO-SUP-001", Name: "远山供应链有限公司",
	}}, submitterID, "legacy-create")
	if err != nil {
		t.Fatalf("create legacy supplier: %v", err)
	}
	submitted, err := store.Submit(t.Context(), bob.EntitySupplier, bob.VersionRevisionInput{
		ObjectID: legacy.ObjectID, VersionID: legacy.VersionID, Revision: legacy.Revision,
	}, submitterID, "legacy-submit")
	if err != nil {
		t.Fatalf("submit legacy supplier: %v", err)
	}
	if _, err = store.Approve(t.Context(), bob.EntitySupplier, bob.ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, reviewerID, "legacy-approve"); err != nil {
		t.Fatalf("approve legacy supplier: %v", err)
	}

	result, err := (&Seeder{service: store, lookup: store}).Seed(t.Context())
	if err != nil {
		t.Fatalf("seed with legacy supplier: %v", err)
	}
	if result != (Result{Created: len(samples) - 1, Resumed: 1}) {
		t.Fatalf("result = %+v", result)
	}
	view := store.byKey[key(bob.EntitySupplier, "DEMO-SUP-001")]
	if view.Data.Name != "自营物流平台" || view.Data.SupplierType != bob.SupplierTypeLogisticsPlatform ||
		view.Version.Status != bob.StatusEffective {
		t.Fatalf("upgraded supplier = %+v", view)
	}
	if store.unapproveCalls != 1 || store.unsubmitCalls != 1 || store.saveCalls != 1 {
		t.Fatalf(
			"unapprove calls=%d unsubmit calls=%d save calls=%d",
			store.unapproveCalls,
			store.unsubmitCalls,
			store.saveCalls,
		)
	}
}

type fakeStore struct {
	byKey          map[string]bob.ObjectView
	byID           map[string]string
	nextID         int
	createCalls    int
	saveCalls      int
	submitCalls    int
	unsubmitCalls  int
	approveCalls   int
	unapproveCalls int
	rejectCalls    int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		byKey: make(map[string]bob.ObjectView),
		byID:  make(map[string]string),
	}
}

func key(entity, code string) string {
	return entity + "/" + code
}

func (s *fakeStore) Find(_ context.Context, entity, code string) (string, bool, error) {
	view, found := s.byKey[key(entity, code)]
	return view.ObjectID, found, nil
}

func (s *fakeStore) Create(_ context.Context, entity string, input bob.CreateInput, _, _ string) (bob.MutationResult, error) {
	s.createCalls++
	s.nextID++
	objectID := fmt.Sprintf("object-%d", s.nextID)
	versionID := fmt.Sprintf("version-%d", s.nextID)
	supplierType := deref(input.Data.SupplierType)
	if entity == bob.EntitySupplier && supplierType == "" {
		supplierType = bob.SupplierTypeGeneral
	}
	customerType := deref(input.Data.CustomerType)
	if entity == bob.EntityCustomer && customerType == "" {
		customerType = bob.CustomerTypeEndUser
	}
	productKind := input.Data.ProductKind
	if entity == bob.EntityProduct && productKind == "" {
		productKind = bob.ProductKindRawMaterial
	}
	view := bob.ObjectView{
		ObjectID:       objectID,
		Entity:         entity,
		Code:           input.Data.Code,
		ObjectRevision: 1,
		Version: bob.VersionMeta{
			VersionID: versionID,
			Version:   1,
			Status:    bob.StatusDraft,
			Revision:  1,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		Data: bob.DetailView{
			Name:                  input.Data.Name,
			Unit:                  input.Data.Unit,
			Currency:              input.Data.Currency,
			SupplierType:          supplierType,
			CustomerType:          customerType,
			PlateNumber:           input.Data.PlateNumber,
			VehicleType:           input.Data.VehicleType,
			PlatformObjectID:      input.Data.PlatformObjectID,
			TargetEntity:          input.Data.TargetEntity,
			ShortName:             input.Data.ShortName,
			CategoryID:            input.Data.CategoryID,
			TaxNumber:             input.Data.TaxNumber,
			ContactName:           input.Data.ContactName,
			ContactPhone:          input.Data.ContactPhone,
			Email:                 input.Data.Email,
			Address:               input.Data.Address,
			Remark:                input.Data.Remark,
			DepartmentID:          input.Data.DepartmentID,
			PositionID:            input.Data.PositionID,
			Phone:                 input.Data.Phone,
			HireDate:              input.Data.HireDate,
			Specification:         input.Data.Specification,
			Model:                 input.Data.Model,
			Barcode:               input.Data.Barcode,
			Description:           input.Data.Description,
			ManagerEmployeeID:     input.Data.ManagerEmployeeID,
			VIN:                   input.Data.VIN,
			EngineNumber:          input.Data.EngineNumber,
			LoadCapacityKG:        input.Data.LoadCapacityKG,
			AccountName:           input.Data.AccountName,
			BankName:              input.Data.BankName,
			BankBranch:            input.Data.BankBranch,
			AccountNumber:         input.Data.AccountNumber,
			ParentID:              input.Data.ParentID,
			SettlementMethodID:    input.Data.SettlementMethodID,
			SalespersonEmployeeID: input.Data.SalespersonEmployeeID,
			RuleType:              input.Data.RuleType,
			MonthOffset:           input.Data.MonthOffset,
			DayOfMonth:            input.Data.DayOfMonth,
			DayOffset:             input.Data.DayOffset,
			ProductKind:           productKind,
			Formula:               input.Data.Formula,
		},
	}
	recordKey := key(entity, input.Data.Code)
	s.byKey[recordKey] = view
	s.byID[objectID] = recordKey
	return mutation(view), nil
}

func (s *fakeStore) Get(_ context.Context, _ string, input bob.GetInput) (bob.ObjectView, error) {
	recordKey, found := s.byID[input.ObjectID]
	if !found {
		return bob.ObjectView{}, fmt.Errorf("object not found")
	}
	return s.byKey[recordKey], nil
}

func (s *fakeStore) Save(_ context.Context, _ string, input bob.SaveInput, _, _ string) (bob.MutationResult, error) {
	s.saveCalls++
	recordKey, found := s.byID[input.ObjectID]
	if !found {
		return bob.MutationResult{}, fmt.Errorf("object not found")
	}
	view := s.byKey[recordKey]
	supplierType := view.Data.SupplierType
	if input.Data.SupplierType != nil {
		supplierType = *input.Data.SupplierType
	}
	customerType := view.Data.CustomerType
	if input.Data.CustomerType != nil {
		customerType = *input.Data.CustomerType
	}
	targetEntity := view.Data.TargetEntity
	if input.Data.TargetEntity != nil {
		targetEntity = *input.Data.TargetEntity
	}
	view.Data.Name, view.Data.Unit, view.Data.Currency = input.Data.Name, input.Data.Unit, input.Data.Currency
	view.Data.SupplierType, view.Data.CustomerType = supplierType, customerType
	view.Data.PlateNumber, view.Data.VehicleType = input.Data.PlateNumber, input.Data.VehicleType
	view.Data.PlatformObjectID, view.Data.TargetEntity = input.Data.PlatformObjectID, targetEntity
	applyOptional := func(value bob.OptionalString, target *string) {
		if value.Set {
			*target = value.Value
		}
	}
	applyOptional(input.Data.ShortName, &view.Data.ShortName)
	applyOptional(input.Data.CategoryID, &view.Data.CategoryID)
	applyOptional(input.Data.TaxNumber, &view.Data.TaxNumber)
	applyOptional(input.Data.ContactName, &view.Data.ContactName)
	applyOptional(input.Data.ContactPhone, &view.Data.ContactPhone)
	applyOptional(input.Data.Email, &view.Data.Email)
	applyOptional(input.Data.Address, &view.Data.Address)
	applyOptional(input.Data.Remark, &view.Data.Remark)
	applyOptional(input.Data.DepartmentID, &view.Data.DepartmentID)
	applyOptional(input.Data.PositionID, &view.Data.PositionID)
	applyOptional(input.Data.Phone, &view.Data.Phone)
	applyOptional(input.Data.HireDate, &view.Data.HireDate)
	applyOptional(input.Data.Specification, &view.Data.Specification)
	applyOptional(input.Data.Model, &view.Data.Model)
	applyOptional(input.Data.Barcode, &view.Data.Barcode)
	applyOptional(input.Data.Description, &view.Data.Description)
	applyOptional(input.Data.ManagerEmployeeID, &view.Data.ManagerEmployeeID)
	applyOptional(input.Data.VIN, &view.Data.VIN)
	applyOptional(input.Data.EngineNumber, &view.Data.EngineNumber)
	applyOptional(input.Data.LoadCapacityKG, &view.Data.LoadCapacityKG)
	applyOptional(input.Data.AccountName, &view.Data.AccountName)
	applyOptional(input.Data.BankName, &view.Data.BankName)
	applyOptional(input.Data.BankBranch, &view.Data.BankBranch)
	applyOptional(input.Data.AccountNumber, &view.Data.AccountNumber)
	applyOptional(input.Data.ParentID, &view.Data.ParentID)
	applyOptional(input.Data.SettlementMethodID, &view.Data.SettlementMethodID)
	applyOptional(input.Data.SalespersonEmployeeID, &view.Data.SalespersonEmployeeID)
	view.Data.RuleType = input.Data.RuleType
	view.Data.MonthOffset = input.Data.MonthOffset
	view.Data.DayOfMonth = input.Data.DayOfMonth
	view.Data.DayOffset = input.Data.DayOffset
	if input.Data.ProductKind != nil {
		view.Data.ProductKind = *input.Data.ProductKind
	}
	if input.Data.Formula != nil {
		view.Data.Formula = input.Data.Formula
	}
	view.Version.Revision++
	s.byKey[recordKey] = view
	return mutation(view), nil
}

func (s *fakeStore) Submit(_ context.Context, _ string, input bob.VersionRevisionInput, _, _ string) (bob.MutationResult, error) {
	s.submitCalls++
	return s.transition(input.ObjectID, bob.StatusPending), nil
}

func (s *fakeStore) Unsubmit(_ context.Context, _ string, input bob.ReverseInput, _, _ string) (bob.MutationResult, error) {
	s.unsubmitCalls++
	return s.transition(input.ObjectID, bob.StatusDraft), nil
}

func (s *fakeStore) Approve(_ context.Context, _ string, input bob.ReviewInput, _, _ string) (bob.MutationResult, error) {
	s.approveCalls++
	return s.transition(input.ObjectID, bob.StatusEffective), nil
}

func (s *fakeStore) Unapprove(_ context.Context, _ string, input bob.ReverseInput, _, _ string) (bob.MutationResult, error) {
	s.unapproveCalls++
	return s.transition(input.ObjectID, bob.StatusPending), nil
}

func (s *fakeStore) Reject(_ context.Context, _ string, input bob.ReviewInput, _, _ string) (bob.MutationResult, error) {
	s.rejectCalls++
	return s.transition(input.ObjectID, bob.StatusDraft), nil
}

func (s *fakeStore) transition(objectID, status string) bob.MutationResult {
	recordKey := s.byID[objectID]
	view := s.byKey[recordKey]
	view.Version.Status = status
	view.Version.Revision++
	s.byKey[recordKey] = view
	return mutation(view)
}

func mutation(view bob.ObjectView) bob.MutationResult {
	return bob.MutationResult{
		ObjectID:  view.ObjectID,
		VersionID: view.Version.VersionID,
		Version:   view.Version.Version,
		Status:    view.Version.Status,
		Revision:  view.Version.Revision,
	}
}
