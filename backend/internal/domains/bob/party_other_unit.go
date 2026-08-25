package bob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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
	Customer     bool
	Supplier     bool
	Employment   bool
	OtherUnit    bool
	SalesPartner bool
}

func (visibility PartyRelationshipVisibility) allows(entity string) bool {
	switch entity {
	case EntityCustomer:
		return visibility.Customer
	case EntitySupplier:
		return visibility.Supplier
	case EntityEmployee:
		return visibility.Employment
	case EntityOtherUnit:
		return visibility.OtherUnit
	case EntitySalesPartner:
		return visibility.SalesPartner
	default:
		return false
	}
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
	MergedIntoPartyID string                  `json:"mergedIntoPartyId,omitempty"`
	MergedAt          string                  `json:"mergedAt,omitempty"`
	Relationships     []PartyRelationshipCard `json:"relationships"`
	UpdatedAt         string                  `json:"updatedAt"`
}

type PartyListItem struct {
	PartyID           string `json:"partyId"`
	Kind              string `json:"kind"`
	LegalName         string `json:"legalName"`
	DisplayName       string `json:"displayName"`
	Revision          int64  `json:"revision"`
	MergedIntoPartyID string `json:"mergedIntoPartyId,omitempty"`
	MergedAt          string `json:"mergedAt,omitempty"`
	UpdatedAt         string `json:"updatedAt"`
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
	ObjectID         string            `json:"objectId"`
	ApprovalEntryID  string            `json:"approvalEntryId"`
	ApprovalRevision int64             `json:"approvalRevision"`
	Data             OtherUnitSaveData `json:"data"`
}

func mergePartyOptional(input OptionalString, target *string) {
	if input.Set {
		*target = input.Value
	}
}

