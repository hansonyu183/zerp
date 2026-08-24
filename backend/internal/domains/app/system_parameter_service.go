package app

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

var (
	systemParameterKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`)
	decimalValuePattern       = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$`)
)

func (s *Service) QuerySystemParameters(ctx context.Context, request PageRequest) (Page[SystemParameterView], error) {
	spec, err := validateFixedPage(request, "key", "asc")
	if err != nil {
		return Page[SystemParameterView]{}, err
	}
	if err = validateFilterKeys(request.Filters, "search", "valueType", "editable"); err != nil {
		return Page[SystemParameterView]{}, err
	}
	search, err := optionalSearch(request.Filters["search"])
	if err != nil {
		return Page[SystemParameterView]{}, err
	}
	valueType, err := optionalSystemParameterType(request.Filters["valueType"])
	if err != nil {
		return Page[SystemParameterView]{}, err
	}
	editable, err := optionalBool(request.Filters["editable"])
	if err != nil {
		return Page[SystemParameterView]{}, err
	}
	total, err := s.queries.CountAppSystemParameters(ctx, dbsqlc.CountAppSystemParametersParams{
		ValueType: valueType, Editable: editable, Search: search,
	})
	if err != nil {
		return Page[SystemParameterView]{}, s.internal("count system parameters", err)
	}
	rows, err := s.queries.ListAppSystemParameters(ctx, dbsqlc.ListAppSystemParametersParams{
		ValueType: valueType, Editable: editable, Search: search,
		PageOffset: spec.Offset, PageSize: int32(spec.PageSize),
	})
	if err != nil {
		return Page[SystemParameterView]{}, s.internal("list system parameters", err)
	}
	items := make([]SystemParameterView, 0, len(rows))
	for _, row := range rows {
		view, viewErr := systemParameterView(row)
		if viewErr != nil {
			return Page[SystemParameterView]{}, s.internal("map registered system parameter", viewErr)
		}
		items = append(items, view)
	}
	return Page[SystemParameterView]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetSystemParameter(ctx context.Context, key string) (SystemParameterView, error) {
	if !validSystemParameterKey(key) {
		return SystemParameterView{}, domainError(ErrorValidation, "invalid system parameter key", nil)
	}
	parameter, err := s.queries.GetAppSystemParameter(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return SystemParameterView{}, domainError(ErrorNotFound, "system parameter not found", nil)
	}
	if err != nil {
		return SystemParameterView{}, s.internal("get system parameter", err)
	}
	view, err := systemParameterView(parameter)
	if err != nil {
		return SystemParameterView{}, s.internal("map registered system parameter", err)
	}
	return view, nil
}

func (s *Service) SaveSystemParameter(ctx context.Context, input SaveSystemParameterInput, actorID, requestID string) (SystemParameterView, error) {
	if !validSystemParameterKey(input.Key) || input.Revision < 1 {
		return SystemParameterView{}, domainError(ErrorValidation, "invalid system parameter request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SystemParameterView{}, s.internal("begin save system parameter", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	parameter, err := qtx.GetAppSystemParameterForUpdate(ctx, input.Key)
	if errors.Is(err, pgx.ErrNoRows) {
		return SystemParameterView{}, domainError(ErrorNotFound, "system parameter not found", nil)
	}
	if err != nil {
		return SystemParameterView{}, s.internal("lock system parameter", err)
	}
	if !parameter.Editable {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter is managed by its owning service", nil)
	}
	if parameter.Revision != input.Revision {
		return SystemParameterView{}, domainError(ErrorConflict, "system parameter revision conflict", nil)
	}
	constraints, err := decodeSystemParameterConstraints(parameter.Constraints)
	if err != nil || constraints == nil {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter does not have registered editing constraints", err)
	}
	if err = validateSystemParameterDefinition(parameter.ValueType, parameter.ConfiguredValue, parameter.DefaultValue, parameter.Editable, constraints); err != nil {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter registration is inconsistent", err)
	}
	value, err := validateSystemParameterValue(parameter.ValueType, input.ConfiguredValue, constraints)
	if err != nil {
		return SystemParameterView{}, err
	}
	if value == parameter.ConfiguredValue {
		view, viewErr := systemParameterView(parameter)
		return view, viewErr
	}
	updated, err := qtx.UpdateAppSystemParameterValue(ctx, dbsqlc.UpdateAppSystemParameterValueParams{
		ParameterKey: input.Key, ConfiguredValue: value, Revision: input.Revision,
	})
	if err != nil {
		return SystemParameterView{}, s.systemParameterWriteError("save system parameter", err)
	}
	if err = s.audit(ctx, qtx, "SYSTEM_PARAMETER_SAVE", &actorID, "system-parameter", &input.Key, "SUCCESS", requestID, map[string]any{
		"key": input.Key, "valueType": parameter.ValueType, "revision": updated.Revision,
	}); err != nil {
		return SystemParameterView{}, s.internal("audit save system parameter", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SystemParameterView{}, s.internal("commit save system parameter", err)
	}
	view, err := systemParameterView(updated)
	if err != nil {
		return SystemParameterView{}, s.internal("map saved system parameter", err)
	}
	return view, nil
}

func (s *Service) ResetSystemParameter(ctx context.Context, input ResetSystemParameterInput, actorID, requestID string) (SystemParameterView, error) {
	if !validSystemParameterKey(input.Key) || input.Revision < 1 {
		return SystemParameterView{}, domainError(ErrorValidation, "invalid system parameter request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SystemParameterView{}, s.internal("begin reset system parameter", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	parameter, err := qtx.GetAppSystemParameterForUpdate(ctx, input.Key)
	if errors.Is(err, pgx.ErrNoRows) {
		return SystemParameterView{}, domainError(ErrorNotFound, "system parameter not found", nil)
	}
	if err != nil {
		return SystemParameterView{}, s.internal("lock system parameter", err)
	}
	if !parameter.Editable {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter is managed by its owning service", nil)
	}
	if parameter.Revision != input.Revision {
		return SystemParameterView{}, domainError(ErrorConflict, "system parameter revision conflict", nil)
	}
	constraints, err := decodeSystemParameterConstraints(parameter.Constraints)
	if err != nil || constraints == nil {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter does not have registered editing constraints", err)
	}
	if err = validateSystemParameterDefinition(parameter.ValueType, parameter.ConfiguredValue, parameter.DefaultValue, parameter.Editable, constraints); err != nil {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter registration is inconsistent", err)
	}
	if parameter.ConfiguredValue == parameter.DefaultValue {
		view, viewErr := systemParameterView(parameter)
		return view, viewErr
	}
	updated, err := qtx.ResetAppSystemParameterValue(ctx, dbsqlc.ResetAppSystemParameterValueParams{
		ParameterKey: input.Key, Revision: input.Revision,
	})
	if err != nil {
		return SystemParameterView{}, s.systemParameterWriteError("reset system parameter", err)
	}
	if err = s.audit(ctx, qtx, "SYSTEM_PARAMETER_RESET", &actorID, "system-parameter", &input.Key, "SUCCESS", requestID, map[string]any{
		"key": input.Key, "valueType": parameter.ValueType, "revision": updated.Revision,
	}); err != nil {
		return SystemParameterView{}, s.internal("audit reset system parameter", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SystemParameterView{}, s.internal("commit reset system parameter", err)
	}
	view, err := systemParameterView(updated)
	if err != nil {
		return SystemParameterView{}, s.internal("map reset system parameter", err)
	}
	return view, nil
}

func (s *Service) systemParameterWriteError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "system parameter changed concurrently", nil)
	}
	return s.writeError(operation, err)
}

func validSystemParameterKey(key string) bool {
	return len(key) <= 128 && systemParameterKeyPattern.MatchString(key)
}

func optionalSystemParameterType(value string) (*string, error) {
	if value == "" {
		return nil, nil
	}
	if _, err := normalizeSystemParameterValue(value, defaultValueForType(value)); err != nil {
		return nil, domainError(ErrorValidation, "invalid system parameter value type", nil)
	}
	return &value, nil
}

func optionalBool(value string) (*bool, error) {
	if value == "" {
		return nil, nil
	}
	if value != "true" && value != "false" {
		return nil, domainError(ErrorValidation, "invalid boolean filter", nil)
	}
	parsed := value == "true"
	return &parsed, nil
}

func defaultValueForType(valueType string) string {
	switch valueType {
	case SystemParameterString:
		return ""
	case SystemParameterInteger, SystemParameterDecimal:
		return "0"
	case SystemParameterBoolean:
		return "false"
	default:
		return ""
	}
}

func normalizeSystemParameterValue(valueType, value string) (string, error) {
	value = strings.TrimSpace(value)
	switch valueType {
	case SystemParameterString:
		if utf8.RuneCountInString(value) > 4000 {
			return "", domainError(ErrorValidation, "string system parameter is too long", nil)
		}
		return value, nil
	case SystemParameterInteger:
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return "", domainError(ErrorValidation, "system parameter must be an integer", nil)
		}
		return strconv.FormatInt(parsed, 10), nil
	case SystemParameterDecimal:
		if len(value) > 128 || !decimalValuePattern.MatchString(value) {
			return "", domainError(ErrorValidation, "system parameter must be a decimal", nil)
		}
		return value, nil
	case SystemParameterBoolean:
		if value != "true" && value != "false" {
			return "", domainError(ErrorValidation, "system parameter must be true or false", nil)
		}
		return value, nil
	default:
		return "", domainError(ErrorValidation, "unsupported system parameter value type", nil)
	}
}

func validateSystemParameterDefinition(valueType, configuredValue, defaultValue string, editable bool, constraints *SystemParameterConstraints) error {
	if editable && constraints == nil {
		return domainError(ErrorValidation, "editable system parameter requires registered constraints", nil)
	}
	if constraints != nil {
		if constraints.MinLength != nil && constraints.MaxLength != nil && *constraints.MinLength > *constraints.MaxLength {
			return domainError(ErrorValidation, "invalid system parameter length constraints", nil)
		}
		if constraints.Minimum != nil && constraints.Maximum != nil {
			minimum, minimumOK := new(big.Rat).SetString(*constraints.Minimum)
			maximum, maximumOK := new(big.Rat).SetString(*constraints.Maximum)
			if !minimumOK || !maximumOK || minimum.Cmp(maximum) > 0 {
				return domainError(ErrorValidation, "invalid system parameter numeric constraints", nil)
			}
		}
		for _, allowed := range constraints.AllowedValues {
			if _, err := validateSystemParameterValueWithoutAllowed(valueType, allowed, constraints); err != nil {
				return err
			}
		}
	}
	if _, err := validateSystemParameterValue(valueType, configuredValue, constraints); err != nil {
		return err
	}
	if _, err := validateSystemParameterValue(valueType, defaultValue, constraints); err != nil {
		return err
	}
	return nil
}

func validateSystemParameterValue(valueType, value string, constraints *SystemParameterConstraints) (string, error) {
	normalized, err := validateSystemParameterValueWithoutAllowed(valueType, value, constraints)
	if err != nil || constraints == nil || len(constraints.AllowedValues) == 0 {
		return normalized, err
	}
	for _, allowed := range constraints.AllowedValues {
		candidate, candidateErr := normalizeSystemParameterValue(valueType, allowed)
		if candidateErr == nil && candidate == normalized {
			return normalized, nil
		}
	}
	return "", domainError(ErrorValidation, "system parameter value is not allowed", nil)
}

func validateSystemParameterValueWithoutAllowed(valueType, value string, constraints *SystemParameterConstraints) (string, error) {
	normalized, err := normalizeSystemParameterValue(valueType, value)
	if err != nil || constraints == nil {
		return normalized, err
	}
	if constraints.Required && normalized == "" {
		return "", domainError(ErrorValidation, "system parameter value is required", nil)
	}
	length := int32(utf8.RuneCountInString(normalized))
	if constraints.MinLength != nil && length < *constraints.MinLength {
		return "", domainError(ErrorValidation, "system parameter value is too short", nil)
	}
	if constraints.MaxLength != nil && length > *constraints.MaxLength {
		return "", domainError(ErrorValidation, "system parameter value is too long", nil)
	}
	if constraints.Minimum != nil || constraints.Maximum != nil {
		number, ok := new(big.Rat).SetString(normalized)
		if !ok {
			return "", domainError(ErrorValidation, "system parameter numeric constraint requires a numeric value", nil)
		}
		if constraints.Minimum != nil {
			minimum, minimumOK := new(big.Rat).SetString(*constraints.Minimum)
			if !minimumOK || number.Cmp(minimum) < 0 {
				return "", domainError(ErrorValidation, "system parameter value is below the minimum", nil)
			}
		}
		if constraints.Maximum != nil {
			maximum, maximumOK := new(big.Rat).SetString(*constraints.Maximum)
			if !maximumOK || number.Cmp(maximum) > 0 {
				return "", domainError(ErrorValidation, "system parameter value is above the maximum", nil)
			}
		}
	}
	return normalized, nil
}

func decodeSystemParameterConstraints(raw []byte) (*SystemParameterConstraints, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var constraints SystemParameterConstraints
	if err := json.Unmarshal(raw, &constraints); err != nil {
		return nil, err
	}
	if constraints.AllowedValues == nil {
		constraints.AllowedValues = []string{}
	}
	return &constraints, nil
}

func systemParameterView(parameter dbsqlc.AppSystemParameter) (SystemParameterView, error) {
	constraints, err := decodeSystemParameterConstraints(parameter.Constraints)
	if err != nil {
		return SystemParameterView{}, err
	}
	if err = validateSystemParameterDefinition(parameter.ValueType, parameter.ConfiguredValue, parameter.DefaultValue, parameter.Editable, constraints); err != nil {
		return SystemParameterView{}, err
	}
	return SystemParameterView{
		Key: parameter.ParameterKey, Name: parameter.Name, Description: parameter.Description,
		ValueType: parameter.ValueType, ConfiguredValue: parameter.ConfiguredValue, DefaultValue: parameter.DefaultValue,
		Editable: parameter.Editable && constraints != nil, Constraints: constraints,
		Revision: parameter.Revision,
	}, nil
}
