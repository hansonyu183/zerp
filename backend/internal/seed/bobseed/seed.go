package bobseed

import (
	"context"
	"errors"
	"fmt"

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
	Create(context.Context, string, bob.CreateInput, approval.Actor) (bob.MutationResult, error)
	Get(context.Context, string, bob.GetInput) (bob.ObjectView, error)
	Save(context.Context, string, bob.SaveInput, approval.Actor) (bob.MutationResult, error)
	Submit(context.Context, string, bob.VersionRevisionInput, approval.Actor) (bob.MutationResult, error)
	Unsubmit(context.Context, string, bob.ReverseInput, approval.Actor) (bob.MutationResult, error)
	Approve(context.Context, string, bob.ReviewInput, approval.Actor) (bob.MutationResult, error)
	Unapprove(context.Context, string, bob.ReverseInput, approval.Actor) (bob.MutationResult, error)
	Reject(context.Context, string, bob.ReviewInput, approval.Actor) (bob.MutationResult, error)
}

type relationshipAwareLifecycleService struct {
	lifecycleService
	relationships           *bob.Service
	settlementRelationships *bob.Service
	auxiliary               *auxdomain.Service
	pool                    *pgxpool.Pool
	operatingEntities       *dcldomain.OperatingEntityService
	warehouses              *dcldomain.WarehouseService
	vehicles                *dcldomain.VehicleService
	fundAccounts            *dcldomain.FundAccountService
}

func (service relationshipAwareLifecycleService) Create(
	ctx context.Context, entity string, input bob.CreateInput, actor approval.Actor,
) (bob.MutationResult, error) {
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
	partyKind := bob.PartyKindOrganization
	if entity == bob.EntityEmployee {
		partyKind = bob.PartyKindPerson
	}
	party := &bob.PartyCreateData{Kind: partyKind, LegalName: input.Data.Name,
		DisplayName: input.Data.ShortName, TaxNumber: input.Data.TaxNumber,
		Phone: input.Data.ContactPhone, Email: input.Data.Email, Address: input.Data.Address}
	switch entity {
	case bob.EntityEmployee:
		party.Phone = input.Data.Phone
		result, err := service.relationships.EmploymentCreate(ctx, bob.EmploymentCreateInput{
			NewParty: party, Data: input.Data,
		}, actor, true)
		return result.MutationResult, err
	case bob.EntitySupplier:
		result, err := service.settlementRelationships.SupplierCreate(ctx, bob.SupplierCreateInput{
			NewParty: party,
			Data: bob.SupplierData{OperatingEntityID: input.Data.OperatingEntityID,
				Name:      input.Data.Name,
				ShortName: input.Data.ShortName, TaxNumber: input.Data.TaxNumber,
				ContactName: input.Data.ContactName, ContactPhone: input.Data.ContactPhone,
				Email: input.Data.Email, Address: input.Data.Address, Remark: input.Data.Remark,
				SettlementMethodID:         input.Data.SettlementMethodID,
				DefaultPurchaserEmployeeID: input.Data.DefaultPurchaserEmployeeID},
		}, actor, true)
		return result.MutationResult, err
	case bob.EntityOtherUnit:
		result, err := service.relationships.OtherUnitCreate(ctx, bob.OtherUnitCreateInput{
			NewParty: party,
			Data: bob.OtherUnitData{OperatingEntityID: input.Data.OperatingEntityID,
				ContactName: input.Data.ContactName, ContactPhone: input.Data.ContactPhone,
				Email: input.Data.Email, Address: input.Data.Address,
				SettlementMethodID: input.Data.SettlementMethodID, Remark: input.Data.Remark},
		}, actor, true)
		return result.MutationResult, err
	case bob.EntityCustomerAccount:
		paymentMethodID, err := service.ensurePaymentMethod(ctx, actor)
		if err != nil {
			return bob.MutationResult{}, err
		}
		customerType := bob.CustomerTypeEndUser
		if input.Data.CustomerType != nil {
			customerType = *input.Data.CustomerType
		}
		result, err := service.settlementRelationships.CustomerCreate(ctx, bob.CustomerCreateInput{
			NewParty: party,
			Data: bob.CustomerAccountData{Name: input.Data.Name, ShortName: input.Data.ShortName,
				CustomerTypeCode: customerType, ContactName: input.Data.ContactName,
				ContactPhone: input.Data.ContactPhone, Email: input.Data.Email, Address: input.Data.Address,
				OperatingEntityID: input.Data.OperatingEntityID, SettlementMethodID: input.Data.SettlementMethodID,
				PaymentMethodID: paymentMethodID, DefaultTransportMethodCode: "DELIVERY",
				DefaultTransportMethodName: "送货",
				PricingPolicy: bob.PricingPolicy{DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
					CostItems: []bob.PricingCostItem{}, ThirdPartyIntermediaryFixedUnitCost: "0.00",
					ThirdPartyIntermediaryVariableUnitCost: "0.00"},
				CreditLimits: []bob.CustomerCreditLimit{}, PrimarySalesAttribution: bob.CustomerSalesAttributionInput{
					Type: bob.SalesAttributionInternalEmployee, SubjectObjectID: input.Data.SalespersonEmployeeID},
				InternalReminder: input.Data.Remark},
		}, actor, true)
		if err != nil {
			return bob.MutationResult{}, err
		}
		account := result.DefaultAccount
		if account.OpenVersion == nil {
			return bob.MutationResult{}, errors.New("created customer account has no open approval version")
		}
		return bob.MutationResult{
			ObjectID: account.ObjectID, ObjectRevision: account.ObjectRevision,
			Enabled: account.Enabled, Approval: account.OpenVersion.Approval,
		}, nil
	}
	return service.lifecycleService.Create(ctx, entity, input, actor)
}

