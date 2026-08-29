//go:build integration

package dcl

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestPartyDeclarationQueryFiltersAndReturnsTypedSnapshotsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	service := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorization.Func(nil), txevent.NewBus())

	approved := insertDCLPartyReadSideFixture(t, pool, creatorID, reviewerID, "阿尔法主体", "PERSON", approval.StatusApproved, "")
	open := insertDCLPartyReadSideFixture(t, pool, creatorID, reviewerID, "贝塔候选", "ORGANIZATION", approval.StatusDraft, "")
	merged := insertDCLPartyReadSideFixture(t, pool, creatorID, reviewerID, "阿尔法已合并", "PERSON", approval.StatusApproved, approved.partyID)
	actor := dclActor(t, creatorID, "party-read-side-query")

	page, err := service.Query(t.Context(), bobdomain.QueryInput{Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{Keyword: "贝塔"}}, actor)
	if err != nil {
		t.Fatalf("keyword query: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].PartyID != open.partyID || page.Items[0].LatestApproved != nil || page.Items[0].OpenVersion == nil || page.Items[0].OpenVersion.Data.LegalName != "贝塔候选" {
		t.Fatalf("keyword snapshots = %#v", page.Items)
	}

	page, err = service.Query(t.Context(), bobdomain.QueryInput{Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{PartyKind: "person"}}, actor)
	if err != nil {
		t.Fatalf("kind query: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].PartyID != approved.partyID || page.Items[0].LatestApproved == nil || page.Items[0].OpenVersion != nil {
		t.Fatalf("unmerged person snapshots = %#v", page.Items)
	}

	mergedOnly := true
	page, err = service.Query(t.Context(), bobdomain.QueryInput{Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{Merged: &mergedOnly}}, actor)
	if err != nil {
		t.Fatalf("merged query: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].PartyID != merged.partyID || page.Items[0].LatestApproved == nil {
		t.Fatalf("merged snapshots = %#v", page.Items)
	}
}

type partyReadSideFixture struct{ partyID string }

func insertDCLPartyReadSideFixture(t *testing.T, pool *pgxpool.Pool, creatorID, reviewerID, name, kind string, status approval.Status, mergedInto string) partyReadSideFixture {
	t.Helper()
	partyID, entryID := ulid.Make().String(), ulid.Make().String()
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,created_by) VALUES($1,'party',$2)`, partyID, creatorID); err != nil {
		t.Fatalf("insert Party subject: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_parties(id,merged_into_party_id,merged_at) VALUES($1,NULLIF($2,''),CASE WHEN $2='' THEN NULL ELSE now() END)`, partyID, mergedInto); err != nil {
		t.Fatalf("insert party root: %v", err)
	}
	if status == approval.StatusApproved {
		if _, err := pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','party',$2,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, entryID, partyID, creatorID, reviewerID); err != nil {
			t.Fatalf("insert approved entry: %v", err)
		}
	} else if _, err := pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at) VALUES($1,'dcl','party',$2,1,'DRAFT',1,$3,now(),$3,now())`, entryID, partyID, creatorID); err != nil {
		t.Fatalf("insert draft entry: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_party_versions(approval_entry_id,party_id,kind,legal_name,display_name) VALUES($1,$2,$3,$4,$4)`, entryID, partyID, kind, name); err != nil {
		t.Fatalf("insert Party snapshot: %v", err)
	}
	return partyReadSideFixture{partyID: partyID}
}
