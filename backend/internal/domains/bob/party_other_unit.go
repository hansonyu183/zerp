package bob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

const (
	PartyKindPerson       = "PERSON"
	PartyKindOrganization = "ORGANIZATION"

	PartyIdentifierPersonID                = "PERSON_ID"
	PartyIdentifierUnifiedSocialCreditCode = "UNIFIED_SOCIAL_CREDIT_CODE"
	PartyIdentifierTaxNumber               = "TAX_NUMBER"
)

type PartyIdentifierInput struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type PartyCreateData struct {
	Kind              string                 `json:"kind"`
	LegalName         string                 `json:"legalName"`
	DisplayName       string                 `json:"displayName,omitempty"`
	TaxNumber         string                 `json:"taxNumber,omitempty"`
	StrongIdentifiers []PartyIdentifierInput `json:"strongIdentifiers"`
	Phone             string                 `json:"phone,omitempty"`
	Email             string                 `json:"email,omitempty"`
	Address           string                 `json:"address,omitempty"`
}

type PartySaveData struct {
	Kind              *string                 `json:"kind,omitempty"`
	LegalName         OptionalString          `json:"legalName,omitempty"`
	DisplayName       OptionalString          `json:"displayName,omitempty"`
	TaxNumber         OptionalString          `json:"taxNumber,omitempty"`
	StrongIdentifiers *[]PartyIdentifierInput `json:"strongIdentifiers,omitempty"`
	Phone             OptionalString          `json:"phone,omitempty"`
	Email             OptionalString          `json:"email,omitempty"`
	Address           OptionalString          `json:"address,omitempty"`
}

type PartySaveInput struct {
	PartyID  string        `json:"partyId"`
	Revision int64         `json:"revision"`
	Data     PartySaveData `json:"data"`
}

type PartyGetInput struct {
	PartyID string `json:"partyId"`
}

type PartyRelationshipVisibility struct {
	OtherUnit bool
}

type PartyRelationshipCard struct {
	ObjectID            string `json:"objectId"`
	Entity              string `json:"entity"`
	Code                string `json:"code"`
	OperatingEntityID   string `json:"operatingEntityId"`
	OperatingEntityCode string `json:"operatingEntityCode"`
	OperatingEntityName string `json:"operatingEntityName"`
	Enabled             bool   `json:"enabled"`
	Status              string `json:"status"`
	Version             int32  `json:"version"`
}

type PartyView struct {
	PartyID           string                  `json:"partyId"`
	Kind              string                  `json:"kind"`
	LegalName         string                  `json:"legalName"`
	DisplayName       string                  `json:"displayName"`
	TaxNumber         string                  `json:"taxNumber,omitempty"`
	StrongIdentifiers []PartyIdentifierInput  `json:"strongIdentifiers"`
	Phone             string                  `json:"phone,omitempty"`
	Email             string                  `json:"email,omitempty"`
	Address           string                  `json:"address,omitempty"`
	Revision          int64                   `json:"revision"`
	Relationships     []PartyRelationshipCard `json:"relationships"`
	UpdatedAt         string                  `json:"updatedAt"`
}

type PartyListItem struct {
	PartyID     string `json:"partyId"`
	Kind        string `json:"kind"`
	LegalName   string `json:"legalName"`
	DisplayName string `json:"displayName"`
	Revision    int64  `json:"revision"`
	UpdatedAt   string `json:"updatedAt"`
}

type OtherUnitData struct {
	OperatingEntityID    string `json:"operatingEntityId"`
	ContactName          string `json:"contactName,omitempty"`
	ContactPhone         string `json:"contactPhone,omitempty"`
	Email                string `json:"email,omitempty"`
	Address              string `json:"address,omitempty"`
	SettlementMethodID   string `json:"settlementMethodId,omitempty"`
	SettlementMethodCode string `json:"settlementMethodCode,omitempty"`
	SettlementMethodName string `json:"settlementMethodName,omitempty"`
	Remark               string `json:"remark,omitempty"`
}

type OtherUnitCreateInput struct {
	PartyID  string           `json:"partyId,omitempty"`
	NewParty *PartyCreateData `json:"newParty,omitempty"`
	Data     OtherUnitData    `json:"data"`
}

type OtherUnitCreateResult struct {
	MutationResult
	PartyID string `json:"partyId"`
}