type OtherUnitView struct {
	ObjectID            string               `json:"objectId"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	Enabled             bool                 `json:"enabled"`
	Approval            approval.VersionMeta `json:"approval"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	Data                OtherUnitData        `json:"data"`
	UpdatedAt           string               `json:"updatedAt"`
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

func partyView(row dbsqlc.BobParty, identifiers []PartyIdentifierInput) PartyView {
	result := PartyView{
		PartyID: row.ID, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName,
		TaxNumber: deref(row.TaxNumber), Phone: deref(row.Phone), Email: deref(row.Email),
		Address: deref(row.Address), Revision: row.Revision,
		StrongIdentifiers: make([]PartyIdentifierInput, 0, len(identifiers)),
		Relationships:     make([]PartyRelationshipCard, 0), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
	}
	if row.MergedIntoPartyID != nil {
		result.MergedIntoPartyID = *row.MergedIntoPartyID
	}
	if row.MergedAt.Valid {
		result.MergedAt = row.MergedAt.Time.Format(time.RFC3339)
	}
	for _, identifier := range identifiers {
		if identifier.Type != PartyIdentifierTaxNumber {
			result.StrongIdentifiers = append(result.StrongIdentifiers, identifier)
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
	merged := filters.Merged != nil && *filters.Merged
	var total int64
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM bob_parties WHERE ($1 = '' OR kind = $1) AND ($2 = '' OR legal_name ILIKE '%' || $2 || '%' OR display_name ILIKE '%' || $2 || '%') AND (($3 AND merged_into_party_id IS NOT NULL) OR (NOT $3 AND merged_into_party_id IS NULL))`, filters.PartyKind, filters.Keyword, merged).Scan(&total)
	if err != nil {
		return Page[PartyListItem]{}, s.internal("count Parties", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,kind,legal_name,display_name,tax_number,phone,email,address,revision,created_at,created_by,updated_at,updated_by,merged_into_party_id,merged_at FROM bob_parties WHERE ($1 = '' OR kind = $1) AND ($2 = '' OR legal_name ILIKE '%' || $2 || '%' OR display_name ILIKE '%' || $2 || '%') AND (($3 AND merged_into_party_id IS NOT NULL) OR (NOT $3 AND merged_into_party_id IS NULL)) ORDER BY display_name,id LIMIT $4 OFFSET $5`, filters.PartyKind, filters.Keyword, merged, input.PageSize, offset)
	if err != nil {
		return Page[PartyListItem]{}, s.internal("list Parties", err)
	}
	defer rows.Close()
	items := make([]PartyListItem, 0, input.PageSize)
	for rows.Next() {
		row, scanErr := scanParty(rows)
		if scanErr != nil {
			return Page[PartyListItem]{}, s.internal("scan Party", scanErr)
		}
		item := PartyListItem{PartyID: row.ID, Kind: row.Kind, LegalName: row.LegalName,
			DisplayName: row.DisplayName, Revision: row.Revision, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339)}
		if row.MergedIntoPartyID != nil {
			item.MergedIntoPartyID = *row.MergedIntoPartyID
		}
		if row.MergedAt.Valid {
			item.MergedAt = row.MergedAt.Time.Format(time.RFC3339)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[PartyListItem]{}, s.internal("list Parties", err)
	}
	return Page[PartyListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) PartyGet(ctx context.Context, input PartyGetInput, visibility PartyRelationshipVisibility) (PartyView, error) {
	if !validID(input.PartyID) {
		return PartyView{}, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	row, err := partyByID(ctx, s.pool, input.PartyID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyView{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	if err != nil {
		return PartyView{}, s.internal("get Party", err)
	}
	identifiers, err := partyIdentifiers(ctx, s.pool, input.PartyID)
	if err != nil {
		return PartyView{}, s.internal("list Party identifiers", err)
	}
	result := partyView(row, identifiers)
	if visibility.Customer || visibility.Supplier || visibility.Employment || visibility.OtherUnit || visibility.SalesPartner {
		cards, cardErr := partyRelationshipCards(ctx, s.pool, input.PartyID)
		if cardErr != nil {
			return PartyView{}, s.internal("list Party relationships", cardErr)
		}
		for _, card := range cards {
			visible := (card.Entity == EntityCustomer && visibility.Customer) ||
				(card.Entity == EntitySupplier && visibility.Supplier) ||
				(card.Entity == EntityEmployee && visibility.Employment) ||
				(card.Entity == EntityOtherUnit && visibility.OtherUnit) ||
				(card.Entity == EntitySalesPartner && visibility.SalesPartner)
			if !visible {
				continue
			}
			result.Relationships = append(result.Relationships, PartyRelationshipCard{
				ObjectID: card.ObjectID, Entity: card.Entity, Code: card.Code,
				OperatingEntityID: card.OperatingEntityID, OperatingEntityCode: card.OperatingEntityCode,
				OperatingEntityName: card.OperatingEntityName, Enabled: card.Enabled,
				Status: card.Status, Version: card.Version,
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
	stored, err := partyByID(ctx, tx, input.PartyID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyView{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	if err != nil {
		return PartyView{}, s.internal("lock Party", err)
	}
	if stored.Revision != input.Revision {
		return PartyView{}, domainError(ErrorConflict, "Party changed before save", map[string]any{"revision": stored.Revision}, nil)
	}
	if stored.MergedIntoPartyID != nil {
		return PartyView{}, domainError(ErrorConflict, "已合并主体永久只读", map[string]any{"mergedIntoPartyId": *stored.MergedIntoPartyID}, nil)
	}
	data := PartyCreateData{Kind: stored.Kind, LegalName: stored.LegalName, DisplayName: stored.DisplayName,
		TaxNumber: deref(stored.TaxNumber), Phone: deref(stored.Phone), Email: deref(stored.Email), Address: deref(stored.Address)}
	identifierRows, err := partyIdentifiers(ctx, tx, input.PartyID)
	if err != nil {
		return PartyView{}, s.internal("read Party identifiers", err)
	}
	for _, row := range identifierRows {
		if row.Type != PartyIdentifierTaxNumber {
			data.StrongIdentifiers = append(data.StrongIdentifiers, row)
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
	result, err := tx.Exec(ctx, `UPDATE bob_parties SET kind=$1,legal_name=$2,display_name=$3,tax_number=$4,phone=$5,email=$6,address=$7,revision=revision+1,updated_at=now(),updated_by=$8 WHERE id=$9 AND revision=$10 AND merged_into_party_id IS NULL`, validated.Kind, validated.LegalName, validated.DisplayName, nilIfEmpty(validated.TaxNumber), nilIfEmpty(validated.Phone), nilIfEmpty(validated.Email), nilIfEmpty(validated.Address), actorID, input.PartyID, input.Revision)
	if err != nil {
		return PartyView{}, s.writeError("update Party", err)
	}
	if result.RowsAffected() != 1 {
		return PartyView{}, domainError(ErrorConflict, "Party changed before save", nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM bob_party_identifiers WHERE party_id=$1`, input.PartyID); err != nil {
		return PartyView{}, s.writeError("replace Party identifiers", err)
	}
	if err = insertPartyIdentifiers(ctx, tx, input.PartyID, identifiers); err != nil {
		return PartyView{}, s.writeError("replace Party identifiers", err)
	}
	if err = insertPartyAudit(ctx, qtx, input.PartyID, "SAVED", input.Revision+1, actorID, requestID, tx); err != nil {
		return PartyView{}, s.writeError("audit Party save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return PartyView{}, s.writeError("commit Party save", err)
	}
	return s.PartyGet(ctx, PartyGetInput{PartyID: input.PartyID}, PartyRelationshipVisibility{})
}

type partyQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type partyRelationshipCardRow struct {
	ObjectID, Entity, Code, OperatingEntityID, OperatingEntityCode, OperatingEntityName, Status string
	Enabled                                                                                     bool
	Version                                                                                     int32
}

func scanParty(row interface{ Scan(...any) error }) (dbsqlc.BobParty, error) {
	var result dbsqlc.BobParty
	err := row.Scan(&result.ID, &result.Kind, &result.LegalName, &result.DisplayName, &result.TaxNumber, &result.Phone, &result.Email, &result.Address, &result.Revision, &result.CreatedAt, &result.CreatedBy, &result.UpdatedAt, &result.UpdatedBy, &result.MergedIntoPartyID, &result.MergedAt)
	return result, err
}

func partyByID(ctx context.Context, q partyQueryer, partyID string, lock bool) (dbsqlc.BobParty, error) {
	sql := `SELECT id,kind,legal_name,display_name,tax_number,phone,email,address,revision,created_at,created_by,updated_at,updated_by,merged_into_party_id,merged_at FROM bob_parties WHERE id=$1`
	if lock {
		sql += ` FOR UPDATE`
	}
	return scanParty(q.QueryRow(ctx, sql, partyID))
}

func partyIdentifiers(ctx context.Context, q partyQueryer, partyID string) ([]PartyIdentifierInput, error) {
	rows, err := q.Query(ctx, `SELECT identifier_type,value FROM bob_party_identifiers WHERE party_id=$1 ORDER BY identifier_type,value`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PartyIdentifierInput, 0)
	for rows.Next() {
		var item PartyIdentifierInput
		if err = rows.Scan(&item.Type, &item.Value); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func partyRelationshipCards(ctx context.Context, q partyQueryer, partyID string) ([]partyRelationshipCardRow, error) {
	rows, err := q.Query(ctx, `WITH relationships AS (
		SELECT object_id,'customer'::text AS entity,operating_entity_id FROM bob_customer_relationships WHERE party_id=$1
		UNION ALL SELECT object_id,'supplier',operating_entity_id FROM bob_supplier_relationships WHERE party_id=$1
		UNION ALL SELECT object_id,'employee',operating_entity_id FROM bob_employment_relationships WHERE party_id=$1
		UNION ALL SELECT object_id,'other-unit',operating_entity_id FROM bob_service_relationships WHERE party_id=$1
		UNION ALL SELECT object_id,'sales-partner',operating_entity_id FROM bob_sales_relationships WHERE party_id=$1
	) SELECT r.object_id,r.entity,o.code,r.operating_entity_id,oe.code,COALESCE(ov.legal_name,''),o.enabled,COALESCE(open_entry.status,approved.status,''),COALESCE(open_entry.version_no,approved.version_no,0)
	FROM relationships r JOIN bob_objects o ON o.id=r.object_id JOIN bob_objects oe ON oe.id=r.operating_entity_id
	LEFT JOIN LATERAL (SELECT legal_name FROM bob_operating_entity_versions p JOIN approval_entries e ON e.id=p.approval_entry_id WHERE e.domain='bob' AND e.entity='operating-entity' AND e.subject_id=oe.id AND e.status='APPROVED' ORDER BY e.version_no DESC LIMIT 1) ov ON true
	LEFT JOIN LATERAL (SELECT status,version_no FROM approval_entries WHERE domain='bob' AND entity=r.entity AND subject_id=r.object_id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) open_entry ON true
	LEFT JOIN LATERAL (SELECT status,version_no FROM approval_entries WHERE domain='bob' AND entity=r.entity AND subject_id=r.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
	ORDER BY o.code`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]partyRelationshipCardRow, 0)
	for rows.Next() {
		var item partyRelationshipCardRow
		if err = rows.Scan(&item.ObjectID, &item.Entity, &item.Code, &item.OperatingEntityID, &item.OperatingEntityCode, &item.OperatingEntityName, &item.Enabled, &item.Status, &item.Version); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) relationshipOperatingEntity(ctx context.Context, objectID string) (string, string, error) {
	object, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityOperatingEntity})
	if err != nil {
		return "", "", err
	}
	entry, err := s.queries.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntityOperatingEntity, ObjectID: objectID})
	if err != nil {
		return "", "", err
	}
	data, err := loadDetail(ctx, s.queries, EntityOperatingEntity, entry.ID)
	if err != nil {
		return "", "", err
	}
	return object.Code, data.Name, nil
}

func insertPartyAudit(ctx context.Context, q *dbsqlc.Queries, partyID, event string, revision int64, actorID, requestID string, txs ...pgx.Tx) error {
	if len(txs) == 0 {
		return errors.New("party identity mutation requires transaction")
	}
	tx := txs[0]
	summary, err := json.Marshal(map[string]any{"identityChanged": true})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO bob_party_audit_events(id,party_id,event_type,revision,actor_id,request_id,summary) VALUES($1,$2,$3,$4,$5,$6,$7)`, newID(), partyID, event, revision, actorID, requestID, summary)
	return err
}

func insertPartyIdentifiers(ctx context.Context, tx pgx.Tx, partyID string, identifiers []PartyIdentifierInput) error {
	for _, identifier := range identifiers {
		if _, err := tx.Exec(ctx, `INSERT INTO bob_party_identifiers(party_id,identifier_type,value,normalized_value) VALUES($1,$2,$3,$4)`, partyID, identifier.Type, identifier.Value, normalizePartyIdentifier(identifier.Value)); err != nil {
			return err
		}
	}
	return nil
}

func findExactParty(ctx context.Context, tx pgx.Tx, identifiers []PartyIdentifierInput) (*dbsqlc.BobParty, error) {
	var matched *dbsqlc.BobParty
	for _, identifier := range identifiers {
		row, err := partyByIdentifier(ctx, tx, identifier.Type, normalizePartyIdentifier(identifier.Value))
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

func partyByIdentifier(ctx context.Context, tx pgx.Tx, identifierType, normalizedValue string) (dbsqlc.BobParty, error) {
	return scanParty(tx.QueryRow(ctx, `SELECT p.id,p.kind,p.legal_name,p.display_name,p.tax_number,p.phone,p.email,p.address,p.revision,p.created_at,p.created_by,p.updated_at,p.updated_by,p.merged_into_party_id,p.merged_at FROM bob_party_identifiers i JOIN bob_parties p ON p.id=i.party_id WHERE i.identifier_type=$1 AND i.normalized_value=$2`, identifierType, normalizedValue))
}

func lockPartyIdentifiers(ctx context.Context, tx pgx.Tx, identifiers []PartyIdentifierInput) error {
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
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, key); err != nil {
			return err
		}
	}
	return nil
}

type relationshipParty struct {
	ID          string
	Kind        string
	DisplayName string
}

func (s *Service) resolveOrCreateRelationshipParty(
	ctx context.Context,
	qtx *dbsqlc.Queries,
	partyID string,
	newParty *PartyCreateData,
	actorID string,
	requestID string,
	canReadMatchedParty bool,
	txs ...pgx.Tx,
) (relationshipParty, error) {
	if len(txs) == 0 {
		return relationshipParty{}, s.internal("resolve Party", errors.New("party identity mutation requires transaction"))
	}
	tx := txs[0]
	if (partyID == "") == (newParty == nil) || (partyID != "" && !validID(partyID)) {
		return relationshipParty{}, domainError(ErrorValidation, "invalid Party reference", nil, nil)
	}
	if newParty != nil {
		validated, identifiers, err := validatePartyData(*newParty)
		if err != nil {
			return relationshipParty{}, err
		}
		if err = lockPartyIdentifiers(ctx, tx, identifiers); err != nil {
			return relationshipParty{}, s.writeError("lock Party identifiers", err)
		}
		matched, err := findExactParty(ctx, tx, identifiers)
		if err != nil {
			return relationshipParty{}, s.writeError("match Party identifier", err)
		}
		if matched != nil {
			if !canReadMatchedParty {
				return relationshipParty{}, domainError(ErrorConflict, "主体已存在，请联系有权人员", nil, nil)
			}
			return relationshipParty{ID: matched.ID, Kind: matched.Kind, DisplayName: matched.DisplayName}, nil
		}
		partyID = newID()
		if _, err = tx.Exec(ctx, `INSERT INTO bob_parties(id,kind,legal_name,display_name,tax_number,phone,email,address,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, partyID, validated.Kind, validated.LegalName, validated.DisplayName, nilIfEmpty(validated.TaxNumber), nilIfEmpty(validated.Phone), nilIfEmpty(validated.Email), nilIfEmpty(validated.Address), actorID); err != nil {
			return relationshipParty{}, s.writeError("insert Party", err)
		}
		if err = insertPartyIdentifiers(ctx, tx, partyID, identifiers); err != nil {
			return relationshipParty{}, s.writeError("insert Party identifiers", err)
		}
		if err = insertPartyAudit(ctx, qtx, partyID, "CREATED", 1, actorID, requestID, tx); err != nil {
			return relationshipParty{}, s.writeError("audit Party create", err)
		}
		return relationshipParty{ID: partyID, Kind: validated.Kind, DisplayName: validated.DisplayName}, nil
	}
	row, err := partyByID(ctx, tx, partyID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return relationshipParty{}, domainError(ErrorConflict, "主体不可用", nil, nil)
	}
	if err != nil {
		return relationshipParty{}, s.internal("resolve Party", err)
	}
	return relationshipParty{ID: row.ID, Kind: row.Kind, DisplayName: row.DisplayName}, nil
}

func (s *Service) OtherUnitCreate(
	ctx context.Context, input OtherUnitCreateInput, actor approval.Actor, canReadMatchedParty bool,
) (OtherUnitCreateResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, input.Data.OperatingEntityID); err != nil {
		return OtherUnitCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, qtx, input.PartyID, input.NewParty,
		actorID, requestID, canReadMatchedParty, tx)
	if err != nil {
		return OtherUnitCreateResult{}, err
	}
	partyID := party.ID

	data := DetailView{
		ContactName: strings.TrimSpace(input.Data.ContactName), ContactPhone: strings.TrimSpace(input.Data.ContactPhone),
		Email: strings.TrimSpace(input.Data.Email), Address: strings.TrimSpace(input.Data.Address),
		SettlementMethodID: strings.TrimSpace(input.Data.SettlementMethodID), Remark: strings.TrimSpace(input.Data.Remark),
	}
	if data.SettlementMethodID != "" {
		data, err = s.resolveSettlementSnapshot(ctx, tx, data)
		if err != nil {
			return OtherUnitCreateResult{}, err
		}
		// Service relationships copy settlement timing only. The AUX sales
		// surcharge belongs to customer pricing and is not service data.
		data.DefaultSalesSurcharge = ""
	}
	if data, err = validateDetailData(EntityOtherUnit, data); err != nil {
		return OtherUnitCreateResult{}, domainError(ErrorValidation, "invalid other-unit create", nil, err)
	}
	objectID := newID()
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitCreateResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return OtherUnitCreateResult{}, s.writeError("allocate other-unit number", err)
	}
	code := fmt.Sprintf("OTU-%04d", counter)
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{
		ID: objectID, Entity: EntityOtherUnit, Code: code, ActorID: actorID,
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert other-unit object", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntityOtherUnit, objectID, code, true, actor)
	if err != nil {
		return OtherUnitCreateResult{}, translateApprovalError(err)
	}
	if err = qtx.InsertBobOtherUnitRelationship(ctx, dbsqlc.InsertBobOtherUnitRelationshipParams{
		ObjectID: objectID, PartyID: partyID, OperatingEntityID: input.Data.OperatingEntityID, ActorID: actorID,
	}); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert other-unit relationship", err)
	}
	if err = insertDetail(ctx, qtx, EntityOtherUnit, entry.ID, data); err != nil {
		return OtherUnitCreateResult{}, s.writeError("insert other-unit payload", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return OtherUnitCreateResult{}, s.writeError("commit other-unit create", err)
	}
	return OtherUnitCreateResult{MutationResult: approvalMutation(objectID, 1, true, entry), PartyID: partyID}, nil
}

func otherUnitData(data DetailView, operatingEntityID string) OtherUnitData {
	return OtherUnitData{
		OperatingEntityID: operatingEntityID, ContactName: data.ContactName, ContactPhone: data.ContactPhone,
		Email: data.Email, Address: data.Address, SettlementMethodID: data.SettlementMethodID,
		SettlementMethodCode: data.SettlementMethodCode, SettlementMethodName: data.SettlementMethodName, Remark: data.Remark,
	}
}

func (s *Service) OtherUnitGet(ctx context.Context, input GetInput) (OtherUnitView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) {
		return OtherUnitView{}, domainError(ErrorValidation, "invalid other-unit", nil, nil)
	}
	object, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: input.ObjectID, Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) {
		return OtherUnitView{}, domainError(ErrorValidation, "other-unit not found", nil, nil)
	}
	if err != nil {
		return OtherUnitView{}, s.internal("get other-unit", err)
	}
	identity, err := s.queries.GetBobOtherUnitRelationship(ctx, input.ObjectID)
	if err != nil {
		return OtherUnitView{}, s.internal("get other-unit relationship", err)
	}
	party, err := s.queries.GetBobParty(ctx, identity.PartyID)
	if err != nil {
		return OtherUnitView{}, s.internal("get other-unit party", err)
	}
	entryID := input.ApprovalEntryID
	if entryID == "" {
		if entry, openErr := s.queries.GetBobOpenEntry(ctx, dbsqlc.GetBobOpenEntryParams{Entity: EntityOtherUnit, ObjectID: input.ObjectID}); openErr == nil {
			entryID = entry.ID
		} else if !errors.Is(openErr, pgx.ErrNoRows) {
			return OtherUnitView{}, s.internal("get open other-unit approval", openErr)
		} else if entry, approvedErr := s.queries.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntityOtherUnit, ObjectID: input.ObjectID}); approvedErr == nil {
			entryID = entry.ID
		} else if !errors.Is(approvedErr, pgx.ErrNoRows) {
			return OtherUnitView{}, s.internal("get latest approved other-unit", approvedErr)
		} else {
			return OtherUnitView{}, domainError(ErrorConflict, "other-unit has no approval entry", nil, nil)
		}
	}
	entry, err := s.entryForObject(ctx, s.queries, EntityOtherUnit, input.ObjectID, entryID)
	if err != nil {
		return OtherUnitView{}, err
	}
	data, err := loadDetail(ctx, s.queries, EntityOtherUnit, entry.ID)
	if err != nil {
		return OtherUnitView{}, s.internal("load other-unit payload", err)
	}
	operatingEntityCode, operatingEntityName, err := s.relationshipOperatingEntity(ctx, identity.OperatingEntityID)
	if err != nil {
		return OtherUnitView{}, s.internal("load other-unit operating entity", err)
	}
	return OtherUnitView{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision, Enabled: object.Enabled,
		Approval: approvalMeta(entry), PartyID: party.ID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName,
		OperatingEntityID: identity.OperatingEntityID, OperatingEntityCode: operatingEntityCode, OperatingEntityName: operatingEntityName,
		Data: otherUnitData(data, identity.OperatingEntityID), UpdatedAt: object.UpdatedAt.Time.Format(time.RFC3339)}, nil
}

func (s *Service) OtherUnitSave(
	ctx context.Context, input OtherUnitSaveInput, actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validWriteInput(EntityOtherUnit, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid other-unit save", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin other-unit save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: EntityOtherUnit})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "other-unit not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock other-unit", err)
	}
	entry, err := s.entryForObject(ctx, qtx, EntityOtherUnit, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != input.ApprovalRevision {
		return MutationResult{}, domainErrorWithKey(ErrorConflict, "approval_stale_revision", "other-unit changed before save", nil, nil)
	}
	target := approvalEntry(entry)
	if approval.Status(entry.Status) == approval.StatusApproved {
		target, err = s.createNextApproval(ctx, tx, EntityOtherUnit, input.ObjectID, object.Code, object.Enabled, actor)
		if err == nil {
			err = copyDetail(ctx, qtx, EntityOtherUnit, target.ID, entry.ID)
		}
		if err != nil {
			return MutationResult{}, s.writeError("copy other-unit approval payload", err)
		}
	} else if approval.Status(entry.Status) != approval.StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "only a draft or latest approved version can be saved", nil, nil)
	}
	data, err := loadDetail(ctx, qtx, EntityOtherUnit, target.ID)
	if err != nil {
		return MutationResult{}, s.internal("load other-unit payload before save", err)
	}
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
			data, err = s.resolveSettlementSnapshot(ctx, tx, data)
			if err != nil {
				return MutationResult{}, err
			}
			data.DefaultSalesSurcharge = ""
		}
	}
	data, err = validateDetailData(EntityOtherUnit, data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid other-unit save", nil, err)
	}
	if err = updateDetail(ctx, qtx, EntityOtherUnit, target.ID, data); err != nil {
		return MutationResult{}, s.writeError("update other-unit payload", err)
	}
	target, err = s.transitionApproval(ctx, tx, EntityOtherUnit, input.ObjectID, object.Code, object.Enabled, target.ID, target.Revision, approval.ActionSaved, "", actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: input.ObjectID, Entity: EntityOtherUnit})
	if err != nil {
		return MutationResult{}, s.writeError("touch other-unit", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit other-unit save", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, target), nil
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
	enabledFilter := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	total, err := s.queries.CountBobObjects(ctx, dbsqlc.CountBobObjectsParams{Entity: EntityOtherUnit, Keyword: filters.Keyword, EnabledFilter: enabledFilter, StatusFilter: statuses})
	if err != nil {
		return Page[OtherUnitView]{}, s.internal("count other-units", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, dbsqlc.ListBobObjectsParams{Entity: EntityOtherUnit, Keyword: filters.Keyword, EnabledFilter: enabledFilter, StatusFilter: statuses, RowLimit: int32(input.PageSize), RowOffset: offset})
	if err != nil {
		return Page[OtherUnitView]{}, s.internal("list other-units", err)
	}
	items := make([]OtherUnitView, 0, len(rows))
	for _, row := range rows {
		view, getErr := s.OtherUnitGet(ctx, GetInput{ObjectID: row.ObjectID, ApprovalEntryID: func() string {
			if row.OpenApprovalEntryID != "" {
				return row.OpenApprovalEntryID
			}
			return row.ApprovalEntryID
		}()})
		if getErr != nil {
			return Page[OtherUnitView]{}, getErr
		}
		if filters.OperatingEntityID != "" && view.OperatingEntityID != filters.OperatingEntityID {
			continue
		}
		if len(statuses) != 0 && !slices.Contains(statuses, string(view.Approval.Status)) {
			continue
		}
		items = append(items, view)
	}
	return Page[OtherUnitView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) OtherUnitVersions(ctx context.Context, input HistoryInput) (Page[VersionHistoryItem], error) {
	if !validHistoryInput(EntityOtherUnit, input) {
		return Page[VersionHistoryItem]{}, domainError(ErrorValidation, "invalid versions request", nil, nil)
	}
	return s.Versions(ctx, EntityOtherUnit, input)
}