func (service relationshipAwareLifecycleService) ensurePaymentMethod(ctx context.Context, actor approval.Actor) (string, error) {
	var objectID string
	err := service.pool.QueryRow(ctx, `SELECT subject_id FROM approval_events
		WHERE domain='aux' AND entity='payment-method' AND request_id='seed-bob-DEMO-PAY-001-create'
		  AND action='CREATED' ORDER BY created_at,id LIMIT 1`).Scan(&objectID)
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
	if view.LatestApproved != nil {
		return objectID, nil
	}
	if view.OpenVersion == nil {
		return "", errors.New("payment method has no approval entry")
	}
	current := view.OpenVersion.Approval
	if current.Status == approval.StatusDraft {
		pending, submitErr := service.auxiliary.Submit(ctx, auxdomain.EntityPaymentMethod, auxdomain.ApprovalRevisionInput{
			ObjectID: objectID, ApprovalEntryID: current.ApprovalEntryID, ApprovalRevision: current.Revision,
		}, actor)
		if submitErr != nil {
			return "", submitErr
		}
		current = pending.Approval
	}
	if current.Status != approval.StatusPending {
		return "", fmt.Errorf("cannot approve payment method from %s", current.Status)
	}
	if _, approveErr := service.auxiliary.Approve(ctx, auxdomain.EntityPaymentMethod, auxdomain.ApprovalRevisionInput{
		ObjectID: objectID, ApprovalEntryID: current.ApprovalEntryID, ApprovalRevision: current.Revision,
	}, mustReviewerActor("seed-bob-DEMO-PAY-001-approve")); approveErr != nil {
		return "", approveErr
	}
	return objectID, nil
}

