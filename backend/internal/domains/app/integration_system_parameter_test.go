//go:build integration

package app

import (
	"strings"
	"testing"
)

func TestSystemParameterManagementIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	_, err := pool.Exec(t.Context(), `
		INSERT INTO app_system_parameters (
			parameter_key, name, value_type, current_value, default_value,
			editable, created_by, updated_by
		) VALUES
			('test.string', '字符串', 'STRING', 'current', 'default', true, $1, $1),
			('test.integer', '整数', 'INTEGER', '1', '10', true, $1, $1),
			('test.decimal', '小数', 'DECIMAL', '1.25', '0.00', true, $1, $1),
			('test.boolean', '布尔', 'BOOLEAN', 'false', 'true', true, $1, $1)
	`, admin.ID)
	if err != nil {
		t.Fatalf("seed system parameters: %v", err)
	}

	page, err := service.QuerySystemParameters(t.Context(), PageRequest{
		Filters: map[string]string{"valueType": "INTEGER", "editable": "true"},
	})
	if err != nil || page.Total != 1 || page.Items[0].Key != "test.integer" {
		t.Fatalf("query system parameters = %+v, %v", page, err)
	}

	integer, err := service.GetSystemParameter(t.Context(), "test.integer")
	if err != nil {
		t.Fatalf("get integer: %v", err)
	}
	saved, err := service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: integer.Key, Value: "0020", Revision: integer.Revision,
	}, admin.ID, "save-system-parameter")
	if err != nil || saved.Value != "20" || saved.Revision != integer.Revision+1 {
		t.Fatalf("save integer = %+v, %v", saved, err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: integer.Key, Value: "21", Revision: integer.Revision,
	}, admin.ID, "stale-system-parameter"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale save error = %v", err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: "test.decimal", Value: "1e3", Revision: 1,
	}, admin.ID, "invalid-system-parameter"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid decimal error = %v", err)
	}
	reset, err := service.ResetSystemParameter(t.Context(), ResetSystemParameterInput{
		Key: saved.Key, Revision: saved.Revision,
	}, admin.ID, "reset-system-parameter")
	if err != nil || reset.Value != "10" {
		t.Fatalf("reset integer = %+v, %v", reset, err)
	}
	menuMode, err := service.GetSystemParameter(t.Context(), MenuModeParameterKey)
	if err != nil {
		t.Fatalf("get menu mode: %v", err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: menuMode.Key, Value: "BUSINESS_TEMPLATE", Revision: menuMode.Revision,
	}, admin.ID, "forbidden-menu-mode-save"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("menu mode save error = %v", err)
	}

	var summaries []string
	rows, err := pool.Query(t.Context(), `
		SELECT summary::text FROM app_audit_events
		WHERE event_type IN ('SYSTEM_PARAMETER_SAVE', 'SYSTEM_PARAMETER_RESET')
	`)
	if err != nil {
		t.Fatalf("query system parameter audit: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var summary string
		if err = rows.Scan(&summary); err != nil {
			t.Fatalf("scan audit summary: %v", err)
		}
		summaries = append(summaries, summary)
	}
	joined := strings.Join(summaries, " ")
	if strings.Contains(joined, "0020") || strings.Contains(joined, `"20"`) || strings.Contains(joined, `"10"`) {
		t.Fatalf("audit summary leaked parameter value: %s", joined)
	}
}
