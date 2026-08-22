package bob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
)

const (
	SalesAttributionInternalEmployee = "INTERNAL_EMPLOYEE"
	SalesAttributionExternalPartTime = "EXTERNAL_PART_TIME"
	SalesAttributionDealer           = "CHANNEL_PARTNER"
)

type CustomerSnapshot struct {
	SourceObjectID        string `json:"sourceObjectId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	TermCode              string `json:"termCode,omitempty"`
	RuleType              string `json:"ruleType,omitempty"`
	DueDays               int32  `json:"dueDays,omitempty"`
	MonthOffset           int32  `json:"monthOffset,omitempty"`
	CutoffDay             int32  `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge string `json:"defaultSalesSurcharge,omitempty"`
	TaxNumber             string `json:"taxNumber,omitempty"`
	Address               string `json:"address,omitempty"`
	Phone                 string `json:"phone,omitempty"`
}
type CustomerSalesAttributionInput struct {
	Type            string `json:"type"`
	SubjectObjectID string `json:"subjectObjectId"`
}
type CustomerSalesAttributionView struct {
	CustomerSalesAttributionInput
	SubjectVersionID string `json:"subjectVersionId"`
	SubjectCode      string `json:"subjectCode"`
	SubjectName      string `json:"subjectName"`
}
type CustomerCreditLimit struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}
type CustomerAccountData struct {
	Name                       string                        `json:"name"`
	ShortName                  string                        `json:"shortName,omitempty"`
	CustomerTypeCode           string                        `json:"customerTypeCode"`
	ContactName                string                        `json:"contactName,omitempty"`
	ContactPhone               string                        `json:"contactPhone,omitempty"`
	Email                      string                        `json:"email,omitempty"`
	Address                    string                        `json:"address,omitempty"`
	OperatingEntityID          string                        `json:"operatingEntityId"`
	SettlementMethodID         string                        `json:"settlementMethodId,omitempty"`
	PaymentMethodID            string                        `json:"paymentMethodId,omitempty"`
	DefaultTransportMethodCode string                        `json:"defaultTransportMethodCode,omitempty"`
	DefaultTransportMethodName string                        `json:"defaultTransportMethodName,omitempty"`
	TransportSurcharge         string                        `json:"transportSurcharge,omitempty"`
	PricingPolicy              PricingPolicy                 `json:"pricingPolicy"`
	CreditLimits               []CustomerCreditLimit         `json:"creditLimits"`
	PrimarySalesAttribution    CustomerSalesAttributionInput `json:"primarySalesAttribution"`
	InternalReminder           string                        `json:"internalReminder,omitempty"`
	DefaultSalesOrderRemark    string                        `json:"defaultSalesOrderRemark,omitempty"`
	OperatingEntity            *CustomerSnapshot             `json:"operatingEntity,omitempty"`
	SettlementMethod           *CustomerSnapshot             `json:"settlementMethod,omitempty"`
	PaymentMethod              *CustomerSnapshot             `json:"paymentMethod,omitempty"`
	SalesAttribution           CustomerSalesAttributionView  `json:"-"`
}

func (data CustomerAccountData) MarshalJSON() ([]byte, error) {
	type alias CustomerAccountData
	return json.Marshal(struct {
		alias
		PrimarySalesAttribution CustomerSalesAttributionView `json:"primarySalesAttribution"`
	}{alias: alias(data), PrimarySalesAttribution: data.SalesAttribution})
}

type CustomerVersionView struct {
	Version     VersionMeta              `json:"version"`
	Data        CustomerAccountData      `json:"data"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}
type CustomerAccountView struct {
	ObjectID       string               `json:"objectId"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Effective      *CustomerVersionView `json:"effective,omitempty"`
	Candidate      *CustomerVersionView `json:"candidate,omitempty"`
}
type CustomerDetailView struct {
	ObjectID            string                   `json:"objectId"`
	Code                string                   `json:"code"`
	ObjectRevision      int64                    `json:"objectRevision"`
	Enabled             bool                     `json:"enabled"`
	PartyID             string                   `json:"partyId"`
	PartyKind           string                   `json:"partyKind"`
	PartyDisplayName    string                   `json:"partyDisplayName"`
	OperatingEntityID   string                   `json:"operatingEntityId"`
	OperatingEntityCode string                   `json:"operatingEntityCode"`
	OperatingEntityName string                   `json:"operatingEntityName"`
	Accounts            []CustomerAccountView    `json:"accounts"`
	UpdatedAt           time.Time                `json:"updatedAt"`
	Attachments         []CustomerAttachmentView `json:"attachments"`
}
type CustomerListVersion struct {
	VersionID            string  `json:"versionId"`
	Version              int32   `json:"version"`
	Status               string  `json:"status,omitempty"`
	Revision             int64   `json:"revision,omitempty"`
	Name                 string  `json:"name,omitempty"`
	CustomerTypeCode     string  `json:"customerTypeCode,omitempty"`
	OperatingEntityName  string  `json:"operatingEntityName,omitempty"`
	SalesAttributionName string  `json:"salesAttributionName,omitempty"`
	SubmittedBy          *string `json:"submittedBy"`
}
type CustomerListItem struct {
	ObjectID       string               `json:"objectId"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Effective      *CustomerListVersion `json:"effective"`
	Candidate      *CustomerListVersion `json:"candidate"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}
