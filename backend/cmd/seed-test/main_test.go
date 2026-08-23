package main

import "testing"

func TestCanSeedTarget(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, target, environment string
		allowDevelopment          bool
		want                      bool
	}{
		{name: "isolated test", target: seedTargetTest, environment: "test", want: true},
		{name: "test target rejects production", target: seedTargetTest, environment: "production", want: false},
		{name: "hosted development rejects production runtime", target: seedTargetDevelopment, environment: "production", allowDevelopment: true, want: false},
		{name: "native development explicit", target: seedTargetDevelopment, environment: "development", allowDevelopment: true, want: true},
		{name: "development requires switch", target: seedTargetDevelopment, environment: "production", want: false},
		{name: "unknown target", target: "other", environment: "test", allowDevelopment: true, want: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := canSeedTarget(test.target, test.environment, test.allowDevelopment); got != test.want {
				t.Fatalf("canSeedTarget(%q, %q, %t) = %t, want %t", test.target, test.environment, test.allowDevelopment, got, test.want)
			}
		})
	}
}

func TestIsManagedSeedDatabase(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, target, database, user, databaseURL string
		want                                      bool
	}{
		{name: "E2E", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e?sslmode=disable", want: true},
		{name: "postgresql scheme", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgresql://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e?sslmode=disable", want: true},
		{name: "hosted development", target: seedTargetDevelopment, database: "zerp", user: "zerp", databaseURL: "postgres://zerp:secret@localhost:55432/zerp?sslmode=disable", want: true},
		{name: "development wrong host", target: seedTargetDevelopment, database: "zerp", user: "zerp", databaseURL: "postgres://zerp:secret@127.0.0.1:55432/zerp", want: false},
		{name: "development wrong port", target: seedTargetDevelopment, database: "zerp", user: "zerp", databaseURL: "postgres://zerp:secret@localhost:5432/zerp", want: false},
		{name: "test", target: seedTargetTest, database: "zerp_test", user: "zerp", databaseURL: "postgres://zerp:secret@127.0.0.1:55434/zerp_test", want: false},
		{name: "wrong connected user", target: seedTargetTest, database: "zerp_e2e", user: "zerp", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "wrong configured user", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "wrong host", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@192.168.0.10:55435/zerp_e2e", want: false},
		{name: "localhost is not exact", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@localhost:55435/zerp_e2e", want: false},
		{name: "wrong port", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:5432/zerp_e2e", want: false},
		{name: "missing port", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1/zerp_e2e", want: false},
		{name: "lookalike connected database", target: seedTargetTest, database: "zerp_e2e_backup", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "lookalike configured database", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e_backup", want: false},
		{name: "invalid URL", target: seedTargetTest, database: "zerp_e2e", user: "zerp_e2e", databaseURL: "://", want: false},
		{name: "unknown target", target: "other", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e", want: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isManagedSeedDatabase(test.target, test.database, test.user, test.databaseURL); got != test.want {
				t.Fatalf("isManagedSeedDatabase(%q, %q, %q, databaseURL) = %t, want %t", test.target, test.database, test.user, got, test.want)
			}
		})
	}
}
