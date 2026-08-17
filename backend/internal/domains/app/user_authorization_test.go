package app

import (
	"context"
	"testing"
)

func TestCurrentUserCanMaintainProfileWithoutEditingRoleAssignment(t *testing.T) {
	actor := actorAuthorization{id: "01JSELF0000000000000000000", paths: map[string]bool{
		"/app/user/save":  true,
		"/app/role/query": true,
	}}
	user := UserView{ID: actor.id}
	manageable, err := (&Service{}).userManageable(context.Background(), nil, user, actor)
	if err != nil {
		t.Fatalf("self manageability: %v", err)
	}
	if !manageable {
		t.Fatal("current user must remain able to maintain ordinary profile fields")
	}
	if roleAssignmentEditable(user.ID, manageable, actor) {
		t.Fatal("current user's role assignment must remain read-only")
	}
}

func TestFiniteCeilingCannotManageSuperadminTarget(t *testing.T) {
	finite := actorAuthorization{permissionIDs: map[string]bool{"PERMISSION-A": true}}
	if targetWithinActorCeiling([]string{"PERMISSION-A"}, true, finite) {
		t.Fatal("a finite actor must not be treated as a superadmin delegate")
	}
	actualSuperadmin := actorAuthorization{superadmin: true}
	if !targetWithinActorCeiling([]string{"PERMISSION-A"}, true, actualSuperadmin) {
		t.Fatal("an enabled superadmin actor must be able to manage a superadmin target")
	}
}
