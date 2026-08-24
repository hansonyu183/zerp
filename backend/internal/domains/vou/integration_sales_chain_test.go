//go:build integration

package vou

import (
	"errors"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
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
	checked, err := service.Check(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "workflow-sales-check")
	if err != nil {
		t.Fatalf("check workflow %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "workflow-sales-approve")
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
		t.Context(), entity, CreateInput{Data: data}, integrationActorOne, "sales-chain-create",
	)
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	checked, err := service.Check(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "sales-chain-check")
	if err != nil {
		t.Fatalf("check %s: %v", entity, err)
	}
	result := checked
	if approve {
		result, err = service.Approve(t.Context(), entity, DocumentRevisionInput{
			DocumentID: created.DocumentID, Revision: checked.Revision,
		}, integrationActorOne, "sales-chain-approve")
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
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&orderCreator); err != nil {
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
	}}, integrationActorOne, "duplicate-delivery"); err == nil {
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
	}}, integrationActorOne, "duplicate-signoff"); err == nil {
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
	if err := pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load refusal return: %v", err)
	}
	if refusalID != refusalDraft.DocumentID {
		t.Fatalf("workflow refusal return = %s, query=%s", refusalDraft.DocumentID, refusalID)
	}
	var refusalCreator, refusalAuditActor string
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM vou_documents WHERE id=$1`, refusalID).Scan(&refusalCreator); err != nil {
		t.Fatalf("load refusal return creator: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM vou_audit_events
		WHERE document_id=$1 AND event_type='CREATED' ORDER BY occurred_at LIMIT 1`, refusalID).Scan(&refusalAuditActor); err != nil {
		t.Fatalf("load refusal return audit: %v", err)
	}
	if refusalCreator != systemidentity.UserID || refusalAuditActor != systemidentity.UserID {
		t.Fatalf("automatic refusal actors = creator:%s audit:%s", refusalCreator, refusalAuditActor)
	}
	firstRefusalID := refusalID
	unapprovedSignoff, err := service.Unapprove(t.Context(), EntitySaleSignoff, ReverseInput{
		DocumentID: signoffOne.DocumentID, Revision: signoffOne.Revision, Reason: "修正签收测试",
	}, integrationActorOne, "signoff-unapprove")
	if err != nil {
		t.Fatalf("unapprove signoff with automatic refusal draft: %v", err)
	}
	var refusalCount int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_sale_return_details
		WHERE source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalCount); err != nil || refusalCount != 0 {
		t.Fatalf("automatic refusal drafts after unapprove = %d, err=%v", refusalCount, err)
	}
	signoffOne, err = service.Approve(t.Context(), EntitySaleSignoff, DocumentRevisionInput{
		DocumentID: signoffOne.DocumentID, Revision: unapprovedSignoff.Revision,
	}, integrationActorOne, "signoff-reapprove")
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
	if err = pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load regenerated refusal return: %v", err)
	}
	if firstRefusalID == refusalID {
		t.Fatal("workflow refusal return was not regenerated")
	}
	refusalChecked, err := service.Check(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalRevision,
	}, integrationActorOne, "refusal-check")
	if err != nil {
		t.Fatalf("check refusal return: %v", err)
	}
	refusalApproved, err := service.Approve(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalChecked.Revision,
	}, integrationActorOne, "refusal-approve")
	if err != nil {
		t.Fatalf("approve refusal return: %v", err)
	}
	if refusalApproved.Status != StatusApproved {
		t.Fatalf("approved refusal return status = %s", refusalApproved.Status)
	}
	afterSale, err := service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "客户退回",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "2",
		}},
	}}, integrationActorOne, "after-sale-return")
	if err != nil {
		t.Fatalf("create after-sale return: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "超量退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, BaseQuantity: "3",
		}},
	}}, integrationActorOne, "over-return"); err == nil {
		t.Fatal("cumulative after-sale over-return was accepted")
	}
	if _, err = service.Delete(t.Context(), EntitySaleReturn, DeleteInput{
		DocumentID: afterSale.DocumentID, Revision: afterSale.Revision, Reason: "取消测试退货",
	}, integrationActorOne, "delete-after-sale-return"); err != nil {
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
	if signoffOne.Status != StatusApproved {
		t.Fatalf("first signoff status = %s", signoffOne.Status)
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
		if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: data}, integrationActorOne, "carrier-negative-"+name); err == nil {
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
	}}, integrationActorOne, "bulk-liquid-incapable-vehicle"); err == nil {
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
	vehicleView, err := bobService.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: recheckVehicle.ObjectID})
	if err != nil {
		t.Fatalf("get approval recheck vehicle: %v", err)
	}
	if _, err = bobService.Disable(t.Context(), bobdomain.EntityVehicle, bobdomain.ObjectRevisionInput{
		ObjectID: recheckVehicle.ObjectID, ObjectRevision: vehicleView.ObjectRevision,
	}, integrationActorOne, "disable-before-delivery-approve"); err != nil {
		t.Fatalf("disable approval recheck vehicle: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntitySaleDelivery, DocumentRevisionInput{
		DocumentID: checkedDelivery.DocumentID, Revision: checkedDelivery.Revision,
	}, integrationActorOne, "delivery-approve-after-vehicle-disable"); err == nil {
		t.Fatal("delivery approval accepted a disabled vehicle")
	}

	checkVehicle := createApprovedBOB(t, bobService, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
		Name: "VOU 核对复检车辆", PlateNumber: "粤C" + newID()[20:], VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: refs.carrier.ObjectID},
	})
	draftDelivery, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: createOutbound("1").DocumentID,
		Carrier: &refs.carrier, Vehicle: &checkVehicle,
	}}, integrationActorOne, "delivery-create-before-vehicle-disable")
	if err != nil {
		t.Fatalf("create delivery before check revalidation: %v", err)
	}
	checkVehicleView, err := bobService.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: checkVehicle.ObjectID})
	if err != nil {
		t.Fatalf("get check revalidation vehicle: %v", err)
	}
	if _, err = bobService.Disable(t.Context(), bobdomain.EntityVehicle, bobdomain.ObjectRevisionInput{
		ObjectID: checkVehicle.ObjectID, ObjectRevision: checkVehicleView.ObjectRevision,
	}, integrationActorOne, "disable-before-delivery-check"); err != nil {
		t.Fatalf("disable check revalidation vehicle: %v", err)
	}
	if _, err = service.Check(t.Context(), EntitySaleDelivery, DocumentRevisionInput{
		DocumentID: draftDelivery.DocumentID, Revision: draftDelivery.Revision,
	}, integrationActorOne, "delivery-check-after-vehicle-disable"); err == nil {
		t.Fatal("delivery check accepted a disabled vehicle")
	}

	stored, err := service.Get(t.Context(), EntitySaleDelivery, GetInput{DocumentID: internalDelivery.DocumentID})
	if err != nil || stored.Data.CarrierType != "INTERNAL" || stored.Data.Vehicle == nil ||
		stored.Data.Vehicle.VersionID != internalVehicle.VersionID {
		t.Fatalf("historical internal delivery snapshot changed: %+v err=%v", stored.Data, err)
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
				DocumentID: document.DocumentID, Revision: document.Revision,
			}, integrationActorOne, "concurrent-outbound-approve")
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
	warehouseView, err := bobService.Get(t.Context(), bobdomain.EntityWarehouse, bobdomain.GetInput{ObjectID: refs.warehouse.ObjectID})
	if err != nil {
		t.Fatalf("get warehouse before blocker checks: %v", err)
	}
	disableBlockers := func() bobdomain.WarehouseDisableBlockers {
		t.Helper()
		_, disableErr := bobService.Disable(t.Context(), bobdomain.EntityWarehouse, bobdomain.ObjectRevisionInput{
			ObjectID: refs.warehouse.ObjectID, ObjectRevision: warehouseView.ObjectRevision,
		}, integrationActorOne, "warehouse-disable-blocked")
		var domainErr *bobdomain.DomainError
		if !errors.As(disableErr, &domainErr) || domainErr.Kind != bobdomain.ErrorConflict {
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
	}}, integrationActorOne, "warehouse-precheck-draft")
	if err != nil {
		t.Fatalf("create warehouse-blocking sale order: %v", err)
	}
	blockers := disableBlockers()
	if len(blockers.Documents) != 1 || blockers.Documents[0].DocumentID != draft.DocumentID {
		t.Fatalf("draft warehouse blockers = %+v", blockers)
	}
	if _, err = service.Delete(t.Context(), EntitySaleOrder, DeleteInput{
		DocumentID: draft.DocumentID, Revision: draft.Revision, Reason: "repair warehouse disable blocker",
	}, integrationActorOne, "warehouse-precheck-delete-draft"); err != nil {
		t.Fatalf("delete warehouse-blocking sale order: %v", err)
	}
	draft, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "2", "12.00")},
	}}, integrationActorOne, "warehouse-precheck-recreated-draft")
	if err != nil {
		t.Fatalf("recreate warehouse-blocking sale order: %v", err)
	}

	checked, err := service.Check(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: draft.DocumentID, Revision: draft.Revision,
	}, integrationActorOne, "warehouse-precheck-check")
	if err != nil {
		t.Fatalf("check warehouse-blocking sale order: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "warehouse-precheck-approve")
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
	if _, err = bobService.Disable(t.Context(), bobdomain.EntityWarehouse, bobdomain.ObjectRevisionInput{
		ObjectID: refs.warehouse.ObjectID, ObjectRevision: warehouseView.ObjectRevision,
	}, integrationActorOne, "warehouse-disable-after-fulfillment"); err != nil {
		t.Fatalf("disable warehouse after fulfillment: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "1", "12.00")},
	}}, integrationActorOne, "warehouse-reference-after-disable"); err == nil {
		t.Fatal("new sale order accepted a disabled warehouse")
	}
}
