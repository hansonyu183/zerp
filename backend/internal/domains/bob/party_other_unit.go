package bob

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
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
	total, err := s.queries.CountDCLApprovedPartiesForBOB(ctx, dbsqlc.CountDCLApprovedPartiesForBOBParams{
		PartyKind: filters.PartyKind,
		Keyword:   filters.Keyword,
	})
	if err != nil {
		return Page[PartyListItem]{}, s.internal("count Parties", err)
	}
	rows, err := s.queries.ListDCLApprovedPartiesForBOB(ctx, dbsqlc.ListDCLApprovedPartiesForBOBParams{
		PartyKind: filters.PartyKind,
		Keyword:   filters.Keyword,
		RowOffset: offset,
		RowLimit:  int32(input.PageSize),
	})
	if err != nil {
		return Page[PartyListItem]{}, s.internal("list Parties", err)
	}
	items := make([]PartyListItem, 0, input.PageSize)
	for _, row := range rows {
		item := PartyListItem{PartyID: row.ID, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo,
			Kind: row.Kind, LegalName: row.LegalName,
			DisplayName: row.DisplayName, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339)}
		items = append(items, item)
	}
	return Page[PartyListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) PartyGet(ctx context.Context, input PartyGetInput, visibility PartyRelationshipVisibility) (PartyView, error) {
	if !validID(input.PartyID) {
		return PartyView{}, domainError(ErrorValidation, "invalid Party", nil, nil)
	}
	row, err := partyByID(ctx, s.queries, input.PartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PartyView{}, domainError(ErrorValidation, "Party not found", nil, nil)
	}
	if err != nil {
		return PartyView{}, s.internal("get Party", err)
	}
	identifiers, err := partyIdentifiers(ctx, s.queries, input.PartyID)
	if err != nil {
		return PartyView{}, s.internal("list Party identifiers", err)
	}
	result := partyView(row, identifiers)
	cards, cardErr := visiblePartyRelationshipCards(ctx, s.queries, input.PartyID, visibility)
	if cardErr != nil {
		return PartyView{}, s.internal("list Party relationships", cardErr)
	}
	result.Relationships = cards
	return result, nil
}

func visiblePartyRelationshipCards(ctx context.Context, queries *dbsqlc.Queries, partyID string, visibility PartyRelationshipVisibility) ([]PartyRelationshipCard, error) {
	if !(visibility.Customer || visibility.Supplier || visibility.Employment || visibility.OtherUnit || visibility.SalesPartner) {
		return []PartyRelationshipCard{}, nil
	}
	rows, err := partyRelationshipCards(ctx, queries, partyID)
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

type partyRelationshipCardRow struct {
	ObjectID, Entity, Code, SourceApprovalEntryID string
	SourceVersionNo                               int32
	OperatingEntityID                             string
	OperatingEntityCode                           string
	OperatingEntityName                           string
	Enabled                                       bool
}

func partyByID(ctx context.Context, queries *dbsqlc.Queries, partyID string) (partyCurrentRow, error) {
	row, err := queries.GetDCLApprovedPartyForBOB(ctx, partyID)
	return partyCurrentRow{
		ID: row.ID, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo,
		Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName,
		TaxNumber: row.TaxNumber, Phone: row.Phone, Email: row.Email, Address: row.Address,
		UpdatedAt: row.UpdatedAt,
	}, err
}

func partyIdentifiers(ctx context.Context, queries *dbsqlc.Queries, partyID string) ([]PartyIdentifierInput, error) {
	rows, err := queries.ListDCLApprovedPartyIdentifiersForBOB(ctx, partyID)
	if err != nil {
		return nil, err
	}
	items := make([]PartyIdentifierInput, 0, len(rows))
	for _, row := range rows {
		items = append(items, PartyIdentifierInput{Type: row.IdentifierType, Value: row.Value})
	}
	return items, nil
}

func partyRelationshipCards(ctx context.Context, queries *dbsqlc.Queries, partyID string) ([]partyRelationshipCardRow, error) {
	rows, err := queries.ListDCLApprovedPartyRelationshipCardsForBOB(ctx, partyID)
	if err != nil {
		return nil, err
	}
	items := make([]partyRelationshipCardRow, 0, len(rows))
	for _, row := range rows {
		items = append(items, partyRelationshipCardRow{
			ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code,
			SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo,
			OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode,
			OperatingEntityName: row.OperatingEntityName, Enabled: row.Enabled,
		})
	}
	return items, nil
}

type relationshipParty struct {
	ID          string
	Kind        string
	DisplayName string
}

type PartyRelationshipResolved = relationshipParty
