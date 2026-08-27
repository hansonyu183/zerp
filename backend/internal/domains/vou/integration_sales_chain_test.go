//go:build integration

package vou

import (
	"errors"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func advanceWorkflowSalesDraft(
	t *testing.T,
	pool *pgxpool.Pool,
	service *Service,
	entity string,
	create func(pgx.Tx) (MutationResult, error),
) (MutationResult, DocumentView) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin workflow %s: %v", entity, err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	created, err := create(tx)
	if err != nil {
		t.Fatalf("create workflow %s: %v (cause: %v)", entity, err, errors.Unwrap(err))
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit workflow %s: %v", entity, err)
	}
	checked, err := service.Submit(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "workflow-sales-check"))
	if err != nil {
		t.Fatalf("check workflow %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "workflow-sales-approve"))
	if err != nil {
		t.Fatalf("approve workflow %s: %v", entity, err)
	}
	view, err := service.Get(t.Context(), entity, GetInput{DocumentID: approved.DocumentID})
	if err != nil {
		t.Fatalf("get workflow %s: %v", entity, err)
	}
	return approved, view
}

func advanceSalesDocument(
	t *testing.T,
	service *Service,
	entity string,
	data DraftInput,
	approve bool,
) (MutationResult, DocumentView) {
	t.Helper()
	created, err := service.Create(
		t.Context(), entity, CreateInput{Data: data}, integrationApprovalActor(t, integrationActorOne, "sales-chain-create"),
	)
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	checked, err := service.Submit(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "sales-chain-check"))
	if err != nil {
		t.Fatalf("check %s: %v", entity, err)
	}
	result := checked
	if approve {
		result, err = service.Approve(t.Context(), entity, DocumentRevisionInput{
			DocumentID: created.DocumentID, Revision: checked.Approval.Revision,
		}, integrationApprovalActor(t, integrationActorOne, "sales-chain-approve"))
		if err != nil {
			t.Fatalf("approve %s: %v", entity, err)
		}
	}
	view, err := service.Get(t.Context(), entity, GetInput{DocumentID: result.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return result, view
}

func approvedSalesOrder(
	t *testing.T,
	service *Service,
	refs integrationReferences,
	quantity string,
) (MutationResult, DocumentView) {
	t.Helper()
	return advanceSalesDocument(t, service, EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, quantity, "12.00")},
	}, true)
}

