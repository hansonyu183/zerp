package wfl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"go.starlark.net/starlark"
)

type WorkflowExecutionTrace struct {
	SourceNodeKey string                  `json:"sourceNodeKey"`
	TargetNodeKey string                  `json:"targetNodeKey"`
	Relation      string                  `json:"relation"`
	Action        string                  `json:"action"`
	Result        BusinessObjectReference `json:"result"`
}

type WorkflowExecutionResult struct {
	Matched           bool                     `json:"matched"`
	Trace             []WorkflowExecutionTrace `json:"trace"`
	UncoveredBranches []string                 `json:"uncoveredBranches"`
}

func executeCompiledWorkflow(
	ctx context.Context,
	tx pgx.Tx,
	compiled compiledScriptDefinition,
	sourceNodeKey, sourceDocumentID string,
	source any,
	actions WorkflowActions,
	requestID string,
	targetNodeKey string,
) (WorkflowExecutionResult, error) {
	result := WorkflowExecutionResult{Trace: []WorkflowExecutionTrace{}, UncoveredBranches: []string{}}
	if actions == nil {
		return result, fmt.Errorf("workflow actions are required")
	}
	sourceValue, err := workflowStarlarkValue(source)
	if err != nil {
		return result, fmt.Errorf("freeze workflow source: %w", err)
	}
	thread := &starlark.Thread{Name: "wfl-execution"}
	thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
	if sourceNodeKey == compiled.RootKey && compiled.when != nil {
		matched, matchErr := callWorkflowCondition(thread, compiled.when, sourceValue)
		if matchErr != nil {
			return result, matchErr
		}
		if !matched {
			return result, nil
		}
	}
	for _, edge := range compiled.Edges {
		if edge.SourceKey != sourceNodeKey || targetNodeKey != "" && edge.TargetKey != targetNodeKey {
			continue
		}
		matched := true
		if edge.when != nil {
			matched, err = callWorkflowCondition(thread, edge.when, sourceValue)
			if err != nil {
				return result, err
			}
		}
		if !matched {
			result.UncoveredBranches = append(result.UncoveredBranches, edge.TargetKey)
			continue
		}
		initialValue := edge.initial
		if initialFunction, ok := initialValue.(starlark.Callable); ok {
			initialValue, err = starlark.Call(thread, initialFunction, starlark.Tuple{sourceValue}, nil)
			if err != nil {
				return result, fmt.Errorf("evaluate %s initial values: %w", edge.ActionName, err)
			}
		}
		businessObject, err := executeTypedAction(ctx, tx, actions, edge.ActionName, sourceDocumentID, requestID, initialValue)
		if err != nil {
			return result, err
		}
		result.Matched = true
		result.Trace = append(result.Trace, WorkflowExecutionTrace{
			SourceNodeKey: edge.SourceKey, TargetNodeKey: edge.TargetKey,
			Relation: edge.Relation, Action: edge.ActionName, Result: businessObject,
		})
	}
	if targetNodeKey != "" && len(result.Trace) == 0 {
		return result, conflict("workflow target is not currently available", map[string]any{"targetNodeKey": targetNodeKey})
	}
	return result, nil
}

func callWorkflowCondition(thread *starlark.Thread, function starlark.Callable, source starlark.Value) (bool, error) {
	value, err := starlark.Call(thread, function, starlark.Tuple{source}, nil)
	if err != nil {
		return false, fmt.Errorf("evaluate workflow condition: %w", err)
	}
	matched, ok := value.(starlark.Bool)
	if !ok {
		return false, fmt.Errorf("workflow condition must return bool")
	}
	return bool(matched), nil
}

