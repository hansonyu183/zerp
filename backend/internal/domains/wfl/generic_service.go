package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

var definitionCodePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)

var reservedDefinitionCodes = map[string]bool{
	"process-definition": true,
	"process-instance":   true,
}

var workflowNodes = []CatalogNode{
	{Entity: "sale-order", Name: "销售订单"},
	{Entity: "sale-outbound", Name: "销售出库"},
	{Entity: "sale-delivery", Name: "销售送货"},
	{Entity: "sale-signoff", Name: "销售签收"},
	{Entity: "sale-return", Name: "销售退货"},
	{Entity: "purchase-order", Name: "采购订单"},
	{Entity: "purchase-inbound", Name: "采购入库"},
	{Entity: "purchase-return", Name: "采购退货"},
	{Entity: "order-production", Name: "生产配货"},
	{Entity: "self-production", Name: "生产自制品"},
	{Entity: "sales-receipt", Name: "销售收款"},
	{Entity: "purchase-refund", Name: "采购退款"},
	{Entity: "other-receipt", Name: "往来收款-其他"},
	{Entity: "sales-refund", Name: "销售退款"},
	{Entity: "purchase-payment", Name: "采购付款"},
	{Entity: "other-payment", Name: "往来付款-其他"},
	{Entity: "expense-reimbursement", Name: "费用报销"},
	{Entity: "expense-payment", Name: "费用付款"},
}

var workflowConverters = []CatalogConverter{
	{Key: "sale-order-to-outbound", SourceEntity: "sale-order", TargetEntity: "sale-outbound"},
	{Key: "sale-outbound-to-delivery", SourceEntity: "sale-outbound", TargetEntity: "sale-delivery", RequiredDefaults: []string{"platformObjectId", "vehicleObjectId"}},
	{Key: "sale-delivery-to-signoff", SourceEntity: "sale-delivery", TargetEntity: "sale-signoff"},
	{Key: "sale-signoff-to-receipt", SourceEntity: "sale-signoff", TargetEntity: "sales-receipt", RequiredDefaults: []string{"fundAccountObjectId", "handlerObjectId"}},
	{Key: "purchase-order-to-inbound", SourceEntity: "purchase-order", TargetEntity: "purchase-inbound"},
	{Key: "purchase-inbound-to-payment", SourceEntity: "purchase-inbound", TargetEntity: "purchase-payment", RequiredDefaults: []string{"fundAccountObjectId", "handlerObjectId"}},
	{Key: "expense-reimbursement-to-payment", SourceEntity: "expense-reimbursement", TargetEntity: "expense-payment", RequiredDefaults: []string{"fundAccountObjectId"}},
}

func (s *Service) DefinitionCatalog(context.Context) (DefinitionCatalog, error) {
	return DefinitionCatalog{
		Nodes: workflowNodes, Converters: workflowConverters,
		Operators: []string{"EQ", "NE", "GT", "GTE", "LT", "LTE", "IN", "CONTAINS"},
	}, nil
}

func (s *Service) DefinitionQuery(ctx context.Context, input DefinitionQueryInput) (Page[DefinitionListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[DefinitionListItem]{}, validation("invalid pagination", nil)
	}
	allowed := map[string]bool{DefinitionDraft: true, DefinitionEnabled: true, DefinitionDisabled: true}
	for _, status := range input.Statuses {
		if !allowed[status] {
			return Page[DefinitionListItem]{}, validation("invalid definition status", nil)
		}
	}
	statuses := input.Statuses
	if statuses == nil {
		statuses = []string{}
	}
	keyword := strings.TrimSpace(input.Keyword)
	total, err := s.queries.CountWorkflowDefinitions(ctx, sqlc.CountWorkflowDefinitionsParams{
		Keyword: keyword, Statuses: statuses,
	})
	if err != nil {
		return Page[DefinitionListItem]{}, internal("count process definitions", err)
	}
	rows, err := s.queries.ListWorkflowDefinitions(ctx, sqlc.ListWorkflowDefinitionsParams{
		Keyword: keyword, Statuses: statuses,
		PageSize: int32(input.PageSize), PageOffset: int32((input.Page - 1) * input.PageSize),
	})
	if err != nil {
		return Page[DefinitionListItem]{}, internal("query process definitions", err)
	}
	items := make([]DefinitionListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, DefinitionListItem{
			DefinitionID: row.ID, Code: row.Code, Name: row.Name, Status: row.Status,
			Revision: row.Revision, SourceKind: row.SourceKind,
			RootEntity: row.DocumentEntity, NodeCount: int(row.NodeCount),
			UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[DefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) DefinitionGet(ctx context.Context, input DefinitionGetInput) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) {
		return DefinitionView{}, validation("invalid definitionId", nil)
	}
	definition, err := s.queries.GetWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get process definition", err)
	}
	result := DefinitionView{
		DefinitionID: definition.ID, Code: definition.Code, Name: definition.Name,
		Status: definition.Status, Revision: definition.Revision,
		SourceKind: definition.SourceKind, Script: definition.DraftScript, Diagnostic: definition.DraftDiagnostic, RootNodeID: definition.RootNodeID,
		StartCondition: definition.StartCondition, UpdatedAt: definition.UpdatedAt.Time,
	}
	nodes, err := s.queries.ListWorkflowDefinitionNodes(ctx, input.DefinitionID)
	if err != nil {
		return DefinitionView{}, internal("get definition nodes", err)
	}
	result.Nodes = make([]DefinitionNodeInput, 0, len(nodes))
	for _, node := range nodes {
		result.Nodes = append(result.Nodes, DefinitionNodeInput{
			ID: node.ID, Key: node.NodeKey, Name: node.Name, DocumentEntity: node.DocumentEntity,
			PositionX: int(node.PositionX), PositionY: int(node.PositionY), Defaults: node.Defaults,
		})
	}
	edges, err := s.queries.ListWorkflowDefinitionEdges(ctx, input.DefinitionID)
	if err != nil {
		return DefinitionView{}, internal("get definition edges", err)
	}
	result.Edges = make([]DefinitionEdgeInput, 0, len(edges))
	for _, edge := range edges {
		result.Edges = append(result.Edges, DefinitionEdgeInput{
			ID: edge.ID, SourceNodeID: edge.SourceNodeID, TargetNodeID: edge.TargetNodeID,
			ConverterKey: edge.ConverterKey, Condition: edge.Condition,
		})
	}
	return result, nil
}