func TestVOUIntegrationSalesOrderOutboundDeliveryAndSignoff(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	order, orderView := approvedSalesOrder(t, service, refs, "10")
	var orderCreator string
	if err := pool.QueryRow(t.Context(), `SELECT approval.created_by FROM vou_documents document
		JOIN approval_entries approval ON approval.id=document.approval_entry_id WHERE document.id=$1`, order.DocumentID).Scan(&orderCreator); err != nil {
		t.Fatalf("load sales order creator: %v", err)
	}
	if orderCreator != integrationActorOne {
		t.Fatalf("sales order creator = %s, want human actor", orderCreator)
	}
	orderLineID := orderView.Data.ProductLines[0].LineID
	outboundOne, outboundView := advanceWorkflowSalesDraft(t, pool, service, EntitySaleOutbound, func(tx pgx.Tx) (MutationResult, error) {
		return service.CreateWorkflowSaleOutbound(t.Context(), tx, order.DocumentID, WorkflowSaleOutboundInitial{
			BusinessDate: "2026-07-25", WarehouseObjectID: refs.warehouse.ObjectID,
			Lines: []SourceQuantityLineInput{{SourceLineID: orderLineID, BaseQuantity: "6"}},
		}, "workflow-outbound")
	})
	if outboundView.DocumentNo[:3] != "SOB" ||
		outboundView.ParentDocumentID != order.DocumentID ||
		outboundView.Data.ProductLines[0].BaseQuantity != "6.0" {
		t.Fatalf("outbound view = %+v", outboundView)
	}

	deliveryOne, deliveryView := advanceWorkflowSalesDraft(t, pool, service, EntitySaleDelivery, func(tx pgx.Tx) (MutationResult, error) {
		return service.CreateWorkflowSaleDelivery(t.Context(), tx, outboundOne.DocumentID, WorkflowSaleDeliveryInitial{
			BusinessDate: "2026-07-26", CarrierServiceRelationshipObjectID: refs.carrier.ObjectID,
			VehicleObjectID: refs.vehicle.ObjectID,
		}, "workflow-delivery")
	})
	if deliveryView.DocumentNo[:3] != "SDL" ||
		deliveryView.ParentDocumentID != outboundOne.DocumentID {
		t.Fatalf("delivery view = %+v", deliveryView)
	}
	if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: outboundOne.DocumentID,
		Carrier: &refs.carrier, Vehicle: &refs.vehicle,
	}}, integrationApprovalActor(t, integrationActorOne, "duplicate-delivery")); err == nil {
		t.Fatal("second delivery for one outbound was accepted")
	}

	signoffOne, signoffView := advanceWorkflowSalesDraft(t, pool, service, EntitySaleSignoff, func(tx pgx.Tx) (MutationResult, error) {
		return service.CreateWorkflowSaleSignoff(t.Context(), tx, deliveryOne.DocumentID, WorkflowSaleSignoffInitial{
			BusinessDate: "2026-07-27",
			Lines: []WorkflowSignoffLineInput{{
				SourceLineID:       deliveryView.Data.ProductLines[0].LineID,
				SignedBaseQuantity: "4", RejectedBaseQuantity: "1",
			}},
		}, "workflow-signoff")
	})
	if signoffView.DocumentNo[:3] != "SSF" ||
		signoffView.Data.SignoffLines[0].LossBaseQuantity != "1.0" {
		t.Fatalf("signoff view = %+v", signoffView)
	}
	if _, err := service.Create(t.Context(), EntitySaleSignoff, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-27", SourceDocumentID: deliveryOne.DocumentID,
		SignoffLines: []SaleSignoffLineInput{{
			SourceLineID:       deliveryView.Data.ProductLines[0].LineID,
			SignedBaseQuantity: "6", RejectedBaseQuantity: "0",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "duplicate-signoff")); err == nil {
		t.Fatal("second signoff for one delivery was accepted")
	}
	refusalTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin workflow refusal return: %v", err)
	}
	refusalDraft, err := service.CreateWorkflowSaleReturn(t.Context(), refusalTx, signoffOne.DocumentID, WorkflowSaleReturnInitial{
		BusinessDate: "2026-07-27", Reason: "包装破损拒收",
		Lines: []SourceQuantityLineInput{{SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "1"}},
	}, "workflow-refusal-return")
	if err == nil {
		err = refusalTx.Commit(t.Context())
	} else {
		_ = refusalTx.Rollback(t.Context())
	}
	if err != nil {
		t.Fatalf("create workflow refusal return: %v", err)
	}
	var refusalID string
	var refusalRevision int64
	if err := pool.QueryRow(t.Context(), `SELECT d.id,approval.revision
		FROM vou_documents d JOIN approval_entries approval ON approval.id=d.approval_entry_id
		JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load refusal return: %v", err)
	}
	if refusalID != refusalDraft.DocumentID {
		t.Fatalf("workflow refusal return = %s, query=%s", refusalDraft.DocumentID, refusalID)
	}
	var refusalCreator, refusalAuditActor string
	if err := pool.QueryRow(t.Context(), `SELECT approval.created_by FROM vou_documents document
		JOIN approval_entries approval ON approval.id=document.approval_entry_id WHERE document.id=$1`, refusalID).Scan(&refusalCreator); err != nil {
		t.Fatalf("load refusal return creator: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM approval_events
		WHERE domain='vou' AND subject_id=$1 AND action='CREATED' ORDER BY created_at LIMIT 1`, refusalID).Scan(&refusalAuditActor); err != nil {
		t.Fatalf("load refusal return audit: %v", err)
	}
	if refusalCreator != systemidentity.UserID || refusalAuditActor != systemidentity.UserID {
		t.Fatalf("automatic refusal actors = creator:%s audit:%s", refusalCreator, refusalAuditActor)
	}
	firstRefusalID := refusalID
	unapprovedSignoff, err := service.Unapprove(t.Context(), EntitySaleSignoff, ReverseInput{
		DocumentID: signoffOne.DocumentID, Revision: signoffOne.Approval.Revision, Reason: "修正签收测试",
	}, integrationApprovalActor(t, integrationActorOne, "signoff-unapprove"))
	if err != nil {
		t.Fatalf("unapprove signoff with automatic refusal draft: %v", err)
	}
	var refusalCount int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_sale_return_details
		WHERE source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalCount); err != nil || refusalCount != 0 {
		t.Fatalf("automatic refusal drafts after unapprove = %d, err=%v", refusalCount, err)
	}
	signoffOne, err = service.Approve(t.Context(), EntitySaleSignoff, DocumentRevisionInput{
		DocumentID: signoffOne.DocumentID, Revision: unapprovedSignoff.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "signoff-re-approve"))
	if err != nil {
		t.Fatalf("reapprove signoff: %v", err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin regenerated refusal return: %v", err)
	}
	_, err = service.CreateWorkflowSaleReturn(t.Context(), tx, signoffOne.DocumentID, WorkflowSaleReturnInitial{
		BusinessDate: "2026-07-27", Reason: "包装破损拒收",
		Lines: []SourceQuantityLineInput{{SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "1"}},
	}, "workflow-refusal-return-replay")
	if err == nil {
		err = tx.Commit(t.Context())
	} else {
		_ = tx.Rollback(t.Context())
	}
	if err != nil {
		t.Fatalf("regenerate refusal return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT d.id,approval.revision
		FROM vou_documents d JOIN approval_entries approval ON approval.id=d.approval_entry_id
		JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load regenerated refusal return: %v", err)
	}
	if firstRefusalID == refusalID {
		t.Fatal("workflow refusal return was not regenerated")
	}
	refusalChecked, err := service.Submit(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalRevision,
	}, integrationApprovalActor(t, integrationActorOne, "refusal-check"))
	if err != nil {
		t.Fatalf("check refusal return: %v", err)
	}
	refusalApproved, err := service.Approve(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalChecked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "refusal-approve"))
	if err != nil {
		t.Fatalf("approve refusal return: %v", err)
	}
	if refusalApproved.Approval.Status != StatusApproved {
		t.Fatalf("approved refusal return status = %s", refusalApproved.Approval.Status)
	}
	afterSale, err := service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "客户退回",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "2",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "after-sale-return"))
	if err != nil {
		t.Fatalf("create after-sale return: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "超量退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "3",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "over-return")); err == nil {
		t.Fatal("cumulative after-sale over-return was accepted")
	}
	if _, err = service.Delete(t.Context(), EntitySaleReturn, DeleteInput{
		DocumentID: afterSale.DocumentID, Revision: afterSale.Approval.Revision, Reason: "取消测试退货",
	}, integrationApprovalActor(t, integrationActorOne, "delete-after-sale-return")); err != nil {
		t.Fatalf("delete after-sale return: %v", err)
	}

	orderView, err = service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get order balances: %v", err)
	}
	if orderView.Data.SignedBaseQuantity != "4.0" ||
		orderView.Data.InTransitBaseQuantity != "0.0" ||
		orderView.Data.RemainingBaseQuantity != "6.0" ||
		orderView.Data.FulfillmentStatus != "OPEN" {
		t.Fatalf("order balances after first signoff = %+v", orderView.Data)
	}

	outboundTwo, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: orderLineID, BaseQuantity: "6",
		}},
	}, true)
	deliveryTwo, deliveryTwoView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-29", SourceDocumentID: outboundTwo.DocumentID,
		Carrier: &refs.carrier, Vehicle: &refs.vehicle,
	}, true)
	_, _ = advanceSalesDocument(t, service, EntitySaleSignoff, DraftInput{
		BusinessDate: "2026-07-30", SourceDocumentID: deliveryTwo.DocumentID,
		SignoffLines: []SaleSignoffLineInput{{
			SourceLineID:       deliveryTwoView.Data.ProductLines[0].LineID,
			SignedBaseQuantity: "6", RejectedBaseQuantity: "0",
		}},
	}, true)
	orderView, err = service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderView.Data.FulfillmentStatus != "FULFILLED" ||
		orderView.Data.SignedBaseQuantity != "10.0" ||
		orderView.Data.RemainingBaseQuantity != "0.0" {
		t.Fatalf("fulfilled order = %+v err=%v", orderView.Data, err)
	}
	if signoffOne.Approval.Status != StatusApproved {
		t.Fatalf("first signoff status = %s", signoffOne.Approval.Status)
	}
}

