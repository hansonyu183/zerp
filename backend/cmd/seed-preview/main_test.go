package main

import "testing"

func TestIsManagedPreviewDatabase(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                 string
		database, user, host string
		port                 int
		want                 bool
	}{
		{name: "baseline", database: "zerp_preview", user: "zerp_preview", host: "127.0.0.1", port: 55436, want: true},
		{name: "pull request", database: "zerp_preview_pr_164", user: "zerp_preview", host: "127.0.0.1", port: 55436, want: true},
		{name: "development", database: "zerp", user: "zerp", host: "127.0.0.1", port: 5432, want: false},
		{name: "test", database: "zerp_test", user: "zerp", host: "127.0.0.1", port: 55434, want: false},
		{name: "wrong user", database: "zerp_preview", user: "zerp", host: "127.0.0.1", port: 55436, want: false},
		{name: "wrong host", database: "zerp_preview", user: "zerp_preview", host: "192.168.0.10", port: 55436, want: false},
		{name: "wrong port", database: "zerp_preview", user: "zerp_preview", host: "127.0.0.1", port: 5432, want: false},
		{name: "empty pull request", database: "zerp_preview_pr_", user: "zerp_preview", host: "127.0.0.1", port: 55436, want: false},
		{name: "non-numeric pull request", database: "zerp_preview_pr_demo", user: "zerp_preview", host: "127.0.0.1", port: 55436, want: false},
		{name: "lookalike", database: "zerp_preview_backup", user: "zerp_preview", host: "127.0.0.1", port: 55436, want: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isManagedPreviewDatabase(test.database, test.user, test.host, test.port); got != test.want {
				t.Fatalf("isManagedPreviewDatabase(%q, %q, %q, %d) = %t, want %t", test.database, test.user, test.host, test.port, got, test.want)
			}
		})
	}
}