type CustomerCreateInput struct {
	PartyID  string              `json:"partyId,omitempty"`
	NewParty *PartyCreateData    `json:"newParty,omitempty"`
	Data     CustomerAccountData `json:"data"`
}
type CustomerAccountAddInput struct {
	CustomerRelationshipID string              `json:"customerRelationshipId"`
	Data                   CustomerAccountData `json:"data"`
}
type CustomerSaveInput struct {
	ObjectID  string              `json:"objectId"`
	VersionID string              `json:"versionId"`
	Revision  int64               `json:"revision"`
	Data      CustomerAccountData `json:"data"`
}
type CustomerCreateResult struct {
	MutationResult
	PartyID        string              `json:"partyId"`
	DefaultAccount CustomerAccountView `json:"defaultAccount"`
}

func normalizeCustomerAccount(data CustomerAccountData) (CustomerAccountData, error) {
	data.Name = strings.TrimSpace(data.Name)
	data.ShortName = strings.TrimSpace(data.ShortName)
	data.CustomerTypeCode = strings.TrimSpace(data.CustomerTypeCode)
	data.ContactName = strings.TrimSpace(data.ContactName)
	data.ContactPhone = strings.TrimSpace(data.ContactPhone)
	data.Email = strings.TrimSpace(data.Email)
	data.Address = strings.TrimSpace(data.Address)
	data.DefaultTransportMethodCode = strings.TrimSpace(data.DefaultTransportMethodCode)
	data.DefaultTransportMethodName = strings.TrimSpace(data.DefaultTransportMethodName)
	data.InternalReminder = strings.TrimSpace(data.InternalReminder)
	data.DefaultSalesOrderRemark = strings.TrimSpace(data.DefaultSalesOrderRemark)
	if data.Name == "" || data.CustomerTypeCode == "" || !validID(data.OperatingEntityID) {
		return CustomerAccountData{}, errors.New("customer name and customerTypeCode are required")
	}
	policy, err := normalizePricingPolicy(data.PricingPolicy)
	if err != nil {
		return CustomerAccountData{}, err
	}
	data.PricingPolicy = policy
	seenCurrency := make(map[string]struct{}, len(data.CreditLimits))
	for index := range data.CreditLimits {
		limit := &data.CreditLimits[index]
		limit.Currency = strings.ToUpper(strings.TrimSpace(limit.Currency))
		if limit.Currency != "CNY" {
			return CustomerAccountData{}, errors.New("only CNY credit limits are supported")
		}
		if _, duplicate := seenCurrency[limit.Currency]; duplicate {
			return CustomerAccountData{}, errors.New("duplicate credit limit currency")
		}
		seenCurrency[limit.Currency] = struct{}{}
		minor, parseErr := fixeddecimal.ParsePositive(strings.TrimSpace(limit.Amount), 2, true)
		if parseErr != nil {
			return CustomerAccountData{}, errors.New("invalid credit limit")
		}
		limit.Amount = fixeddecimal.Format(minor, 2, false)
	}
	if data.CreditLimits == nil {
		data.CreditLimits = []CustomerCreditLimit{}
	}
	switch data.PrimarySalesAttribution.Type {
	case SalesAttributionInternalEmployee, SalesAttributionExternalPartTime, SalesAttributionDealer:
	default:
		return CustomerAccountData{}, errors.New("invalid primary sales attribution type")
	}
	if !validID(data.PrimarySalesAttribution.SubjectObjectID) {
		return CustomerAccountData{}, errors.New("primary sales attribution subject is required")
	}
	if data.TransportSurcharge == "" {
		data.TransportSurcharge = "0.00"
	}
	minor, err := fixeddecimal.ParsePositive(data.TransportSurcharge, 2, true)
	if err != nil {
		return CustomerAccountData{}, errors.New("invalid transport surcharge")
	}
	data.TransportSurcharge = fixeddecimal.Format(minor, 2, false)
	sort.Slice(data.CreditLimits, func(left, right int) bool {
		return data.CreditLimits[left].Currency < data.CreditLimits[right].Currency
	})
	return data, nil
}