func TestSaleDeliveryCarrierAffiliationAndApprovalRecheckIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	bobService := newBOBIntegrationService(pool)
	order, orderView := approvedSalesOrder(t, service, refs, "20")
	orderLineID := orderView.Data.ProductLines[0].LineID

	var orderOperatingEntityID string
	if err := pool.QueryRow(t.Context(), `SELECT relationship.operating_entity_id
		FROM bob_customer_accounts account
		JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id
		WHERE account.object_id=$1`, refs.customer.ObjectID).Scan(&orderOperatingEntityID); err != nil {
		t.Fatalf("read sale order operating entity: %v", err)
	}
	internalVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 自有配送车辆", PlateNumber: "粤I" + newID()[20:], VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: orderOperatingEntityID},
	})
	otherOperating := createApprovedBOB(t, bobService, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "VOU 其它经营主体", TaxNumber: "TAX" + newID()[3:],
	})
	wrongInternalVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 错误自有车辆", PlateNumber: "粤W" + newID()[20:], VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: otherOperating.ObjectID},
	})
	otherCarrier := createApprovedBOB(t, bobService, bobdomain.EntityOtherUnit, bobdomain.CreateDetailInput{
		Name: "VOU 其它承运服务关系", SettlementMethodID: refs.settlement.ObjectID,
	})

	createOutbound := func(quantity string) MutationResult {
		t.Helper()
		outbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
			BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{SourceLineID: orderLineID, BaseQuantity: quantity}},
		}, true)
		return outbound
	}

	for name, data := range map[string]DraftInput{
		"external carrier missing": {
			BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID, Vehicle: &refs.vehicle,
		},
		"external carrier mismatch": {
			BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID,
			Carrier: &otherCarrier, Vehicle: &refs.vehicle,
		},
		"internal carrier supplied": {
			BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID,
			Carrier: &refs.carrier, Vehicle: &internalVehicle,
		},
		"internal operating entity mismatch": {
			BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID, Vehicle: &wrongInternalVehicle,
		},
	} {
		if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: data},
			integrationApprovalActor(t, integrationActorOne, "carrier-negative-"+name)); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}

	bulkLine := integrationProductLine(t, refs.product, "2", "12.00")
	bulkLine.DeliverySpecificationType = "BULK_LIQUID"
	bulkOrder, bulkOrderView := advanceSalesDocument(t, service, EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse: &refs.warehouse, ProductLines: []ProductLineInput{bulkLine},
	}, true)
	bulkOutbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: bulkOrder.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: bulkOrderView.Data.ProductLines[0].LineID, BaseQuantity: "2"}},
	}, true)
	if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: bulkOutbound.DocumentID,
		Carrier: &refs.carrier, Vehicle: &refs.vehicle,
	}}, integrationApprovalActor(t, integrationActorOne, "bulk-liquid-incapable-vehicle")); err == nil {
		t.Fatal("bulk-liquid delivery accepted a vehicle without bulk-liquid capability")
	}
	bulkVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 散装液体车辆", PlateNumber: "粤B" + newID()[20:], VehicleType: "DIT-0003",
		BulkLiquidCapable: true,
		CarrierAffiliation: &bobdomain.CarrierAffiliation{
			Type: "EXTERNAL", ServiceRelationshipObjectID: refs.carrier.ObjectID,
		},
	})
	_, bulkDeliveryView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: bulkOutbound.DocumentID,
		Carrier: &refs.carrier, Vehicle: &bulkVehicle,
	}, true)
	if !bulkDeliveryView.Data.VehicleBulkLiquidCapable {
		t.Fatalf("bulk-liquid vehicle capability snapshot = %+v", bulkDeliveryView.Data)
	}

	internalDelivery, internalView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID, Vehicle: &internalVehicle,
	}, true)
	if internalView.Data.CarrierType != "INTERNAL" || internalView.Data.Carrier != nil ||
		internalView.Data.CarrierOperatingEntity == nil || internalView.Data.CarrierOperatingEntity.ObjectID != orderOperatingEntityID {
		t.Fatalf("internal delivery snapshot = %+v", internalView.Data)
	}

	recheckVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 审批复检车辆", PlateNumber: "粤R" + newID()[20:], VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: refs.carrier.ObjectID},
	})
	checkedDelivery, _ := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID,
		Carrier: &refs.carrier, Vehicle: &recheckVehicle,
	}, false)
	disableVehicleViaDCL(t, pool, bobService, recheckVehicle, "disable-before-delivery-approve")
	if _, err := service.Approve(t.Context(), EntitySaleDelivery, DocumentRevisionInput{
		DocumentID: checkedDelivery.DocumentID, Revision: checkedDelivery.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "delivery-approve-after-vehicle-disable")); err == nil {
		t.Fatal("delivery approval accepted a disabled vehicle")
	}

	checkVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 核对复检车辆", PlateNumber: "粤C" + newID()[20:], VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: refs.carrier.ObjectID},
	})
	draftDelivery, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID,
		Carrier: &refs.carrier, Vehicle: &checkVehicle,
	}}, integrationApprovalActor(t, integrationActorOne, "delivery-create-before-vehicle-disable"))
	if err != nil {
		t.Fatalf("create delivery before check revalidation: %v", err)
	}
	disableVehicleViaDCL(t, pool, bobService, checkVehicle, "disable-before-delivery-check")
	if _, err = service.Submit(t.Context(), EntitySaleDelivery, DocumentRevisionInput{
		DocumentID: draftDelivery.DocumentID, Revision: draftDelivery.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "delivery-check-after-vehicle-disable")); err == nil {
		t.Fatal("delivery check accepted a disabled vehicle")
	}

	stored, err := service.Get(t.Context(), EntitySaleDelivery, GetInput{DocumentID: internalDelivery.DocumentID})
	if err != nil || stored.Data.CarrierType != "INTERNAL" || stored.Data.Vehicle == nil ||
		stored.Data.Vehicle.ApprovalEntryID != internalVehicle.ApprovalEntryID {
		t.Fatalf("historical internal delivery snapshot changed: %+v err=%v", stored.Data, err)
	}
}

