package previewseed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
)

func (s *Seeder) seedWorkflows(ctx context.Context, counts *Counts) error {
	page, err := s.workflows.DefinitionQuery(ctx, wfldomain.DefinitionQueryInput{
		Page: 1, PageSize: 20, Keyword: "expense-payment",
	})
	if err != nil {
		return err
	}
	var definitionID string
	for _, item := range page.Items {
		if item.Code == "expense-payment" {
			definitionID = item.DefinitionID
			break
		}
	}
	if definitionID == "" {
		return errors.New("built-in expense-payment workflow is missing")
	}
	definition, err := s.workflows.DefinitionGet(ctx, wfldomain.DefinitionGetInput{
		DefinitionID: definitionID,
	})
	if err != nil {
		return err
	}
	if definition.Status == wfldomain.DefinitionEnabled {
		counts.add(outcomeSkipped)
		return nil
	}
	if definition.Status != wfldomain.DefinitionDraft {
		return fmt.Errorf("expense-payment workflow was changed by a tester: %s", definition.Status)
	}
	fund := s.voucherReference("fund-effective")
	defaults, err := json.Marshal(map[string]string{"fundAccountObjectId": fund.ObjectID})
	if err != nil {
		return err
	}
	foundPayment := false
	for index := range definition.Nodes {
		if definition.Nodes[index].DocumentEntity == voudomain.EntityExpensePayment {
			definition.Nodes[index].Defaults = defaults
			foundPayment = true
		}
	}
	if !foundPayment {
		return errors.New("expense-payment workflow target node is missing")
	}
	saved, err := s.workflows.DefinitionSave(ctx, wfldomain.DefinitionSaveInput{
		DefinitionCreateInput: wfldomain.DefinitionCreateInput{
			Code: definition.Code, Name: definition.Name, RootNodeID: definition.RootNodeID,
			StartCondition: definition.StartCondition, Nodes: definition.Nodes, Edges: definition.Edges,
		},
		DefinitionID: definition.DefinitionID, Revision: definition.Revision,
	}, actorID)
	if err != nil {
		return err
	}
	if _, err = s.workflows.DefinitionAction(ctx, "enable", wfldomain.DefinitionActionInput{
		DefinitionID: saved.DefinitionID, Revision: saved.Revision,
	}, actorID); err != nil {
		return err
	}
	counts.add(outcomeCreated)
	return nil
}