type OtherUnitSaveData struct {
	ContactName        OptionalString `json:"contactName,omitempty"`
	ContactPhone       OptionalString `json:"contactPhone,omitempty"`
	Email              OptionalString `json:"email,omitempty"`
	Address            OptionalString `json:"address,omitempty"`
	SettlementMethodID OptionalString `json:"settlementMethodId,omitempty"`
	Remark             OptionalString `json:"remark,omitempty"`
}

type OtherUnitSaveInput struct {
	ObjectID  string            `json:"objectId"`
	VersionID string            `json:"versionId"`
	Revision  int64             `json:"revision"`
	Data      OtherUnitSaveData `json:"data"`
}

func mergePartyOptional(input OptionalString, target *string) {
	if input.Set {
		*target = input.Value
	}
}

type OtherUnitView struct {
	ObjectID            string        `json:"objectId"`
	Code                string        `json:"code"`
	ObjectRevision      int64         `json:"objectRevision"`
	Enabled             bool          `json:"enabled"`
	VersionID           string        `json:"versionId"`
	Version             int32         `json:"version"`
	Status              string        `json:"status"`
	Revision            int64         `json:"revision"`
	SubmittedBy         *string       `json:"submittedBy"`
	EffectiveVersionID  *string       `json:"effectiveVersionId"`
	PartyID             string        `json:"partyId"`
	PartyKind           string        `json:"partyKind"`
	PartyDisplayName    string        `json:"partyDisplayName"`
	OperatingEntityID   string        `json:"operatingEntityId"`
	OperatingEntityCode string        `json:"operatingEntityCode"`
	OperatingEntityName string        `json:"operatingEntityName"`
	Data                OtherUnitData `json:"data"`
	UpdatedAt           string        `json:"updatedAt"`
}

func normalizePartyIdentifier(value string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(value)))
}

func validatePartyData(data PartyCreateData) (PartyCreateData, []PartyIdentifierInput, error) {
	data.Kind = strings.TrimSpace(data.Kind)
	data.LegalName = strings.TrimSpace(data.LegalName)
	data.DisplayName = strings.TrimSpace(data.DisplayName)
	data.TaxNumber = strings.TrimSpace(data.TaxNumber)
	data.Phone = strings.TrimSpace(data.Phone)
	data.Email = strings.TrimSpace(data.Email)
	data.Address = strings.TrimSpace(data.Address)
	if data.Kind != PartyKindPerson && data.Kind != PartyKindOrganization {
		return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party kind", nil, nil)
	}
	if data.LegalName == "" || len([]rune(data.LegalName)) > 200 {
		return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party legal name", nil, nil)
	}
	if data.DisplayName == "" {
		data.DisplayName = data.LegalName
	}
	if len([]rune(data.DisplayName)) > 200 || len([]rune(data.TaxNumber)) > 100 ||
		len([]rune(data.Phone)) > 32 || len([]rune(data.Email)) > 254 || len([]rune(data.Address)) > 500 {
		return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party identity data", nil, nil)
	}
	identifiers := append([]PartyIdentifierInput(nil), data.StrongIdentifiers...)
	for _, identifier := range identifiers {
		identifierType := strings.TrimSpace(identifier.Type)
		if identifierType != PartyIdentifierPersonID && identifierType != PartyIdentifierUnifiedSocialCreditCode {
			return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party identifier type", nil, nil)
		}
	}
	if data.TaxNumber != "" {
		identifiers = append(identifiers, PartyIdentifierInput{Type: PartyIdentifierTaxNumber, Value: data.TaxNumber})
	}
	seen := make(map[string]struct{}, len(identifiers))
	for index := range identifiers {
		identifiers[index].Type = strings.TrimSpace(identifiers[index].Type)
		identifiers[index].Value = strings.TrimSpace(identifiers[index].Value)
		if identifiers[index].Type != PartyIdentifierPersonID &&
			identifiers[index].Type != PartyIdentifierUnifiedSocialCreditCode &&
			identifiers[index].Type != PartyIdentifierTaxNumber {
			return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party identifier type", nil, nil)
		}
		normalized := normalizePartyIdentifier(identifiers[index].Value)
		if normalized == "" || len([]rune(normalized)) > 100 {
			return PartyCreateData{}, nil, domainError(ErrorValidation, "invalid Party identifier", nil, nil)
		}
		key := identifiers[index].Type + "\x00" + normalized
		if _, exists := seen[key]; exists {
			return PartyCreateData{}, nil, domainError(ErrorValidation, "duplicate Party identifier", nil, nil)
		}
		seen[key] = struct{}{}
	}
	return data, identifiers, nil
}

