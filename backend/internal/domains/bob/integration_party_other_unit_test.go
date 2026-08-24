//go:build integration

package bob

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestOtherUnitCreateAtomicallyCreatesOrReusesPartyIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := newIntegrationService(pool)
	_, operatingOne := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Party integration operating one",
	}, "party-operating-one")
	_, operatingTwo := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Party integration operating two",
	}, "party-operating-two")

	identifierValue := "91310000" + newID()[8:18]
	created, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{
			Kind:        PartyKindOrganization,
			LegalName:   "原子创建服务单位",
			DisplayName: "服务单位",
			StrongIdentifiers: []PartyIdentifierInput{{
				Type: PartyIdentifierUnifiedSocialCreditCode, Value: identifierValue,
			}},
		},
		Data: OtherUnitData{OperatingEntityID: operatingOne.ObjectID},
	}, integrationActorOne, "party-other-unit-create-1", true)
	if err != nil {
		t.Fatalf("create Party and other-unit: %v", err)
	}
	if created.PartyID == "" || created.ObjectID == "" || created.Status != StatusDraft {
		t.Fatalf("unexpected create result: %+v", created)
	}

	reused, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{
			Kind:        PartyKindOrganization,
			LegalName:   "不应复制的名称",
			DisplayName: "不应复制",
			StrongIdentifiers: []PartyIdentifierInput{{
				Type: PartyIdentifierUnifiedSocialCreditCode, Value: identifierValue,
			}},
		},
		Data: OtherUnitData{OperatingEntityID: operatingTwo.ObjectID},
	}, integrationActorOne, "party-other-unit-create-2", true)
	if err != nil {
		t.Fatalf("reuse exact Party match: %v", err)
	}
	if reused.PartyID != created.PartyID {
		t.Fatalf("exact identifier created duplicate Party: first=%s second=%s", created.PartyID, reused.PartyID)
	}

	_, err = service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		PartyID: created.PartyID,
		Data:    OtherUnitData{OperatingEntityID: operatingOne.ObjectID},
	}, integrationActorOne, "party-other-unit-duplicate", true)
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("duplicate relationship error=%v, want conflict", err)
	}

	hiddenIdentifier := "91310000" + newID()[8:18]
	_, err = service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{
			Kind: PartyKindOrganization, LegalName: "隐藏主体",
			StrongIdentifiers: []PartyIdentifierInput{{
				Type: PartyIdentifierUnifiedSocialCreditCode, Value: hiddenIdentifier,
			}},
		},
		Data: OtherUnitData{OperatingEntityID: operatingOne.ObjectID},
	}, integrationActorOne, "party-hidden-create", true)
	if err != nil {
		t.Fatalf("create hidden-match fixture: %v", err)
	}
	_, err = service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{
			Kind: PartyKindOrganization, LegalName: "尝试重复隐藏主体",
			StrongIdentifiers: []PartyIdentifierInput{{
				Type: PartyIdentifierUnifiedSocialCreditCode, Value: hiddenIdentifier,
			}},
		},
		Data: OtherUnitData{OperatingEntityID: operatingTwo.ObjectID},
	}, integrationActorOne, "party-hidden-match", false)
	if !errors.As(err, &domainErr) || domainErr.Message != "主体已存在，请联系有权人员" || domainErr.Data != nil {
		t.Fatalf("hidden exact match leaked details: %#v", err)
	}

	rollbackIdentifier := "91310000" + newID()[8:18]
	_, err = service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{
			Kind: PartyKindOrganization, LegalName: "应回滚主体",
			StrongIdentifiers: []PartyIdentifierInput{{
				Type: PartyIdentifierUnifiedSocialCreditCode, Value: rollbackIdentifier,
			}},
		},
		Data: OtherUnitData{OperatingEntityID: newID()},
	}, integrationActorOne, "party-atomic-rollback", true)
	if err == nil {
		t.Fatal("invalid operating entity unexpectedly succeeded")
	}
	var partyCount int
	if scanErr := pool.QueryRow(t.Context(), `
		SELECT count(*)
		FROM bob_party_identifiers
		WHERE identifier_type=$1 AND normalized_value=$2
	`, PartyIdentifierUnifiedSocialCreditCode, normalizePartyIdentifier(rollbackIdentifier)).Scan(&partyCount); scanErr != nil {
		t.Fatalf("count rolled-back Party: %v", scanErr)
	}
	if partyCount != 0 {
		t.Fatalf("failed relationship left %d bare Parties", partyCount)
	}
}

