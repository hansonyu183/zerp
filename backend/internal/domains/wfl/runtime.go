package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

type workflowDocumentConverter interface {
	CreateWorkflowChild(context.Context, pgx.Tx, string, string, json.RawMessage, string) (voudomain.MutationResult, error)
}

func (s *Service) SetWorkflowDocumentConverter(converter workflowDocumentConverter) {
	s.converter = converter
}

func (s *Service) registerGenericSubscriptions(bus *txevent.Bus) error {
	for _, node := range workflowNodes {
		entity := node.Entity
		if err := bus.Subscribe(voudomain.DocumentChangedTopic(entity), "wfl-generic-approved", s.handleGenericApproved); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentFinalizedTopic(entity), "wfl-generic-completion", s.handleGenericCompletion); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentUnfinalizedTopic(entity), "wfl-generic-completion", s.handleGenericCompletion); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) handleGenericApproved(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentChangedEvent)
	if !ok || event.Action != "APPROVED" {
		return nil
	}
	if s.converter == nil {
		return txevent.Reject("workflow document converter is unavailable", nil)
	}
	projection, err := loadConditionProjection(ctx, tx, event.DocumentID)
	if err != nil {
		return err
	}
	if err = s.startMatchingInstances(ctx, tx, event, projection); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT n.id,n.process_id,n.definition_node_id
		FROM wfl_node_instances n
		JOIN wfl_definition_instances i ON i.id=n.process_id
		WHERE n.document_id=$1 AND NOT n.legacy AND n.definition_node_id IS NOT NULL
		FOR UPDATE OF n,i`, event.DocumentID)
	if err != nil {
		return err
	}
	type sourceNode struct{ id, processID, definitionNodeID string }
	sources := make([]sourceNode, 0)
	for rows.Next() {
		var source sourceNode
		if err = rows.Scan(&source.id, &source.processID, &source.definitionNodeID); err != nil {
			rows.Close()
			return err
		}
		sources = append(sources, source)
	}
	rows.Close()
	for _, source := range sources {
		if err = s.executeOutgoingEdges(ctx, tx, event, source, projection); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) startMatchingInstances(
	ctx context.Context, tx pgx.Tx, event voudomain.DocumentChangedEvent, projection conditionProjection,
) error {
	rows, err := tx.Query(ctx, `SELECT d.id,d.revision,d.root_node_id,d.start_condition,n.node_key,n.name
		FROM wfl_process_definitions d JOIN wfl_definition_nodes n ON n.id=d.root_node_id
		WHERE d.status='ENABLED' AND NOT n.archived AND n.document_entity=$1
		ORDER BY d.id FOR SHARE OF d,n`, event.Entity)
	if err != nil {
		return err
	}
	type definitionRoot struct {
		id, rootID, key, name string
		revision              int64
		condition             json.RawMessage
	}
	definitions := make([]definitionRoot, 0)
	for rows.Next() {
		var value definitionRoot
		if err = rows.Scan(&value.id, &value.revision, &value.rootID, &value.condition, &value.key, &value.name); err != nil {
			rows.Close()
			return err
		}
		definitions = append(definitions, value)
	}
	rows.Close()
	for _, definition := range definitions {
		matched, matchErr := evaluateCondition(definition.condition, projection)
		if matchErr != nil {
			return txevent.Reject("workflow start condition is invalid", map[string]any{"definitionId": definition.id})
		}
		if !matched {
			continue
		}
		var processID string
		err = tx.QueryRow(ctx, `SELECT id FROM wfl_definition_instances
			WHERE definition_id=$1 AND root_document_id=$2`, definition.id, event.DocumentID).Scan(&processID)
		if err == nil {
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		processID = newID()
		nodeInstanceID := newID()
		if _, err = tx.Exec(ctx, `INSERT INTO wfl_definition_instances(
			id,definition_id,root_document_id,status,revision,started_definition_revision,created_by,updated_by
		) VALUES($1,$2,$3,'ACTIVE',1,$4,$5,$5)`, processID, definition.id, event.DocumentID, definition.revision, systemidentity.UserID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO wfl_node_instances(
			id,process_id,definition_node_id,document_id,node_key,node_name,document_entity
		) VALUES($1,$2,$3,$4,$5,$6,$7)`, nodeInstanceID, processID, definition.rootID, event.DocumentID, definition.key, definition.name, event.Entity); err != nil {
			return err
		}
		if err = insertRuntimeAudit(ctx, tx, processID, "STARTED", nodeInstanceID, event, map[string]any{"definitionRevision": definition.revision}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) executeOutgoingEdges(
	ctx context.Context, tx pgx.Tx, event voudomain.DocumentChangedEvent, source struct{ id, processID, definitionNodeID string }, projection conditionProjection,
) error {
	var revision int64
	if err := tx.QueryRow(ctx, `SELECT d.revision FROM wfl_definition_instances i
		JOIN wfl_process_definitions d ON d.id=i.definition_id WHERE i.id=$1`, source.processID).Scan(&revision); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT e.id,e.target_node_id,e.converter_key,e.condition,n.node_key,n.name,n.document_entity,n.defaults
		FROM wfl_definition_edges e JOIN wfl_definition_nodes n ON n.id=e.target_node_id
		WHERE e.source_node_id=$1 AND NOT e.archived AND NOT n.archived ORDER BY e.created_at,e.id`, source.definitionNodeID)
	if err != nil {
		return err
	}
	type outgoing struct {
		id, targetID, converter, key, name, entity string
		condition, defaults                        json.RawMessage
	}
	edges := make([]outgoing, 0)
	for rows.Next() {
		var edge outgoing
		if err = rows.Scan(&edge.id, &edge.targetID, &edge.converter, &edge.condition, &edge.key, &edge.name, &edge.entity, &edge.defaults); err != nil {
			rows.Close()
			return err
		}
		edges = append(edges, edge)
	}
	rows.Close()
	for _, edge := range edges {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM wfl_edge_executions
			WHERE process_id=$1 AND source_node_instance_id=$2 AND edge_id=$3)`, source.processID, source.id, edge.id).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		matched, matchErr := evaluateCondition(edge.condition, projection)
		if matchErr != nil {
			return txevent.Reject("workflow branch condition is invalid", map[string]any{"edgeId": edge.id})
		}
		var targetNodeID *string
		if matched {
			child, createErr := s.converter.CreateWorkflowChild(ctx, tx, edge.converter, event.DocumentID, edge.defaults, event.RequestID)
			if createErr != nil {
				return createErr
			}
			if child.DocumentID == "" {
				return txevent.Reject("workflow converter did not create a child document", map[string]any{"edgeId": edge.id})
			}
			targetID := newID()
			err = tx.QueryRow(ctx, `INSERT INTO wfl_node_instances(
				id,process_id,definition_node_id,parent_node_instance_id,document_id,node_key,node_name,document_entity
			) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT(process_id,definition_node_id,document_id) DO UPDATE SET parent_node_instance_id=excluded.parent_node_instance_id
			RETURNING id`, targetID, source.processID, edge.targetID, source.id, child.DocumentID, edge.key, edge.name, edge.entity).Scan(&targetID)
			if err != nil {
				return err
			}
			targetNodeID = &targetID
			if err = insertRuntimeAudit(ctx, tx, source.processID, "CHILD_CREATED", targetID, voudomain.DocumentChangedEvent{
				Entity: edge.entity, DocumentID: child.DocumentID, DocumentNo: child.DocumentNo,
				ActorID: systemidentity.UserID, RequestID: event.RequestID,
			}, map[string]any{"sourceDocumentId": event.DocumentID, "edgeId": edge.id}); err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, `INSERT INTO wfl_edge_executions(
			process_id,source_node_instance_id,edge_id,matched,target_node_instance_id,definition_revision
		) VALUES($1,$2,$3,$4,$5,$6)`, source.processID, source.id, edge.id, matched, targetNodeID, revision); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE wfl_node_instances SET evaluated_definition_revision=$1,evaluated_at=now() WHERE id=$2`, revision, source.id)
	return err
}

func (s *Service) handleGenericCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	var documentID string
	switch event := raw.(type) {
	case voudomain.DocumentFinalizedEvent:
		documentID = event.DocumentID
	case voudomain.DocumentUnfinalizedEvent:
		documentID = event.DocumentID
	default:
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT process_id FROM wfl_node_instances WHERE document_id=$1`, documentID)
	if err != nil {
		return err
	}
	processes := make([]string, 0)
	for rows.Next() {
		var processID string
		if err = rows.Scan(&processID); err != nil {
			rows.Close()
			return err
		}
		processes = append(processes, processID)
	}
	rows.Close()
	for _, processID := range processes {
		var incomplete bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM wfl_node_instances n JOIN vou_documents d ON d.id=n.document_id
			WHERE n.process_id=$1 AND NOT n.legacy
			  AND NOT EXISTS(SELECT 1 FROM wfl_node_instances child WHERE child.parent_node_instance_id=n.id)
			  AND d.status<>'FINALIZED'
		)`, processID).Scan(&incomplete)
		if err != nil {
			return err
		}
		status := InstanceCompleted
		if incomplete {
			status = InstanceActive
		}
		if _, err = tx.Exec(ctx, `UPDATE wfl_definition_instances SET status=$1,revision=revision+1,
			updated_at=now(),updated_by=$2,completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE NULL END
			WHERE id=$3 AND status<>$1`, status, systemidentity.UserID, processID); err != nil {
			return err
		}
	}
	return nil
}

func insertRuntimeAudit(ctx context.Context, tx pgx.Tx, processID, eventType, nodeID string, event voudomain.DocumentChangedEvent, summary map[string]any) error {
	encoded, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wfl_runtime_audit_events(
		id,process_id,event_type,node_instance_id,document_id,document_no,actor_id,request_id,summary
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, newID(), processID, eventType, nodeID, event.DocumentID, event.DocumentNo,
		systemidentity.UserID, event.RequestID, encoded)
	return err
}

type conditionProjection struct {
	Header map[string]any
	Lines  []map[string]any
}

func loadConditionProjection(ctx context.Context, tx pgx.Tx, documentID string) (conditionProjection, error) {
	result := conditionProjection{Header: map[string]any{}, Lines: []map[string]any{}}
	var entity, status, businessDate string
	var currency *string
	var amount int64
	err := tx.QueryRow(ctx, `SELECT entity,status,currency,total_amount_cents,to_char(business_date,'YYYY-MM-DD')
		FROM vou_documents WHERE id=$1`, documentID).Scan(&entity, &status, &currency, &amount, &businessDate)
	if err != nil {
		return result, err
	}
	result.Header["entity"], result.Header["status"] = entity, status
	if currency != nil {
		result.Header["currency"] = *currency
	}
	result.Header["businessDate"] = businessDate
	result.Header["amount"] = float64(amount) / 100
	rows, err := tx.Query(ctx, `SELECT product_code,product_unit,quantity_micros,unit_price_cents,line_amount_cents FROM (
		SELECT product_code,product_unit,ordered_qty_micros quantity_micros,unit_price_cents,line_amount_cents FROM vou_product_lines WHERE document_id=$1
		UNION ALL SELECT product_code,product_unit,quantity_micros,unit_price_cents,line_amount_cents FROM vou_sale_outbound_lines WHERE document_id=$1
		UNION ALL SELECT product_code,product_unit,quantity_micros,unit_price_cents,line_amount_cents FROM vou_purchase_inbound_lines WHERE document_id=$1
	) lines`, documentID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var code, unit string
		var quantity, price, lineAmount int64
		if err = rows.Scan(&code, &unit, &quantity, &price, &lineAmount); err != nil {
			return result, err
		}
		result.Lines = append(result.Lines, map[string]any{"productCode": code, "unit": unit, "quantity": float64(quantity) / 1_000_000, "unitPrice": float64(price) / 100, "amount": float64(lineAmount) / 100})
	}
	return result, rows.Err()
}

func evaluateCondition(raw json.RawMessage, projection conditionProjection) (bool, error) {
	if len(raw) == 0 || string(raw) == "{}" || string(raw) == "null" {
		return true, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, err
	}
	return evaluateConditionValue(value, projection.Header, projection.Lines)
}

func evaluateConditionValue(value map[string]any, header map[string]any, lines []map[string]any) (bool, error) {
	for key, wantAll := range map[string]bool{"all": true, "any": false} {
		if raw, ok := value[key]; ok {
			items, ok := raw.([]any)
			if !ok {
				return false, fmt.Errorf("%s must be an array", key)
			}
			if len(items) == 0 {
				return true, nil
			}
			result := wantAll
			for _, item := range items {
				child, ok := item.(map[string]any)
				if !ok {
					return false, errors.New("condition item must be an object")
				}
				matched, err := evaluateConditionValue(child, header, lines)
				if err != nil {
					return false, err
				}
				if wantAll && !matched {
					return false, nil
				}
				if !wantAll && matched {
					return true, nil
				}
				result = matched
			}
			return result, nil
		}
	}
	for key, wantAll := range map[string]bool{"lineAll": true, "lineAny": false} {
		if raw, ok := value[key]; ok {
			child, ok := raw.(map[string]any)
			if !ok {
				return false, fmt.Errorf("%s must be an object", key)
			}
			if len(lines) == 0 {
				return false, nil
			}
			for _, line := range lines {
				matched, err := evaluatePredicate(child, line)
				if err != nil {
					return false, err
				}
				if wantAll && !matched {
					return false, nil
				}
				if !wantAll && matched {
					return true, nil
				}
			}
			return wantAll, nil
		}
	}
	return evaluatePredicate(value, header)
}

func evaluatePredicate(value map[string]any, source map[string]any) (bool, error) {
	field, _ := value["field"].(string)
	operator, _ := value["operator"].(string)
	actual, ok := source[field]
	if !ok {
		return false, nil
	}
	expected := value["value"]
	switch operator {
	case "EQ":
		return fmt.Sprint(actual) == fmt.Sprint(expected), nil
	case "NE":
		return fmt.Sprint(actual) != fmt.Sprint(expected), nil
	case "CONTAINS":
		return strings.Contains(strings.ToLower(fmt.Sprint(actual)), strings.ToLower(fmt.Sprint(expected))), nil
	case "IN":
		items, ok := expected.([]any)
		if !ok {
			return false, errors.New("IN requires array")
		}
		for _, item := range items {
			if fmt.Sprint(actual) == fmt.Sprint(item) {
				return true, nil
			}
		}
		return false, nil
	case "GT", "GTE", "LT", "LTE":
		left, err := strconv.ParseFloat(fmt.Sprint(actual), 64)
		if err != nil {
			return false, err
		}
		right, err := strconv.ParseFloat(fmt.Sprint(expected), 64)
		if err != nil {
			return false, err
		}
		switch operator {
		case "GT":
			return left > right, nil
		case "GTE":
			return left >= right, nil
		case "LT":
			return left < right, nil
		default:
			return left <= right, nil
		}
	}
	return false, errors.New("unknown condition operator")
}
