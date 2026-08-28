package bobseed

import (
	"context"
	"fmt"
	"testing"
	"time"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

func TestSamplesCoverEveryEntityAndLifecycleState(t *testing.T) {
	entityCounts := make(map[string]int)
	statusCounts := make(map[string]int)
	for _, item := range samples {
		entityCounts[item.entity]++
		statusCounts[item.status]++
	}
	expectedEntityCounts := map[string]int{
		bob.EntityCustomerAccount:       2,
		bob.EntitySupplier:              2,
		bob.EntityOtherUnit:             1,
		bob.EntityEmployee:              2,
		bob.EntityProduct:               4,
		bob.EntityWarehouse:             2,
		bob.EntityVehicle:               2,
		bob.EntityFundAccount:           2,
		bob.EntityOperatingEntity:       1,
		auxdomain.EntityProductCategory: 2,
		auxdomain.EntityDepartment:      2,
		auxdomain.EntityPosition:        2,
	}
	for entity, expected := range expectedEntityCounts {
		if entityCounts[entity] != expected {
			t.Errorf("%s sample count = %d, want %d", entity, entityCounts[entity], expected)
		}
	}
	for _, status := range []string{approvedStatus, string(approval.StatusDraft), string(approval.StatusPending)} {
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
	if store.createCalls != 24 || store.submitCalls != 17 || store.approveCalls != 15 || store.rejectCalls != 0 {
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
	if store.createCalls != 24 || store.submitCalls != 17 || store.approveCalls != 15 || store.rejectCalls != 0 {
		t.Fatal("idempotent seed performed extra lifecycle mutations")
	}
}

func TestSeedResumesPartialLifecycle(t *testing.T) {
	store := newFakeStore()
	item := samples[0]
	created, err := store.Create(t.Context(), item.entity, bob.CreateInput{Data: item.data}, mustSeedActor("partial"))
	if err != nil {
		t.Fatalf("create partial sample: %v", err)
	}
	if created.Approval.Status != approval.StatusDraft {
		t.Fatalf("partial status = %s", created.Approval.Status)
	}

	result, err := (&Seeder{service: store, lookup: store}).Seed(t.Context())
	if err != nil {
		t.Fatalf("resume seed: %v", err)
	}
	if result != (Result{Created: len(samples) - 1, Resumed: 1}) {
		t.Fatalf("result = %+v", result)
	}
	view := store.byKey[key(item.entity, item.data.Code)]
	if string(view.Approval.Status) != approvedStatus {
		t.Fatalf("resumed status = %s", view.Approval.Status)
	}
}

func TestSeedRejectsOccupiedDemoCode(t *testing.T) {
	store := newFakeStore()
	item := samples[0]
	changed := item.data
	changed.Name = "其他客户"
	if _, err := store.Create(t.Context(), item.entity, bob.CreateInput{Data: changed}, mustSeedActor("occupied")); err != nil {
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
	customer := detailInput(bob.EntityCustomerAccount, input)
	if !customer.SettlementMethodID.Set || !customer.Remark.Set ||
		customer.DepartmentID.Set || customer.Description.Set {
		t.Fatalf("customer detail input over-posted fields: %+v", customer)
	}
	settlement := detailInput(auxdomain.EntitySettlementMethod, input)
	if !settlement.Description.Set || settlement.Remark.Set ||
		settlement.SettlementMethodID.Set || settlement.DepartmentID.Set {
		t.Fatalf("settlement detail input over-posted fields: %+v", settlement)
	}
}

type fakeStore struct {
	byKey          map[string]seedObjectView
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
		byKey: make(map[string]seedObjectView),
		byID:  make(map[string]string),
	}
}

func key(entity, code string) string {
	return entity + "/" + code
}

func (s *fakeStore) Find(_ context.Context, entity, code string) (string, bool, error) {
	if entity == auxdomain.EntitySettlementMethod && code == bob.SettlementTermMonthlyCurrent {
		return "fixed-monthly-current", true, nil
	}
	view, found := s.byKey[key(entity, code)]
	return view.ObjectID, found, nil
}

func (s *fakeStore) Create(_ context.Context, entity string, input bob.CreateInput, _ approval.Actor) (seedMutation, error) {
	s.createCalls++
	s.nextID++
	objectID := fmt.Sprintf("object-%d", s.nextID)
	approvalEntryID := fmt.Sprintf("approval-%d", s.nextID)
	customerType := deref(input.Data.CustomerType)
	if entity == bob.EntityCustomerAccount && customerType == "" {
		customerType = bob.CustomerTypeEndUser
	}
	monthlyClosingDay := input.Data.MonthlyClosingDay
	if entity == bob.EntityCustomerAccount && monthlyClosingDay == 0 {
		monthlyClosingDay = 31
	}
	view := seedObjectView{
		ObjectID:       objectID,
		Entity:         entity,
		Code:           input.Data.Code,
		ObjectRevision: 1,
		Approval: approval.VersionMeta{
			ApprovalEntryID: approvalEntryID,
			VersionNo:       1,
			Status:          approval.StatusDraft,
			Revision:        1,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		},
		Data: bob.DetailView{
			Name:                       input.Data.Name,
			Unit:                       input.Data.Unit,
			Currency:                   input.Data.Currency,
			CustomerType:               customerType,
			PlateNumber:                input.Data.PlateNumber,
			VehicleType:                input.Data.VehicleType,
			CarrierAffiliation:         input.Data.CarrierAffiliation,
			TargetEntity:               input.Data.TargetEntity,
			ShortName:                  input.Data.ShortName,
			CategoryID:                 input.Data.CategoryID,
			TaxNumber:                  input.Data.TaxNumber,
			ContactName:                input.Data.ContactName,
			ContactPhone:               input.Data.ContactPhone,
			Email:                      input.Data.Email,
			Address:                    input.Data.Address,
			Remark:                     input.Data.Remark,
			DepartmentID:               input.Data.DepartmentID,
			PositionID:                 input.Data.PositionID,
			Phone:                      input.Data.Phone,
			HireDate:                   input.Data.HireDate,
			Specification:              input.Data.Specification,
			Model:                      input.Data.Model,
			Barcode:                    input.Data.Barcode,
			Description:                input.Data.Description,
			ManagerEmployeeID:          input.Data.ManagerEmployeeID,
			VIN:                        input.Data.VIN,
			EngineNumber:               input.Data.EngineNumber,
			LoadCapacityKG:             input.Data.LoadCapacityKG,
			AccountName:                input.Data.AccountName,
			BankName:                   input.Data.BankName,
			BankBranch:                 input.Data.BankBranch,
			AccountNumber:              input.Data.AccountNumber,
			OperatingEntityID:          input.Data.OperatingEntityID,
			ParentID:                   input.Data.ParentID,
			SettlementMethodID:         input.Data.SettlementMethodID,
			MonthlyClosingDay:          monthlyClosingDay,
			SalespersonEmployeeID:      input.Data.SalespersonEmployeeID,
			DefaultPurchaserEmployeeID: input.Data.DefaultPurchaserEmployeeID,
			RuleType:                   input.Data.RuleType,
			MonthOffset:                input.Data.MonthOffset,
			DayOfMonth:                 input.Data.DayOfMonth,
			DayOffset:                  input.Data.DayOffset,
			ProductTypeID:              input.Data.ProductTypeID,
			DefaultInputUnitID:         input.Data.DefaultInputUnitID,
			PricingUnitID:              input.Data.PricingUnitID,
			UnitConversions:            input.Data.UnitConversions,
			Formula:                    input.Data.Formula,
		},
	}
	recordKey := key(entity, input.Data.Code)
	s.byKey[recordKey] = view
	s.byID[objectID] = recordKey
	return mutation(view), nil
}

func (s *fakeStore) Get(_ context.Context, _ string, input bob.GetInput) (seedObjectView, error) {
	recordKey, found := s.byID[input.ObjectID]
	if !found {
		return seedObjectView{}, fmt.Errorf("object not found")
	}
	return s.byKey[recordKey], nil
}

func (s *fakeStore) Save(_ context.Context, _ string, input bob.SaveInput, _ approval.Actor) (seedMutation, error) {
	s.saveCalls++
	recordKey, found := s.byID[input.ObjectID]
	if !found {
		return seedMutation{}, fmt.Errorf("object not found")
	}
	view := s.byKey[recordKey]
	customerType := view.Data.CustomerType
	if input.Data.CustomerType != nil {
		customerType = *input.Data.CustomerType
	}
	targetEntity := view.Data.TargetEntity
	if input.Data.TargetEntity != nil {
		targetEntity = *input.Data.TargetEntity
	}
	view.Data.Name, view.Data.Unit, view.Data.Currency = input.Data.Name, input.Data.Unit, input.Data.Currency
	view.Data.CustomerType = customerType
	view.Data.PlateNumber, view.Data.VehicleType = input.Data.PlateNumber, input.Data.VehicleType
	view.Data.CarrierAffiliation, view.Data.TargetEntity = input.Data.CarrierAffiliation, targetEntity
	applyOptional := func(value bob.OptionalString, target *string) {
		if value.Set {
			*target = value.Value
		}
	}
	applyOptional(input.Data.ShortName, &view.Data.ShortName)
	applyOptional(input.Data.OperatingEntityID, &view.Data.OperatingEntityID)
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
	if input.Data.MonthlyClosingDay != nil {
		view.Data.MonthlyClosingDay = *input.Data.MonthlyClosingDay
	}
	applyOptional(input.Data.SalespersonEmployeeID, &view.Data.SalespersonEmployeeID)
	applyOptional(input.Data.DefaultPurchaserEmployeeID, &view.Data.DefaultPurchaserEmployeeID)
	view.Data.RuleType = input.Data.RuleType
	view.Data.MonthOffset = input.Data.MonthOffset
	view.Data.DayOfMonth = input.Data.DayOfMonth
	view.Data.DayOffset = input.Data.DayOffset
	applyOptional(input.Data.ProductTypeID, &view.Data.ProductTypeID)
	applyOptional(input.Data.DefaultInputUnitID, &view.Data.DefaultInputUnitID)
	applyOptional(input.Data.PricingUnitID, &view.Data.PricingUnitID)
	if input.Data.UnitConversions != nil {
		view.Data.UnitConversions = *input.Data.UnitConversions
	}
	if input.Data.Formula != nil {
		view.Data.Formula = input.Data.Formula
	}
	view.Approval.Revision++
	s.byKey[recordKey] = view
	return mutation(view), nil
}

func (s *fakeStore) Submit(_ context.Context, _ string, input bob.VersionRevisionInput, _ approval.Actor) (seedMutation, error) {
	s.submitCalls++
	return s.transition(input.ObjectID, approval.StatusPending), nil
}

func (s *fakeStore) Unsubmit(_ context.Context, _ string, input bob.ReverseInput, _ approval.Actor) (seedMutation, error) {
	s.unsubmitCalls++
	return s.transition(input.ObjectID, approval.StatusDraft), nil
}

func (s *fakeStore) Approve(_ context.Context, _ string, input bob.ReviewInput, _ approval.Actor) (seedMutation, error) {
	s.approveCalls++
	return s.transition(input.ObjectID, approval.StatusApproved), nil
}

func (s *fakeStore) Unapprove(_ context.Context, _ string, input bob.ReverseInput, _ approval.Actor) (seedMutation, error) {
	s.unapproveCalls++
	return s.transition(input.ObjectID, approval.StatusPending), nil
}

func (s *fakeStore) Reject(_ context.Context, _ string, input bob.ReviewInput, _ approval.Actor) (seedMutation, error) {
	s.rejectCalls++
	return s.transition(input.ObjectID, approval.StatusDraft), nil
}

func (s *fakeStore) transition(objectID string, status approval.Status) seedMutation {
	recordKey := s.byID[objectID]
	view := s.byKey[recordKey]
	view.Approval.Status = status
	view.Approval.Revision++
	s.byKey[recordKey] = view
	return mutation(view)
}

func mutation(view seedObjectView) seedMutation {
	return seedMutation{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision, Approval: view.Approval,
	}
}