func TestConcurrentOtherUnitCreateReusesStrongIdentifierIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := newIntegrationService(pool)
	_, operatingOne := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Concurrent Party operating one",
	}, "concurrent-party-operating-one")
	_, operatingTwo := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Concurrent Party operating two",
	}, "concurrent-party-operating-two")
	identifierValue := "91320000" + newID()[8:18]
	type result struct {
		value OtherUnitCreateResult
		err   error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	var workers sync.WaitGroup
	for index, operatingID := range []string{operatingOne.ObjectID, operatingTwo.ObjectID} {
		workers.Add(1)
		go func(index int, operatingID string) {
			defer workers.Done()
			<-start
			value, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
				NewParty: &PartyCreateData{
					Kind: PartyKindOrganization, LegalName: "并发复用主体",
					StrongIdentifiers: []PartyIdentifierInput{{
						Type: PartyIdentifierUnifiedSocialCreditCode, Value: identifierValue,
					}},
				},
				Data: OtherUnitData{OperatingEntityID: operatingID},
			}, integrationActorOne, fmt.Sprintf("concurrent-party-create-%d", index), true)
			results <- result{value: value, err: err}
		}(index, operatingID)
	}
	close(start)
	workers.Wait()
	close(results)
	var partyID string
	for item := range results {
		if item.err != nil {
			t.Fatalf("concurrent create: %v", item.err)
		}
		if partyID == "" {
			partyID = item.value.PartyID
		} else if partyID != item.value.PartyID {
			t.Fatalf("concurrent exact matches created different Parties: %s and %s", partyID, item.value.PartyID)
		}
	}
}

func TestPartySaveAndFirstOtherUnitDeleteIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := newIntegrationService(pool)
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Party delete operating",
	}, "party-delete-operating")
	created, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindPerson, LegalName: "待编辑个人", Phone: "13800000000"},
		Data:     OtherUnitData{OperatingEntityID: operating.ObjectID},
	}, integrationActorOne, "party-delete-create", true)
	if err != nil {
		t.Fatalf("create deletable Party: %v", err)
	}

	party, err := service.PartyGet(t.Context(), PartyGetInput{PartyID: created.PartyID}, PartyRelationshipVisibility{
		OtherUnit: true,
	})
	if err != nil {
		t.Fatalf("get Party: %v", err)
	}
	if len(party.Relationships) != 1 || party.Relationships[0].Entity != EntityOtherUnit {
		t.Fatalf("unexpected relationship cards: %+v", party.Relationships)
	}
	updated, err := service.PartySave(t.Context(), PartySaveInput{
		PartyID:  party.PartyID,
		Revision: party.Revision,
		Data:     PartySaveData{DisplayName: optionalString("编辑后的显示名")},
	}, integrationActorOne, "party-save")
	if err != nil {
		t.Fatalf("save Party: %v", err)
	}
	if updated.Revision != party.Revision+1 || updated.DisplayName != "编辑后的显示名" {
		t.Fatalf("unexpected saved Party: %+v", updated)
	}

	err = service.Delete(t.Context(), EntityOtherUnit, DeleteInput{
		ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision,
		VersionID: created.VersionID, Revision: created.Revision,
	})
	if err != nil {
		t.Fatalf("delete first other-unit draft: %v", err)
	}
	var partyCount int
	if scanErr := pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_parties WHERE id=$1`, created.PartyID).Scan(&partyCount); scanErr != nil {
		t.Fatalf("count preserved Party: %v", scanErr)
	}
	if partyCount != 1 {
		t.Fatalf("Party with identity history was deleted: %s", created.PartyID)
	}

	untouched, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: "未触碰主体"},
		Data:     OtherUnitData{OperatingEntityID: operating.ObjectID},
	}, integrationActorOne, "party-untouched-create", true)
	if err != nil {
		t.Fatalf("create untouched Party: %v", err)
	}
	err = service.Delete(t.Context(), EntityOtherUnit, DeleteInput{
		ObjectID: untouched.ObjectID, ObjectRevision: untouched.ObjectRevision,
		VersionID: untouched.VersionID, Revision: untouched.Revision,
	})
	if err != nil {
		t.Fatalf("delete untouched first other-unit draft: %v", err)
	}
	if scanErr := pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_parties WHERE id=$1`, untouched.PartyID).Scan(&partyCount); scanErr != nil {
		t.Fatalf("count deleted untouched Party: %v", scanErr)
	}
	if partyCount != 0 {
		t.Fatalf("untouched first draft deletion left Party %s", untouched.PartyID)
	}
}

