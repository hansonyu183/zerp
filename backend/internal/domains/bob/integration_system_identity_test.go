//go:build integration

package bob

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

func TestSystemIdentityMayApproveAutomaticBOBSeedIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	created, err := service.Create(t.Context(), EntityEmployee, CreateInput{Data: CreateDetailInput{
		Code: "SYSAUTO" + newID(), Name: "System Generated Employee",
	}}, systemidentity.UserID, "system-bob-create")
	if err != nil {
		t.Fatalf("create automatic BOB object: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityEmployee, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, systemidentity.UserID, "system-bob-submit")
	if err != nil {
		t.Fatalf("submit automatic BOB object: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityEmployee, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, systemidentity.UserID, "system-bob-approve")
	if err != nil || approved.Status != StatusEffective {
		t.Fatalf("approve automatic BOB object: result=%+v err=%v", approved, err)
	}

	humanCreated, err := service.Create(t.Context(), EntityEmployee, CreateInput{Data: CreateDetailInput{
		Code: "HUMAN" + newID(), Name: "Human Employee",
	}}, integrationActorOne, "human-bob-create")
	if err != nil {
		t.Fatalf("create human BOB object: %v", err)
	}
	humanSubmitted, err := service.Submit(t.Context(), EntityEmployee, VersionRevisionInput{
		ObjectID: humanCreated.ObjectID, VersionID: humanCreated.VersionID, Revision: humanCreated.Revision,
	}, integrationActorOne, "human-bob-submit")
	if err != nil {
		t.Fatalf("submit human BOB object: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityEmployee, ReviewInput{
		ObjectID: humanSubmitted.ObjectID, VersionID: humanSubmitted.VersionID, Revision: humanSubmitted.Revision,
	}, integrationActorOne, "human-bob-self-approve"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("human self approval error = %v", err)
	}
}
