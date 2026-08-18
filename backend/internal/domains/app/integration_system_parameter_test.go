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
			parameter_key, name, value_type, configured_value, default_value,
			safe_to_expose, editable, constraints, effect_mode, running_value, running_revision,
			restart_pending, created_by, updated_by
		) VALUES
			('test.string', '字符串', 'STRING', 'current', 'default', true, true,
			 '{"required":true,"minLength":1,"maxLength":20,"minimum":null,"maximum":null,"allowedValues":[]}',
			 'IMMEDIATE', 'current', 1, false, $1, $1),
			('test.integer', '整数', 'INTEGER', '1', '10', true, true,
			 '{"required":true,"minLength":null,"maxLength":null,"minimum":"0","maximum":"100","allowedValues":[]}',
			 'NEXT_REQUEST', '1', 1, false, $1, $1),
			('test.decimal', '小数', 'DECIMAL', '1.25', '0.00', true, true,
			 '{"required":true,"minLength":null,"maxLength":null,"minimum":"0","maximum":"100","allowedValues":[]}',
			 'RESTART_REQUIRED', '1.25', 1, false, $1, $1),
			('test.boolean', '布尔', 'BOOLEAN', 'false', 'true', true, true,
			 '{"required":true,"minLength":null,"maxLength":null,"minimum":null,"maximum":null,"allowedValues":["true","false"]}',
			 'IMMEDIATE', 'false', 1, false, $1, $1),
			('test.secret', '敏感项', 'STRING', 'hidden', 'hidden', false, true,
			 '{"required":true,"minLength":1,"maxLength":20,"minimum":null,"maximum":null,"allowedValues":[]}',
			 'IMMEDIATE', 'hidden', 1, false, $1, $1)
	`, admin.ID)
	if err != nil {
		t.Fatalf("seed system parameters: %v", err)
	}

	page, err := service.QuerySystemParameters(t.Context(), PageRequest{
		Page: 1, PageSize: 20, Sort: []SortItem{{Field: "key", Order: "asc"}},
		Filters: map[string]string{"valueType": "INTEGER", "editable": "true"},
	})
	if err != nil || page.Total != 1 || page.Items[0].Key != "test.integer" {
		t.Fatalf("query system parameters = %+v, %v", page, err)
	}
	if _, err = service.QuerySystemParameters(t.Context(), PageRequest{
		Page: 1, PageSize: 200, Sort: []SortItem{{Field: "key", Order: "asc"}},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("non-fixed system parameter page size error = %v", err)
	}
	if _, err = service.QuerySystemParameters(t.Context(), PageRequest{
		Page: 1, PageSize: 20, Sort: []SortItem{{Field: "key", Order: "asc"}},
		Filters: map[string]string{"valueType": "integer"},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("non-wire value type error = %v", err)
	}
	secretPage, err := service.QuerySystemParameters(t.Context(), PageRequest{
		Page: 1, PageSize: 20, Sort: []SortItem{{Field: "key", Order: "asc"}},
		Filters: map[string]string{"search": "test.secret"},
	})
	if err != nil || secretPage.Total != 0 || len(secretPage.Items) != 0 {
		t.Fatalf("sensitive parameter leaked from query = %+v, %v", secretPage, err)
	}
	if _, err = service.GetSystemParameter(t.Context(), "test.secret"); !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("sensitive parameter get error = %v, want not found", err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: "test.secret", ConfiguredValue: "leaked", Revision: 1,
	}, admin.ID, "save-sensitive-system-parameter"); !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("sensitive parameter save error = %v, want not found", err)
	}

	integer, err := service.GetSystemParameter(t.Context(), "test.integer")
	if err != nil {
		t.Fatalf("get integer: %v", err)
	}
	saved, err := service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: integer.Key, ConfiguredValue: "0020", Revision: integer.Revision,
	}, admin.ID, "save-system-parameter")
	if err != nil || saved.ConfiguredValue != "20" || saved.RunningValue == nil || *saved.RunningValue != "20" || saved.RestartPending || saved.Revision != integer.Revision+1 {
		t.Fatalf("save integer = %+v, %v", saved, err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: integer.Key, ConfiguredValue: "21", Revision: integer.Revision,
	}, admin.ID, "stale-system-parameter"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale save error = %v", err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: "test.decimal", ConfiguredValue: "1e3", Revision: 1,
	}, admin.ID, "invalid-system-parameter"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid decimal error = %v", err)
	}
	reset, err := service.ResetSystemParameter(t.Context(), ResetSystemParameterInput{
		Key: saved.Key, Revision: saved.Revision,
	}, admin.ID, "reset-system-parameter")
	if err != nil || reset.ConfiguredValue != "10" || reset.RunningValue == nil || *reset.RunningValue != "10" || reset.RestartPending {
		t.Fatalf("reset integer = %+v, %v", reset, err)
	}
	restartRequired, err := service.GetSystemParameter(t.Context(), "test.decimal")
	if err != nil {
		t.Fatalf("get restart-required parameter: %v", err)
	}
	restartSaved, err := service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: restartRequired.Key, ConfiguredValue: "2.50", Revision: restartRequired.Revision,
	}, admin.ID, "save-restart-required-system-parameter")
	if err != nil || restartSaved.ConfiguredValue != "2.50" || restartSaved.RunningValue == nil || *restartSaved.RunningValue != "1.25" || !restartSaved.RestartPending {
		t.Fatalf("save restart-required parameter = %+v, %v", restartSaved, err)
	}
	reverted, err := service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: restartSaved.Key, ConfiguredValue: "1.25", Revision: restartSaved.Revision,
	}, admin.ID, "revert-restart-required-system-parameter")
	if err != nil || reverted.RunningValue == nil || *reverted.RunningValue != "1.25" || !reverted.RestartPending {
		t.Fatalf("restart-required revert must remain pending = %+v, %v", reverted, err)
	}
	partialEvidence := ConfirmSystemParameterAdoptionInput{
		Key: reverted.Key, Revision: reverted.Revision, DeploymentScope: "integration",
		ExpectedInstanceIDs: []string{"api-1", "api-2"},
		Reports:             []RuntimeInstanceAdoption{{InstanceID: "api-1", Revision: reverted.Revision}},
	}
	if _, err = service.ConfirmSystemParameterAdoption(t.Context(), partialEvidence, admin.ID, "partial-adoption"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("partial adoption error = %v", err)
	}
	partialEvidence.Reports = append(partialEvidence.Reports, RuntimeInstanceAdoption{InstanceID: "api-2", Revision: reverted.Revision})
	adopted, err := service.ConfirmSystemParameterAdoption(t.Context(), partialEvidence, admin.ID, "complete-adoption")
	if err != nil || adopted.RunningValue == nil || *adopted.RunningValue != "1.25" || adopted.RestartPending {
		t.Fatalf("complete adoption = %+v, %v", adopted, err)
	}
	menuMode, err := service.GetSystemParameter(t.Context(), MenuModeParameterKey)
	if err != nil {
		t.Fatalf("get menu mode: %v", err)
	}
	if _, err = service.SaveSystemParameter(t.Context(), SaveSystemParameterInput{
		Key: menuMode.Key, ConfiguredValue: "BUSINESS_TEMPLATE", Revision: menuMode.Revision,
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
