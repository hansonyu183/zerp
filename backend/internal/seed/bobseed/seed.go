package bobseed

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	approvedStatus = string(approval.StatusApproved)
	seedReviewerID = "01J00000000000000000000001"
)

type Result struct {
	Created int
	Resumed int
	Skipped int
}

// Seed lifecycle views are deliberately local: BOB exposes approved-current
// read models only, while this builder still drives DCL declaration workflows.
type seedMutation struct {
	ObjectID         string
	ApprovalRevision int64
	Enabled          bool
	Approval         approval.VersionMeta
}

type seedObjectView struct {
	ObjectID         string
	Entity           string
	Code             string
	ApprovalRevision int64
	Enabled          bool
	Approval         approval.VersionMeta
	Data             bob.DetailView
	UpdatedAt        time.Time
}

type seedCreateInput struct {
	Data bob.CreateDetailInput
}

type seedGetInput struct {
	ObjectID        string
	ApprovalEntryID string
}

type seedSaveInput struct {
	ObjectID         string
	ApprovalEntryID  string
	ApprovalRevision int64
	Data             bob.DetailInput
}

type seedVersionRevisionInput struct {
	ObjectID         string
	ApprovalEntryID  string
	ApprovalRevision int64
}

type seedReverseInput struct {
	ObjectID         string
	ApprovalEntryID  string
	ApprovalRevision int64
	Reason           string
}

type seedReviewInput struct {
	ObjectID         string
	ApprovalEntryID  string
	ApprovalRevision int64
	Reason           *string
}

func errorChain(err error) string {
	chain := ""
	for err != nil {
		if chain != "" {
			chain += ": "
		}
		chain += err.Error()
		err = errors.Unwrap(err)
	}
	return chain
}

func seedActor(requestID string) (approval.Actor, error) {
	return approval.TrustedSystemActor(requestID)
}

func mustSeedActor(requestID string) approval.Actor {
	actor, err := seedActor(requestID)
	if err != nil {
		panic(fmt.Sprintf("invalid fixed seed actor: %v", err))
	}
	return actor
}

func mustReviewerActor(requestID string) approval.Actor {
	actor, err := approval.UserActor(authorization.Principal{ActorID: seedReviewerID}, requestID)
	if err != nil {
		panic(fmt.Sprintf("invalid fixed seed reviewer actor: %v", err))
	}
	return actor
}

type lifecycleService interface {
	Create(context.Context, string, seedCreateInput, approval.Actor) (seedMutation, error)
	Get(context.Context, string, seedGetInput) (seedObjectView, error)
	Save(context.Context, string, seedSaveInput, approval.Actor) (seedMutation, error)
	Submit(context.Context, string, seedVersionRevisionInput, approval.Actor) (seedMutation, error)
	Unsubmit(context.Context, string, seedReverseInput, approval.Actor) (seedMutation, error)
	Approve(context.Context, string, seedReviewInput, approval.Actor) (seedMutation, error)
	Unapprove(context.Context, string, seedReverseInput, approval.Actor) (seedMutation, error)
	Reject(context.Context, string, seedReviewInput, approval.Actor) (seedMutation, error)
}

type relationshipAwareLifecycleService struct {
	relationships     *dcldomain.RelationshipService
	business          *bob.Service
	customers         *dcldomain.CustomerService
	customerAccounts  *dcldomain.CustomerAccountService
	auxiliary         *auxdomain.Service
	pool              *pgxpool.Pool
	queries           *dbsqlc.Queries
	operatingEntities *dcldomain.OperatingEntityService
	warehouses        *dcldomain.WarehouseService
	vehicles          *dcldomain.VehicleService
	fundAccounts      *dcldomain.FundAccountService
	products          *dcldomain.ProductService
	employees         *dcldomain.EmployeeService
	suppliers         *dcldomain.SupplierService
	parties           *dcldomain.PartyService
}

