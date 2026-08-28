package bob

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	ObjectID              string `json:"objectId"`
	Entity                string `json:"entity"`
	Code                  string `json:"code"`
	SourceApprovalEntryID string `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32  `json:"sourceVersionNo"`
	OperatingEntityID     string `json:"operatingEntityId"`
	OperatingEntityCode   string `json:"operatingEntityCode"`
	OperatingEntityName   string `json:"operatingEntityName"`
	Enabled               bool   `json:"enabled"`
}

type PartyView struct {
	PartyID               string                  `json:"partyId"`
	SourceApprovalEntryID string                  `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32                   `json:"sourceVersionNo"`
	Kind                  string                  `json:"kind"`
	LegalName             string                  `json:"legalName"`
	DisplayName           string                  `json:"displayName"`
	TaxNumber             string                  `json:"taxNumber,omitempty"`
	StrongIdentifiers     []PartyIdentifierInput  `json:"strongIdentifiers"`
	Phone                 string                  `json:"phone,omitempty"`
	Email                 string                  `json:"email,omitempty"`
	Address               string                  `json:"address,omitempty"`
	Relationships         []PartyRelationshipCard `json:"relationships"`
	UpdatedAt             string                  `json:"updatedAt"`
}

type PartyListItem struct {
	PartyID               string `json:"partyId"`
	SourceApprovalEntryID string `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32  `json:"sourceVersionNo"`
	Kind                  string `json:"kind"`
	LegalName             string `json:"legalName"`
	DisplayName           string `json:"displayName"`
	UpdatedAt             string `json:"updatedAt"`
}

func normalizePartyIdentifier(value string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(value)))
}

func NormalizePartyIdentifier(value string) string { return normalizePartyIdentifier(value) }

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

// ValidatePartyDeclaration exposes the shared Party identity invariant to DCL
// without letting DCL reach into BOB persistence.
func ValidatePartyDeclaration(data PartyCreateData) (PartyCreateData, []PartyIdentifierInput, error) {
	return validatePartyData(data)
}

type partyCurrentRow struct {
	ID, Kind, LegalName, DisplayName string
	SourceApprovalEntryID            string
	SourceVersionNo                  int32
	TaxNumber, Phone, Email, Address *string
	UpdatedAt                        pgtype.Timestamptz
}

func partyView(row partyCurrentRow, identifiers []PartyIdentifierInput) PartyView {
	result := PartyView{
		PartyID: row.ID, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo,
		Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName,
		TaxNumber: deref(row.TaxNumber), Phone: deref(row.Phone), Email: deref(row.Email),
		Address:           deref(row.Address),
		StrongIdentifiers: make([]PartyIdentifierInput, 0, len(identifiers)),
		Relationships:     make([]PartyRelationshipCard, 0), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
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
	if filters.Merged != nil {
		return Page[PartyListItem]{}, domainError(ErrorValidation, "invalid Party query", nil, nil)
	}
	var total int64
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM bob_party_currents current JOIN approval_entries source ON source.id=current.source_approval_entry_id AND source.domain='dcl' AND source.entity='party' AND source.status='APPROVED' WHERE ($1 = '' OR current.kind = $1) AND ($2 = '' OR current.legal_name ILIKE '%' || $2 || '%' OR current.display_name ILIKE '%' || $2 || '%')`, filters.PartyKind, filters.Keyword).Scan(&total)
	if err != nil {
		return Page[PartyListItem]{}, s.internal("count Parties", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT current.party_id,current.source_approval_entry_id,source.version_no,current.kind,current.legal_name,current.display_name,current.tax_number,current.phone,current.email,current.address,current.updated_at FROM bob_party_currents current JOIN approval_entries source ON source.id=current.source_approval_entry_id AND source.domain='dcl' AND source.entity='party' AND source.status='APPROVED' WHERE ($1 = '' OR current.kind = $1) AND ($2 = '' OR current.legal_name ILIKE '%' || $2 || '%' OR current.display_name ILIKE '%' || $2 || '%') ORDER BY current.display_name,current.party_id LIMIT $3 OFFSET $4`, filters.PartyKind, filters.Keyword, input.PageSize, offset)
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
		item := PartyListItem{PartyID: row.ID, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo,
			Kind: row.Kind, LegalName: row.LegalName,
			DisplayName: row.DisplayName, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339)}
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
	cards, cardErr := visiblePartyRelationshipCards(ctx, s.pool, input.PartyID, visibility)
	if cardErr != nil {
		return PartyView{}, s.internal("list Party relationships", cardErr)
	}
	result.Relationships = cards
	return result, nil
}

func visiblePartyRelationshipCards(ctx context.Context, q partyQueryer, partyID string, visibility PartyRelationshipVisibility) ([]PartyRelationshipCard, error) {
	if !(visibility.Customer || visibility.Supplier || visibility.Employment || visibility.OtherUnit || visibility.SalesPartner) {
		return []PartyRelationshipCard{}, nil
	}
	rows, err := partyRelationshipCards(ctx, q, partyID)
	if err != nil {
		return nil, err
	}
	result := make([]PartyRelationshipCard, 0, len(rows))
	for _, card := range rows {
		if !visibility.allows(card.Entity) {
			continue
		}
		result = append(result, PartyRelationshipCard(card))
	}
	return result, nil
}

type partyQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type partyRelationshipCardRow struct {
	ObjectID, Entity, Code, SourceApprovalEntryID string
	SourceVersionNo                               int32
	OperatingEntityID                             string
	OperatingEntityCode                           string
	OperatingEntityName                           string
	Enabled                                       bool
}

func scanParty(row interface{ Scan(...any) error }) (partyCurrentRow, error) {
	var result partyCurrentRow
	err := row.Scan(&result.ID, &result.SourceApprovalEntryID, &result.SourceVersionNo, &result.Kind, &result.LegalName, &result.DisplayName, &result.TaxNumber, &result.Phone, &result.Email, &result.Address, &result.UpdatedAt)
	return result, err
}

func partyByID(ctx context.Context, q partyQueryer, partyID string, lock bool) (partyCurrentRow, error) {
	sql := `SELECT current.party_id,current.source_approval_entry_id,source.version_no,current.kind,current.legal_name,current.display_name,current.tax_number,current.phone,current.email,current.address,current.updated_at FROM bob_party_currents current JOIN approval_entries source ON source.id=current.source_approval_entry_id AND source.domain='dcl' AND source.entity='party' AND source.status='APPROVED' WHERE current.party_id=$1`
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
		SELECT relation.object_id,'customer'::text AS entity,current.source_approval_entry_id,relation.operating_entity_id,current.enabled FROM bob_customer_relationships relation JOIN bob_customers current ON current.object_id=relation.object_id WHERE relation.party_id=$1 AND relation.merged_into_object_id IS NULL
		UNION ALL SELECT relation.object_id,'supplier',current.source_approval_entry_id,relation.operating_entity_id,current.enabled FROM bob_supplier_relationships relation JOIN bob_suppliers current ON current.object_id=relation.object_id WHERE relation.party_id=$1 AND relation.merged_into_object_id IS NULL
		UNION ALL SELECT relation.object_id,'employee',current.source_approval_entry_id,relation.operating_entity_id,current.enabled FROM bob_employment_relationships relation JOIN bob_employees current ON current.object_id=relation.object_id WHERE relation.party_id=$1 AND relation.merged_into_object_id IS NULL
		UNION ALL SELECT relation.object_id,'other-unit',current.source_approval_entry_id,relation.operating_entity_id,current.enabled FROM bob_service_relationships relation JOIN bob_other_units current ON current.object_id=relation.object_id WHERE relation.party_id=$1 AND relation.merged_into_object_id IS NULL
		UNION ALL SELECT relation.object_id,'sales-partner',current.source_approval_entry_id,relation.operating_entity_id,current.enabled FROM bob_sales_relationships relation JOIN bob_sales_partners current ON current.object_id=relation.object_id WHERE relation.party_id=$1 AND relation.merged_into_object_id IS NULL
	) SELECT r.object_id,r.entity,o.code,r.source_approval_entry_id,source.version_no,r.operating_entity_id,oe.code,COALESCE(ov.legal_name,''),r.enabled
	FROM relationships r JOIN bob_objects o ON o.id=r.object_id JOIN bob_objects oe ON oe.id=r.operating_entity_id
	JOIN bob_operating_entities ov ON ov.object_id=oe.id
	JOIN approval_entries source ON source.id=r.source_approval_entry_id AND source.domain='dcl' AND source.entity=r.entity AND source.status='APPROVED'
	ORDER BY o.code`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]partyRelationshipCardRow, 0)
	for rows.Next() {
		var item partyRelationshipCardRow
		if err = rows.Scan(&item.ObjectID, &item.Entity, &item.Code, &item.SourceApprovalEntryID, &item.SourceVersionNo, &item.OperatingEntityID, &item.OperatingEntityCode, &item.OperatingEntityName, &item.Enabled); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func insertPartyIdentifiers(ctx context.Context, tx pgx.Tx, partyID string, identifiers []PartyIdentifierInput) error {
	for _, identifier := range identifiers {
		if _, err := tx.Exec(ctx, `INSERT INTO bob_party_identifiers(party_id,identifier_type,value,normalized_value) VALUES($1,$2,$3,$4)`, partyID, identifier.Type, identifier.Value, normalizePartyIdentifier(identifier.Value)); err != nil {
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

type PartyRelationshipResolved = relationshipParty