func partyView(row dbsqlc.BobParty, identifiers []dbsqlc.ListBobPartyIdentifiersRow) PartyView {
	result := PartyView{
		PartyID: row.ID, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName,
		TaxNumber: deref(row.TaxNumber), Phone: deref(row.Phone), Email: deref(row.Email),
		Address: deref(row.Address), Revision: row.Revision,
		StrongIdentifiers: make([]PartyIdentifierInput, 0, len(identifiers)),
		Relationships:     make([]PartyRelationshipCard, 0), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
	}
	for _, identifier := range identifiers {
		if identifier.IdentifierType != PartyIdentifierTaxNumber {
			result.StrongIdentifiers = append(result.StrongIdentifiers, PartyIdentifierInput{
				Type: identifier.IdentifierType, Value: identifier.Value,
			})
		}
	}
	return result
}

func (s *Service) PartyQuery(ctx context.Context, input QueryInput) (Page[PartyListItem], error) {
	offset, valid := pageOffset(input.Page, input.PageSize)
	if !valid || input.PageSize != 20 || len(input.Sort) > 0 {
		return Page[PartyListItem]{}, domainError(ErrorValidation, "invalid Party query", nil, nil)
	}
	filters, err := validateQueryFilters("party", input.Filters)
	if err != nil {
		return Page[PartyListItem]{}, err
	}
	total, err := s.queries.CountBobParties(ctx, dbsqlc.CountBobPartiesParams{PartyKind: filters.PartyKind, Keyword: filters.Keyword})
	if err != nil {
		return Page[PartyListItem]{}, s.internal("count Parties", err)
	}
	rows, err := s.queries.ListBobParties(ctx, dbsqlc.ListBobPartiesParams{
		PartyKind: filters.PartyKind, Keyword: filters.Keyword, PageSize: int32(input.PageSize), PageOffset: offset,
	})
	if err != nil {
		return Page[PartyListItem]{}, s.internal("list Parties", err)
	}
	items := make([]PartyListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, PartyListItem{PartyID: row.ID, Kind: row.Kind, LegalName: row.LegalName,
			DisplayName: row.DisplayName, Revision: row.Revision, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339)})
	}
	return Page[PartyListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) PartyGet(ctx context.Context, input PartyGetInput, visibility PartyRelationshipVisibility) (PartyView, error) {
	if !validID(input.PartyID) {
		return PartyView{}, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	row, err := s.queries.GetBobParty(ctx, input.PartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyView{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	if err != nil {
		return PartyView{}, s.internal("get Party", err)
	}
	identifiers, err := s.queries.ListBobPartyIdentifiers(ctx, input.PartyID)
	if err != nil {
		return PartyView{}, s.internal("list Party identifiers", err)
	}
	result := partyView(row, identifiers)
	if visibility.OtherUnit {
		cards, cardErr := s.queries.ListBobPartyRelationshipCards(ctx, input.PartyID)
		if cardErr != nil {
			return PartyView{}, s.internal("list Party relationships", cardErr)
		}
		for _, card := range cards {
			result.Relationships = append(result.Relationships, PartyRelationshipCard{
				ObjectID: card.ObjectID, Entity: card.Entity, Code: card.Code,
				OperatingEntityID: card.OperatingEntityID, OperatingEntityCode: card.OperatingEntityCode,
				OperatingEntityName: card.OperatingEntityName, Enabled: card.Enabled,
				Status: card.Status, Version: card.VersionNo,
			})
		}
	}
	return result, nil
}

func (s *Service) PartySave(ctx context.Context, input PartySaveInput, actorID, requestID string) (PartyView, error) {
	if !validID(input.PartyID) || input.Revision < 1 || !validActorAndRequest(actorID, requestID) {
		return PartyView{}, domainError(ErrorValidation, "invalid Party save", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PartyView{}, s.internal("begin Party save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	stored, err := qtx.LockBobParty(ctx, input.PartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyView{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	if err != nil {
		return PartyView{}, s.internal("lock Party", err)
	}
	if stored.Revision != input.Revision {
		return PartyView{}, domainError(ErrorConflict, "Party changed before save", map[string]any{"revision": stored.Revision}, nil)
	}
	data := PartyCreateData{Kind: stored.Kind, LegalName: stored.LegalName, DisplayName: stored.DisplayName,
		TaxNumber: deref(stored.TaxNumber), Phone: deref(stored.Phone), Email: deref(stored.Email), Address: deref(stored.Address)}
	identifierRows, err := qtx.ListBobPartyIdentifiers(ctx, input.PartyID)
	if err != nil {
		return PartyView{}, s.internal("read Party identifiers", err)
	}
	for _, row := range identifierRows {
		if row.IdentifierType != PartyIdentifierTaxNumber {
			data.StrongIdentifiers = append(data.StrongIdentifiers, PartyIdentifierInput{Type: row.IdentifierType, Value: row.Value})
		}
	}
	if input.Data.Kind != nil {
		data.Kind = *input.Data.Kind
	}
	mergePartyOptional(input.Data.LegalName, &data.LegalName)
	mergePartyOptional(input.Data.DisplayName, &data.DisplayName)
	mergePartyOptional(input.Data.TaxNumber, &data.TaxNumber)
	mergePartyOptional(input.Data.Phone, &data.Phone)
	mergePartyOptional(input.Data.Email, &data.Email)
	mergePartyOptional(input.Data.Address, &data.Address)
	if input.Data.StrongIdentifiers != nil {
		data.StrongIdentifiers = append([]PartyIdentifierInput(nil), (*input.Data.StrongIdentifiers)...)
	}
	validated, identifiers, err := validatePartyData(data)
	if err != nil {
		return PartyView{}, err
	}
	rows, err := qtx.UpdateBobParty(ctx, dbsqlc.UpdateBobPartyParams{
		Kind: validated.Kind, LegalName: validated.LegalName, DisplayName: validated.DisplayName,
		TaxNumber: nilIfEmpty(validated.TaxNumber), Phone: nilIfEmpty(validated.Phone),
		Email: nilIfEmpty(validated.Email), Address: nilIfEmpty(validated.Address), ActorID: actorID,
		PartyID: input.PartyID, Revision: input.Revision,
	})
	if err != nil {
		return PartyView{}, s.writeError("update Party", err)
	}
	if rows != 1 {
		return PartyView{}, domainError(ErrorConflict, "Party changed before save", nil, nil)
	}
	if err = qtx.DeleteBobPartyIdentifiers(ctx, input.PartyID); err != nil {
		return PartyView{}, s.writeError("replace Party identifiers", err)
	}
	if err = insertPartyIdentifiers(ctx, qtx, input.PartyID, identifiers); err != nil {
		return PartyView{}, s.writeError("replace Party identifiers", err)
	}
	if err = insertPartyAudit(ctx, qtx, input.PartyID, "SAVED", input.Revision+1, actorID, requestID); err != nil {
		return PartyView{}, s.writeError("audit Party save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return PartyView{}, s.writeError("commit Party save", err)
	}
	return s.PartyGet(ctx, PartyGetInput{PartyID: input.PartyID}, PartyRelationshipVisibility{})
}

func insertPartyAudit(ctx context.Context, q *dbsqlc.Queries, partyID, event string, revision int64, actorID, requestID string) error {
	summary, err := json.Marshal(map[string]any{"identityChanged": true})
	if err != nil {
		return err
	}
	return q.InsertBobPartyAuditEvent(ctx, dbsqlc.InsertBobPartyAuditEventParams{
		ID: newID(), PartyID: partyID, EventType: event, Revision: revision,
		ActorID: actorID, RequestID: requestID, Summary: summary,
	})
}

func insertPartyIdentifiers(ctx context.Context, q *dbsqlc.Queries, partyID string, identifiers []PartyIdentifierInput) error {
	for _, identifier := range identifiers {
		if err := q.InsertBobPartyIdentifier(ctx, dbsqlc.InsertBobPartyIdentifierParams{
			PartyID: partyID, IdentifierType: identifier.Type, Value: identifier.Value,
			NormalizedValue: normalizePartyIdentifier(identifier.Value),
		}); err != nil {
			return err
		}
	}
	return nil
}

func findExactParty(ctx context.Context, q *dbsqlc.Queries, identifiers []PartyIdentifierInput) (*dbsqlc.BobParty, error) {
	var matched *dbsqlc.BobParty
	for _, identifier := range identifiers {
		row, err := q.FindBobPartyByIdentifier(ctx, dbsqlc.FindBobPartyByIdentifierParams{
			IdentifierType: identifier.Type, NormalizedValue: normalizePartyIdentifier(identifier.Value),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if matched != nil && matched.ID != row.ID {
			return nil, domainError(ErrorConflict, "强标识分别属于不同主体", nil, nil)
		}
		copy := row
		matched = &copy
	}
	return matched, nil
}

func lockPartyIdentifiers(ctx context.Context, q *dbsqlc.Queries, identifiers []PartyIdentifierInput) error {
	keys := make([]string, 0, len(identifiers))
	seen := make(map[string]struct{}, len(identifiers))
	for _, identifier := range identifiers {
		key := "bob.party.identifier:" + identifier.Type + ":" + normalizePartyIdentifier(identifier.Value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err := q.AcquireBobPartyIdentifierLock(ctx, key); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) OtherUnitCreate(
	ctx context.Context, input OtherUnitCreateInput, actorID, requestID string, canReadMatchedParty bool,
) (OtherUnitCreateResult, error) {
	if !validActorAndRequest(actorID, requestID) || !validID(input.Data.OperatingEntityID) ||
		(input.PartyID == "") == (input.NewParty == nil) {
		return OtherUnitCreateResult{}, domainError(ErrorValidation, "invalid other-unit create", nil, nil)
	}
	if input.PartyID != "" && !validID(input.PartyID) {
		return OtherUnitCreateResult{}, domainError(ErrorValidation, "invalid Party reference", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OtherUnitCreateResult{}, s.internal("begin other-unit create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if _, err = qtx.ResolveCustomerOperatingEntity(ctx, input.Data.OperatingEntityID); errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, nil)
	} else if err != nil {
		return OtherUnitCreateResult{}, s.internal("resolve operating entity", err)
	}
	partyID := input.PartyID
	if input.NewParty != nil {
		validated, identifiers, validateErr := validatePartyData(*input.NewParty)
		if validateErr != nil {
			return OtherUnitCreateResult{}, validateErr
		}
		if err = lockPartyIdentifiers(ctx, qtx, identifiers); err != nil {
			return OtherUnitCreateResult{}, s.writeError("lock Party identifiers", err)
		}
		matched, matchErr := findExactParty(ctx, qtx, identifiers)
		if matchErr != nil {
			return OtherUnitCreateResult{}, s.writeError("match Party identifier", matchErr)
		}
		if matched != nil {
			if !canReadMatchedParty {
				return OtherUnitCreateResult{}, domainError(ErrorConflict, "主体已存在，请联系有权人员", nil, nil)
			}
			partyID = matched.ID
		} else {
			partyID = newID()
			if err = qtx.InsertBobParty(ctx, dbsqlc.InsertBobPartyParams{
				ID: partyID, Kind: validated.Kind, LegalName: validated.LegalName,
				DisplayName: validated.DisplayName, TaxNumber: nilIfEmpty(validated.TaxNumber),
				Phone: nilIfEmpty(validated.Phone), Email: nilIfEmpty(validated.Email),
				Address: nilIfEmpty(validated.Address), ActorID: actorID,
			}); err != nil {
				return OtherUnitCreateResult{}, s.writeError("insert Party", err)
			}
			if err = insertPartyIdentifiers(ctx, qtx, partyID, identifiers); err != nil {
				return OtherUnitCreateResult{}, s.writeError("insert Party identifiers", err)
			}
			if err = insertPartyAudit(ctx, qtx, partyID, "CREATED", 1, actorID, requestID); err != nil {
				return OtherUnitCreateResult{}, s.writeError("audit Party create", err)
			}
		}
	} else if _, err = qtx.GetBobParty(ctx, partyID); errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitCreateResult{}, domainError(ErrorConflict, "主体不可用", nil, nil)
	} else if err != nil {
		return OtherUnitCreateResult{}, s.internal("resolve Party", err)
	}

	data := DetailView{SettlementMethodID: strings.TrimSpace(input.Data.SettlementMethodID)}
	if data.SettlementMethodID != "" {
		data, err = s.resolveGenericCustomerSettlement(ctx, tx, data)
		if err != nil {
			return OtherUnitCreateResult{}, err
		}
	}
	objectID, versionID := newID(), newID()
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitCreateResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return OtherUnitCreateResult{}, s.writeError("allocate other-unit number", err)
	}
	code := fmt.Sprintf("OTU-%04d", counter)
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{
		ID: objectID, Entity: EntityOtherUnit, Code: code, CurrentVersionID: versionID, ActorID: actorID,
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert other-unit object", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
		ID: versionID, ObjectID: objectID, Entity: EntityOtherUnit, VersionNo: 1, ActorID: actorID,
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert other-unit version", err)
	}
	if err = qtx.InsertBobServiceRelationship(ctx, dbsqlc.InsertBobServiceRelationshipParams{
		ObjectID: objectID, PartyID: partyID, OperatingEntityID: input.Data.OperatingEntityID, ActorID: actorID,
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert Service Relationship", err)
	}
	dayOfMonth := int32(0)
	if data.DayOfMonth != nil {
		dayOfMonth = *data.DayOfMonth
	}
	if err = qtx.InsertBobServiceRelationshipDetail(ctx, dbsqlc.InsertBobServiceRelationshipDetailParams{
		VersionID: versionID, ContactName: nilIfEmpty(strings.TrimSpace(input.Data.ContactName)),
		ContactPhone: nilIfEmpty(strings.TrimSpace(input.Data.ContactPhone)), Email: nilIfEmpty(strings.TrimSpace(input.Data.Email)),
		Address: nilIfEmpty(strings.TrimSpace(input.Data.Address)), SettlementMethodID: nilIfEmpty(data.SettlementMethodID),
		SettlementMethodCode: nilIfEmpty(data.SettlementMethodCode), SettlementMethodName: nilIfEmpty(data.SettlementMethodName),
		SettlementTermCode: nilIfEmpty(data.TermCode), SettlementRuleType: nilIfEmpty(data.RuleType),
		SettlementMonthOffset: data.MonthOffset, SettlementDayOfMonth: dayOfMonth,
		SettlementDayOffset: data.DayOffset, Remark: nilIfEmpty(strings.TrimSpace(input.Data.Remark)),
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert Service Relationship detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: objectID, VersionID: versionID, Entity: EntityOtherUnit, Event: "CREATED",
		To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"partyId", "operatingEntityId"}},
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("audit other-unit create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return OtherUnitCreateResult{}, s.writeError("commit other-unit create", err)
	}
	return OtherUnitCreateResult{MutationResult: MutationResult{
		ObjectID: objectID, ObjectRevision: 1, Enabled: true, VersionID: versionID,
		Version: 1, Status: StatusDraft, Revision: 1,
	}, PartyID: partyID}, nil
}

func otherUnitView(row dbsqlc.GetBobOtherUnitRow) OtherUnitView {
	return OtherUnitView{
		ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled,
		VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status, Revision: row.VersionRevision,
		SubmittedBy: row.SubmittedBy, EffectiveVersionID: row.EffectiveVersionID,
		PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.PartyDisplayName,
		OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
		OperatingEntityName: row.OperatingEntityName, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
		Data: OtherUnitData{OperatingEntityID: row.OperatingEntityID, ContactName: deref(row.ContactName),
			ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address),
			SettlementMethodID: deref(row.SettlementMethodID), SettlementMethodCode: deref(row.SettlementMethodCode),
			SettlementMethodName: deref(row.SettlementMethodName), Remark: deref(row.Remark)},
	}
}

func (s *Service) OtherUnitGet(ctx context.Context, input GetInput) (OtherUnitView, error) {
	if !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return OtherUnitView{}, domainError(ErrorValidation, "invalid other-unit", nil, nil)
	}
	row, err := s.queries.GetBobOtherUnit(ctx, dbsqlc.GetBobOtherUnitParams{ObjectID: input.ObjectID, VersionID: input.VersionID})
	if errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitView{}, domainError(ErrorValidation, "other-unit not found", nil, nil)
	}
	if err != nil {
		return OtherUnitView{}, s.internal("get other-unit", err)
	}
	return otherUnitView(row), nil
}

func storedOtherUnitData(row dbsqlc.GetStoredBobServiceRelationshipDetailRow) DetailView {
	result := DetailView{
		ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone),
		Email: deref(row.Email), Address: deref(row.Address), Remark: deref(row.Remark),
		SettlementMethodID: deref(row.SettlementMethodID), SettlementMethodCode: deref(row.SettlementMethodCode),
		SettlementMethodName: deref(row.SettlementMethodName), TermCode: deref(row.SettlementTermCode),
		RuleType: deref(row.SettlementRuleType), MonthOffset: row.SettlementMonthOffset,
		DayOffset: row.SettlementDayOffset,
	}
	if row.SettlementDayOfMonth > 0 {
		result.DayOfMonth = &row.SettlementDayOfMonth
	}
	return result
}

func insertOtherUnitDetail(ctx context.Context, q *dbsqlc.Queries, versionID string, data DetailView) error {
	return q.InsertBobServiceRelationshipDetail(ctx, dbsqlc.InsertBobServiceRelationshipDetailParams{
		VersionID: versionID, ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone),
		Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address),
		SettlementMethodID: nilIfEmpty(data.SettlementMethodID), SettlementMethodCode: nilIfEmpty(data.SettlementMethodCode),
		SettlementMethodName: nilIfEmpty(data.SettlementMethodName), SettlementTermCode: nilIfEmpty(data.TermCode),
		SettlementRuleType: nilIfEmpty(data.RuleType), SettlementMonthOffset: data.MonthOffset,
		SettlementDayOfMonth: derefInt32(data.DayOfMonth), SettlementDayOffset: data.DayOffset,
		Remark: nilIfEmpty(data.Remark),
	})
}

func (s *Service) OtherUnitSave(
	ctx context.Context, input OtherUnitSaveInput, actorID, requestID string,
) (MutationResult, error) {
	if !validWriteInput(EntityOtherUnit, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid other-unit save", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, EntityOtherUnit, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "other-unit changed before save")
	}
	stored, err := qtx.GetStoredBobServiceRelationshipDetail(ctx, input.VersionID)
	if err != nil {
		return MutationResult{}, s.internal("load other-unit before save", err)
	}
	data := storedOtherUnitData(stored)
	mergePartyOptional(input.Data.ContactName, &data.ContactName)
	mergePartyOptional(input.Data.ContactPhone, &data.ContactPhone)
	mergePartyOptional(input.Data.Email, &data.Email)
	mergePartyOptional(input.Data.Address, &data.Address)
	mergePartyOptional(input.Data.Remark, &data.Remark)
	settlementChanged := input.Data.SettlementMethodID.Set
	mergePartyOptional(input.Data.SettlementMethodID, &data.SettlementMethodID)
	if settlementChanged {
		data.SettlementMethodCode, data.SettlementMethodName, data.TermCode, data.RuleType = "", "", "", ""
		data.MonthOffset, data.DayOffset, data.DayOfMonth = 0, 0, nil
		if data.SettlementMethodID != "" {
			data, err = s.resolveGenericCustomerSettlement(ctx, tx, data)
			if err != nil {
				return MutationResult{}, err
			}
		}
	}
	data, err = validateDetailData(EntityOtherUnit, data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid other-unit save", nil, err)
	}
	targetVersionID, targetVersionNo := input.VersionID, version.VersionNo
	objectRevision := object.Revision
	createdCandidate := false
	if version.Status == StatusEffective && object.EffectiveVersionID != nil && *object.EffectiveVersionID == input.VersionID {
		targetVersionID, targetVersionNo = newID(), object.NextVersionNo
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
			ID: targetVersionID, ObjectID: input.ObjectID, Entity: EntityOtherUnit,
			VersionNo: targetVersionNo, ActorID: actorID,
		}); err != nil {
			return MutationResult{}, s.writeError("insert other-unit candidate", err)
		}
		rows, advanceErr := qtx.AdvanceBobOtherUnitCandidate(ctx, dbsqlc.AdvanceBobOtherUnitCandidateParams{
			VersionID: targetVersionID, ActorID: actorID, ObjectID: input.ObjectID,
			Revision: object.Revision, CurrentVersionID: input.VersionID,
		})
		if advanceErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "other-unit changed before save")
		}
		objectRevision++
		createdCandidate = true
	} else if version.Status != StatusDraft || (object.EffectiveVersionID != nil && object.CurrentVersionID == *object.EffectiveVersionID) {
		return MutationResult{}, conflict(object, version, "other-unit changed before save")
	}
	if createdCandidate {
		if err = insertOtherUnitDetail(ctx, qtx, targetVersionID, data); err != nil {
			return MutationResult{}, s.writeError("insert other-unit candidate detail", err)
		}
	} else {
		if err = updateDetail(ctx, qtx, EntityOtherUnit, targetVersionID, data); err != nil {
			return MutationResult{}, s.writeError("update other-unit detail", err)
		}
		rows, saveErr := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{
			ActorID: actorID, ID: targetVersionID, ObjectID: input.ObjectID,
			Entity: EntityOtherUnit, Revision: input.Revision,
		})
		if saveErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "other-unit changed before save")
		}
		if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{
			ActorID: actorID, ID: input.ObjectID, Entity: EntityOtherUnit,
		}); err != nil {
			return MutationResult{}, s.internal("touch other-unit", err)
		}
	}
	event := "SAVED"
	if createdCandidate {
		event = "CREATED"
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: targetVersionID, Entity: EntityOtherUnit,
		Event: event, To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"contactName", "contactPhone", "email", "address", "settlementMethodId", "remark"}},
	}); err != nil {
		return MutationResult{}, s.writeError("audit other-unit save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit other-unit save", err)
	}
	revision := input.Revision + 1
	if createdCandidate {
		revision = 1
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision, Enabled: object.Enabled,
		VersionID: targetVersionID, Version: targetVersionNo, Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) OtherUnitQuery(ctx context.Context, input QueryInput) (Page[OtherUnitView], error) {
	offset, valid := pageOffset(input.Page, input.PageSize)
	if !valid || input.PageSize != 20 || len(input.Sort) > 0 {
		return Page[OtherUnitView]{}, domainError(ErrorValidation, "invalid other-unit query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityOtherUnit, input.Filters)
	if err != nil {
		return Page[OtherUnitView]{}, err
	}
	statuses := uniqueStrings(filters.Status)
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[OtherUnitView]{}, domainError(ErrorValidation, "invalid status filter", nil, nil)
		}
	}
	total, err := s.queries.CountBobOtherUnits(ctx, dbsqlc.CountBobOtherUnitsParams{
		Keyword: filters.Keyword, OperatingEntityID: filters.OperatingEntityID, Statuses: statuses,
	})
	if err != nil {
		return Page[OtherUnitView]{}, s.internal("count other-units", err)
	}
	rows, err := s.queries.ListBobOtherUnits(ctx, dbsqlc.ListBobOtherUnitsParams{
		Keyword: filters.Keyword, OperatingEntityID: filters.OperatingEntityID, Statuses: statuses,
		PageSize: int32(input.PageSize), PageOffset: offset,
	})
	if err != nil {
		return Page[OtherUnitView]{}, s.internal("list other-units", err)
	}
	items := make([]OtherUnitView, 0, len(rows))
	for _, row := range rows {
		getRow := dbsqlc.GetBobOtherUnitRow{
			ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled,
			VersionID: row.VersionID, VersionNo: row.VersionNo, Status: row.Status,
			VersionRevision: row.VersionRevision, SubmittedBy: row.SubmittedBy,
			EffectiveVersionID: row.EffectiveVersionID, CurrentVersionID: row.CurrentVersionID,
			PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.PartyDisplayName,
			OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
			OperatingEntityName: row.OperatingEntityName, ContactName: row.ContactName,
			ContactPhone: row.ContactPhone, Email: row.Email, Address: row.Address,
			SettlementMethodID: row.SettlementMethodID, SettlementMethodCode: row.SettlementMethodCode,
			SettlementMethodName: row.SettlementMethodName, SettlementTermCode: row.SettlementTermCode,
			SettlementRuleType: row.SettlementRuleType, SettlementMonthOffset: row.SettlementMonthOffset,
			SettlementDayOfMonth: row.SettlementDayOfMonth, SettlementDayOffset: row.SettlementDayOffset,
			Remark: row.Remark, UpdatedAt: row.UpdatedAt,
		}
		items = append(items, otherUnitView(getRow))
	}
	return Page[OtherUnitView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) OtherUnitVersions(ctx context.Context, input HistoryInput) (Page[VersionHistoryItem], error) {
	if !validHistoryInput(EntityOtherUnit, input) {
		return Page[VersionHistoryItem]{}, domainError(ErrorValidation, "invalid versions request", nil, nil)
	}
	if _, err := s.OtherUnitGet(ctx, GetInput{ObjectID: input.ObjectID}); err != nil {
		return Page[VersionHistoryItem]{}, err
	}
	total, err := s.queries.CountBobVersions(ctx, dbsqlc.CountBobVersionsParams{
		ObjectID: input.ObjectID, Entity: EntityOtherUnit,
	})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("count other-unit versions", err)
	}
	rows, err := s.queries.ListBobOtherUnitVersions(ctx, dbsqlc.ListBobOtherUnitVersionsParams{
		ObjectID: input.ObjectID, PageOffset: mustPageOffset(input.Page, input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("list other-unit versions", err)
	}
	items := make([]VersionHistoryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, VersionHistoryItem{
			VersionID: row.VersionID, Version: row.VersionNo, Status: row.Status, Revision: row.Revision,
			CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt.Time, UpdatedBy: row.UpdatedBy,
			SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy,
			ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment,
			Summary: DetailView{
				Name: row.PartyDisplayName, OperatingEntityID: row.OperatingEntityID,
				ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone),
				Email: deref(row.Email), Address: deref(row.Address),
				SettlementMethodID: deref(row.SettlementMethodID), Remark: deref(row.Remark),
			},
		})
	}
	return Page[VersionHistoryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