func TestSaleDeliveryExactVehicleSnapshotBlocksDCLUnapproveIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	vouService := newIntegrationService(t, pool)
	bobService := newBOBIntegrationService(pool)
	order, orderView := approvedSalesOrder(t, vouService, refs, "2")
	outbound, _ := advanceSalesDocument(t, vouService, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "2"}},
	}, true)
	delivery, deliveryView := advanceSalesDocument(t, vouService, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: outbound.DocumentID,
		Carrier: &refs.carrier, Vehicle: &refs.vehicle,
	}, true)
	if deliveryView.Data.Vehicle == nil || deliveryView.Data.Vehicle.ApprovalEntryID != refs.vehicle.ApprovalEntryID {
		t.Fatalf("sale delivery vehicle snapshot = %+v", deliveryView.Data.Vehicle)
	}

	declarations := dcldomain.NewVehicleService(pool, bobService, authorization.Func(nil), txevent.NewBus())
	vehicle, err := declarations.Get(t.Context(), dcldomain.VehicleGetInput{
		ObjectID: refs.vehicle.ObjectID, ApprovalEntryID: refs.vehicle.ApprovalEntryID,
	}, integrationApprovalActor(t, integrationActorOne, "vehicle-blocker-get"))
	if err != nil {
		t.Fatalf("get DCL vehicle before unapprove: %v", err)
	}
	var currentEntryBefore string
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_vehicles WHERE object_id=$1`, refs.vehicle.ObjectID).Scan(&currentEntryBefore); err != nil {
		t.Fatalf("read BOB vehicle current before blocked unapprove: %v", err)
	}

	_, err = declarations.Unapprove(t.Context(), dcldomain.VehicleReviewInput{
		ObjectID: vehicle.ObjectID, ApprovalEntryID: vehicle.Approval.ApprovalEntryID,
		ApprovalRevision: vehicle.Approval.Revision, Reason: "配送单已精确引用",
	}, integrationApprovalActor(t, integrationActorTwo, "vehicle-blocker-unapprove"))
	var domainErr *dcldomain.DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("vehicle unapprove error = %v, want bob_unapprove_blocked", err)
	}
	blockers, ok := domainErr.Data.(bobdomain.ActiveReferenceBlockers)
	if !ok || len(blockers.References) != 1 || blockers.References[0] != (bobdomain.ActiveReferenceCount{Entity: "vou_sale_delivery_details", Field: "snapshot", Count: 1}) {
		t.Fatalf("vehicle unapprove blockers = %#v", domainErr.Data)
	}

	vehicleAfter, err := declarations.Get(t.Context(), dcldomain.VehicleGetInput{
		ObjectID: vehicle.ObjectID, ApprovalEntryID: vehicle.Approval.ApprovalEntryID,
	}, integrationApprovalActor(t, integrationActorOne, "vehicle-blocker-get-after"))
	if err != nil {
		t.Fatalf("get DCL vehicle after blocked unapprove: %v", err)
	}
	if vehicleAfter.Approval.Status != vehicle.Approval.Status || vehicleAfter.Approval.Revision != vehicle.Approval.Revision {
		t.Fatalf("vehicle approval changed after blocked unapprove: before=%+v after=%+v", vehicle.Approval, vehicleAfter.Approval)
	}
	var currentEntryAfter string
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_vehicles WHERE object_id=$1`, refs.vehicle.ObjectID).Scan(&currentEntryAfter); err != nil {
		t.Fatalf("read BOB vehicle current after blocked unapprove: %v", err)
	}
	if currentEntryAfter != currentEntryBefore || currentEntryAfter != vehicle.Approval.ApprovalEntryID {
		t.Fatalf("BOB vehicle current changed after blocked unapprove: before=%s after=%s", currentEntryBefore, currentEntryAfter)
	}
	deliveryAfter, err := vouService.Get(t.Context(), EntitySaleDelivery, GetInput{DocumentID: delivery.DocumentID})
	if err != nil {
		t.Fatalf("get delivery after blocked vehicle unapprove: %v", err)
	}
	if deliveryAfter.Data.Vehicle == nil || deliveryAfter.Data.Vehicle.ApprovalEntryID != vehicle.Approval.ApprovalEntryID {
		t.Fatalf("delivery vehicle snapshot changed after blocked unapprove: %+v", deliveryAfter.Data.Vehicle)
	}
}