func executeTypedAction(ctx context.Context, tx pgx.Tx, actions WorkflowActions, actionName, sourceDocumentID, requestID string, initial starlark.Value) (BusinessObjectReference, error) {
	switch actionName {
	case ActionExpensePayment:
		var input ExpensePaymentInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreateExpensePayment(ctx, tx, WorkflowActionInput[ExpensePaymentInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	case ActionPurchaseInbound:
		var input PurchaseInboundInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreatePurchaseInbound(ctx, tx, WorkflowActionInput[PurchaseInboundInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	case ActionSaleOutbound:
		var input SaleOutboundInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreateSaleOutbound(ctx, tx, WorkflowActionInput[SaleOutboundInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	case ActionSaleDelivery:
		var input SaleDeliveryInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreateSaleDelivery(ctx, tx, WorkflowActionInput[SaleDeliveryInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	case ActionSaleSignoff:
		var input SaleSignoffInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreateSaleSignoff(ctx, tx, WorkflowActionInput[SaleSignoffInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	case ActionSaleReturn:
		var input SaleReturnInitial
		if err := decodeWorkflowInitial(initial, &input); err != nil {
			return BusinessObjectReference{}, err
		}
		return actions.CreateSaleReturn(ctx, tx, WorkflowActionInput[SaleReturnInitial]{SourceDocumentID: sourceDocumentID, RequestID: requestID, Initial: input})
	default:
		return BusinessObjectReference{}, fmt.Errorf("unsupported compiled workflow action")
	}
}

func decodeWorkflowInitial(value starlark.Value, target any) error {
	if value == nil || value == starlark.None {
		value = starlark.NewDict(0)
	}
	plain, err := workflowPlainValue(value)
	if err != nil {
		return fmt.Errorf("invalid workflow action initial values: %w", err)
	}
	encoded, err := json.Marshal(plain)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(encoded, target); err != nil {
		return fmt.Errorf("invalid workflow action initial values: %w", err)
	}
	return nil
}

func workflowStarlarkValue(source any) (starlark.Value, error) {
	encoded, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}
	var plain any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err = decoder.Decode(&plain); err != nil {
		return nil, err
	}
	value, err := workflowValueFromPlain(plain)
	if err == nil {
		value.Freeze()
	}
	return value, err
}

func workflowValueFromPlain(value any) (starlark.Value, error) {
	switch typed := value.(type) {
	case nil:
		return starlark.None, nil
	case bool:
		return starlark.Bool(typed), nil
	case string:
		return starlark.String(typed), nil
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return starlark.MakeInt64(integer), nil
		}
		decimal, err := typed.Float64()
		return starlark.Float(decimal), err
	case []any:
		items := make([]starlark.Value, 0, len(typed))
		for _, item := range typed {
			converted, err := workflowValueFromPlain(item)
			if err != nil {
				return nil, err
			}
			items = append(items, converted)
		}
		return starlark.NewList(items), nil
	case map[string]any:
		result := starlark.NewDict(len(typed))
		for key, item := range typed {
			converted, err := workflowValueFromPlain(item)
			if err != nil {
				return nil, err
			}
			if err = result.SetKey(starlark.String(key), converted); err != nil {
				return nil, err
			}
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported workflow value %T", value)
	}
}

func workflowPlainValue(value starlark.Value) (any, error) {
	switch typed := value.(type) {
	case starlark.NoneType:
		return nil, nil
	case starlark.Bool:
		return bool(typed), nil
	case starlark.String:
		return string(typed), nil
	case starlark.Int:
		integer := typed.BigInt()
		if !integer.IsInt64() {
			return nil, fmt.Errorf("integer is out of range")
		}
		return integer.Int64(), nil
	case starlark.Float:
		return float64(typed), nil
	case *starlark.List:
		items := make([]any, 0, typed.Len())
		for index := 0; index < typed.Len(); index++ {
			item, err := workflowPlainValue(typed.Index(index))
			if err != nil {
				return nil, err
			}
			items = append(items, item)
		}
		return items, nil
	case *starlark.Dict:
		result := make(map[string]any, typed.Len())
		for _, item := range typed.Items() {
			key, ok := starlark.AsString(item[0])
			if !ok {
				return nil, fmt.Errorf("object key must be a string")
			}
			converted, err := workflowPlainValue(item[1])
			if err != nil {
				return nil, err
			}
			result[key] = converted
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported Starlark value %s", value.Type())
	}
}