func (service relationshipAwareLifecycleService) Create(
	ctx context.Context, entity string, input seedCreateInput, actor approval.Actor,
) (seedMutation, error) {
	if entity == bob.EntityProduct {
		result, err := service.products.Create(ctx, dcldomain.ProductCreateInput{Data: productData(input.Data)}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityOperatingEntity {
		result, err := service.operatingEntities.Create(ctx, dcldomain.OperatingEntityCreateInput{
			Data: operatingEntityData(input.Data),
		}, actor)
		return operatingEntityMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		result, err := service.warehouses.Create(ctx, dcldomain.WarehouseCreateInput{
			Data: warehouseData(input.Data),
		}, actor)
		return warehouseMutation(result), err
	}
	if entity == bob.EntityVehicle {
		result, err := service.vehicles.Create(ctx, dcldomain.VehicleCreateInput{Data: vehicleData(input.Data)}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		result, err := service.fundAccounts.Create(ctx, dcldomain.FundAccountCreateInput{Data: fundAccountData(input.Data)}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityEmployee {
		result, err := service.employees.Create(ctx, dcldomain.EmployeeCreateInput{
			NewParty: &bob.PartyCreateData{Kind: bob.PartyKindPerson, LegalName: input.Data.Name,
				DisplayName: input.Data.ShortName, Phone: input.Data.Phone, Email: input.Data.Email},
			OperatingEntityID: input.Data.OperatingEntityID,
			Data: dcldomain.EmployeeInput{DepartmentID: input.Data.DepartmentID, PositionID: input.Data.PositionID,
				Phone: input.Data.Phone, Email: input.Data.Email, HireDate: input.Data.HireDate, Remark: input.Data.Remark},
		}, actor)
		return employeeMutation(result), err
	}
	partyKind := bob.PartyKindOrganization
	party := &bob.PartyCreateData{Kind: partyKind, LegalName: input.Data.Name,
		DisplayName: input.Data.ShortName, TaxNumber: input.Data.TaxNumber,
		Phone: input.Data.ContactPhone, Email: input.Data.Email, Address: input.Data.Address}
	switch entity {
	case bob.EntitySupplier:
		result, err := service.suppliers.Create(ctx, dcldomain.SupplierCreateInput{
			NewParty:          party,
			OperatingEntityID: input.Data.OperatingEntityID,
			Data:              supplierData(input.Data),
		}, actor)
		return supplierMutation(result), err
	case bob.EntityOtherUnit:
		result, err := service.relationships.CreateOtherUnit(ctx, dcldomain.OtherUnitCreateInput{
			NewParty:          party,
			OperatingEntityID: input.Data.OperatingEntityID,
			Data: dcldomain.OtherUnitData{
				ContactName: input.Data.ContactName, ContactPhone: input.Data.ContactPhone,
				Email: input.Data.Email, Address: input.Data.Address,
				SettlementMethodID: input.Data.SettlementMethodID, Remark: input.Data.Remark},
		}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	case bob.EntityCustomerAccount:
		paymentMethodID, err := service.ensurePaymentMethod(ctx, actor)
		if err != nil {
			return seedMutation{}, err
		}
		customer, err := service.customers.Create(ctx, dcldomain.CustomerCreateInput{
			NewParty:          party,
			OperatingEntityID: input.Data.OperatingEntityID,
			DefaultAccount: dcldomain.CustomerAccountDataInput{Name: input.Data.Name, ShortName: input.Data.ShortName,
				CustomerTypeID: bob.CustomerTypeEndUserID, ContactName: input.Data.ContactName,
				ContactPhone: input.Data.ContactPhone, Email: input.Data.Email, Address: input.Data.Address,
				SettlementMethodID: input.Data.SettlementMethodID,
				PaymentMethodID:    paymentMethodID, DefaultTransportMethodCode: "DELIVERY",
				DefaultTransportMethodName: "送货",
				PricingPolicy: dcldomain.CustomerPricingPolicy{DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
					CostItems: []dcldomain.CustomerPricingCostItem{}, ThirdPartyIntermediaryFixedUnitCost: "0.00",
					ThirdPartyIntermediaryVariableUnitCost: "0.00"},
				CreditLimits: []dcldomain.CustomerCreditLimit{}, PrimarySalesAttribution: dcldomain.CustomerSalesAttributionInput{
					Type: dcldomain.CustomerSalesAttributionInternalEmployee, SubjectObjectID: input.Data.SalespersonEmployeeID},
				InternalReminder: input.Data.Remark},
		}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		accounts, err := service.customerAccounts.Query(ctx, dcldomain.CustomerAccountQueryInput{
			Page: 1, PageSize: 20, Filters: dcldomain.CustomerAccountQueryFilters{CustomerRelationshipID: customer.ObjectID},
			Sort: []dcldomain.CustomerAccountSortItem{{Field: "code", Order: "asc"}},
		}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		if len(accounts.Items) != 1 || accounts.Items[0].OpenVersion == nil {
			return seedMutation{}, errors.New("created customer account has no open approval version")
		}
		account := accounts.Items[0]
		return seedMutation{
			ObjectID: account.ObjectID, ApprovalRevision: account.OpenVersion.Approval.Revision,
			Enabled: account.Enabled, Approval: account.OpenVersion.Approval,
		}, nil
	}
	return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
}

func (service relationshipAwareLifecycleService) ensurePaymentMethod(ctx context.Context, actor approval.Actor) (string, error) {
	objectID, err := dbsqlc.New(service.pool).FindAuxObjectByName(ctx, dbsqlc.FindAuxObjectByNameParams{
		Entity: auxdomain.EntityPaymentMethod, Name: "演示银行转账",
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		created, createErr := service.auxiliary.Create(ctx, auxdomain.EntityPaymentMethod, auxdomain.CreateInput{
			Data: auxdomain.CreateData{Data: map[string]any{"name": "演示银行转账", "defaultSalesSurcharge": "0.00"}},
		}, actor)
		if createErr != nil {
			return "", createErr
		}
		objectID = created.ObjectID
	}
	view, getErr := service.auxiliary.Get(ctx, auxdomain.EntityPaymentMethod, auxdomain.GetInput{ObjectID: objectID}, actor)
	if getErr != nil {
		return "", getErr
	}
	_ = view
	return objectID, nil
}

func (service relationshipAwareLifecycleService) Save(
	ctx context.Context, entity string, input seedSaveInput, actor approval.Actor,
) (seedMutation, error) {
	if entity == bob.EntityProduct {
		view, err := service.products.Get(ctx, dcldomain.ProductGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-product-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		data := productInputFromView(view.Data)
		data.Name = input.Data.Name
		if input.Data.CategoryID.Set {
			data.CategoryID = input.Data.CategoryID.Value
		}
		if input.Data.Specification.Set {
			data.Specification = input.Data.Specification.Value
		}
		if input.Data.Model.Set {
			data.Model = input.Data.Model.Value
		}
		if input.Data.Barcode.Set {
			data.Barcode = input.Data.Barcode.Value
		}
		if input.Data.Remark.Set {
			data.Remark = input.Data.Remark.Value
		}
		if input.Data.ProductTypeID.Set {
			data.ProductTypeID = input.Data.ProductTypeID.Value
		}
		if input.Data.DefaultInputUnitID.Set {
			data.DefaultInputUnitID = input.Data.DefaultInputUnitID.Value
		}
		if input.Data.PricingUnitID.Set {
			data.PricingUnitID = input.Data.PricingUnitID.Value
		}
		if input.Data.UnitConversions != nil {
			data.UnitConversions = productInputFromReadData(bob.DetailView{
				UnitConversions: *input.Data.UnitConversions,
			}).UnitConversions
		}
		if input.Data.Returnable != nil {
			data.Returnable = *input.Data.Returnable
		}
		if input.Data.DefaultPackagingSpec.Set {
			data.DefaultPackagingSpec = input.Data.DefaultPackagingSpec.Value
		}
		if input.Data.Formula != nil {
			data.Formula = productInputFromReadData(bob.DetailView{Formula: input.Data.Formula}).Formula
		}
		result, err := service.products.Save(ctx, dcldomain.ProductSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled, Data: data,
		}, actor)
		return productViewMutation(result), err
	}
	if entity == bob.EntityOperatingEntity {
		view, err := service.operatingEntities.Get(ctx, dcldomain.OperatingEntityGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-operating-entity-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.operatingEntities.Save(ctx, dcldomain.OperatingEntitySaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: dcldomain.OperatingEntityData{
				Name: input.Data.Name, ShortName: input.Data.ShortName.Value, TaxNumber: input.Data.TaxNumber.Value,
				Address: input.Data.Address.Value, Phone: input.Data.Phone.Value, Remark: input.Data.Remark.Value,
			},
		}, actor)
		return operatingEntityMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		view, err := service.warehouses.Get(ctx, dcldomain.WarehouseGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-warehouse-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.warehouses.Save(ctx, dcldomain.WarehouseSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: dcldomain.WarehouseData{
				Name: input.Data.Name, Address: input.Data.Address.Value,
				ContactName: input.Data.ContactName.Value, ContactPhone: input.Data.ContactPhone.Value,
				ManagerEmployeeID: input.Data.ManagerEmployeeID.Value, Remark: input.Data.Remark.Value,
			},
		}, actor)
		return warehouseMutation(result), err
	}
	if entity == bob.EntityVehicle {
		view, err := service.vehicles.Get(ctx, dcldomain.VehicleGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-vehicle-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.vehicles.Save(ctx, dcldomain.VehicleSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: dcldomain.VehicleData{
				Name: input.Data.Name, PlateNumber: input.Data.PlateNumber, VehicleType: input.Data.VehicleType,
				CarrierAffiliation: input.Data.CarrierAffiliation, BulkLiquidCapable: input.Data.BulkLiquidCapable,
				VIN: input.Data.VIN.Value, EngineNumber: input.Data.EngineNumber.Value,
				LoadCapacityKG: input.Data.LoadCapacityKG.Value, Remark: input.Data.Remark.Value,
			},
		}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		view, err := service.fundAccounts.Get(ctx, dcldomain.FundAccountGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-fund-account-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.fundAccounts.Save(ctx, dcldomain.FundAccountSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: dcldomain.FundAccountData{
				Name: input.Data.Name, Currency: input.Data.Currency,
				OperatingEntityID: input.Data.OperatingEntityID.Value,
				AccountName:       input.Data.AccountName.Value, BankName: input.Data.BankName.Value,
				BankBranch: input.Data.BankBranch.Value, AccountNumber: input.Data.AccountNumber.Value,
				Remark: input.Data.Remark.Value,
			},
		}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityEmployee {
		view, err := service.employees.Get(ctx, dcldomain.EmployeeGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-employee-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.employees.Save(ctx, dcldomain.EmployeeSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: dcldomain.EmployeeInput{DepartmentID: input.Data.DepartmentID.Value,
				PositionID: input.Data.PositionID.Value, Phone: input.Data.Phone.Value,
				Email: input.Data.Email.Value, HireDate: input.Data.HireDate.Value,
				Remark: input.Data.Remark.Value},
		}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntitySupplier {
		view, err := service.suppliers.Get(ctx, dcldomain.SupplierGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-supplier-save-get"))
		if err != nil {
			return seedMutation{}, err
		}
		result, err := service.suppliers.Save(ctx, dcldomain.SupplierSaveInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Enabled: view.Enabled,
			Data: supplierData(bob.CreateDetailInput{
				ShortName: input.Data.ShortName.Value, TaxNumber: input.Data.TaxNumber.Value,
				ContactName: input.Data.ContactName.Value, ContactPhone: input.Data.ContactPhone.Value,
				Email: input.Data.Email.Value, Address: input.Data.Address.Value, Remark: input.Data.Remark.Value,
				SettlementMethodID:         input.Data.SettlementMethodID.Value,
				DefaultPurchaserEmployeeID: input.Data.DefaultPurchaserEmployeeID.Value,
			}),
		}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityCustomerAccount {
		return seedMutation{}, errors.New("seed customer account reconciliation is not supported")
	}
	return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
}

func (service relationshipAwareLifecycleService) Get(
	ctx context.Context, entity string, input seedGetInput,
) (seedObjectView, error) {
	if entity == bob.EntityProduct {
		view, err := service.products.Get(ctx, dcldomain.ProductGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-product-get"))
		return productView(view), err
	}
	if entity == bob.EntityOperatingEntity {
		view, err := service.operatingEntities.Get(ctx, dcldomain.OperatingEntityGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-operating-entity-get"))
		return operatingEntityView(view), err
	}
	if entity == bob.EntityWarehouse {
		view, err := service.warehouses.Get(ctx, dcldomain.WarehouseGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-warehouse-get"))
		return warehouseView(view), err
	}
	if entity == bob.EntityVehicle {
		view, err := service.vehicles.Get(ctx, dcldomain.VehicleGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-vehicle-get"))
		return vehicleView(view), err
	}
	if entity == bob.EntityFundAccount {
		view, err := service.fundAccounts.Get(ctx, dcldomain.FundAccountGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-fund-account-get"))
		return fundAccountView(view), err
	}
	if entity == bob.EntityEmployee {
		view, err := service.employees.Get(ctx, dcldomain.EmployeeGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-employee-get"))
		return employeeView(view), err
	}
	if entity == bob.EntitySupplier {
		view, err := service.suppliers.Get(ctx, dcldomain.SupplierGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-supplier-get"))
		return supplierView(view), err
	}
	if entity == bob.EntityCustomerAccount {
		view, err := service.customerAccounts.Get(ctx, dcldomain.CustomerAccountGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-customer-account-get"))
		return customerAccountView(view), err
	}
	if entity != bob.EntityOtherUnit {
		return seedObjectView{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	view, err := service.relationships.GetOtherUnit(ctx, dcldomain.RelationshipGetInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID}, mustSeedActor("seed-bob-other-unit-get"))
	if err != nil {
		return seedObjectView{}, err
	}
	return seedObjectView{ObjectID: view.ObjectID, Entity: entity, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled,
		Approval: view.Approval,
		Data: bob.DetailView{Name: view.PartyDisplayName, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, Email: view.Data.Email, Address: view.Data.Address,
			Remark: view.Data.Remark, SettlementMethodID: view.Data.SettlementMethodID}}, nil
}

func (service relationshipAwareLifecycleService) Submit(ctx context.Context, entity string, input seedVersionRevisionInput, actor approval.Actor) (seedMutation, error) {
	if entity == bob.EntityCustomerAccount {
		if err := service.approveCustomerRelationship(ctx, input.ObjectID, actor); err != nil {
			return seedMutation{}, err
		}
		result, err := service.customerAccounts.Submit(ctx, dcldomain.CustomerAccountVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return customerAccountMutation(result), err
	}
	if entity == bob.EntitySupplier {
		partyID, err := service.supplierPartyID(ctx, input.ObjectID)
		if err != nil {
			return seedMutation{}, err
		}
		party, err := service.parties.Get(ctx, dcldomain.PartyGetInput{PartyID: partyID}, bob.PartyRelationshipVisibility{}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		if party.Approval.Status == approval.StatusDraft {
			pending, submitErr := service.parties.Submit(ctx, dcldomain.PartyVersionInput{PartyID: partyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, actor)
			if submitErr != nil {
				return seedMutation{}, submitErr
			}
			party.Approval = pending.Approval
		}
		if party.Approval.Status == approval.StatusPending {
			if _, approveErr := service.parties.Approve(ctx, dcldomain.PartyVersionInput{PartyID: partyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, mustReviewerActor("seed-bob-"+input.ObjectID+"-party-approve")); approveErr != nil {
				return seedMutation{}, approveErr
			}
		}
		result, err := service.suppliers.Submit(ctx, dcldomain.SupplierVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityEmployee {
		view, err := service.employees.Get(ctx, dcldomain.EmployeeGetInput{ObjectID: input.ObjectID}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		party, err := service.parties.Get(ctx, dcldomain.PartyGetInput{PartyID: view.PartyID}, bob.PartyRelationshipVisibility{}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		if party.Approval.Status == approval.StatusDraft {
			pending, submitErr := service.parties.Submit(ctx, dcldomain.PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, actor)
			if submitErr != nil {
				return seedMutation{}, submitErr
			}
			party.Approval = pending.Approval
		}
		if party.Approval.Status == approval.StatusPending {
			if _, approveErr := service.parties.Approve(ctx, dcldomain.PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, mustReviewerActor("seed-bob-"+input.ObjectID+"-party-approve")); approveErr != nil {
				return seedMutation{}, approveErr
			}
		}
		result, err := service.employees.Submit(ctx, dcldomain.EmployeeVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntityOtherUnit {
		view, err := service.relationships.GetOtherUnit(ctx, dcldomain.RelationshipGetInput{ObjectID: input.ObjectID}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		party, err := service.parties.Get(ctx, dcldomain.PartyGetInput{PartyID: view.PartyID}, bob.PartyRelationshipVisibility{}, actor)
		if err != nil {
			return seedMutation{}, err
		}
		if party.Approval.Status == approval.StatusDraft {
			pending, submitErr := service.parties.Submit(ctx, dcldomain.PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, actor)
			if submitErr != nil {
				return seedMutation{}, submitErr
			}
			party.Approval = pending.Approval
		}
		if party.Approval.Status == approval.StatusPending {
			if _, approveErr := service.parties.Approve(ctx, dcldomain.PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, mustReviewerActor("seed-bob-"+input.ObjectID+"-party-approve")); approveErr != nil {
				return seedMutation{}, approveErr
			}
		}
		result, err := service.relationships.SubmitOtherUnit(ctx, dcldomain.RelationshipVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	}
	if entity == bob.EntityProduct {
		result, err := service.products.Submit(ctx, dcldomain.ProductVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		result, err := service.fundAccounts.Submit(ctx, dcldomain.FundAccountVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityVehicle {
		result, err := service.vehicles.Submit(ctx, dcldomain.VehicleVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		result, err := service.warehouses.Submit(ctx, dcldomain.WarehouseVersionInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
		}, actor)
		return warehouseMutation(result), err
	}
	if entity != bob.EntityOperatingEntity {
		return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	result, err := service.operatingEntities.Submit(ctx, dcldomain.OperatingEntityVersionInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) approveCustomerRelationship(ctx context.Context, accountID string, actor approval.Actor) error {
	account, err := service.customerAccounts.Get(ctx, dcldomain.CustomerAccountGetInput{ObjectID: accountID}, actor)
	if err != nil {
		return fmt.Errorf("get customer account: %w", err)
	}
	partyID, err := service.customerPartyID(ctx, account.CustomerRelationshipID)
	if err != nil {
		return fmt.Errorf("get customer Party identity: %w", err)
	}
	party, err := service.parties.Get(ctx, dcldomain.PartyGetInput{PartyID: partyID}, bob.PartyRelationshipVisibility{}, actor)
	if err != nil {
		return fmt.Errorf("get customer Party: %w", err)
	}
	if party.Approval.Status == approval.StatusDraft {
		pending, submitErr := service.parties.Submit(ctx, dcldomain.PartyVersionInput{
			PartyID: party.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision,
		}, actor)
		if submitErr != nil {
			return fmt.Errorf("submit customer Party: %w", submitErr)
		}
		party.Approval = pending.Approval
	}
	if party.Approval.Status == approval.StatusPending {
		if _, approveErr := service.parties.Approve(ctx, dcldomain.PartyVersionInput{
			PartyID: party.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision,
		}, mustReviewerActor("seed-bob-"+accountID+"-customer-party-approve")); approveErr != nil {
			return fmt.Errorf("approve customer Party: %w", approveErr)
		}
	}
	customer, err := service.customers.Get(ctx, dcldomain.CustomerGetInput{ObjectID: account.CustomerRelationshipID}, actor)
	if err != nil {
		return fmt.Errorf("get customer relationship: %w", err)
	}
	if customer.Approval.Status == approval.StatusDraft {
		pending, submitErr := service.customers.Submit(ctx, dcldomain.CustomerVersionInput{
			ObjectID: customer.ObjectID, ApprovalEntryID: customer.Approval.ApprovalEntryID, ApprovalRevision: customer.Approval.Revision,
		}, actor)
		if submitErr != nil {
			return fmt.Errorf("submit customer relationship: %w", submitErr)
		}
		customer.Approval = pending.Approval
	}
	if customer.Approval.Status == approval.StatusPending {
		if _, approveErr := service.customers.Approve(ctx, dcldomain.CustomerVersionInput{
			ObjectID: customer.ObjectID, ApprovalEntryID: customer.Approval.ApprovalEntryID, ApprovalRevision: customer.Approval.Revision,
		}, mustReviewerActor("seed-bob-"+accountID+"-customer-approve")); approveErr != nil {
			return fmt.Errorf("approve customer relationship: %w", approveErr)
		}
	}
	return nil
}

func (service relationshipAwareLifecycleService) customerPartyID(ctx context.Context, objectID string) (string, error) {
	return service.queries.GetDCLCustomerRelationshipPartyIDForBOB(ctx, objectID)
}

func (service relationshipAwareLifecycleService) supplierPartyID(ctx context.Context, objectID string) (string, error) {
	return service.queries.GetDCLSupplierRelationshipPartyIDForBOB(ctx, objectID)
}

func (service relationshipAwareLifecycleService) Unsubmit(ctx context.Context, entity string, input seedReverseInput, actor approval.Actor) (seedMutation, error) {
	if entity == bob.EntityCustomerAccount {
		result, err := service.customerAccounts.Unsubmit(ctx, dcldomain.CustomerAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return customerAccountMutation(result), err
	}
	if entity == bob.EntitySupplier {
		result, err := service.suppliers.Unsubmit(ctx, dcldomain.SupplierReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityEmployee {
		result, err := service.employees.Unsubmit(ctx, dcldomain.EmployeeReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntityOtherUnit {
		result, err := service.relationships.UnsubmitOtherUnit(ctx, dcldomain.RelationshipReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	}
	if entity == bob.EntityProduct {
		result, err := service.products.Unsubmit(ctx, dcldomain.ProductReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		result, err := service.fundAccounts.Unsubmit(ctx, dcldomain.FundAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityVehicle {
		result, err := service.vehicles.Unsubmit(ctx, dcldomain.VehicleReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		result, err := service.warehouses.Unsubmit(ctx, dcldomain.WarehouseReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return warehouseMutation(result), err
	}
	if entity != bob.EntityOperatingEntity {
		return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	result, err := service.operatingEntities.Unsubmit(ctx, dcldomain.OperatingEntityReviewInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Approve(ctx context.Context, entity string, input seedReviewInput, actor approval.Actor) (seedMutation, error) {
	if entity == bob.EntityCustomerAccount {
		result, err := service.customerAccounts.Approve(ctx, dcldomain.CustomerAccountVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return customerAccountMutation(result), err
	}
	if entity == bob.EntitySupplier {
		result, err := service.suppliers.Approve(ctx, dcldomain.SupplierVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityOtherUnit {
		result, err := service.relationships.ApproveOtherUnit(ctx, dcldomain.RelationshipVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	}
	if entity == bob.EntityEmployee {
		result, err := service.employees.Approve(ctx, dcldomain.EmployeeVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntityProduct {
		result, err := service.products.Approve(ctx, dcldomain.ProductVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		result, err := service.fundAccounts.Approve(ctx, dcldomain.FundAccountVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityVehicle {
		result, err := service.vehicles.Approve(ctx, dcldomain.VehicleVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		result, err := service.warehouses.Approve(ctx, dcldomain.WarehouseVersionInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
		}, actor)
		return warehouseMutation(result), err
	}
	if entity != bob.EntityOperatingEntity {
		return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	result, err := service.operatingEntities.Approve(ctx, dcldomain.OperatingEntityVersionInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Unapprove(ctx context.Context, entity string, input seedReverseInput, actor approval.Actor) (seedMutation, error) {
	if entity == bob.EntityCustomerAccount {
		result, err := service.customerAccounts.Unapprove(ctx, dcldomain.CustomerAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return customerAccountMutation(result), err
	}
	if entity == bob.EntitySupplier {
		result, err := service.suppliers.Unapprove(ctx, dcldomain.SupplierReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityOtherUnit {
		result, err := service.relationships.UnapproveOtherUnit(ctx, dcldomain.RelationshipReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	}
	if entity == bob.EntityEmployee {
		result, err := service.employees.Unapprove(ctx, dcldomain.EmployeeReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntityProduct {
		result, err := service.products.Unapprove(ctx, dcldomain.ProductReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		result, err := service.fundAccounts.Unapprove(ctx, dcldomain.FundAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: input.Reason}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityVehicle {
		result, err := service.vehicles.Unapprove(ctx, dcldomain.VehicleReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		result, err := service.warehouses.Unapprove(ctx, dcldomain.WarehouseReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
		}, actor)
		return warehouseMutation(result), err
	}
	if entity != bob.EntityOperatingEntity {
		return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	result, err := service.operatingEntities.Unapprove(ctx, dcldomain.OperatingEntityReviewInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Reject(ctx context.Context, entity string, input seedReviewInput, actor approval.Actor) (seedMutation, error) {
	if entity == bob.EntityCustomerAccount {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.customerAccounts.Reject(ctx, dcldomain.CustomerAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: reason}, actor)
		return customerAccountMutation(result), err
	}
	if entity == bob.EntitySupplier {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.suppliers.Reject(ctx, dcldomain.SupplierReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: reason}, actor)
		return supplierMutation(result), err
	}
	if entity == bob.EntityOtherUnit {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.relationships.RejectOtherUnit(ctx, dcldomain.RelationshipReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: reason}, actor)
		return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}, err
	}
	if entity == bob.EntityEmployee {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.employees.Reject(ctx, dcldomain.EmployeeReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: reason}, actor)
		return employeeMutation(result), err
	}
	if entity == bob.EntityProduct {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.products.Reject(ctx, dcldomain.ProductReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: reason,
		}, actor)
		return productMutation(result), err
	}
	if entity == bob.EntityFundAccount {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.fundAccounts.Reject(ctx, dcldomain.FundAccountReviewInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision, Reason: reason}, actor)
		return fundAccountMutation(result), err
	}
	if entity == bob.EntityVehicle {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.vehicles.Reject(ctx, dcldomain.VehicleReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: reason,
		}, actor)
		return vehicleMutation(result), err
	}
	if entity == bob.EntityWarehouse {
		reason := ""
		if input.Reason != nil {
			reason = *input.Reason
		}
		result, err := service.warehouses.Reject(ctx, dcldomain.WarehouseReviewInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
			ApprovalRevision: input.ApprovalRevision, Reason: reason,
		}, actor)
		return warehouseMutation(result), err
	}
	if entity != bob.EntityOperatingEntity {
		return seedMutation{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	reason := ""
	if input.Reason != nil {
		reason = *input.Reason
	}
	result, err := service.operatingEntities.Reject(ctx, dcldomain.OperatingEntityReviewInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		ApprovalRevision: input.ApprovalRevision, Reason: reason,
	}, actor)
	return operatingEntityMutation(result), err
}

func operatingEntityData(data bob.CreateDetailInput) dcldomain.OperatingEntityData {
	return dcldomain.OperatingEntityData{
		Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber,
		Address: data.Address, Phone: data.Phone, Remark: data.Remark,
	}
}

func productData(data bob.CreateDetailInput) dcldomain.ProductInput {
	return productInputFromReadData(bob.DetailView{
		Name: data.Name, CategoryID: data.CategoryID,
		Specification: data.Specification, Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
		ProductTypeID: data.ProductTypeID, DefaultInputUnitID: data.DefaultInputUnitID,
		PricingUnitID: data.PricingUnitID, UnitConversions: data.UnitConversions,
		Returnable: data.Returnable, DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
	})
}

func productInputFromReadData(data bob.DetailView) dcldomain.ProductInput {
	return dcldomain.ProductInputFromData(dcldomain.ProductData{
		Name: data.Name, CategoryID: data.CategoryID,
		Specification: data.Specification, Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
		ProductTypeID: data.ProductTypeID, DefaultInputUnitID: data.DefaultInputUnitID,
		PricingUnitID: data.PricingUnitID, UnitConversions: data.UnitConversions,
		Returnable: data.Returnable, DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
	})
}

func supplierData(data bob.CreateDetailInput) dcldomain.SupplierData {
	return dcldomain.SupplierData{
		ShortName: data.ShortName, TaxNumber: data.TaxNumber,
		ContactName: data.ContactName, ContactPhone: data.ContactPhone,
		Email: data.Email, Address: data.Address, Remark: data.Remark,
		SettlementMethodID:         data.SettlementMethodID,
		DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID,
	}
}

func supplierMutation(result dcldomain.SupplierMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func supplierView(view dcldomain.SupplierView) seedObjectView {
	return seedObjectView{ObjectID: view.ObjectID, Entity: bob.EntitySupplier, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{Name: view.PartyDisplayName, ShortName: view.Data.ShortName,
			TaxNumber: view.Data.TaxNumber, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, Email: view.Data.Email, Address: view.Data.Address,
			Remark: view.Data.Remark, SettlementMethodID: view.Data.SettlementMethodID,
			DefaultPurchaserEmployeeID: view.Data.DefaultPurchaserEmployeeID,
			OperatingEntityID:          view.OperatingEntityID}, UpdatedAt: view.UpdatedAt}
}

func customerAccountMutation(result dcldomain.CustomerAccountMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func customerAccountView(view dcldomain.CustomerAccountView) seedObjectView {
	return seedObjectView{ObjectID: view.ObjectID, Entity: bob.EntityCustomerAccount, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{Name: view.Data.Name, ShortName: view.Data.ShortName,
			CustomerType: view.Data.CustomerTypeID, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, Email: view.Data.Email, Address: view.Data.Address,
			OperatingEntityID: view.Data.OperatingEntityID, SettlementMethodID: view.Data.SettlementMethodID,
			SalespersonEmployeeID: view.Data.PrimarySalesAttribution.SubjectObjectID,
			Remark:                view.Data.InternalReminder}, UpdatedAt: view.UpdatedAt}
}

func productInputFromView(data dcldomain.ProductData) dcldomain.ProductInput {
	return dcldomain.ProductInputFromData(data)
}

func productMutation(result dcldomain.ProductMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func productViewMutation(result dcldomain.ProductView) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func productView(view dcldomain.ProductView) seedObjectView {
	return seedObjectView{ObjectID: view.ObjectID, Entity: bob.EntityProduct, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, CategoryID: view.Data.CategoryID,
			Specification: view.Data.Specification, Model: view.Data.Model,
			Barcode: view.Data.Barcode, Remark: view.Data.Remark,
			ProductTypeID: view.Data.ProductTypeID, ProductTypeCode: view.Data.ProductTypeCode,
			ProductTypeName: view.Data.ProductTypeName, BehaviorProfile: view.Data.BehaviorProfile,
			DefaultInputUnitID: view.Data.DefaultInputUnitID, PricingUnitID: view.Data.PricingUnitID,
			UnitConversions: view.Data.UnitConversions, Returnable: view.Data.Returnable,
			DefaultPackagingSpec: view.Data.DefaultPackagingSpec, Formula: view.Data.Formula,
		}, UpdatedAt: view.UpdatedAt}
}

func operatingEntityMutation(result dcldomain.OperatingEntityMutation) seedMutation {
	return seedMutation{
		ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval,
	}
}

func operatingEntityView(view dcldomain.OperatingEntityView) seedObjectView {
	return seedObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityOperatingEntity, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, ShortName: view.Data.ShortName, TaxNumber: view.Data.TaxNumber,
			Address: view.Data.Address, Phone: view.Data.Phone, Remark: view.Data.Remark,
		}, UpdatedAt: view.UpdatedAt,
	}
}

func warehouseData(data bob.CreateDetailInput) dcldomain.WarehouseData {
	return dcldomain.WarehouseData{
		Name: data.Name, Address: data.Address, ContactName: data.ContactName,
		ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, Remark: data.Remark,
	}
}

func warehouseMutation(result dcldomain.WarehouseMutation) seedMutation {
	return seedMutation{
		ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval,
	}
}

func vehicleData(data bob.CreateDetailInput) dcldomain.VehicleData {
	return dcldomain.VehicleData{
		Name: data.Name, PlateNumber: data.PlateNumber, VehicleType: data.VehicleType,
		CarrierAffiliation: data.CarrierAffiliation, BulkLiquidCapable: data.BulkLiquidCapable,
		VIN: data.VIN, EngineNumber: data.EngineNumber, LoadCapacityKG: data.LoadCapacityKG, Remark: data.Remark,
	}
}

func vehicleMutation(result dcldomain.VehicleMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func vehicleView(view dcldomain.VehicleView) seedObjectView {
	return seedObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityVehicle, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, PlateNumber: view.Data.PlateNumber, VehicleType: view.Data.VehicleType,
			CarrierAffiliation: view.Data.CarrierAffiliation, BulkLiquidCapable: view.Data.BulkLiquidCapable,
			VIN: view.Data.VIN, EngineNumber: view.Data.EngineNumber,
			LoadCapacityKG: view.Data.LoadCapacityKG, Remark: view.Data.Remark,
		}, UpdatedAt: view.UpdatedAt,
	}
}

func fundAccountData(data bob.CreateDetailInput) dcldomain.FundAccountData {
	return dcldomain.FundAccountData{
		Name: data.Name, Currency: data.Currency, OperatingEntityID: data.OperatingEntityID,
		AccountName: data.AccountName, BankName: data.BankName, BankBranch: data.BankBranch,
		AccountNumber: data.AccountNumber, Remark: data.Remark,
	}
}

func fundAccountMutation(result dcldomain.FundAccountMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func fundAccountView(view dcldomain.FundAccountView) seedObjectView {
	return seedObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityFundAccount, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, Currency: view.Data.Currency, OperatingEntityID: view.Data.OperatingEntityID,
			AccountName: view.Data.AccountName, BankName: view.Data.BankName, BankBranch: view.Data.BankBranch,
			AccountNumber: view.Data.AccountNumber, Remark: view.Data.Remark,
		}, UpdatedAt: view.UpdatedAt,
	}
}

func employeeMutation(result dcldomain.EmployeeMutation) seedMutation {
	return seedMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func employeeView(view dcldomain.EmployeeView) seedObjectView {
	return seedObjectView{ObjectID: view.ObjectID, Entity: bob.EntityEmployee, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{Name: view.PartyDisplayName, OperatingEntityID: view.OperatingEntityID,
			DepartmentID: view.Data.DepartmentID, PositionID: view.Data.PositionID, Phone: view.Data.Phone,
			Email: view.Data.Email, HireDate: view.Data.HireDate, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func warehouseView(view dcldomain.WarehouseView) seedObjectView {
	return seedObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityWarehouse, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, Address: view.Data.Address, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, ManagerEmployeeID: view.Data.ManagerEmployeeID,
			Remark: view.Data.Remark,
		}, UpdatedAt: view.UpdatedAt,
	}
}

type objectLookup interface {
	Find(context.Context, string, string) (string, bool, error)
}

type queryLookup struct {
	queries *dbsqlc.Queries
	pool    *pgxpool.Pool
}

func (l queryLookup) Find(ctx context.Context, entity, code string) (string, bool, error) {
	if entity == bob.EntityOperatingEntity || entity == bob.EntityWarehouse || entity == bob.EntityVehicle || entity == bob.EntityFundAccount || entity == bob.EntityProduct || entity == bob.EntityEmployee || entity == bob.EntitySupplier {
		var id string
		err := l.pool.QueryRow(ctx, `SELECT subject_id FROM approval_events
			WHERE domain='dcl' AND entity=$1 AND request_id=$2 AND action='CREATED'
			ORDER BY created_at,id LIMIT 1`, entity, requestID(code, "create")).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return id, err == nil, err
	}
	if auxiliaryEntity, ok := auxiliarySeedEntity(entity); ok {
		seedName := code
		for _, item := range samples {
			if item.entity == entity && item.data.Code == code {
				seedName = item.data.Name
				break
			}
		}
		id, err := l.queries.FindAuxObjectByCodeOrName(ctx, dbsqlc.FindAuxObjectByCodeOrNameParams{
			Entity: auxiliaryEntity, Code: code, Name: seedName,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return id, err == nil, err
	}
	if entity == auxdomain.EntitySettlementMethod {
		id, err := l.queries.FindEnabledSettlementMethodByTermCode(ctx, code)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return id, err == nil, err
	}
	id, err := l.queries.FindBobSeedObjectID(ctx, dbsqlc.FindBobSeedObjectIDParams{
		Entity:   entity,
		SeedCode: code,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

type Seeder struct {
	service   lifecycleService
	lookup    objectLookup
	pool      *pgxpool.Pool
	auxiliary *auxdomain.Service
}

func New(pool *pgxpool.Pool) *Seeder {
	authorizer := authorization.Func(nil)
	auxiliary := auxdomain.NewService(pool)
	auxiliaryResolver := auxiliaryrefs.New(auxiliary)
	bus := txevent.NewBus()
	partyDeclarations := dcldomain.NewPartyService(pool, bob.NewPartyCurrentReader(pool), authorizer, bus)
	service := bob.NewService(pool, auxiliaryResolver)
	operatingEntities := dcldomain.NewOperatingEntityService(pool, service, authorizer, bus)
	warehouses := dcldomain.NewWarehouseService(pool, service, authorizer, bus)
	vehicles := dcldomain.NewVehicleService(pool, service, authorizer, bus)
	fundAccounts := dcldomain.NewFundAccountService(pool, service, authorizer, bus)
	products := dcldomain.NewProductService(pool, service, authorizer, bus)
	employees := dcldomain.NewEmployeeService(pool, service, partyDeclarations, bob.NewPartyCurrentReader(pool), authorizer, bus)
	suppliers := dcldomain.NewSupplierService(pool, service, partyDeclarations, bob.NewPartyCurrentReader(pool), authorizer, bus)
	relationships := dcldomain.NewRelationshipService(pool, service, partyDeclarations, bob.NewPartyCurrentReader(pool), authorizer, bus)
	accounts := dcldomain.NewCustomerAccountService(pool, service, authorizer, bus)
	customers := dcldomain.NewCustomerService(pool, service, partyDeclarations, bob.NewPartyCurrentReader(pool), accounts, authorizer, bus)
	return &Seeder{
		service: relationshipAwareLifecycleService{relationships: relationships,
			business: service, customers: customers, customerAccounts: accounts, auxiliary: auxiliary, pool: pool, queries: dbsqlc.New(pool), operatingEntities: operatingEntities, warehouses: warehouses,
			vehicles: vehicles, fundAccounts: fundAccounts, products: products, employees: employees,
			suppliers: suppliers, parties: partyDeclarations},
		lookup: queryLookup{queries: dbsqlc.New(pool), pool: pool}, pool: pool,
		auxiliary: auxiliary,
	}
}

func auxiliarySeedEntity(entity string) (string, bool) {
	switch entity {
	case auxdomain.EntityProductCategory:
		return auxdomain.EntityProductCategory, true
	case auxdomain.EntityDepartment:
		return auxdomain.EntityDepartment, true
	case auxdomain.EntityPosition:
		return auxdomain.EntityPosition, true
	default:
		return "", false
	}
}

type sample struct {
	entity                         string
	data                           bob.CreateDetailInput
	status                         string
	carrierServiceRelationshipCode string
	categoryCode                   string
	departmentCode                 string
	positionCode                   string
	parentCode                     string
	managerEmployeeCode            string
	salespersonEmployeeCode        string
	settlementMethodCode           string
	operatingEntityCode            string
	formulaMaterialCode            string
	formulaBaseQuantity            string
	formulaMaterialQuantity        string
}

var samples = [...]sample{
	{entity: auxdomain.EntityProductCategory, data: bob.CreateDetailInput{
		Code: "DEMO-CAT-001", Name: "工业零部件", TargetEntity: bob.EntityProduct, Description: "产品演示分类",
	}, status: approvedStatus},
	{entity: auxdomain.EntityProductCategory, data: bob.CreateDetailInput{
		Code: "DEMO-CAT-002", Name: "标准件", TargetEntity: bob.EntityProduct, Description: "工业零部件子分类",
	}, status: approvedStatus, parentCode: "DEMO-CAT-001"},
	{entity: auxdomain.EntityDepartment, data: bob.CreateDetailInput{
		Code: "DEMO-DEPT-001", Name: "运营部", Description: "演示有效部门",
	}, status: approvedStatus},
	{entity: auxdomain.EntityDepartment, data: bob.CreateDetailInput{
		Code: "DEMO-DEPT-002", Name: "华东运营组", Description: "演示草稿部门",
	}, status: string(approval.StatusDraft), parentCode: "DEMO-DEPT-001"},
	{entity: auxdomain.EntityPosition, data: bob.CreateDetailInput{
		Code: "DEMO-POS-001", Name: "运营专员", Description: "演示有效岗位",
	}, status: approvedStatus},
	{entity: auxdomain.EntityPosition, data: bob.CreateDetailInput{
		Code: "DEMO-POS-002", Name: "仓储主管", Description: "演示待审核岗位",
	}, status: string(approval.StatusPending)},
	{entity: bob.EntityOperatingEntity, data: bob.CreateDetailInput{
		Code: "DEMO-OPE-001", Name: "上海示例科技有限公司", ShortName: "上海示例",
		TaxNumber: "91310000DEMO0OPE01", Address: "上海市浦东新区示例路1号", Phone: "021-60000000",
	}, status: approvedStatus},
	{entity: bob.EntityEmployee, data: bob.CreateDetailInput{
		Code: "DEMO-EMP-001", Name: "张伟", Phone: "13800000004",
		Email: "zhangwei@example.com", HireDate: "2024-01-15", Remark: "演示在岗员工",
	}, status: approvedStatus, departmentCode: "DEMO-DEPT-001", positionCode: "DEMO-POS-001", operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityEmployee, data: bob.CreateDetailInput{
		Code: "DEMO-EMP-002", Name: "李娜（草稿）", Phone: "13800000005",
	}, status: string(approval.StatusDraft), departmentCode: "DEMO-DEPT-001", positionCode: "DEMO-POS-001", operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityCustomerAccount, data: bob.CreateDetailInput{
		Code: "DEMO-CUST-001", Name: "星河零售有限公司", CustomerType: stringPointer(bob.CustomerTypeEndUser),
		ShortName: "星河零售", TaxNumber: "91310000DEMO000001", ContactName: "王经理",
		ContactPhone: "+86 13800000001", Email: "sales@example.com",
		Address: "上海市浦东新区示例路1号", Remark: "演示终端客户",
	}, status: approvedStatus, salespersonEmployeeCode: "DEMO-EMP-001", settlementMethodCode: bob.SettlementTermMonthlyCurrent, operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityCustomerAccount, data: bob.CreateDetailInput{
		Code: "DEMO-CUST-002", Name: "新客户（草稿）", CustomerType: stringPointer(bob.CustomerTypeEndUser),
		ContactName: "陈先生", ContactPhone: "13800000002",
	}, status: string(approval.StatusDraft), salespersonEmployeeCode: "DEMO-EMP-001", operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityOtherUnit, data: bob.CreateDetailInput{
		Code: "DEMO-OTU-001", Name: "自营物流服务单位",
		ShortName: "自营物流", ContactName: "调度中心", ContactPhone: "021-60000001",
		Address: "上海市闵行区物流路1号", Remark: "演示物流服务单位",
	}, status: approvedStatus, settlementMethodCode: bob.SettlementTermMonthlyCurrent, operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntitySupplier, data: bob.CreateDetailInput{
		Code: "DEMO-SUP-003", Name: "通用零部件供应商",
		ShortName: "通用供应商", ContactName: "采购对接人", ContactPhone: "13800000006",
		Address: "江苏省苏州市工业园区示例路3号", Remark: "VOU 演示普通供应商",
	}, status: approvedStatus, salespersonEmployeeCode: "DEMO-EMP-001", settlementMethodCode: bob.SettlementTermMonthlyCurrent, operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntitySupplier, data: bob.CreateDetailInput{
		Code: "DEMO-SUP-002", Name: "待审核供应商", TaxNumber: "91310000DEMO000002",
		ContactName: "赵经理", ContactPhone: "13800000003",
	}, status: string(approval.StatusPending), salespersonEmployeeCode: "DEMO-EMP-001", settlementMethodCode: bob.SettlementTermMonthlyCurrent, operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-PROD-001", Name: "标准零件 A", Unit: "件",
		DefaultPackagingSpec: "1",
		Specification:        "M20", Model: "A-20", Barcode: "DEMO-BARCODE-001", Remark: "演示标准产品",
	}, status: approvedStatus, categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-PROD-002", Name: "试制零件 B", Unit: "件",
		DefaultPackagingSpec: "1",
		Specification:        "M30", Model: "B-30", Barcode: "DEMO-BARCODE-002",
	}, status: string(approval.StatusDraft), categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-FG-001", Name: "标准自制品 A", Unit: "件",
		DefaultPackagingSpec: "1",
		Specification:        "FG-A", Model: "A-100",
		Remark: "生产单固定测试成品",
	}, status: approvedStatus, categoryCode: "DEMO-CAT-002",
		formulaMaterialCode: "DEMO-PROD-001", formulaBaseQuantity: "1", formulaMaterialQuantity: "2"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-FG-002", Name: "客户定制品 B", Unit: "件",
		DefaultPackagingSpec: "1",
		Specification:        "FG-B", Model: "B-200",
		Remark: "生产配货固定测试成品",
	}, status: approvedStatus, categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityWarehouse, data: bob.CreateDetailInput{
		Code: "DEMO-WH-001", Name: "华东主仓", Address: "上海市嘉定区仓储路1号",
		ContactName: "张伟", ContactPhone: "13800000004", Remark: "演示主仓",
	}, status: approvedStatus, managerEmployeeCode: "DEMO-EMP-001"},
	{entity: bob.EntityWarehouse, data: bob.CreateDetailInput{
		Code: "DEMO-WH-002", Name: "临时仓（草稿）", Address: "上海市青浦区临时仓路2号",
	}, status: string(approval.StatusDraft)},
	{entity: bob.EntityVehicle, data: bob.CreateDetailInput{
		Code: "DEMO-VEH-001", Name: "自营配送一号车", PlateNumber: "沪A10001", VehicleType: "DIT-0003",
		VIN: "LSVAA4187N2000001", EngineNumber: "ENG-DEMO-001", LoadCapacityKG: "18000.000",
		Remark: "演示有效车辆",
	}, status: approvedStatus, carrierServiceRelationshipCode: "DEMO-OTU-001"},
	{entity: bob.EntityVehicle, data: bob.CreateDetailInput{
		Code: "DEMO-VEH-002", Name: "自营配送二号车", PlateNumber: "沪A10002", VehicleType: "DIT-0003",
		VIN: "LSVAA4187N2000002", EngineNumber: "ENG-DEMO-002", LoadCapacityKG: "12000.000",
	}, status: string(approval.StatusDraft), carrierServiceRelationshipCode: "DEMO-OTU-001"},
	{entity: bob.EntityFundAccount, data: bob.CreateDetailInput{
		Code: "DEMO-FA-001", Name: "人民币基本账户", Currency: "CNY",
		AccountName: "上海示例科技有限公司", BankName: "示例银行",
		BankBranch: "上海浦东支行", AccountNumber: "622200000000000001", Remark: "演示基本账户",
	}, status: approvedStatus, operatingEntityCode: "DEMO-OPE-001"},
	{entity: bob.EntityFundAccount, data: bob.CreateDetailInput{
		Code: "DEMO-FA-002", Name: "备用结算账户", Currency: "CNY",
		AccountName: "上海示例科技有限公司", BankName: "示例银行",
		BankBranch: "上海虹桥支行", AccountNumber: "622200000000000002",
	}, status: string(approval.StatusDraft), operatingEntityCode: "DEMO-OPE-001"},
}

func (s *Seeder) Seed(ctx context.Context) (Result, error) {
	var result Result
	for _, item := range samples {
		outcome, err := s.seedOne(ctx, item)
		if err != nil {
			return result, fmt.Errorf("seed %s %s: %w", item.entity, item.data.Code, err)
		}
		switch outcome {
		case outcomeCreated:
			result.Created++
		case outcomeResumed:
			result.Resumed++
		case outcomeSkipped:
			result.Skipped++
		}
	}
	return result, nil
}

type seedOutcome int

const (
	outcomeCreated seedOutcome = iota + 1
	outcomeResumed
	outcomeSkipped
)

func (s *Seeder) seedOne(ctx context.Context, item sample) (seedOutcome, error) {
	if s.auxiliary != nil {
		if entity, ok := auxiliarySeedEntity(item.entity); ok {
			return s.seedAuxiliaryOne(ctx, entity, item)
		}
	}
	resolve := func(entity, code, label string) (string, error) {
		if code == "" {
			return "", nil
		}
		objectID, found, err := s.lookup.Find(ctx, entity, code)
		if err != nil {
			return "", fmt.Errorf("find %s: %w", label, err)
		}
		if !found {
			return "", fmt.Errorf("%s %s is missing", label, code)
		}
		return objectID, nil
	}
	var err error
	if item.carrierServiceRelationshipCode != "" {
		carrierObjectID, resolveErr := resolve(
			bob.EntityOtherUnit,
			item.carrierServiceRelationshipCode,
			"carrier service relationship",
		)
		if resolveErr != nil {
			return 0, resolveErr
		}
		item.data.CarrierAffiliation = &bob.CarrierAffiliation{
			Type: "EXTERNAL", ServiceRelationshipObjectID: carrierObjectID,
		}
	}
	if item.data.CategoryID, err = resolve(auxdomain.EntityProductCategory, item.categoryCode, "category"); err != nil {
		return 0, err
	}
	if item.data.DepartmentID, err = resolve(auxdomain.EntityDepartment, item.departmentCode, "department"); err != nil {
		return 0, err
	}
	if item.data.PositionID, err = resolve(auxdomain.EntityPosition, item.positionCode, "position"); err != nil {
		return 0, err
	}
	if item.data.ManagerEmployeeID, err = resolve(bob.EntityEmployee, item.managerEmployeeCode, "manager employee"); err != nil {
		return 0, err
	}
	if item.data.SalespersonEmployeeID, err = resolve(
		bob.EntityEmployee, item.salespersonEmployeeCode, "salesperson employee",
	); err != nil {
		return 0, err
	}
	if item.data.SettlementMethodID, err = resolve(
		auxdomain.EntitySettlementMethod, item.settlementMethodCode, "settlement method",
	); err != nil {
		return 0, err
	}
	if item.entity == bob.EntitySupplier {
		item.data.DefaultPurchaserEmployeeID = item.data.SalespersonEmployeeID
		item.data.SalespersonEmployeeID = ""
	}
	if item.data.OperatingEntityID, err = resolve(
		bob.EntityOperatingEntity, item.operatingEntityCode, "operating entity",
	); err != nil {
		return 0, err
	}
	if item.parentCode != "" {
		if item.data.ParentID, err = resolve(item.entity, item.parentCode, "parent"); err != nil {
			return 0, err
		}
	}
	if item.entity == bob.EntityProduct {
		profile := "RAW_MATERIAL"
		if item.data.Code == "DEMO-FG-001" {
			profile = "STANDARD_FINISHED"
		}
		if item.data.Code == "DEMO-FG-002" {
			profile = "CUSTOM_FINISHED"
		}
		if s.pool == nil {
			item.data.ProductTypeID = demoProductTypeID(profile)
		} else if item.data.ProductTypeID, err = dbsqlc.New(s.pool).FindEnabledProductTypeByBehaviorProfile(ctx, profile); err != nil {
			return 0, fmt.Errorf("resolve demo product type: %w", err)
		}
		if s.pool != nil {
			item.data.Unit = ""
		}
		item.data.DefaultInputUnitID = "01JAVX00000000000000000013"
		item.data.PricingUnitID = "01JAVX00000000000000000011"
		item.data.UnitConversions = []bob.ProductUnitConversion{
			{Unit: bob.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000013"}, Factor: "1"},
			{Unit: bob.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000011"}, Factor: "1"},
		}
	}
	if item.formulaMaterialCode != "" {
		materialObjectID, resolveErr := resolve(
			bob.EntityProduct,
			item.formulaMaterialCode,
			"formula material",
		)
		if resolveErr != nil {
			return 0, resolveErr
		}
		material, getErr := s.service.Get(
			ctx,
			bob.EntityProduct,
			seedGetInput{ObjectID: materialObjectID},
		)
		if getErr != nil {
			return 0, fmt.Errorf("get formula material: %w", getErr)
		}
		if string(material.Approval.Status) != approvedStatus {
			return 0, fmt.Errorf("formula material %s is not effective", item.formulaMaterialCode)
		}
		item.data.Formula = &bob.ProductFormula{
			Output: bob.QuantitySnapshot{EnteredQuantity: item.formulaBaseQuantity, EnteredUnit: bob.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000013"}, BaseQuantity: item.formulaBaseQuantity},
			Components: []bob.ProductFormulaComponent{{
				Material: bob.FormulaMaterialReference{
					ObjectID: material.ObjectID, ApprovalEntryID: material.Approval.ApprovalEntryID,
				},
				Quantity: bob.QuantitySnapshot{EnteredQuantity: item.formulaMaterialQuantity, EnteredUnit: bob.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000013"}, BaseQuantity: item.formulaMaterialQuantity}, ResolutionStatus: "CURRENT",
			}},
		}
	}

	objectID, found, err := s.findSeedObject(ctx, item)
	if err != nil {
		return 0, fmt.Errorf("find existing object: %w", err)
	}

	var current seedMutation
	outcome := outcomeCreated
	if found {
		view, getErr := s.service.Get(ctx, item.entity, seedGetInput{ObjectID: objectID})
		if getErr != nil {
			return 0, fmt.Errorf("get existing object: %w", getErr)
		}
		seedManagedRelationship := item.entity == bob.EntityEmployee || item.entity == bob.EntitySupplier ||
			item.entity == bob.EntityOtherUnit || item.entity == bob.EntityCustomerAccount
		if !seedManagedRelationship && !matches(item, view) {
			if !matchesLegacyShape(item, view) {
				return 0, fmt.Errorf("reserved demo code is occupied by different data")
			}
			current, err = s.reconcileExisting(ctx, item, view)
			if err != nil {
				return 0, err
			}
			outcome = outcomeResumed
		} else {
			if string(view.Approval.Status) == item.status {
				return outcomeSkipped, nil
			}
			current = seedMutation{
				ObjectID:         view.ObjectID,
				ApprovalRevision: view.ApprovalRevision,
				Approval:         view.Approval,
			}
			outcome = outcomeResumed
		}
	} else {
		current, err = s.service.Create(
			ctx,
			item.entity,
			seedCreateInput{Data: item.data},
			mustSeedActor(requestID(item.data.Code, "create")),
		)
		if err != nil {
			return 0, fmt.Errorf("create object: %w (cause: %v)", err, errors.Unwrap(err))
		}
	}

	if current.Approval.Status == approval.StatusDraft && item.status != string(current.Approval.Status) {
		current, err = s.service.Submit(ctx, item.entity, seedVersionRevisionInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision,
		}, mustSeedActor(requestID(item.data.Code, "submit")))
		if err != nil {
			return 0, fmt.Errorf("submit object: %w (cause: %s)", err, errorChain(errors.Unwrap(err)))
		}
	}

	switch {
	case string(current.Approval.Status) == item.status:
		return outcome, nil
	case current.Approval.Status == approval.StatusPending && item.status == approvedStatus:
		reason := "演示数据：审核通过"
		_, err = s.service.Approve(ctx, item.entity, seedReviewInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision, Reason: &reason,
		}, mustReviewerActor(requestID(item.data.Code, "approve")))
	default:
		return 0, fmt.Errorf("cannot advance status %s to %s", current.Approval.Status, item.status)
	}
	if err != nil {
		return 0, fmt.Errorf("review object: %w", err)
	}
	return outcome, nil
}

func (s *Seeder) findSeedObject(ctx context.Context, item sample) (string, bool, error) {
	if item.entity != bob.EntityCustomerAccount || s.pool == nil {
		return s.lookup.Find(ctx, item.entity, item.data.Code)
	}
	var objectID string
	err := s.pool.QueryRow(ctx, `SELECT subject_id FROM approval_events
		WHERE domain='dcl' AND entity='customer-account' AND action='CREATED' AND request_id=$1
		ORDER BY created_at,id LIMIT 1`, requestID(item.data.Code, "create")).Scan(&objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return objectID, true, nil
}

func (s *Seeder) seedAuxiliaryOne(
	ctx context.Context,
	entity string,
	item sample,
) (seedOutcome, error) {
	objectID, found, err := s.lookup.Find(ctx, item.entity, item.data.Code)
	if err != nil {
		return 0, fmt.Errorf("find existing auxiliary object: %w", err)
	}
	created := false
	if !found {
		data := map[string]any{
			"name":        item.data.Name,
			"description": item.data.Description,
		}
		if item.parentCode != "" {
			parentID, parentFound, parentErr := s.lookup.Find(ctx, item.entity, item.parentCode)
			if parentErr != nil {
				return 0, fmt.Errorf("find auxiliary parent: %w", parentErr)
			}
			if !parentFound {
				return 0, fmt.Errorf("parent %s is missing", item.parentCode)
			}
			data["parentId"] = parentID
		}
		result, createErr := s.auxiliary.Create(
			ctx,
			entity,
			auxdomain.CreateInput{Data: auxdomain.CreateData{Data: data}},
			mustSeedActor(requestID(item.data.Code, "create")),
		)
		if createErr != nil {
			return 0, createErr
		}
		objectID, created = result.ObjectID, true
	}
	_, getErr := s.auxiliary.Get(ctx, entity, auxdomain.GetInput{ObjectID: objectID}, mustSeedActor(requestID(item.data.Code, "get")))
	if getErr != nil {
		return 0, getErr
	}
	if created {
		return outcomeCreated, nil
	}
	return outcomeSkipped, nil
}

func demoProductTypeID(profile string) string {
	switch profile {
	case "STANDARD_FINISHED":
		return "01JPTP00000000000000000003"
	case "CUSTOM_FINISHED":
		return "01JPTP00000000000000000005"
	case "PACKAGING":
		return "01JPTP00000000000000000007"
	default:
		return "01JPTP00000000000000000001"
	}
}

func matches(item sample, view seedObjectView) bool {
	expectedCustomerType := deref(item.data.CustomerType)
	if item.entity == bob.EntityCustomerAccount && expectedCustomerType == "" {
		expectedCustomerType = bob.CustomerTypeEndUser
	}
	return view.Entity == item.entity &&
		view.Data.Name == item.data.Name &&
		view.Data.Unit == item.data.Unit &&
		view.Data.Currency == item.data.Currency &&
		view.Data.CustomerType == expectedCustomerType &&
		view.Data.PlateNumber == item.data.PlateNumber &&
		view.Data.VehicleType == item.data.VehicleType &&
		equalCarrierAffiliation(view.Data.CarrierAffiliation, item.data.CarrierAffiliation) &&
		view.Data.TargetEntity == item.data.TargetEntity &&
		view.Data.ShortName == item.data.ShortName &&
		view.Data.CategoryID == item.data.CategoryID &&
		view.Data.TaxNumber == item.data.TaxNumber &&
		view.Data.ContactName == item.data.ContactName &&
		view.Data.ContactPhone == item.data.ContactPhone &&
		view.Data.Email == item.data.Email &&
		view.Data.Address == item.data.Address &&
		view.Data.Remark == item.data.Remark &&
		view.Data.DepartmentID == item.data.DepartmentID &&
		view.Data.PositionID == item.data.PositionID &&
		view.Data.Phone == item.data.Phone &&
		view.Data.HireDate == item.data.HireDate &&
		view.Data.Specification == item.data.Specification &&
		view.Data.Model == item.data.Model &&
		view.Data.Barcode == item.data.Barcode &&
		view.Data.Description == item.data.Description &&
		view.Data.ManagerEmployeeID == item.data.ManagerEmployeeID &&
		view.Data.VIN == item.data.VIN &&
		view.Data.EngineNumber == item.data.EngineNumber &&
		view.Data.LoadCapacityKG == item.data.LoadCapacityKG &&
		view.Data.AccountName == item.data.AccountName &&
		view.Data.BankName == item.data.BankName &&
		view.Data.BankBranch == item.data.BankBranch &&
		view.Data.AccountNumber == item.data.AccountNumber &&
		view.Data.OperatingEntityID == item.data.OperatingEntityID &&
		view.Data.ParentID == item.data.ParentID &&
		view.Data.SalespersonEmployeeID == item.data.SalespersonEmployeeID &&
		view.Data.DefaultPurchaserEmployeeID == item.data.DefaultPurchaserEmployeeID &&
		view.Data.SettlementMethodID == item.data.SettlementMethodID &&
		view.Data.MonthlyClosingDay == expectedMonthlyClosingDay(item) &&
		view.Data.RuleType == item.data.RuleType &&
		view.Data.MonthOffset == item.data.MonthOffset &&
		equalInt32Pointer(view.Data.DayOfMonth, item.data.DayOfMonth) &&
		view.Data.DayOffset == item.data.DayOffset &&
		formulaMatches(view.Data.Formula, item.data.Formula)
}

func expectedMonthlyClosingDay(item sample) int32 {
	if item.entity == bob.EntityCustomerAccount && item.data.MonthlyClosingDay == 0 {
		return 31
	}
	return item.data.MonthlyClosingDay
}

func formulaMatches(actual, expected *bob.ProductFormula) bool {
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	if actual.Output.BaseQuantity != expected.Output.BaseQuantity ||
		len(actual.Components) != len(expected.Components) {
		return false
	}
	for index := range actual.Components {
		actualComponent := actual.Components[index]
		expectedComponent := expected.Components[index]
		if actualComponent.Material.ObjectID != expectedComponent.Material.ObjectID ||
			actualComponent.Material.ApprovalEntryID != expectedComponent.Material.ApprovalEntryID ||
			actualComponent.Quantity.BaseQuantity != expectedComponent.Quantity.BaseQuantity {
			return false
		}
	}
	return true
}

func matchesLegacyShape(item sample, view seedObjectView) bool {
	if item.entity == auxdomain.EntityProductCategory || item.entity == auxdomain.EntityDepartment || item.entity == auxdomain.EntityPosition {
		return false
	}
	return view.Entity == item.entity &&
		view.Data.Name == item.data.Name &&
		view.Data.Unit == item.data.Unit &&
		view.Data.Currency == item.data.Currency &&
		view.Data.PlateNumber == item.data.PlateNumber &&
		view.Data.VehicleType == item.data.VehicleType &&
		equalCarrierAffiliation(view.Data.CarrierAffiliation, item.data.CarrierAffiliation)
}

func requestID(code, action string) string {
	return "seed-bob-" + code + "-" + action
}

func (s *Seeder) reconcileExisting(ctx context.Context, item sample, view seedObjectView) (seedMutation, error) {
	current := seedMutation{
		ObjectID: view.ObjectID, ApprovalRevision: view.ApprovalRevision,
		Approval: view.Approval,
	}
	if item.entity == bob.EntitySupplier && string(current.Approval.Status) == approvedStatus {
		saved, err := s.service.Save(ctx, item.entity, seedSaveInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision,
			Data:             detailInput(item.entity, item.data),
		}, mustSeedActor(requestID(item.data.Code, "upgrade-save")))
		if err != nil {
			return seedMutation{}, fmt.Errorf("save upgraded demo supplier: %w", err)
		}
		return saved, nil
	}
	var err error
	switch current.Approval.Status {
	case approval.StatusApproved:
		current, err = s.service.Unapprove(ctx, item.entity, seedReverseInput{
			ObjectID:        current.ObjectID,
			ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision,
			Reason: "演示数据：撤销批准后补齐属性",
		}, mustSeedActor(requestID(item.data.Code, "upgrade-unapprove")))
		if err == nil {
			current, err = s.service.Unsubmit(ctx, item.entity, seedReverseInput{
				ObjectID:        current.ObjectID,
				ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision,
				Reason: "演示数据：退回草稿补齐属性",
			}, mustSeedActor(requestID(item.data.Code, "upgrade-unsubmit")))
		}
	case approval.StatusPending:
		reason := "演示数据：补齐新增属性"
		current, err = s.service.Reject(ctx, item.entity, seedReviewInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision, Reason: &reason,
		}, mustReviewerActor(requestID(item.data.Code, "upgrade-reject")))
	case approval.StatusDraft:
	default:
		return seedMutation{}, fmt.Errorf("cannot reconcile status %s", current.Approval.Status)
	}
	if err != nil {
		return seedMutation{}, fmt.Errorf("prepare demo data upgrade: %w", err)
	}
	saved, err := s.service.Save(ctx, item.entity, seedSaveInput{
		ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
		ApprovalRevision: current.Approval.Revision,
		Data:             detailInput(item.entity, item.data),
	}, mustSeedActor(requestID(item.data.Code, "upgrade-save")))
	if err != nil {
		return seedMutation{}, fmt.Errorf("save upgraded demo data: %w", err)
	}
	return saved, nil
}

func detailInput(entity string, input bob.CreateDetailInput) bob.DetailInput {
	result := bob.DetailInput{
		Name: input.Name, Unit: input.Unit, Currency: input.Currency,
		PlateNumber:  input.PlateNumber,
		CustomerType: input.CustomerType, VehicleType: input.VehicleType,
		CarrierAffiliation: input.CarrierAffiliation, TargetEntity: stringPointer(input.TargetEntity),
		RuleType: input.RuleType, MonthOffset: input.MonthOffset,
		DayOfMonth: input.DayOfMonth, DayOffset: input.DayOffset,
	}
	switch entity {
	case bob.EntityCustomerAccount, bob.EntitySupplier:
		result.ShortName = bob.Optional(input.ShortName)
		result.CategoryID = bob.Optional(input.CategoryID)
		result.TaxNumber = bob.Optional(input.TaxNumber)
		result.ContactName = bob.Optional(input.ContactName)
		result.ContactPhone = bob.Optional(input.ContactPhone)
		result.Email = bob.Optional(input.Email)
		result.Address = bob.Optional(input.Address)
		result.Remark = bob.Optional(input.Remark)
		result.SettlementMethodID = bob.Optional(input.SettlementMethodID)
		if entity == bob.EntityCustomerAccount {
			closingDay := expectedMonthlyClosingDay(sample{entity: entity, data: input})
			result.MonthlyClosingDay = &closingDay
		}
		result.SalespersonEmployeeID = bob.Optional(input.SalespersonEmployeeID)
		if entity == bob.EntitySupplier {
			result.DefaultPurchaserEmployeeID = bob.Optional(input.DefaultPurchaserEmployeeID)
		}
	case bob.EntityEmployee:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.DepartmentID = bob.Optional(input.DepartmentID)
		result.PositionID = bob.Optional(input.PositionID)
		result.Phone = bob.Optional(input.Phone)
		result.Email = bob.Optional(input.Email)
		result.HireDate = bob.Optional(input.HireDate)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityProduct:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Specification = bob.Optional(input.Specification)
		result.Model = bob.Optional(input.Model)
		result.Barcode = bob.Optional(input.Barcode)
		result.Remark = bob.Optional(input.Remark)
		result.ProductTypeID = bob.Optional(input.ProductTypeID)
		result.DefaultInputUnitID = bob.Optional(input.DefaultInputUnitID)
		result.PricingUnitID = bob.Optional(input.PricingUnitID)
		if input.UnitConversions != nil {
			result.UnitConversions = &input.UnitConversions
		}
		result.DefaultPackagingSpec = bob.Optional(input.DefaultPackagingSpec)
		result.Formula = input.Formula
	case bob.EntityWarehouse:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Address = bob.Optional(input.Address)
		result.ContactName = bob.Optional(input.ContactName)
		result.ContactPhone = bob.Optional(input.ContactPhone)
		result.ManagerEmployeeID = bob.Optional(input.ManagerEmployeeID)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityVehicle:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.VIN = bob.Optional(input.VIN)
		result.EngineNumber = bob.Optional(input.EngineNumber)
		result.LoadCapacityKG = bob.Optional(input.LoadCapacityKG)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityFundAccount:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.AccountName = bob.Optional(input.AccountName)
		result.BankName = bob.Optional(input.BankName)
		result.BankBranch = bob.Optional(input.BankBranch)
		result.AccountNumber = bob.Optional(input.AccountNumber)
		result.OperatingEntityID = bob.Optional(input.OperatingEntityID)
		result.Remark = bob.Optional(input.Remark)
	case auxdomain.EntityProductCategory:
		result.ParentID = bob.Optional(input.ParentID)
		result.Description = bob.Optional(input.Description)
	case auxdomain.EntityDepartment:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.ParentID = bob.Optional(input.ParentID)
		result.Description = bob.Optional(input.Description)
	case auxdomain.EntityPosition:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Description = bob.Optional(input.Description)
	case auxdomain.EntitySettlementMethod:
		result.Description = bob.Optional(input.Description)
	}
	return result
}

func equalCarrierAffiliation(actual, expected *bob.CarrierAffiliation) bool {
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	return actual.Type == expected.Type &&
		actual.OperatingEntityID == expected.OperatingEntityID &&
		actual.ServiceRelationshipObjectID == expected.ServiceRelationshipObjectID
}

func stringPointer(value string) *string {
	return &value
}

func equalInt32Pointer(left, right *int32) bool {
	return (left == nil && right == nil) ||
		(left != nil && right != nil && *left == *right)
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