func (s *Service) CustomerQuery(ctx context.Context, input QueryInput) (Page[CustomerListItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 {
		return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer query", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	if statuses == nil {
		statuses = []string{}
	}
	for _, v := range statuses {
		if !validStatus(v) {
			return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer status", nil, nil)
		}
	}
	enabled := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	params := dbsqlc.CountBobCustomersParams{Keyword: strings.TrimSpace(input.Filters.Keyword), Statuses: statuses, EnabledFilter: enabled, CustomerType: strings.TrimSpace(input.Filters.CustomerType), OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), SalesAttributionType: strings.TrimSpace(input.Filters.SalesAttributionType), SalesAttributionSubjectID: strings.TrimSpace(input.Filters.SalesAttributionSubjectID)}
	total, err := s.queries.CountBobCustomers(ctx, params)
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("count customer accounts", err)
	}
	rows, err := s.queries.ListBobCustomers(ctx, dbsqlc.ListBobCustomersParams{Keyword: params.Keyword, Statuses: params.Statuses, EnabledFilter: params.EnabledFilter, CustomerType: params.CustomerType, OperatingEntityID: params.OperatingEntityID, SalesAttributionType: params.SalesAttributionType, SalesAttributionSubjectID: params.SalesAttributionSubjectID, RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("list customer accounts", err)
	}
	items := make([]CustomerListItem, 0, len(rows))
	for _, r := range rows {
		item := CustomerListItem{ObjectID: r.ObjectID, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time}
		if r.EffectiveVersionID != nil {
			item.Effective = &CustomerListVersion{VersionID: *r.EffectiveVersionID, Version: *r.EffectiveVersionNo, Status: deref(r.EffectiveStatus), Revision: *r.EffectiveRevision, Name: deref(r.EffectiveName), CustomerTypeCode: deref(r.EffectiveCustomerType), OperatingEntityName: r.EffectiveOperatingEntityName, SalesAttributionName: r.EffectiveSalesAttributionName, SubmittedBy: r.EffectiveSubmittedBy}
		}
		if r.CandidateVersionID != nil {
			item.Candidate = &CustomerListVersion{VersionID: *r.CandidateVersionID, Version: *r.CandidateVersionNo, Status: deref(r.CandidateStatus), Revision: *r.CandidateRevision, Name: deref(r.CandidateName), CustomerTypeCode: deref(r.CandidateCustomerType), SubmittedBy: r.CandidateSubmittedBy}
		}
		items = append(items, item)
	}
	return Page[CustomerListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) CustomerCreate(ctx context.Context, input CustomerCreateInput, actorID, requestID string, canReadMatchedParty bool) (CustomerCreateResult, error) {
	if !validActorAndRequest(actorID, requestID) || !validID(input.Data.OperatingEntityID) || (input.PartyID == "") == (input.NewParty == nil) {
		return CustomerCreateResult{}, domainError(ErrorValidation, "invalid customer create", nil, nil)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil {
		return CustomerCreateResult{}, domainError(ErrorValidation, "invalid customer account", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerCreateResult{}, s.internal("begin customer create", err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	if _, err = q.ResolveCustomerOperatingEntity(ctx, data.OperatingEntityID); errors.Is(err, pgx.ErrNoRows) {
		return CustomerCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, nil)
	} else if err != nil {
		return CustomerCreateResult{}, s.internal("resolve operating entity", err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, q, input.PartyID, input.NewParty, actorID, requestID, canReadMatchedParty)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	if err = s.rejectCustomerSelfAttribution(ctx, q, party.ID, data.PrimarySalesAttribution); err != nil {
		return CustomerCreateResult{}, err
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	relationID, relationVersionID := newID(), newID()
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomer})
	if err != nil {
		return CustomerCreateResult{}, s.writeError("allocate customer relationship number", err)
	}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: relationID, Entity: EntityCustomer, Code: fmt.Sprintf("CUR-%04d", n), CurrentVersionID: relationVersionID, ActorID: actorID}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship", err)
	}
	if err = q.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: relationVersionID, ObjectID: relationID, Entity: EntityCustomer, VersionNo: 1, ActorID: actorID}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship version", err)
	}
	if err = q.InsertBobCustomerRelationship(ctx, dbsqlc.InsertBobCustomerRelationshipParams{ObjectID: relationID, PartyID: party.ID, OperatingEntityID: data.OperatingEntityID, ActorID: actorID}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship identity", err)
	}
	if err = q.InsertBobCustomerRelationshipDetail(ctx, relationVersionID); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship detail", err)
	}
	account, err := s.insertCustomerAccount(ctx, q, relationID, data, actorID, requestID)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{ObjectID: relationID, VersionID: relationVersionID, Entity: EntityCustomer, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"partyId": party.ID, "operatingEntityId": data.OperatingEntityID}}); err != nil {
		return CustomerCreateResult{}, s.writeError("audit customer relationship", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerCreateResult{}, s.writeError("commit customer create", err)
	}
	return CustomerCreateResult{MutationResult: MutationResult{ObjectID: relationID, ObjectRevision: 1, Enabled: true, VersionID: relationVersionID, Version: 1, Status: StatusDraft, Revision: 1}, PartyID: party.ID, DefaultAccount: account}, nil
}
func (s *Service) CustomerAccountDelete(ctx context.Context, input DeleteInput) error {
	return s.Delete(ctx, EntityCustomerAccount, input)
}

