package rpt

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	pgquery "github.com/wasilibs/go-pgquery"
)

var placeholderPattern = regexp.MustCompile(`\$([1-9][0-9]*)`)

func validateReadOnlySQL(sql string) error {
	parsed, err := pgquery.ParseToJSON(strings.TrimSpace(sql))
	if err != nil {
		return validation("report SQL is invalid", nil)
	}
	var tree struct {
		Stmts []struct {
			Stmt map[string]json.RawMessage `json:"stmt"`
		} `json:"stmts"`
	}
	if err = json.Unmarshal([]byte(parsed), &tree); err != nil || len(tree.Stmts) != 1 {
		return validation("report SQL must contain one statement", nil)
	}
	stmt := tree.Stmts[0].Stmt
	raw, ok := stmt["SelectStmt"]
	if !ok || len(stmt) != 1 {
		return validation("report SQL must be a SELECT", nil)
	}
	text := string(raw)
	for _, forbidden := range []string{`"InsertStmt"`, `"UpdateStmt"`, `"DeleteStmt"`, `"MergeStmt"`, `"Create`, `"Alter`, `"Drop`, `"CopyStmt"`, `"LockStmt"`, `"IntoClause"`, `"nextval"`, `"setval"`, `"pg_advisory`} {
		if strings.Contains(strings.ToLower(text), strings.ToLower(forbidden)) {
			return validation("report SQL is not read-only", nil)
		}
	}
	return nil
}

func validateVersionData(data VersionData) error {
	if err := validateReadOnlySQL(data.SQL); err != nil {
		return err
	}
	keys := map[string]bool{}
	for _, parameter := range data.Parameters {
		if keys[parameter.Key] {
			return validation("report parameter keys must be unique", nil)
		}
		keys[parameter.Key] = true
		if parameter.Type == ParameterTypeEnum && (parameter.EnumValues == nil || len(*parameter.EnumValues) == 0) {
			return validation("ENUM parameter requires values", map[string]any{"key": parameter.Key})
		}
		if parameter.Type == ParameterTypeReference && parameter.ReferenceType == nil {
			return validation("REFERENCE parameter requires reference type", map[string]any{"key": parameter.Key})
		}
		if parameter.Type != ParameterTypeEnum && parameter.EnumValues != nil {
			return validation("enum values only apply to ENUM", map[string]any{"key": parameter.Key})
		}
		if parameter.Type != ParameterTypeReference && parameter.ReferenceType != nil {
			return validation("reference type only applies to REFERENCE", map[string]any{"key": parameter.Key})
		}
	}
	wanted := make([]int, len(data.Parameters))
	for index := range wanted {
		wanted[index] = index + 1
	}
	found := []int{}
	for _, match := range placeholderPattern.FindAllStringSubmatch(data.SQL, -1) {
		var value int
		_, _ = fmt.Sscanf(match[1], "%d", &value)
		found = append(found, value)
	}
	sort.Ints(found)
	found = compactInts(found)
	if fmt.Sprint(found) != fmt.Sprint(wanted) {
		return validation("report SQL placeholders do not match parameters", nil)
	}
	aliases, orders := map[string]bool{}, map[int]bool{}
	for _, column := range data.Columns {
		if aliases[column.Alias] || orders[column.Order] {
			return validation("report result columns must be unique", nil)
		}
		aliases[column.Alias], orders[column.Order] = true, true
	}
	return nil
}

func validateBuiltInParameterValues(code string, values map[string]any) error {
	if code != "customer-aging" && code != "supplier-aging" {
		return nil
	}
	value, exists := values["minAgeDays"]
	if !exists || value == nil {
		return nil
	}
	number, ok := value.(float64)
	if ok && number < 0 {
		return validation("最小账龄天数不能小于 0。", map[string]any{"key": "minAgeDays"})
	}
	return nil
}

func compactInts(values []int) []int {
	result := []int{}
	for _, value := range values {
		if len(result) == 0 || result[len(result)-1] != value {
			result = append(result, value)
		}
	}
	return result
}