func (service relationshipAwareLifecycleService) Save(
	ctx context.Context, entity string, input bob.SaveInput, actor approval.Actor,
) (bob.MutationResult, error) {
	if entity == bob.EntityOperatingEntity {
		view, err := service.operatingEntities.Get(ctx, dcldomain.OperatingEntityGetInput{
			ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		}, mustSeedActor("seed-bob-operating-entity-save-get"))
		if err != nil {
			return bob.MutationResult{}, err
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
			return bob.MutationResult{}, err
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
			return bob.MutationResult{}, err
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
			return bob.MutationResult{}, err
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
	if entity == bob.EntitySupplier {
		return service.relationships.Save(ctx, entity, input, actor)
	}
	return service.lifecycleService.Save(ctx, entity, input, actor)
}

func (service relationshipAwareLifecycleService) Get(
	ctx context.Context, entity string, input bob.GetInput,
) (bob.ObjectView, error) {
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
	if entity != bob.EntityOtherUnit {
		return service.lifecycleService.Get(ctx, entity, input)
	}
	view, err := service.relationships.OtherUnitGet(ctx, input)
	if err != nil {
		return bob.ObjectView{}, err
	}
	return bob.ObjectView{ObjectID: view.ObjectID, Entity: entity, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
		Approval: view.Approval,
		Data: bob.DetailView{Name: view.PartyDisplayName, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, Email: view.Data.Email, Address: view.Data.Address,
			Remark: view.Data.Remark, SettlementMethodID: view.Data.SettlementMethodID}}, nil
}

func (service relationshipAwareLifecycleService) Submit(ctx context.Context, entity string, input bob.VersionRevisionInput, actor approval.Actor) (bob.MutationResult, error) {
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
		return service.lifecycleService.Submit(ctx, entity, input, actor)
	}
	result, err := service.operatingEntities.Submit(ctx, dcldomain.OperatingEntityVersionInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Unsubmit(ctx context.Context, entity string, input bob.ReverseInput, actor approval.Actor) (bob.MutationResult, error) {
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
		return service.lifecycleService.Unsubmit(ctx, entity, input, actor)
	}
	result, err := service.operatingEntities.Unsubmit(ctx, dcldomain.OperatingEntityReviewInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Approve(ctx context.Context, entity string, input bob.ReviewInput, actor approval.Actor) (bob.MutationResult, error) {
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
		return service.lifecycleService.Approve(ctx, entity, input, actor)
	}
	result, err := service.operatingEntities.Approve(ctx, dcldomain.OperatingEntityVersionInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Unapprove(ctx context.Context, entity string, input bob.ReverseInput, actor approval.Actor) (bob.MutationResult, error) {
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
		return service.lifecycleService.Unapprove(ctx, entity, input, actor)
	}
	result, err := service.operatingEntities.Unapprove(ctx, dcldomain.OperatingEntityReviewInput{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID,
		ApprovalRevision: input.ApprovalRevision, Reason: input.Reason,
	}, actor)
	return operatingEntityMutation(result), err
}

func (service relationshipAwareLifecycleService) Reject(ctx context.Context, entity string, input bob.ReviewInput, actor approval.Actor) (bob.MutationResult, error) {
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
		return service.lifecycleService.Reject(ctx, entity, input, actor)
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

func operatingEntityMutation(result dcldomain.OperatingEntityMutation) bob.MutationResult {
	return bob.MutationResult{
		ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision,
		Enabled: result.Enabled, Approval: result.Approval,
	}
}

func operatingEntityView(view dcldomain.OperatingEntityView) bob.ObjectView {
	return bob.ObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityOperatingEntity, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled, Approval: view.Approval,
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

func warehouseMutation(result dcldomain.WarehouseMutation) bob.MutationResult {
	return bob.MutationResult{
		ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision,
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

func vehicleMutation(result dcldomain.VehicleMutation) bob.MutationResult {
	return bob.MutationResult{ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision, Enabled: result.Enabled, Approval: result.Approval}
}

func vehicleView(view dcldomain.VehicleView) bob.ObjectView {
	return bob.ObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityVehicle, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled, Approval: view.Approval,
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

func fundAccountMutation(result dcldomain.FundAccountMutation) bob.MutationResult {
	return bob.MutationResult{ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision, Enabled: result.Enabled, Approval: result.Approval}
}

func fundAccountView(view dcldomain.FundAccountView) bob.ObjectView {
	return bob.ObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityFundAccount, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled, Approval: view.Approval,
		Data: bob.DetailView{
			Name: view.Data.Name, Currency: view.Data.Currency, OperatingEntityID: view.Data.OperatingEntityID,
			AccountName: view.Data.AccountName, BankName: view.Data.BankName, BankBranch: view.Data.BankBranch,
			AccountNumber: view.Data.AccountNumber, Remark: view.Data.Remark,
		}, UpdatedAt: view.UpdatedAt,
	}
}

func warehouseView(view dcldomain.WarehouseView) bob.ObjectView {
	return bob.ObjectView{
		ObjectID: view.ObjectID, Entity: bob.EntityWarehouse, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled, Approval: view.Approval,
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
	if entity == bob.EntityOperatingEntity || entity == bob.EntityWarehouse || entity == bob.EntityVehicle || entity == bob.EntityFundAccount {
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
		var id string
		err := l.pool.QueryRow(ctx, `SELECT subject_id FROM approval_events
			WHERE domain='aux' AND entity=$1 AND request_id=$2 AND action='CREATED'
			ORDER BY created_at,id LIMIT 1`, auxiliaryEntity, requestID(code, "create")).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return id, err == nil, err
	}
	if entity == auxdomain.EntitySettlementMethod {
		var id string
		err := l.pool.QueryRow(ctx, `SELECT object.id FROM aux_objects object
			JOIN approval_entries entry ON entry.domain='aux' AND entry.entity=object.entity
			  AND entry.subject_id=object.id AND entry.status='APPROVED'
			JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
			WHERE object.entity='settlement-method' AND object.enabled
			  AND payload.data->>'termCode'=$1
			ORDER BY entry.version_no DESC`, code).Scan(&id)
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
	auxiliary := auxdomain.NewService(pool, authorizer, txevent.NewBus())
	auxiliaryResolver := auxiliaryrefs.New(auxiliary)
	bus := txevent.NewBus()
	service := bob.NewService(pool, auxiliaryResolver, authorizer, bus)
	supplier := bob.NewService(pool, auxiliaryResolver, authorizer, bus)
	operatingEntities := dcldomain.NewOperatingEntityService(pool, service, authorizer, bus)
	warehouses := dcldomain.NewWarehouseService(pool, service, authorizer, bus)
	vehicles := dcldomain.NewVehicleService(pool, service, authorizer, bus)
	fundAccounts := dcldomain.NewFundAccountService(pool, service, authorizer, bus)
	return &Seeder{
		service: relationshipAwareLifecycleService{lifecycleService: service, relationships: service,
			settlementRelationships: supplier, auxiliary: auxiliary, pool: pool,
			operatingEntities: operatingEntities, warehouses: warehouses, vehicles: vehicles, fundAccounts: fundAccounts},
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
		} else if err := s.pool.QueryRow(ctx, `
			SELECT object.id FROM aux_objects object
			JOIN approval_entries entry ON entry.domain='aux' AND entry.entity=object.entity
			  AND entry.subject_id=object.id AND entry.status='APPROVED'
			JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
			WHERE object.entity='product-type' AND object.enabled AND payload.data->>'behaviorProfile'=$1
			ORDER BY entry.version_no DESC, object.code LIMIT 1`, profile).Scan(&item.data.ProductTypeID); err != nil {
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
			bob.GetInput{ObjectID: materialObjectID},
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

	objectID, found, err := s.lookup.Find(ctx, item.entity, item.data.Code)
	if err != nil {
		return 0, fmt.Errorf("find existing object: %w", err)
	}

	var current bob.MutationResult
	outcome := outcomeCreated
	if found {
		view, getErr := s.service.Get(ctx, item.entity, bob.GetInput{ObjectID: objectID})
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
			current = bob.MutationResult{
				ObjectID:       view.ObjectID,
				ObjectRevision: view.ObjectRevision,
				Approval:       view.Approval,
			}
			outcome = outcomeResumed
		}
	} else {
		current, err = s.service.Create(
			ctx,
			item.entity,
			bob.CreateInput{Data: item.data},
			mustSeedActor(requestID(item.data.Code, "create")),
		)
		if err != nil {
			return 0, fmt.Errorf("create object: %w (cause: %v)", err, errors.Unwrap(err))
		}
	}

	if current.Approval.Status == approval.StatusDraft && item.status != string(current.Approval.Status) {
		current, err = s.service.Submit(ctx, item.entity, bob.VersionRevisionInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision,
		}, mustSeedActor(requestID(item.data.Code, "submit")))
		if err != nil {
			return 0, fmt.Errorf("submit object: %w", err)
		}
	}

	switch {
	case string(current.Approval.Status) == item.status:
		return outcome, nil
	case current.Approval.Status == approval.StatusPending && item.status == approvedStatus:
		reason := "演示数据：审核通过"
		_, err = s.service.Approve(ctx, item.entity, bob.ReviewInput{
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
	view, getErr := s.auxiliary.Get(ctx, entity, auxdomain.GetInput{ObjectID: objectID}, mustSeedActor(requestID(item.data.Code, "get")))
	if getErr != nil {
		return 0, getErr
	}
	if view.LatestApproved != nil {
		if created {
			return outcomeCreated, nil
		}
		return outcomeSkipped, nil
	}
	if view.OpenVersion == nil {
		return 0, fmt.Errorf("auxiliary object has no approval entry")
	}
	current := view.OpenVersion.Approval
	if current.Status == approval.StatusDraft {
		pending, submitErr := s.auxiliary.Submit(ctx, entity, auxdomain.ApprovalRevisionInput{
			ObjectID: objectID, ApprovalEntryID: current.ApprovalEntryID, ApprovalRevision: current.Revision,
		}, mustSeedActor(requestID(item.data.Code, "submit")))
		if submitErr != nil {
			return 0, submitErr
		}
		current = pending.Approval
	}
	if current.Status != approval.StatusPending {
		return 0, fmt.Errorf("cannot approve auxiliary object from %s", current.Status)
	}
	if _, approveErr := s.auxiliary.Approve(ctx, entity, auxdomain.ApprovalRevisionInput{
		ObjectID: objectID, ApprovalEntryID: current.ApprovalEntryID, ApprovalRevision: current.Revision,
	}, mustReviewerActor(requestID(item.data.Code, "approve"))); approveErr != nil {
		return 0, approveErr
	}
	if created {
		return outcomeCreated, nil
	}
	return outcomeResumed, nil
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

func matches(item sample, view bob.ObjectView) bool {
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

func matchesLegacyShape(item sample, view bob.ObjectView) bool {
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

func (s *Seeder) reconcileExisting(ctx context.Context, item sample, view bob.ObjectView) (bob.MutationResult, error) {
	current := bob.MutationResult{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision,
		Approval: view.Approval,
	}
	if item.entity == bob.EntitySupplier && string(current.Approval.Status) == approvedStatus {
		saved, err := s.service.Save(ctx, item.entity, bob.SaveInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision,
			Data:             detailInput(item.entity, item.data),
		}, mustSeedActor(requestID(item.data.Code, "upgrade-save")))
		if err != nil {
			return bob.MutationResult{}, fmt.Errorf("save upgraded demo supplier: %w", err)
		}
		return saved, nil
	}
	var err error
	switch current.Approval.Status {
	case approval.StatusApproved:
		current, err = s.service.Unapprove(ctx, item.entity, bob.ReverseInput{
			ObjectID:        current.ObjectID,
			ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision,
			Reason: "演示数据：撤销批准后补齐属性",
		}, mustSeedActor(requestID(item.data.Code, "upgrade-unapprove")))
		if err == nil {
			current, err = s.service.Unsubmit(ctx, item.entity, bob.ReverseInput{
				ObjectID:        current.ObjectID,
				ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision,
				Reason: "演示数据：退回草稿补齐属性",
			}, mustSeedActor(requestID(item.data.Code, "upgrade-unsubmit")))
		}
	case approval.StatusPending:
		reason := "演示数据：补齐新增属性"
		current, err = s.service.Reject(ctx, item.entity, bob.ReviewInput{
			ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
			ApprovalRevision: current.Approval.Revision, Reason: &reason,
		}, mustReviewerActor(requestID(item.data.Code, "upgrade-reject")))
	case approval.StatusDraft:
	default:
		return bob.MutationResult{}, fmt.Errorf("cannot reconcile status %s", current.Approval.Status)
	}
	if err != nil {
		return bob.MutationResult{}, fmt.Errorf("prepare demo data upgrade: %w", err)
	}
	saved, err := s.service.Save(ctx, item.entity, bob.SaveInput{
		ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
		ApprovalRevision: current.Approval.Revision,
		Data:             detailInput(item.entity, item.data),
	}, mustSeedActor(requestID(item.data.Code, "upgrade-save")))
	if err != nil {
		return bob.MutationResult{}, fmt.Errorf("save upgraded demo data: %w", err)
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