func TestVOUIntegrationConcurrentOutboundReservationAllowsOneWinner(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	order, orderView := approvedSalesOrder(t, service, refs, "10")
	sourceLineID := orderView.Data.ProductLines[0].LineID

	approved := make([]MutationResult, 2)
	for index := range approved {
		approved[index], _ = advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
			BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID,
			Warehouse: &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{
				SourceLineID: sourceLineID, BaseQuantity: "6",
			}},
		}, false)
	}

	results := make(chan error, len(approved))
	var group sync.WaitGroup
	for _, document := range approved {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := service.Approve(t.Context(), EntitySaleOutbound, DocumentRevisionInput{
				DocumentID: document.DocumentID, Revision: document.Approval.Revision,
			}, integrationApprovalActor(t, integrationActorOne, "concurrent-outbound-approve"))
			results <- err
		}()
	}
	group.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent outbound results successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestWarehouseDisableTracksSalesLifecycleIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	bobService := newBOBIntegrationService(pool)
	declarations := dcldomain.NewWarehouseService(pool, bobService, authorization.Func(nil), txevent.NewBus())
	warehouseView, err := declarations.Get(t.Context(), dcldomain.WarehouseGetInput{ObjectID: refs.warehouse.ObjectID}, trustedIntegrationActor(t, "warehouse-disable-get"))
	if err != nil {
		t.Fatalf("get warehouse before blocker checks: %v", err)
	}
	disabled, err := declarations.Save(t.Context(), dcldomain.WarehouseSaveInput{
		ObjectID: warehouseView.ObjectID, ApprovalEntryID: warehouseView.Approval.ApprovalEntryID,
		ApprovalRevision: warehouseView.Approval.Revision, Enabled: false, Data: warehouseView.Data,
	}, trustedIntegrationActor(t, "warehouse-disable-save"))
	if err != nil {
		t.Fatalf("save warehouse disable declaration: %v", err)
	}
	disabled, err = declarations.Submit(t.Context(), dcldomain.WarehouseVersionInput{
		ObjectID: disabled.ObjectID, ApprovalEntryID: disabled.Approval.ApprovalEntryID,
		ApprovalRevision: disabled.Approval.Revision,
	}, trustedIntegrationActor(t, "warehouse-disable-submit"))
	if err != nil {
		t.Fatalf("submit warehouse disable declaration: %v", err)
	}
	disableBlockers := func() bobdomain.WarehouseDisableBlockers {
		t.Helper()
		_, disableErr := declarations.Approve(t.Context(), dcldomain.WarehouseVersionInput{
			ObjectID: disabled.ObjectID, ApprovalEntryID: disabled.Approval.ApprovalEntryID,
			ApprovalRevision: disabled.Approval.Revision,
		}, integrationApprovalActor(t, integrationActorTwo, "warehouse-disable-blocked"))
		var domainErr *dcldomain.DomainError
		if !errors.As(disableErr, &domainErr) || domainErr.Kind != dcldomain.ErrorConflict {
			t.Fatalf("warehouse disable error = %v, want conflict", disableErr)
		}
		blockers, ok := domainErr.Data.(bobdomain.WarehouseDisableBlockers)
		if !ok {
			t.Fatalf("warehouse disable blockers = %#v", domainErr.Data)
		}
		return blockers
	}

	draft, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "2", "12.00")},
	}}, integrationApprovalActor(t, integrationActorOne, "warehouse-precheck-draft"))
	if err != nil {
		t.Fatalf("create warehouse-blocking sale order: %v", err)
	}
	blockers := disableBlockers()
	if len(blockers.Documents) != 1 || blockers.Documents[0].DocumentID != draft.DocumentID {
		t.Fatalf("draft warehouse blockers = %+v", blockers)
	}
	if _, err = service.Delete(t.Context(), EntitySaleOrder, DeleteInput{
		DocumentID: draft.DocumentID, Revision: draft.Approval.Revision, Reason: "repair warehouse disable blocker",
	}, integrationApprovalActor(t, integrationActorOne, "warehouse-precheck-delete-draft")); err != nil {
		t.Fatalf("delete warehouse-blocking sale order: %v", err)
	}
	draft, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "2", "12.00")},
	}}, integrationApprovalActor(t, integrationActorOne, "warehouse-precheck-recreated-draft"))
	if err != nil {
		t.Fatalf("recreate warehouse-blocking sale order: %v", err)
	}

	checked, err := service.Submit(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: draft.DocumentID, Revision: draft.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "warehouse-precheck-check"))
	if err != nil {
		t.Fatalf("check warehouse-blocking sale order: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "warehouse-precheck-approve"))
	if err != nil {
		t.Fatalf("approve warehouse-blocking sale order: %v", err)
	}
	blockers = disableBlockers()
	if len(blockers.Sources) != 1 || blockers.Sources[0].DocumentID != approved.DocumentID {
		t.Fatalf("approved source warehouse blockers = %+v", blockers)
	}

	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: approved.DocumentID})
	if err != nil {
		t.Fatalf("get warehouse-blocking sale order: %v", err)
	}
	advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: approved.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "2"}},
	}, true)
	if _, err = declarations.Approve(t.Context(), dcldomain.WarehouseVersionInput{
		ObjectID: disabled.ObjectID, ApprovalEntryID: disabled.Approval.ApprovalEntryID,
		ApprovalRevision: disabled.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "warehouse-disable-after-fulfillment")); err != nil {
		t.Fatalf("disable warehouse after fulfillment: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "1", "12.00")},
	}}, integrationApprovalActor(t, integrationActorOne, "warehouse-reference-after-disable")); err == nil {
		t.Fatal("new sale order accepted a disabled warehouse")
	}
}