func (s *Service) DefinitionCreate(ctx context.Context, input DefinitionCreateInput, actorID string) (DefinitionView, error) {
	sourceKind := DefinitionSourceGraph
	if input.Script != nil {
		if hasGraphDefinitionFields(input) {
			return DefinitionView{}, validation("definition must use exactly one source kind", nil)
		}
		compiled, err := compileDefinitionScript(*input.Script)
		if err != nil {
			return DefinitionView{}, workflowScriptValidation(err)
		}
		input = scriptDefinitionInput(compiled, nil, nil, input.Script)
		sourceKind = DefinitionSourceStarlark
	}
	if err := validateDefinitionInput(input); err != nil {
		return DefinitionView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin create definition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	id := newID()
	queries := s.queries.WithTx(tx)
	if err = queries.CreateWorkflowDefinition(ctx, sqlc.CreateWorkflowDefinitionParams{
		ID: id, Code: strings.TrimSpace(input.Code), Name: strings.TrimSpace(input.Name),
		SourceKind: sourceKind, DraftScript: input.Script, RootNodeID: input.RootNodeID,
		StartCondition: normalizedJSON(input.StartCondition), ActorID: actorID,
	}); err != nil {
		return DefinitionView{}, conflict("process definition code already exists", nil)
	}
	if err = writeDefinitionGraph(ctx, tx, id, input.Nodes, input.Edges); err != nil {
		return DefinitionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit create definition", err)
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: id})
}

func hasGraphDefinitionFields(input DefinitionCreateInput) bool {
	return strings.TrimSpace(input.Code) != "" || strings.TrimSpace(input.Name) != "" ||
		input.RootNodeID != "" || len(input.StartCondition) != 0 || len(input.Nodes) != 0 || len(input.Edges) != 0
}

