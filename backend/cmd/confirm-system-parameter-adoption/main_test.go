package main

import "testing"

func TestParseOptionsRequiresExactRuntimeInventoryAndReports(t *testing.T) {
	parsed, err := parseOptions([]string{
		"--key", "app.worker.limit",
		"--revision", "7",
		"--scope", "production",
		"--expected-instances", "api-1,api-2",
		"--reports", "api-1:7,api-2:7",
	})
	if err != nil {
		t.Fatalf("parse valid options: %v", err)
	}
	if parsed.input.Key != "app.worker.limit" || parsed.input.Revision != 7 ||
		len(parsed.input.ExpectedInstanceIDs) != 2 || len(parsed.input.Reports) != 2 {
		t.Fatalf("parsed options = %+v", parsed.input)
	}
	for _, arguments := range [][]string{
		{"--key", "app.worker.limit", "--revision", "7"},
		{"--key", "app.worker.limit", "--revision", "7", "--scope", "production", "--expected-instances", "api-1", "--reports", "api-1:not-a-revision"},
		{"--key", "app.worker.limit", "--revision", "7", "--scope", "production", "--expected-instances", "api-1", "--reports", "api-1:7", "extra"},
	} {
		if _, err = parseOptions(arguments); err == nil {
			t.Fatalf("invalid options accepted: %v", arguments)
		}
	}
}