func (s *Service) CustomerAccountAdd(ctx context.Context, input CustomerAccountAddInput, actorID, requestID string) (CustomerAccountView, error) {
	if !validID(input.CustomerRelationshipID) || !validActorAndRequest(actorID, requestID) {
		return CustomerAccountView{}, domainError(ErrorValidation, "invalid customer account add", nil, nil)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil {
		return CustomerAccountView{}, domainError(ErrorValidation, "invalid customer account", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAccountView{}, s.internal("begin customer account add", err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	relation, err := q.GetBobCustomerRelationshipDetail(ctx, input.CustomerRelationshipID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerAccountView{}, domainError(ErrorConflict, "customer relationship is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerAccountView{}, s.internal("lock customer relationship", err)
	}
	if relation.OperatingEntityID != data.OperatingEntityID {
		return CustomerAccountView{}, domainError(ErrorValidation, "customer account operating entity must match relationship", nil, nil)
	}
	if err = s.rejectCustomerSelfAttribution(ctx, q, relation.PartyID, data.PrimarySalesAttribution); err != nil {
		return CustomerAccountView{}, err
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return CustomerAccountView{}, err
	}
	result, err := s.insertCustomerAccount(ctx, q, input.CustomerRelationshipID, data, actorID, requestID)
	if err != nil {
		return CustomerAccountView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAccountView{}, s.writeError("commit customer account add", err)
	}
	return result, nil
}
func (s *Service) insertCustomerAccount(ctx context.Context, q *dbsqlc.Queries, relationshipID string, data CustomerAccountData, actorID, requestID string) (CustomerAccountView, error) {
	id, vid := newID(), newID()
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomerAccount})
	if err != nil {
		return CustomerAccountView{}, s.writeError("allocate customer account number", err)
	}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id, Entity: EntityCustomerAccount, Code: fmt.Sprintf("CAC-%04d", n), CurrentVersionID: vid, ActorID: actorID}); err != nil {
		return CustomerAccountView{}, s.writeError("insert customer account", err)
	}
	if err = q.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: vid, ObjectID: id, Entity: EntityCustomerAccount, VersionNo: 1, ActorID: actorID}); err != nil {
		return CustomerAccountView{}, s.writeError("insert customer account version", err)
	}
	if err = q.InsertBobCustomerAccountRelationship(ctx, dbsqlc.InsertBobCustomerAccountRelationshipParams{ObjectID: id, CustomerRelationshipID: relationshipID, ActorID: actorID}); err != nil {
		return CustomerAccountView{}, s.writeError("bind customer account", err)
	}
	if err = insertCustomerAccountData(ctx, q, vid, data); err != nil {
		return CustomerAccountView{}, s.writeError("insert customer account detail", err)
	}
	if err = insertAudit(ctx, q, auditInput{ObjectID: id, VersionID: vid, Entity: EntityCustomerAccount, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"customerRelationshipId": relationshipID}}); err != nil {
		return CustomerAccountView{}, s.writeError("audit customer account", err)
	}
	return CustomerAccountView{ObjectID: id, Code: fmt.Sprintf("CAC-%04d", n), ObjectRevision: 1, Enabled: true, Candidate: &CustomerVersionView{Version: VersionMeta{VersionID: vid, Version: 1, Status: StatusDraft, Revision: 1}, Data: data}}, nil
}
func (s *Service) CustomerGet(ctx context.Context, input GetInput) (CustomerDetailView, error) {
	if !validID(input.ObjectID) {
		return CustomerDetailView{}, domainError(ErrorValidation, "invalid customer relationship", nil, nil)
	}
	r, err := s.queries.GetBobCustomerRelationshipDetail(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerDetailView{}, domainError(ErrorValidation, "customer relationship not found", nil, nil)
	}
	if err != nil {
		return CustomerDetailView{}, s.internal("get customer relationship", err)
	}
	out := CustomerDetailView{ObjectID: r.ID, Code: r.Code, ObjectRevision: r.Revision, Enabled: r.Enabled, PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.PartyDisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: r.OperatingEntityCode, OperatingEntityName: r.OperatingEntityName, UpdatedAt: r.UpdatedAt.Time, Accounts: []CustomerAccountView{}}
	rows, err := s.queries.ListBobCustomerAccounts(ctx, input.ObjectID)
	if err != nil {
		return CustomerDetailView{}, s.internal("list customer accounts", err)
	}
	for _, a := range rows {
		v, loadErr := s.loadCustomerVersion(ctx, a.ID, a.CurrentVersionID)
		if loadErr != nil {
			return CustomerDetailView{}, loadErr
		}
		view := CustomerAccountView{ObjectID: a.ID, Code: a.Code, ObjectRevision: a.Revision, Enabled: a.Enabled}
		if a.EffectiveVersionID != nil {
			view.Effective = &v
		}
		if a.EffectiveVersionID == nil || a.CurrentVersionID != *a.EffectiveVersionID {
			view.Candidate = &v
		}
		out.Accounts = append(out.Accounts, view)
	}
	return out, nil
}
func (s *Service) CustomerSave(ctx context.Context, input CustomerSaveInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(EntityCustomerAccount, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer account save", nil, nil)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer account", nil, err)
	}
	tx, q, object, version, err := s.lockTarget(ctx, EntityCustomerAccount, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "customer account changed before save")
	}
	relation, err := q.GetBobCustomerAccountRelationshipParty(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "customer relationship is unavailable", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("load customer relationship", err)
	}
	if relation.OperatingEntityID != data.OperatingEntityID {
		return MutationResult{}, domainError(ErrorValidation, "customer account operating entity must match relationship", nil, nil)
	}
	if err = s.rejectCustomerSelfAttribution(ctx, q, relation.PartyID, data.PrimarySalesAttribution); err != nil {
		return MutationResult{}, err
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return MutationResult{}, err
	}
	targetID, targetNo, objectRevision := input.VersionID, version.VersionNo, object.Revision
	candidate := false
	if version.Status == StatusEffective && object.EffectiveVersionID != nil && *object.EffectiveVersionID == input.VersionID {
		targetID, targetNo, candidate = newID(), object.NextVersionNo, true
		if err = q.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: targetID, ObjectID: input.ObjectID, Entity: EntityCustomerAccount, VersionNo: targetNo, ActorID: actorID}); err != nil {
			return MutationResult{}, s.writeError("insert customer account candidate", err)
		}
		if err = q.CopyCustomerVersionAttachments(ctx, dbsqlc.CopyCustomerVersionAttachmentsParams{SourceVersionID: input.VersionID, TargetVersionID: targetID}); err != nil {
			return MutationResult{}, s.writeError("copy customer account attachments", err)
		}
		rows, advanceErr := q.AdvanceBobCustomerAccountCandidate(ctx, dbsqlc.AdvanceBobCustomerAccountCandidateParams{VersionID: targetID, ActorID: actorID, ObjectID: input.ObjectID, Revision: object.Revision, CurrentVersionID: input.VersionID})
		if advanceErr != nil || rows != 1 {
			return MutationResult{}, conflict(object, version, "customer account changed before save")
		}
		objectRevision++
	} else if version.Status != StatusDraft || (object.EffectiveVersionID != nil && object.CurrentVersionID == *object.EffectiveVersionID) {
		return MutationResult{}, conflict(object, version, "customer account changed before save")
	}
	if err = q.DeleteBobCustomerCreditLimits(ctx, targetID); err != nil {
		return MutationResult{}, s.writeError("delete customer account credit limits", err)
	}
	if !candidate {
		if _, err = q.DeleteBobCustomerDetail(ctx, targetID); err != nil {
			return MutationResult{}, s.writeError("replace customer account detail", err)
		}
	}
	if err = insertCustomerAccountData(ctx, q, targetID, data); err != nil {
		return MutationResult{}, s.writeError("insert customer account detail", err)
	}
	if candidate {
		if err = insertAudit(ctx, q, auditInput{ObjectID: input.ObjectID, VersionID: targetID, Entity: EntityCustomerAccount, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"sourceVersionId": input.VersionID, "reason": "CUSTOMER_ACCOUNT_EDIT"}}); err != nil {
			return MutationResult{}, s.writeError("audit customer account candidate", err)
		}
		if err = tx.Commit(ctx); err != nil {
			return MutationResult{}, s.writeError("commit customer account candidate", err)
		}
		return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision, Enabled: object.Enabled, VersionID: targetID, Version: targetNo, Status: StatusDraft, Revision: 1}, nil
	}
	rows, err := q.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{ActorID: actorID, ID: targetID, ObjectID: input.ObjectID, Entity: EntityCustomerAccount, Revision: input.Revision})
	if err != nil || rows != 1 {
		return MutationResult{}, conflict(object, version, "customer account changed before save")
	}
	if err = q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: EntityCustomerAccount}); err != nil {
		return MutationResult{}, s.internal("touch customer account", err)
	}
	if err = insertAudit(ctx, q, auditInput{ObjectID: input.ObjectID, VersionID: targetID, Entity: EntityCustomerAccount, Event: "SAVED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": []string{"pricingPolicy", "creditLimits", "primarySalesAttribution"}}}); err != nil {
		return MutationResult{}, s.writeError("audit customer account save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit customer account save", err)
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: object.Revision, Enabled: object.Enabled, VersionID: targetID, Version: targetNo, Status: StatusDraft, Revision: input.Revision + 1}, nil
}
func (s *Service) loadCustomerVersion(ctx context.Context, objectID, versionID string) (CustomerVersionView, error) {
	row, err := s.queries.GetBobCustomerVersion(ctx, dbsqlc.GetBobCustomerVersionParams{ObjectID: objectID, VersionID: versionID})
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerVersionView{}, domainError(ErrorValidation, "customer version not found", nil, nil)
	}
	if err != nil {
		return CustomerVersionView{}, s.internal("load customer version", err)
	}
	result := CustomerVersionView{Version: VersionMeta{VersionID: row.ID, Version: row.VersionNo, Status: row.Status, Revision: row.Revision, CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt.Time, UpdatedBy: row.UpdatedBy, SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy, ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment}, Data: CustomerAccountData{Name: row.Name, ShortName: row.ShortName, CustomerTypeCode: row.CustomerType, ContactName: row.ContactName, ContactPhone: row.ContactPhone, Email: row.Email, Address: row.Address, DefaultTransportMethodCode: row.DefaultTransportMethodCode, DefaultTransportMethodName: row.DefaultTransportMethodName, InternalReminder: row.InternalReminder, DefaultSalesOrderRemark: row.DefaultSalesOrderRemark}}
	if err = json.Unmarshal(row.PricingPolicy, &result.Data.PricingPolicy); err != nil {
		return CustomerVersionView{}, s.internal("decode customer pricing policy", err)
	}
	result.Data.OperatingEntityID = row.OperatingEntityID
	if row.OperatingEntityID != "" {
		result.Data.OperatingEntity = &CustomerSnapshot{SourceObjectID: row.OperatingEntityID, Code: row.OperatingEntityCode, Name: row.OperatingEntityName, TaxNumber: row.OperatingEntityTaxNumber, Address: row.OperatingEntityAddress, Phone: row.OperatingEntityPhone}
	}
	result.Data.SettlementMethodID = row.SettlementMethodID
	if row.SettlementMethodID != "" {
		result.Data.SettlementMethod = &CustomerSnapshot{SourceObjectID: row.SettlementMethodID, Code: row.SettlementMethodCode, Name: row.SettlementMethodName, TermCode: row.SettlementTermCode, RuleType: row.SettlementRuleType, DueDays: row.SettlementDueDays, MonthOffset: row.SettlementMonthOffset, CutoffDay: row.SettlementCutoffDay, DefaultSalesSurcharge: fixeddecimal.Format(row.SettlementSalesSurchargeCents, 2, false)}
	}
	result.Data.PaymentMethodID = row.PaymentMethodID
	if row.PaymentMethodID != "" {
		result.Data.PaymentMethod = &CustomerSnapshot{SourceObjectID: row.PaymentMethodID, Code: row.PaymentMethodCode, Name: row.PaymentMethodName, DefaultSalesSurcharge: fixeddecimal.Format(row.PaymentSalesSurchargeCents, 2, false)}
	}
	result.Data.TransportSurcharge = fixeddecimal.Format(row.TransportSurchargeCents, 2, false)
	result.Data.PrimarySalesAttribution = CustomerSalesAttributionInput{Type: deref(row.PrimarySalesAttributionType), SubjectObjectID: deref(row.PrimarySalesSubjectID)}
	result.Data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: result.Data.PrimarySalesAttribution, SubjectVersionID: deref(row.PrimarySalesSubjectVersionID), SubjectCode: deref(row.PrimarySalesSubjectCode), SubjectName: deref(row.PrimarySalesSubjectName)}
	limits, err := s.queries.ListBobCustomerCreditLimits(ctx, versionID)
	if err != nil {
		return CustomerVersionView{}, s.internal("load customer credit limits", err)
	}
	result.Data.CreditLimits = make([]CustomerCreditLimit, 0, len(limits))
	for _, limit := range limits {
		result.Data.CreditLimits = append(result.Data.CreditLimits, CustomerCreditLimit{Currency: limit.Currency, Amount: fixeddecimal.Format(limit.AmountCents, 2, false)})
	}
	return result, nil
}