func (s *Service) DefinitionSave(ctx context.Context, input DefinitionSaveInput, actorID string) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return DefinitionView{}, validation("invalid definition revision", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	locked, err := queries.LockWorkflowDefinitionDraft(ctx, input.DefinitionID)
	if err != nil {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if locked.Revision != input.Revision {
		return DefinitionView{}, conflict("process definition changed", map[string]any{"revision": locked.Revision})
	}
	if input.Script != nil {
		if hasGraphDefinitionFields(input.DefinitionCreateInput) {
			return DefinitionView{}, validation("definition must use exactly one source kind", nil)
		}
		if locked.SourceKind != DefinitionSourceStarlark {
			return DefinitionView{}, validation("definition source kind is immutable", nil)
		}
		compiled, compileErr := compileDefinitionScript(*input.Script)
		if compileErr != nil {
			if locked.Status != DefinitionDraft {
				return DefinitionView{}, workflowScriptValidation(compileErr)
			}
			diagnostic := compileErr.Error()
			if saveErr := queries.SaveWorkflowDefinitionScriptDiagnostic(ctx, sqlc.SaveWorkflowDefinitionScriptDiagnosticParams{
				DraftScript: input.Script, DraftDiagnostic: &diagnostic, ActorID: actorID, ID: input.DefinitionID,
			}); saveErr != nil {
				return DefinitionView{}, internal("save workflow script diagnostic", saveErr)
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return DefinitionView{}, internal("commit workflow script diagnostic", commitErr)
			}
			return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
		}
		existingNodes, queryErr := queries.ListWorkflowDefinitionNodeIdentities(ctx, input.DefinitionID)
		if queryErr != nil {
			return DefinitionView{}, internal("read workflow node identities", queryErr)
		}
		nodeIDsByKey := make(map[string]string, len(existingNodes))
		nodeKeysByID := make(map[string]string, len(existingNodes))
		for _, node := range existingNodes {
			if nodeIDsByKey[node.NodeKey] == "" {
				nodeIDsByKey[node.NodeKey] = node.ID
			}
			nodeKeysByID[node.ID] = node.NodeKey
		}
		if nodeKeysByID[locked.RootNodeID] != compiled.RootKey {
			return DefinitionView{}, validation("workflow root node key is immutable", nil)
		}
		existingEdges, queryErr := queries.ListWorkflowDefinitionEdgeIdentities(ctx, input.DefinitionID)
		if queryErr != nil {
			return DefinitionView{}, internal("read workflow edge identities", queryErr)
		}
		edgeIDsBySignature := make(map[string]string, len(existingEdges))
		for _, edge := range existingEdges {
			signature := compiledEdgeSignature(edge.SourceNodeKey, edge.TargetNodeKey, edge.ConverterKey)
			if edgeIDsBySignature[signature] == "" {
				edgeIDsBySignature[signature] = edge.ID
			}
		}
		input.DefinitionCreateInput = scriptDefinitionInput(compiled, nodeIDsByKey, edgeIDsBySignature, input.Script)
	} else if locked.SourceKind != DefinitionSourceGraph {
		return DefinitionView{}, validation("workflow script is required", nil)
	}
	if err = validateDefinitionInput(input.DefinitionCreateInput); err != nil {
		return DefinitionView{}, err
	}
	if strings.TrimSpace(input.Code) != locked.Code {
		return DefinitionView{}, validation("process definition code is immutable", nil)
	}
	if locked.Status == DefinitionEnabled {
		if err = validateRequiredDefaults(input.Nodes, input.Edges); err != nil {
			return DefinitionView{}, err
		}
	}
	if err = queries.SaveWorkflowDefinitionDraft(ctx, sqlc.SaveWorkflowDefinitionDraftParams{
		Name: strings.TrimSpace(input.Name), RootNodeID: input.RootNodeID,
		StartCondition: normalizedJSON(input.StartCondition), DraftScript: input.Script,
		ActorID: actorID, ID: input.DefinitionID,
	}); err != nil {
		return DefinitionView{}, internal("save process definition", err)
	}
	if err = syncDefinitionPermissionDescriptions(ctx, tx, locked.Code, strings.TrimSpace(input.Name), actorID); err != nil {
		return DefinitionView{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE wfl_definition_edges SET archived=true WHERE definition_id=$1`, input.DefinitionID); err != nil {
		return DefinitionView{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE wfl_definition_nodes SET archived=true WHERE definition_id=$1`, input.DefinitionID); err != nil {
		return DefinitionView{}, err
	}
	if err = writeDefinitionGraph(ctx, tx, input.DefinitionID, input.Nodes, input.Edges); err != nil {
		return DefinitionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, err
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
}

func (s *Service) DefinitionTrial(ctx context.Context, input DefinitionTrialInput) (DefinitionTrialResult, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return DefinitionTrialResult{}, validation("invalid definition trial", nil)
	}
	definition, err := s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
	if err != nil {
		return DefinitionTrialResult{}, err
	}
	if definition.Revision != input.Revision {
		return DefinitionTrialResult{}, conflict("process definition changed", map[string]any{"revision": definition.Revision})
	}
	if definition.Status != DefinitionDraft || definition.SourceKind != DefinitionSourceStarlark || definition.Script == nil {
		return DefinitionTrialResult{}, validation("only Starlark drafts can be trialed", nil)
	}
	if definition.Diagnostic != nil {
		return DefinitionTrialResult{}, workflowScriptValidation(errors.New(*definition.Diagnostic))
	}
	compiled, err := compileDefinitionScript(*definition.Script)
	if err != nil {
		return DefinitionTrialResult{}, workflowScriptValidation(err)
	}
	root := compiledNodeByKey(compiled, compiled.RootKey)
	if input.Source.Entity != root.Entity {
		return DefinitionTrialResult{}, validation("trial source entity does not match the workflow root", map[string]any{"expectedEntity": root.Entity})
	}
	if err = s.validator.ValidateWorkflowDraft(root.Entity, input.Source.Data); err != nil {
		return DefinitionTrialResult{}, err
	}
	rowsAffected, err := s.queries.RecordWorkflowDefinitionTrial(ctx, sqlc.RecordWorkflowDefinitionTrialParams{
		DefinitionID: input.DefinitionID,
		Revision:     &input.Revision,
	})
	if err != nil {
		return DefinitionTrialResult{}, internal("record workflow trial", err)
	}
	if rowsAffected != 1 {
		return DefinitionTrialResult{}, conflict("process definition changed", nil)
	}
	trace := make([]DefinitionTrialTrace, 0, len(compiled.Nodes))
	for index, node := range compiledTraversal(compiled) {
		kind := "GRAPH_REACHABLE"
		if index == 0 {
			kind = "ROOT_MATCHED"
		}
		trace = append(trace, DefinitionTrialTrace{Kind: kind, NodeKey: node.Key, DocumentEntity: node.Entity})
	}
	return DefinitionTrialResult{
		DefinitionID: input.DefinitionID, Revision: input.Revision, Matched: true,
		RootNodeKey: compiled.RootKey,
		Trace:       trace,
	}, nil
}

func workflowScriptValidation(err error) error {
	return validation("流程脚本编译失败："+err.Error(), map[string]any{"diagnostic": err.Error()})
}

func (s *Service) DefinitionAction(ctx context.Context, action string, input DefinitionActionInput, actorID string) (any, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return nil, validation("invalid definition action", nil)
	}
	if action == "delete" {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return nil, internal("begin delete process definition", err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		var deletable bool
		if err = tx.QueryRow(ctx, `SELECT status='DRAFT' AND revision=$2 AND NOT EXISTS(
			SELECT 1 FROM wfl_definition_instances i WHERE i.definition_id=d.id)
			FROM wfl_process_definitions d WHERE d.id=$1 FOR UPDATE`, input.DefinitionID, input.Revision).Scan(&deletable); err != nil || !deletable {
			return nil, conflict("only unused draft definitions can be deleted", nil)
		}
		if _, err = tx.Exec(ctx, `DELETE FROM wfl_definition_edges WHERE definition_id=$1`, input.DefinitionID); err != nil {
			return nil, internal("delete process definition edges", err)
		}
		if _, err = tx.Exec(ctx, `DELETE FROM wfl_definition_nodes WHERE definition_id=$1`, input.DefinitionID); err != nil {
			return nil, internal("delete process definition nodes", err)
		}
		if _, err = tx.Exec(ctx, `DELETE FROM wfl_process_definitions WHERE id=$1`, input.DefinitionID); err != nil {
			return nil, internal("delete process definition", err)
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, internal("commit delete process definition", err)
		}
		return map[string]any{"definitionId": input.DefinitionID}, nil
	}
	status := DefinitionEnabled
	if action == "disable" {
		status = DefinitionDisabled
	} else if action != "enable" {
		return nil, validation("invalid definition action", nil)
	}
	if action == "enable" {
		definition, err := s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
		if err != nil {
			return nil, err
		}
		if definition.Revision != input.Revision {
			return nil, conflict("process definition changed", map[string]any{"revision": definition.Revision})
		}
		if definition.SourceKind == DefinitionSourceStarlark {
			return nil, validation("Starlark drafts must be published before they can be enabled", nil)
		}
		if err = validateRequiredDefaults(definition.Nodes, definition.Edges); err != nil {
			return nil, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internal("begin change definition status", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var code, name string
	var actualRevision int64
	if err = tx.QueryRow(ctx, `SELECT code,name,revision FROM wfl_process_definitions WHERE id=$1 FOR UPDATE`, input.DefinitionID).Scan(&code, &name, &actualRevision); err != nil {
		return nil, validation("process definition not found", nil)
	}
	if actualRevision != input.Revision {
		return nil, conflict("process definition changed", map[string]any{"revision": actualRevision})
	}
	if action == "enable" {
		err = enableDefinitionPermissions(ctx, tx, code, name, actorID)
	} else {
		err = disableDefinitionPermissions(ctx, tx, code, actorID)
	}
	if err != nil {
		return nil, err
	}
	command, err := tx.Exec(ctx, `UPDATE wfl_process_definitions SET status=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4`, status, actorID, input.DefinitionID, input.Revision)
	if err != nil {
		return nil, internal("change definition status", err)
	}
	if command.RowsAffected() != 1 {
		return nil, conflict("process definition changed", nil)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, internal("commit definition status", err)
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
}

var definitionPermissionActions = []struct {
	action string
	label  string
}{
	{action: "query", label: "查询"},
	{action: "get", label: "读取"},
	{action: "audit-history", label: "查询审计"},
}

func enableDefinitionPermissions(ctx context.Context, tx pgx.Tx, code, name, actorID string) error {
	for _, permission := range definitionPermissionActions {
		path := "/wfl/" + code + "/" + permission.action
		_, err := tx.Exec(ctx, `INSERT INTO app_permissions(id,path,domain,entity,action,description,status,created_by,updated_by)
			VALUES($1,$2,'wfl',$3,$4,$5,'ENABLED',$6,$6)
			ON CONFLICT(path) DO UPDATE SET domain='wfl',entity=excluded.entity,action=excluded.action,
				description=excluded.description,status='ENABLED',revision=app_permissions.revision+1,
				updated_at=now(),updated_by=excluded.updated_by`, newID(), path, code, permission.action, permission.label+name+"流程", actorID)
		if err != nil {
			return internal("enable process definition permission", err)
		}
	}
	return nil
}

func disableDefinitionPermissions(ctx context.Context, tx pgx.Tx, code, actorID string) error {
	for _, permission := range definitionPermissionActions {
		path := "/wfl/" + code + "/" + permission.action
		if _, err := tx.Exec(ctx, `UPDATE app_permissions SET status='DISABLED',revision=revision+1,
			updated_at=now(),updated_by=$1 WHERE path=$2 AND status<>'DISABLED'`, actorID, path); err != nil {
			return internal("disable process definition permission", err)
		}
	}
	return nil
}

func syncDefinitionPermissionDescriptions(ctx context.Context, tx pgx.Tx, code, name, actorID string) error {
	for _, permission := range definitionPermissionActions {
		if _, err := tx.Exec(ctx, `UPDATE app_permissions SET description=$1,revision=revision+1,
			updated_at=now(),updated_by=$2 WHERE path=$3`, permission.label+name+"流程", actorID, "/wfl/"+code+"/"+permission.action); err != nil {
			return internal("update process definition permission", err)
		}
	}
	return nil
}

func writeDefinitionGraph(ctx context.Context, tx pgx.Tx, definitionID string, nodes []DefinitionNodeInput, edges []DefinitionEdgeInput) error {
	for _, node := range nodes {
		command, err := tx.Exec(ctx, `INSERT INTO wfl_definition_nodes(id,definition_id,node_key,name,document_entity,position_x,position_y,defaults,archived)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,false)
		ON CONFLICT(id) DO UPDATE SET node_key=excluded.node_key,name=excluded.name,document_entity=excluded.document_entity,
		position_x=excluded.position_x,position_y=excluded.position_y,defaults=excluded.defaults,archived=false
		WHERE wfl_definition_nodes.definition_id=excluded.definition_id`, node.ID, definitionID, node.Key, node.Name, node.DocumentEntity, node.PositionX, node.PositionY, normalizedJSON(node.Defaults))
		if err != nil || command.RowsAffected() != 1 {
			return conflict("invalid definition node", map[string]any{"nodeId": node.ID})
		}
	}
	for _, edge := range edges {
		command, err := tx.Exec(ctx, `INSERT INTO wfl_definition_edges(id,definition_id,source_node_id,target_node_id,converter_key,condition,archived)
		VALUES($1,$2,$3,$4,$5,$6,false)
		ON CONFLICT(id) DO UPDATE SET source_node_id=excluded.source_node_id,target_node_id=excluded.target_node_id,
		converter_key=excluded.converter_key,condition=excluded.condition,archived=false
		WHERE wfl_definition_edges.definition_id=excluded.definition_id`, edge.ID, definitionID, edge.SourceNodeID, edge.TargetNodeID, edge.ConverterKey, normalizedJSON(edge.Condition))
		if err != nil || command.RowsAffected() != 1 {
			return conflict("invalid definition edge", map[string]any{"edgeId": edge.ID})
		}
	}
	return nil
}

func validateDefinitionInput(input DefinitionCreateInput) error {
	code := strings.TrimSpace(input.Code)
	if !definitionCodePattern.MatchString(code) || reservedDefinitionCodes[code] || strings.TrimSpace(input.Name) == "" || len(input.Nodes) == 0 {
		return validation("invalid process definition", nil)
	}
	allowed := map[string]bool{}
	for _, node := range workflowNodes {
		allowed[node.Entity] = true
	}
	converters := map[string]CatalogConverter{}
	for _, converter := range workflowConverters {
		converters[converter.Key] = converter
	}
	nodes := map[string]DefinitionNodeInput{}
	keys := map[string]bool{}
	for _, node := range input.Nodes {
		if !validWorkflowID(node.ID) || strings.TrimSpace(node.Key) == "" || strings.TrimSpace(node.Name) == "" || !allowed[node.DocumentEntity] || keys[node.Key] {
			return validation("invalid or duplicate process node", map[string]any{"nodeId": node.ID})
		}
		if _, exists := nodes[node.ID]; exists {
			return validation("invalid or duplicate process node", map[string]any{"nodeId": node.ID})
		}
		nodes[node.ID] = node
		keys[node.Key] = true
	}
	if _, ok := nodes[input.RootNodeID]; !ok {
		return validation("root node is missing", nil)
	}
	if err := validateConditionSyntax(input.StartCondition); err != nil {
		return validation("invalid start condition", nil)
	}
	indegree := map[string]int{}
	adj := map[string][]string{}
	edgePairs := map[string]bool{}
	edgeIDs := map[string]bool{}
	for _, edge := range input.Edges {
		source, sok := nodes[edge.SourceNodeID]
		target, tok := nodes[edge.TargetNodeID]
		converter, cok := converters[edge.ConverterKey]
		pair := edge.SourceNodeID + ":" + edge.TargetNodeID
		if !validWorkflowID(edge.ID) || !sok || !tok || !cok || edgeIDs[edge.ID] || edgePairs[pair] || converter.SourceEntity != source.DocumentEntity || converter.TargetEntity != target.DocumentEntity {
			return validation("invalid process edge", map[string]any{"edgeId": edge.ID})
		}
		if err := validateConditionSyntax(edge.Condition); err != nil {
			return validation("invalid branch condition", map[string]any{"edgeId": edge.ID})
		}
		edgePairs[pair] = true
		edgeIDs[edge.ID] = true
		indegree[edge.TargetNodeID]++
		adj[edge.SourceNodeID] = append(adj[edge.SourceNodeID], edge.TargetNodeID)
	}
	if indegree[input.RootNodeID] != 0 {
		return validation("root node cannot have a parent", nil)
	}
	for id := range nodes {
		if id != input.RootNodeID && indegree[id] != 1 {
			return validation("every non-root node must have exactly one parent", map[string]any{"nodeId": id})
		}
	}
	seen := map[string]bool{}
	active := map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		if active[id] {
			return false
		}
		if seen[id] {
			return true
		}
		active[id] = true
		for _, next := range adj[id] {
			if !visit(next) {
				return false
			}
		}
		active[id] = false
		seen[id] = true
		return true
	}
	if !visit(input.RootNodeID) || len(seen) != len(nodes) {
		return validation("process graph must be connected and acyclic", nil)
	}
	return nil
}

func validateConditionSyntax(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		return nil
	}
	var condition map[string]any
	if err := json.Unmarshal(raw, &condition); err != nil {
		return err
	}
	return validateConditionObject(condition)
}

func validateConditionObject(condition map[string]any) error {
	if len(condition) == 0 {
		return nil
	}
	if len(condition) != 1 && (condition["field"] == nil || condition["operator"] == nil) {
		return errors.New("condition must contain one group or one predicate")
	}
	for _, group := range []string{"all", "any"} {
		if raw, ok := condition[group]; ok {
			if len(condition) != 1 {
				return errors.New("condition group cannot contain siblings")
			}
			items, ok := raw.([]any)
			if !ok {
				return errors.New("condition group must be an array")
			}
			for _, item := range items {
				child, ok := item.(map[string]any)
				if !ok {
					return errors.New("condition item must be an object")
				}
				if err := validateConditionObject(child); err != nil {
					return err
				}
			}
			return nil
		}
	}
	for _, group := range []string{"lineAll", "lineAny"} {
		if raw, ok := condition[group]; ok {
			if len(condition) != 1 {
				return errors.New("line condition cannot contain siblings")
			}
			predicate, ok := raw.(map[string]any)
			if !ok {
				return errors.New("line condition must be an object")
			}
			return validatePredicateSyntax(predicate)
		}
	}
	return validatePredicateSyntax(condition)
}

func validatePredicateSyntax(predicate map[string]any) error {
	field, fieldOK := predicate["field"].(string)
	operator, operatorOK := predicate["operator"].(string)
	_, valueOK := predicate["value"]
	allowed := map[string]bool{"EQ": true, "NE": true, "GT": true, "GTE": true, "LT": true, "LTE": true, "IN": true, "CONTAINS": true}
	if !fieldOK || strings.TrimSpace(field) == "" || !operatorOK || !allowed[operator] || !valueOK {
		return errors.New("invalid condition predicate")
	}
	if operator == "IN" {
		if _, ok := predicate["value"].([]any); !ok {
			return errors.New("IN condition value must be an array")
		}
	}
	return nil
}

func validateRequiredDefaults(nodes []DefinitionNodeInput, edges []DefinitionEdgeInput) error {
	nodeByID := make(map[string]DefinitionNodeInput, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	converterByKey := make(map[string]CatalogConverter, len(workflowConverters))
	for _, converter := range workflowConverters {
		converterByKey[converter.Key] = converter
	}
	for _, edge := range edges {
		converter := converterByKey[edge.ConverterKey]
		if len(converter.RequiredDefaults) == 0 {
			continue
		}
		var defaults map[string]any
		if err := json.Unmarshal(normalizedJSON(nodeByID[edge.TargetNodeID].Defaults), &defaults); err != nil {
			return validation("invalid node defaults", map[string]any{"nodeId": edge.TargetNodeID})
		}
		for _, field := range converter.RequiredDefaults {
			value, ok := defaults[field]
			if !ok || strings.TrimSpace(fmt.Sprint(value)) == "" || value == nil {
				return validation("workflow node default is required", map[string]any{"nodeId": edge.TargetNodeID, "field": field})
			}
		}
	}
	return nil
}

func normalizedJSON(value json.RawMessage) json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return json.RawMessage(`{}`)
	}
	return value
}

const instancePartyJoin = ` LEFT JOIN LATERAL (
	SELECT party_object_id,party_code,party_name FROM (
		SELECT customer_object_id AS party_object_id,customer_code AS party_code,customer_name AS party_name FROM vou_sale_order_details WHERE document_id=d.id
		UNION ALL SELECT customer_object_id,customer_code,customer_name FROM vou_sale_outbound_details WHERE document_id=d.id
		UNION ALL SELECT customer_object_id,customer_code,customer_name FROM vou_sale_delivery_details WHERE document_id=d.id
		UNION ALL SELECT customer_object_id,customer_code,customer_name FROM vou_sale_signoff_details WHERE document_id=d.id
		UNION ALL SELECT customer_object_id,customer_code,customer_name FROM vou_sale_return_details WHERE document_id=d.id
		UNION ALL SELECT supplier_object_id,supplier_code,supplier_name FROM vou_purchase_inquiry_details WHERE document_id=d.id
		UNION ALL SELECT supplier_object_id,supplier_code,supplier_name FROM vou_purchase_order_details WHERE document_id=d.id
		UNION ALL SELECT supplier_object_id,supplier_code,supplier_name FROM vou_purchase_inbound_details WHERE document_id=d.id
		UNION ALL SELECT supplier_object_id,supplier_code,supplier_name FROM vou_purchase_return_details WHERE document_id=d.id
		UNION ALL SELECT counterparty_object_id,counterparty_code,counterparty_name FROM vou_receipt_details WHERE document_id=d.id
		UNION ALL SELECT counterparty_object_id,counterparty_code,counterparty_name FROM vou_payment_details WHERE document_id=d.id
		UNION ALL SELECT employee_object_id,employee_code,employee_name FROM vou_expense_reimbursement_details WHERE document_id=d.id
		UNION ALL SELECT employee_object_id,employee_code,employee_name FROM vou_expense_payment_details WHERE document_id=d.id
		UNION ALL SELECT counterparty_object_id,COALESCE(counterparty_code,''),COALESCE(NULLIF(counterparty_name,''),source_name) FROM vou_other_income_details WHERE document_id=d.id
	) parties LIMIT 1
) party ON true `

const instanceKeywordCondition = `($1='' OR party.party_code ILIKE '%'||$1||'%' OR party.party_name ILIKE '%'||$1||'%' OR EXISTS(
	SELECT 1 FROM wfl_node_instances search_node WHERE search_node.process_id=i.id AND (
		EXISTS(SELECT 1 FROM vou_product_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_sale_outbound_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_sale_signoff_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_sale_return_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_purchase_inbound_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_purchase_return_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_production_output_lines line WHERE line.document_id=search_node.document_id AND (line.product_code ILIKE '%'||$1||'%' OR line.product_name ILIKE '%'||$1||'%'))
		OR EXISTS(SELECT 1 FROM vou_production_material_lines material JOIN vou_production_output_lines output ON output.id=material.output_line_id WHERE output.document_id=search_node.document_id AND (material.formula_material_code ILIKE '%'||$1||'%' OR material.formula_material_name ILIKE '%'||$1||'%' OR material.actual_material_code ILIKE '%'||$1||'%' OR material.actual_material_name ILIKE '%'||$1||'%'))
	)
))`

func (s *Service) InstanceQuery(ctx context.Context, input InstanceQueryInput) (Page[InstanceListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[InstanceListItem]{}, validation("invalid pagination", nil)
	}
	if input.PartyObjectID != "" && !validID(strings.TrimSpace(input.PartyObjectID)) {
		return Page[InstanceListItem]{}, validation("invalid partyObjectId", nil)
	}
	statuses := input.Statuses
	if statuses == nil {
		statuses = []string{}
	}
	for _, status := range statuses {
		if status != InstanceActive && status != InstanceCompleted {
			return Page[InstanceListItem]{}, validation("invalid instance status", nil)
		}
	}
	var total int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM wfl_definition_instances i JOIN vou_documents d ON d.id=i.root_document_id JOIN wfl_process_definitions f ON f.id=i.definition_id`+instancePartyJoin+`WHERE `+instanceKeywordCondition+` AND ($2='' OR i.definition_id=$2) AND (cardinality($3::text[])=0 OR i.status=ANY($3::text[])) AND ($4='' OR party.party_object_id=$4)`, strings.TrimSpace(input.Keyword), input.DefinitionID, statuses, strings.TrimSpace(input.PartyObjectID)).Scan(&total)
	if err != nil {
		return Page[InstanceListItem]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT i.id,i.definition_id,f.code,f.name,i.status,i.revision,i.root_document_id,d.document_no,d.entity,COALESCE(party.party_code,''),COALESCE(party.party_name,''),i.updated_at FROM wfl_definition_instances i JOIN vou_documents d ON d.id=i.root_document_id JOIN wfl_process_definitions f ON f.id=i.definition_id`+instancePartyJoin+`WHERE `+instanceKeywordCondition+` AND ($2='' OR i.definition_id=$2) AND (cardinality($3::text[])=0 OR i.status=ANY($3::text[])) AND ($4='' OR party.party_object_id=$4) ORDER BY i.updated_at DESC,i.id DESC LIMIT $5 OFFSET $6`, strings.TrimSpace(input.Keyword), input.DefinitionID, statuses, strings.TrimSpace(input.PartyObjectID), input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[InstanceListItem]{}, err
	}
	defer rows.Close()
	items := []InstanceListItem{}
	processIDs := []string{}
	for rows.Next() {
		var item InstanceListItem
		if err = rows.Scan(&item.ProcessID, &item.DefinitionID, &item.DefinitionCode, &item.DefinitionName, &item.Status, &item.Revision, &item.RootDocumentID, &item.RootDocumentNo, &item.RootEntity, &item.PartyCode, &item.PartyName, &item.UpdatedAt); err != nil {
			return Page[InstanceListItem]{}, err
		}
		item.CurrentNodes = []CurrentNodeView{}
		item.Progress = []InstanceProgressItem{}
		items = append(items, item)
		processIDs = append(processIDs, item.ProcessID)
	}
	if err = rows.Err(); err != nil {
		return Page[InstanceListItem]{}, err
	}
	if len(processIDs) > 0 {
		progressRows, queryErr := s.pool.Query(ctx, `WITH RECURSIVE node_depth AS (
			SELECT id,0 AS depth FROM wfl_node_instances WHERE process_id=ANY($1::varchar[]) AND parent_node_instance_id IS NULL
			UNION ALL
			SELECT child.id,parent.depth+1 FROM wfl_node_instances child JOIN node_depth parent ON parent.id=child.parent_node_instance_id
		)
			SELECT n.process_id,n.node_key,n.node_name,n.document_entity,count(*)::bigint,
			count(*) FILTER (WHERE d.status='FINALIZED' OR EXISTS(SELECT 1 FROM wfl_node_instances child WHERE child.parent_node_instance_id=n.id))::bigint
			FROM wfl_node_instances n JOIN node_depth depth ON depth.id=n.id JOIN vou_documents d ON d.id=n.document_id
			WHERE n.process_id=ANY($1::varchar[])
			GROUP BY n.process_id,n.node_key,n.node_name,n.document_entity
			ORDER BY min(depth.depth),min(n.created_at),n.node_key`, processIDs)
		if queryErr != nil {
			return Page[InstanceListItem]{}, queryErr
		}
		defer progressRows.Close()
		progressByProcess := make(map[string][]InstanceProgressItem, len(processIDs))
		for progressRows.Next() {
			var processID string
			var progress InstanceProgressItem
			if err = progressRows.Scan(&processID, &progress.NodeKey, &progress.NodeName, &progress.DocumentEntity, &progress.TotalCount, &progress.CompletedCount); err != nil {
				return Page[InstanceListItem]{}, err
			}
			progressByProcess[processID] = append(progressByProcess[processID], progress)
		}
		if err = progressRows.Err(); err != nil {
			return Page[InstanceListItem]{}, err
		}
		currentRows, queryErr := s.pool.Query(ctx, `SELECT n.process_id,n.id,n.node_name,n.document_id,d.document_no,n.document_entity,d.status
			FROM wfl_node_instances n JOIN vou_documents d ON d.id=n.document_id
			WHERE n.process_id=ANY($1::varchar[]) AND d.status<>'FINALIZED'
			  AND NOT EXISTS(SELECT 1 FROM wfl_node_instances child WHERE child.parent_node_instance_id=n.id)
			ORDER BY n.created_at,n.id`, processIDs)
		if queryErr != nil {
			return Page[InstanceListItem]{}, queryErr
		}
		defer currentRows.Close()
		byProcess := make(map[string][]CurrentNodeView, len(processIDs))
		for currentRows.Next() {
			var processID string
			var node CurrentNodeView
			if err = currentRows.Scan(&processID, &node.NodeInstanceID, &node.NodeName, &node.DocumentID, &node.DocumentNo, &node.DocumentEntity, &node.DocumentStatus); err != nil {
				return Page[InstanceListItem]{}, err
			}
			byProcess[processID] = append(byProcess[processID], node)
		}
		if err = currentRows.Err(); err != nil {
			return Page[InstanceListItem]{}, err
		}
		for index := range items {
			if progress := progressByProcess[items[index].ProcessID]; progress != nil {
				items[index].Progress = progress
			}
			if nodes := byProcess[items[index].ProcessID]; nodes != nil {
				items[index].CurrentNodes = nodes
			}
		}
	}
	return Page[InstanceListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) InstanceQueryByDefinitionCode(ctx context.Context, code string, input InstanceQueryInput) (Page[InstanceListItem], error) {
	definitionID, err := s.enabledDefinitionID(ctx, code)
	if err != nil {
		return Page[InstanceListItem]{}, err
	}
	input.DefinitionID = definitionID
	return s.InstanceQuery(ctx, input)
}

func (s *Service) InstanceGetByDefinitionCode(ctx context.Context, code string, input InstanceGetInput) (InstanceView, error) {
	if _, err := s.enabledDefinitionID(ctx, code); err != nil {
		return InstanceView{}, err
	}
	result, err := s.InstanceGet(ctx, input)
	if err == nil && result.DefinitionCode != code {
		return InstanceView{}, validation("process instance not found", nil)
	}
	return result, err
}

func (s *Service) InstanceHistoryByDefinitionCode(ctx context.Context, code string, input InstanceHistoryInput) (Page[RuntimeAuditView], error) {
	if _, err := s.enabledDefinitionID(ctx, code); err != nil {
		return Page[RuntimeAuditView]{}, err
	}
	var matches bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM wfl_definition_instances i
		JOIN wfl_process_definitions d ON d.id=i.definition_id WHERE i.id=$1 AND d.code=$2)`, input.ProcessID, code).Scan(&matches); err != nil {
		return Page[RuntimeAuditView]{}, err
	}
	if !matches {
		return Page[RuntimeAuditView]{}, validation("process instance not found", nil)
	}
	return s.InstanceHistory(ctx, input)
}

func (s *Service) enabledDefinitionID(ctx context.Context, code string) (string, error) {
	if !definitionCodePattern.MatchString(code) || reservedDefinitionCodes[code] {
		return "", validation("process definition not found", nil)
	}
	var definitionID string
	err := s.pool.QueryRow(ctx, `SELECT id FROM wfl_process_definitions WHERE code=$1 AND status='ENABLED'`, code).Scan(&definitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", validation("process definition not found", nil)
	}
	if err != nil {
		return "", internal("resolve process definition", err)
	}
	return definitionID, nil
}

func (s *Service) InstanceGet(ctx context.Context, input InstanceGetInput) (InstanceView, error) {
	if !validWorkflowID(input.ProcessID) {
		return InstanceView{}, validation("invalid processId", nil)
	}
	var result InstanceView
	err := s.pool.QueryRow(ctx, `SELECT i.id,i.definition_id,f.code,f.name,i.status,i.revision,i.root_document_id,d.document_no,d.entity,i.updated_at,i.started_definition_revision FROM wfl_definition_instances i JOIN vou_documents d ON d.id=i.root_document_id JOIN wfl_process_definitions f ON f.id=i.definition_id WHERE i.id=$1`, input.ProcessID).Scan(&result.ProcessID, &result.DefinitionID, &result.DefinitionCode, &result.DefinitionName, &result.Status, &result.Revision, &result.RootDocumentID, &result.RootDocumentNo, &result.RootEntity, &result.UpdatedAt, &result.StartedDefinitionRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return InstanceView{}, validation("process instance not found", nil)
	}
	if err != nil {
		return InstanceView{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT n.id,n.definition_node_id,n.parent_node_instance_id,n.node_key,n.node_name,n.document_id,d.document_no,n.document_entity,d.status,d.revision,to_char(d.business_date,'YYYY-MM-DD'),n.legacy,n.evaluated_definition_revision,n.evaluated_at FROM wfl_node_instances n JOIN vou_documents d ON d.id=n.document_id WHERE n.process_id=$1 ORDER BY n.created_at,n.id`, input.ProcessID)
	if err != nil {
		return InstanceView{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var node NodeInstanceView
		if err = rows.Scan(&node.NodeInstanceID, &node.DefinitionNodeID, &node.ParentNodeInstanceID, &node.NodeKey, &node.NodeName, &node.DocumentID, &node.DocumentNo, &node.DocumentEntity, &node.DocumentStatus, &node.DocumentRevision, &node.BusinessDate, &node.Legacy, &node.EvaluatedRevision, &node.EvaluatedAt); err != nil {
			return InstanceView{}, err
		}
		result.Nodes = append(result.Nodes, node)
	}
	return result, rows.Err()
}

func (s *Service) InstanceHistory(ctx context.Context, input InstanceHistoryInput) (Page[RuntimeAuditView], error) {
	if !validWorkflowID(input.ProcessID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[RuntimeAuditView]{}, validation("invalid history query", nil)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM wfl_runtime_audit_events WHERE process_id=$1`, input.ProcessID).Scan(&total); err != nil {
		return Page[RuntimeAuditView]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id,event_type,node_instance_id,document_id,document_no,actor_id,request_id,summary,occurred_at FROM wfl_runtime_audit_events WHERE process_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`, input.ProcessID, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[RuntimeAuditView]{}, err
	}
	defer rows.Close()
	items := []RuntimeAuditView{}
	for rows.Next() {
		var item RuntimeAuditView
		if err = rows.Scan(&item.ID, &item.EventType, &item.NodeInstanceID, &item.DocumentID, &item.DocumentNo, &item.ActorID, &item.RequestID, &item.Summary, &item.OccurredAt); err != nil {
			return Page[RuntimeAuditView]{}, err
		}
		items = append(items, item)
	}
	return Page[RuntimeAuditView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, rows.Err()
}

func validWorkflowID(value string) bool { return len(strings.TrimSpace(value)) == 26 }
