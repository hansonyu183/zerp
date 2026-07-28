package vou

import (
	"reflect"
	"testing"
)

func TestManagedDocumentStatusUsesStageSemantics(t *testing.T) {
	tests := []struct {
		entity string
		stored string
		want   string
	}{
		{EntityCustomerOrder, "REVIEWED", StatusChecked},
		{EntityCustomerOrder, StatusApproved, StatusApproved},
		{EntityProcurementOrder, StatusApproved, "ORDERED"},
		{EntityGoodsReceipt, StatusApproved, "CONFIRMED"},
		{EntityDeliveryNote, StatusApproved, "EXECUTED"},
		{EntitySignoffNote, StatusApproved, "CONFIRMED"},
	}
	for _, test := range tests {
		if got := documentStatus(test.entity, test.stored); got != test.want {
			t.Errorf("%s status %s = %s, want %s", test.entity, test.stored, got, test.want)
		}
	}
}

func TestManagedDocumentStatusFiltersMapToStoredLifecycle(t *testing.T) {
	tests := []struct {
		entity   string
		statuses []string
		want     []string
	}{
		{EntityCustomerOrder, []string{StatusDraft, StatusChecked, StatusApproved}, []string{StatusDraft, "REVIEWED", StatusApproved}},
		{EntityProcurementOrder, []string{StatusChecked, "ORDERED"}, []string{"REVIEWED", StatusApproved}},
		{EntityGoodsReceipt, []string{"CONFIRMED"}, []string{StatusApproved}},
		{EntityDeliveryNote, []string{"EXECUTED"}, []string{StatusApproved}},
		{EntitySignoffNote, []string{"CONFIRMED"}, []string{StatusApproved}},
	}
	for _, test := range tests {
		if got := storedStatuses(test.entity, test.statuses); !reflect.DeepEqual(got, test.want) {
			t.Errorf("%s statuses = %#v, want %#v", test.entity, got, test.want)
		}
	}
}

func TestWorkflowManagedEntityCoversBothProcesses(t *testing.T) {
	for _, entity := range []string{
		EntitySaleOrder, EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff,
		EntityPurchaseOrder, EntityPurchaseInbound,
		EntityCustomerOrder, EntityProcurementOrder, EntityGoodsReceipt,
		EntityDeliveryNote, EntitySignoffNote,
	} {
		if !workflowManagedEntity(entity) {
			t.Errorf("%s is not workflow-managed", entity)
		}
	}
}