func insertCustomerAccountData(ctx context.Context, q *dbsqlc.Queries, versionID string, data CustomerAccountData) error {
	policy, err := json.Marshal(data.PricingPolicy)
	if err != nil {
		return err
	}
	transportMinor, _ := fixeddecimal.ParsePositive(data.TransportSurcharge, 2, true)
	salespersonEmployeeID := ""
	if data.PrimarySalesAttribution.Type == SalesAttributionInternalEmployee {
		salespersonEmployeeID = data.PrimarySalesAttribution.SubjectObjectID
	}
	err = q.InsertBobCustomerAccountData(ctx, dbsqlc.InsertBobCustomerAccountDataParams{
		VersionID: versionID, Name: data.Name, CustomerType: data.CustomerTypeCode, ShortName: data.ShortName, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, SalespersonEmployeeID: salespersonEmployeeID,
		OperatingEntityID: data.OperatingEntityID, OperatingEntityCode: snapshotCode(data.OperatingEntity), OperatingEntityName: snapshotName(data.OperatingEntity), OperatingEntityTaxNumber: snapshotTax(data.OperatingEntity), OperatingEntityAddress: snapshotAddress(data.OperatingEntity), OperatingEntityPhone: snapshotPhone(data.OperatingEntity),
		SettlementMethodID: data.SettlementMethodID, SettlementMethodCode: snapshotCode(data.SettlementMethod), SettlementMethodName: snapshotName(data.SettlementMethod), SettlementTermCode: snapshotTerm(data.SettlementMethod), SettlementRuleType: snapshotRule(data.SettlementMethod), SettlementDueDays: snapshotDueDays(data.SettlementMethod), SettlementMonthOffset: snapshotMonthOffset(data.SettlementMethod), SettlementCutoffDay: snapshotCutoffDay(data.SettlementMethod), SettlementSalesSurchargeCents: snapshotSurchargeMinor(data.SettlementMethod),
		PaymentMethodID: data.PaymentMethodID, PaymentMethodCode: snapshotCode(data.PaymentMethod), PaymentMethodName: snapshotName(data.PaymentMethod), PaymentSalesSurchargeCents: snapshotSurchargeMinor(data.PaymentMethod), DefaultTransportMethodCode: data.DefaultTransportMethodCode, DefaultTransportMethodName: data.DefaultTransportMethodName, TransportSurchargeCents: transportMinor, PricingPolicy: policy,
		PrimarySalesAttributionType: &data.PrimarySalesAttribution.Type, PrimarySalesSubjectID: &data.PrimarySalesAttribution.SubjectObjectID, PrimarySalesSubjectVersionID: &data.SalesAttribution.SubjectVersionID, PrimarySalesSubjectCode: &data.SalesAttribution.SubjectCode, PrimarySalesSubjectName: &data.SalesAttribution.SubjectName, InternalReminder: data.InternalReminder, DefaultSalesOrderRemark: data.DefaultSalesOrderRemark,
	})
	if err != nil {
		return err
	}
	for _, limit := range data.CreditLimits {
		minor, _ := fixeddecimal.ParsePositive(limit.Amount, 2, true)
		if err = q.InsertBobCustomerCreditLimit(ctx, dbsqlc.InsertBobCustomerCreditLimitParams{VersionID: versionID, Currency: limit.Currency, AmountCents: minor}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) resolveCustomerSnapshots(ctx context.Context, tx pgx.Tx, data CustomerAccountData) (CustomerAccountData, error) {
	if data.PrimarySalesAttribution.Type == SalesAttributionInternalEmployee {
		subject, err := s.ResolveCurrentEffectiveReference(ctx, tx, EntityEmployee, data.PrimarySalesAttribution.SubjectObjectID)
		if err != nil {
			return CustomerAccountData{}, err
		}
		data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: data.PrimarySalesAttribution, SubjectVersionID: subject.VersionID, SubjectCode: subject.Code, SubjectName: subject.Data.Name}
	} else {
		partner, err := s.queries.WithTx(tx).ResolveCurrentBobEffectiveSalesPartnerReference(ctx, data.PrimarySalesAttribution.SubjectObjectID)
		if errors.Is(err, pgx.ErrNoRows) {
			return CustomerAccountData{}, domainError(ErrorConflict, "sales-partner reference is unavailable", nil, nil)
		}
		if err != nil {
			return CustomerAccountData{}, s.internal("resolve sales-partner attribution", err)
		}
		required := SalesCapabilityExternalPartTime
		if data.PrimarySalesAttribution.Type == SalesAttributionDealer {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(partner.Capabilities, required) {
			return CustomerAccountData{}, domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
		data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: data.PrimarySalesAttribution, SubjectVersionID: partner.VersionID, SubjectCode: partner.Code, SubjectName: partner.Name}
	}
	if data.OperatingEntityID != "" {
		operating, resolveErr := s.resolveOperatingEntityReference(ctx, tx, data.OperatingEntityID)
		if resolveErr != nil {
			return CustomerAccountData{}, resolveErr
		}
		data.OperatingEntity = &operating
	}
	if data.SettlementMethodID != "" {
		settlement, resolveErr := s.resolveCustomerAuxSnapshot(ctx, tx, "settlement-method", data.SettlementMethodID)
		if resolveErr != nil {
			return CustomerAccountData{}, resolveErr
		}
		data.SettlementMethod = &settlement
	}
	if data.PaymentMethodID != "" {
		payment, resolveErr := s.resolveCustomerAuxSnapshot(ctx, tx, "payment-method", data.PaymentMethodID)
		if resolveErr != nil {
			return CustomerAccountData{}, resolveErr
		}
		data.PaymentMethod = &payment
	}
	return data, nil
}

func (s *Service) resolveCustomerAuxSnapshot(ctx context.Context, tx pgx.Tx, entity, objectID string) (CustomerSnapshot, error) {
	if s.auxiliaryResolver == nil {
		return CustomerSnapshot{}, domainError(ErrorInternal, "internal server error", nil, errors.New("auxiliary resolver is not configured"))
	}
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, entity, objectID, "")
	if err != nil {
		return CustomerSnapshot{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return CustomerSnapshot{SourceObjectID: reference.ObjectID, Code: reference.Code, Name: mapString(reference.Data, "name"),
		TermCode: mapString(reference.Data, "termCode"), RuleType: mapString(reference.Data, "ruleType"),
		DueDays: int32(mapInt(reference.Data, "dayOffset")), MonthOffset: int32(mapInt(reference.Data, "monthOffset")),
		CutoffDay: int32(mapInt(reference.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(reference.Data, "defaultSalesSurcharge")}, nil
}

func (s *Service) resolveOperatingEntityReference(ctx context.Context, tx pgx.Tx, objectID string) (CustomerSnapshot, error) {
	row, err := s.queries.WithTx(tx).ResolveCustomerOperatingEntity(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerSnapshot{}, domainError(ErrorConflict, "operating-entity reference is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerSnapshot{}, s.internal("resolve operating entity", err)
	}
	return CustomerSnapshot{SourceObjectID: row.ID, Code: row.Code, Name: row.LegalName, TaxNumber: row.TaxNumber, Address: row.Address, Phone: row.Phone}, nil
}

func snapshotCode(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.Code
}
func snapshotName(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.Name
}
func snapshotTax(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.TaxNumber
}
func snapshotAddress(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.Address
}
func snapshotPhone(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.Phone
}
func snapshotTerm(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.TermCode
}
func snapshotRule(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.RuleType
}
func snapshotDueDays(value *CustomerSnapshot) int32 {
	if value == nil {
		return 0
	}
	return value.DueDays
}
func snapshotMonthOffset(value *CustomerSnapshot) int32 {
	if value == nil {
		return 0
	}
	return value.MonthOffset
}
func snapshotCutoffDay(value *CustomerSnapshot) int32 {
	if value == nil {
		return 0
	}
	return value.CutoffDay
}
func snapshotSurchargeMinor(value *CustomerSnapshot) int64 {
	if value == nil {
		return 0
	}
	n, _ := fixeddecimal.ParsePositive(value.DefaultSalesSurcharge, 2, true)
	return n
}

func (s *Service) rejectCustomerSelfAttribution(ctx context.Context, q *dbsqlc.Queries, customerPartyID string, attribution CustomerSalesAttributionInput) error {
	if attribution.Type == SalesAttributionInternalEmployee {
		return nil
	}
	partner, err := q.ResolveCurrentBobEffectiveSalesPartnerReference(ctx, attribution.SubjectObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "sales-partner reference is unavailable", nil, nil)
	}
	if err != nil {
		return s.internal("resolve sales-partner attribution Party", err)
	}
	if partner.PartyID == customerPartyID {
		return domainError(ErrorValidation, "customer cannot attribute sales to itself", nil, nil)
	}
	return nil
}

func hasSalesCapability(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
