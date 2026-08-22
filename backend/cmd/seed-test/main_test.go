package main

import "testing"

func TestIsManagedTestDatabase(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, database, user, databaseURL string
		want                              bool
	}{
		{name: "E2E", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e?sslmode=disable", want: true},
		{name: "postgresql scheme", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgresql://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e?sslmode=disable", want: true},
		{name: "development", database: "zerp", user: "zerp", databaseURL: "postgres://zerp:secret@127.0.0.1:5432/zerp", want: false},
		{name: "test", database: "zerp_test", user: "zerp", databaseURL: "postgres://zerp:secret@127.0.0.1:55434/zerp_test", want: false},
		{name: "wrong connected user", database: "zerp_e2e", user: "zerp", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "wrong configured user", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "wrong host", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@192.168.0.10:55435/zerp_e2e", want: false},
		{name: "localhost is not exact", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@localhost:55435/zerp_e2e", want: false},
		{name: "wrong port", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:5432/zerp_e2e", want: false},
		{name: "missing port", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1/zerp_e2e", want: false},
		{name: "lookalike connected database", database: "zerp_e2e_backup", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e", want: false},
		{name: "lookalike configured database", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "postgres://zerp_e2e:secret@127.0.0.1:55435/zerp_e2e_backup", want: false},
		{name: "invalid URL", database: "zerp_e2e", user: "zerp_e2e", databaseURL: "://", want: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isManagedTestDatabase(test.database, test.user, test.databaseURL); got != test.want {
				t.Fatalf("isManagedTestDatabase(%q, %q, databaseURL) = %t, want %t", test.database, test.user, got, test.want)
			}
		})
	}
}
