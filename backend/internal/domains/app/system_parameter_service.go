package app

import (
	"context"
	"errors"
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
	spec, err := validatePage(request, map[string]bool{"key": true, "name": true, "updatedAt": true}, "key", "asc")
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
		SortField: spec.SortField, SortOrder: spec.SortOrder,
		PageOffset: spec.Offset, PageSize: int32(spec.PageSize),
	})
	if err != nil {
		return Page[SystemParameterView]{}, s.internal("list system parameters", err)
	}
	items := make([]SystemParameterView, 0, len(rows))
	for _, row := range rows {
		items = append(items, systemParameterView(row))
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
	return systemParameterView(parameter), nil
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
	if !parameter.Editable || parameter.ParameterKey == MenuModeParameterKey {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter is managed by its owning service", nil)
	}
	if parameter.Revision != input.Revision {
		return SystemParameterView{}, domainError(ErrorConflict, "system parameter revision conflict", nil)
	}
	value, err := normalizeSystemParameterValue(parameter.ValueType, input.Value)
	if err != nil {
		return SystemParameterView{}, err
	}
	if value == parameter.CurrentValue {
		return systemParameterView(parameter), nil
	}
	updated, err := qtx.UpdateAppSystemParameterValue(ctx, dbsqlc.UpdateAppSystemParameterValueParams{
		ParameterKey: input.Key, CurrentValue: value, Revision: input.Revision, ActorID: &actorID,
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
	return systemParameterView(updated), nil
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
	if !parameter.Editable || parameter.ParameterKey == MenuModeParameterKey {
		return SystemParameterView{}, domainError(ErrorForbidden, "system parameter is managed by its owning service", nil)
	}
	if parameter.Revision != input.Revision {
		return SystemParameterView{}, domainError(ErrorConflict, "system parameter revision conflict", nil)
	}
	if parameter.CurrentValue == parameter.DefaultValue {
		return systemParameterView(parameter), nil
	}
	updated, err := qtx.ResetAppSystemParameterValue(ctx, dbsqlc.ResetAppSystemParameterValueParams{
		ParameterKey: input.Key, Revision: input.Revision, ActorID: &actorID,
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
	return systemParameterView(updated), nil
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
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	value = strings.ToUpper(strings.TrimSpace(value))
	if _, err := normalizeSystemParameterValue(value, defaultValueForType(value)); err != nil {
		return nil, domainError(ErrorValidation, "invalid system parameter value type", nil)
	}
	return &value, nil
}

func optionalBool(value string) (*bool, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return nil, domainError(ErrorValidation, "invalid boolean filter", nil)
	}
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

func systemParameterView(parameter dbsqlc.AppSystemParameter) SystemParameterView {
	return SystemParameterView{
		Key: parameter.ParameterKey, Name: parameter.Name, Description: parameter.Description,
		ValueType: parameter.ValueType, Value: parameter.CurrentValue, DefaultValue: parameter.DefaultValue,
		Editable: parameter.Editable, Revision: parameter.Revision, UpdatedAt: parameter.UpdatedAt.Time,
		UpdatedBy: parameter.UpdatedBy,
	}
}