func TestOtherUnitLifecycleKeepsEffectiveVersionWhileEditingIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := newIntegrationService(pool)
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Other Unit lifecycle operating",
	}, "other-unit-lifecycle-operating")
	created, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: "服务关系生命周期主体"},
		Data:     OtherUnitData{OperatingEntityID: operating.ObjectID, ContactName: "初始联系人"},
	}, integrationActorOne, "other-unit-lifecycle-create", true)
	if err != nil {
		t.Fatalf("create other-unit: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityOtherUnit, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "other-unit-lifecycle-submit")
	if err != nil {
		t.Fatalf("submit other-unit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityOtherUnit, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "other-unit-lifecycle-approve")
	if err != nil {
		t.Fatalf("approve other-unit: %v", err)
	}
	candidate, err := service.OtherUnitSave(t.Context(), OtherUnitSaveInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: approved.Revision,
		Data: OtherUnitSaveData{ContactName: Optional("候选联系人")},
	}, integrationActorOne, "other-unit-lifecycle-candidate")
	if err != nil {
		t.Fatalf("create other-unit candidate: %v", err)
	}
	if candidate.Version != 2 || candidate.Status != StatusDraft || candidate.VersionID == created.VersionID {
		t.Fatalf("unexpected candidate: %+v", candidate)
	}
	view, err := service.OtherUnitGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get other-unit candidate: %v", err)
	}
	if view.Data.ContactName != "候选联系人" || view.EffectiveVersionID == nil || *view.EffectiveVersionID != created.VersionID {
		t.Fatalf("effective/candidate projection is wrong: %+v", view)
	}
	history, err := service.OtherUnitVersions(t.Context(), HistoryInput{
		ObjectID: created.ObjectID, Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("list other-unit versions: %v", err)
	}
	if history.Total != 2 || len(history.Items) != 2 || history.Items[0].Summary.ContactName != "候选联系人" ||
		history.Items[1].Summary.ContactName != "初始联系人" {
		t.Fatalf("other-unit version history is incomplete: %+v", history)
	}
	if err = service.Delete(t.Context(), EntityOtherUnit, DeleteInput{
		ObjectID: created.ObjectID, ObjectRevision: candidate.ObjectRevision,
		VersionID: candidate.VersionID, Revision: candidate.Revision,
	}); err != nil {
		t.Fatalf("delete other-unit candidate: %v", err)
	}
	view, err = service.OtherUnitGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get restored effective other-unit: %v", err)
	}
	if view.VersionID != created.VersionID || view.Status != StatusEffective || view.Data.ContactName != "初始联系人" {
		t.Fatalf("effective version was not restored: %+v", view)
	}
}

func optionalString(value string) OptionalString { return OptionalString{Set: true, Value: value} }
