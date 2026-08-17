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
