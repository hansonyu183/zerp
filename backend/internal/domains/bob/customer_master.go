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

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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
	ApprovalEntryID       string `json:"approvalEntryId"`
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
	SubjectApprovalEntryID string `json:"subjectApprovalEntryId"`
	SubjectCode            string `json:"subjectCode"`
	SubjectName            string `json:"subjectName"`
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
	Approval    VersionMeta              `json:"approval"`
	Data        CustomerAccountData      `json:"data"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}
type CustomerAccountView struct {
	ObjectID       string               `json:"objectId"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	LatestApproved *CustomerVersionView `json:"latestApproved,omitempty"`
	OpenVersion    *CustomerVersionView `json:"openVersion,omitempty"`
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
	Approval             approval.VersionMeta `json:"approval"`
	Name                 string               `json:"name,omitempty"`
	CustomerTypeCode     string               `json:"customerTypeCode,omitempty"`
	OperatingEntityName  string               `json:"operatingEntityName,omitempty"`
	SalesAttributionName string               `json:"salesAttributionName,omitempty"`
}
type CustomerListItem struct {
	ObjectID       string               `json:"objectId"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	LatestApproved *CustomerListVersion `json:"latestApproved"`
	OpenVersion    *CustomerListVersion `json:"openVersion"`
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
	ObjectID         string              `json:"objectId"`
	ApprovalEntryID  string              `json:"approvalEntryId"`
	ApprovalRevision int64               `json:"approvalRevision"`
	Data             CustomerAccountData `json:"data"`
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
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer sort", nil, nil)
	}
	if (input.Filters.CustomerType != "" && !objectCodePattern.MatchString(strings.TrimSpace(input.Filters.CustomerType))) ||
		(input.Filters.OperatingEntityID != "" && !validID(strings.TrimSpace(input.Filters.OperatingEntityID))) ||
		(input.Filters.SalesAttributionSubjectID != "" && !validID(strings.TrimSpace(input.Filters.SalesAttributionSubjectID))) ||
		(input.Filters.SalesAttributionType != "" && !slices.Contains([]string{SalesAttributionInternalEmployee, SalesAttributionExternalPartTime, SalesAttributionDealer}, strings.TrimSpace(input.Filters.SalesAttributionType))) {
		return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer filters", nil, nil)
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
	params := bobListParams(EntityCustomer, input.Filters, enabled, statuses, "code", "asc", int32((input.Page-1)*input.PageSize), int32(input.PageSize))
	total, err := s.queries.CountBobObjects(ctx, bobCountParams(params))
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("count customer accounts", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, params)
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("list customer accounts", err)
	}
	items := make([]CustomerListItem, 0, len(rows))
	for _, r := range rows {
		item := CustomerListItem{ObjectID: r.ObjectID, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time}
		if r.ApprovalEntryID != "" {
			entry, entryErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: r.ApprovalEntryID, Domain: "bob", Entity: EntityCustomer})
			if entryErr != nil {
				return Page[CustomerListItem]{}, s.internal("get customer approval", entryErr)
			}
			item.LatestApproved = &CustomerListVersion{Approval: approvalMeta(entry)}
		}
		if r.OpenApprovalEntryID != "" {
			entry, entryErr := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: r.OpenApprovalEntryID, Domain: "bob", Entity: EntityCustomer})
			if entryErr != nil {
				return Page[CustomerListItem]{}, s.internal("get customer approval", entryErr)
			}
			item.OpenVersion = &CustomerListVersion{Approval: approvalMeta(entry)}
		}
		if len(statuses) > 0 && (item.OpenVersion == nil || !slices.Contains(statuses, string(item.OpenVersion.Approval.Status))) && (item.LatestApproved == nil || !slices.Contains(statuses, string(item.LatestApproved.Approval.Status))) {
			continue
		}
		items = append(items, item)
	}
	return Page[CustomerListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) CustomerCreate(ctx context.Context, input CustomerCreateInput, actor approval.Actor, canReadMatchedParty bool) (CustomerCreateResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, data.OperatingEntityID); err != nil {
		return CustomerCreateResult{}, domainError(ErrorConflict, "经营主体不可用", nil, err)
	}
	party, err := s.resolveOrCreateRelationshipParty(ctx, q, input.PartyID, input.NewParty, actorID, requestID, canReadMatchedParty, tx)
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
	relationID := newID()
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomer})
	if err != nil {
		return CustomerCreateResult{}, s.writeError("allocate customer relationship number", err)
	}
	code := fmt.Sprintf("CUR-%04d", n)
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: relationID, Entity: EntityCustomer, Code: code, ActorID: actorID}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntityCustomer, relationID, code, true, actor)
	if err != nil {
		return CustomerCreateResult{}, translateApprovalError(err)
	}
	if err = q.InsertBobCustomerRelationship(ctx, dbsqlc.InsertBobCustomerRelationshipParams{ObjectID: relationID, PartyID: party.ID, OperatingEntityID: data.OperatingEntityID, ActorID: actorID}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship identity", err)
	}
	if err = insertDetail(ctx, q, EntityCustomer, entry.ID, DetailView{}); err != nil {
		return CustomerCreateResult{}, s.writeError("insert customer relationship detail", err)
	}
	account, err := s.insertCustomerAccount(ctx, tx, q, relationID, data, actor)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerCreateResult{}, s.writeError("commit customer create", err)
	}
	return CustomerCreateResult{MutationResult: approvalMutation(relationID, 1, true, entry), PartyID: party.ID, DefaultAccount: account}, nil
}
func (s *Service) CustomerAccountDelete(ctx context.Context, input DeleteInput, actor approval.Actor) error {
	return s.Delete(ctx, EntityCustomerAccount, input, actor)
}

func (s *Service) CustomerAccountAdd(ctx context.Context, input CustomerAccountAddInput, actor approval.Actor) (CustomerAccountView, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
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
	relation, err := q.GetBobCustomerRelationship(ctx, input.CustomerRelationshipID)
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
	result, err := s.insertCustomerAccount(ctx, tx, q, input.CustomerRelationshipID, data, actor)
	if err != nil {
		return CustomerAccountView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAccountView{}, s.writeError("commit customer account add", err)
	}
	return result, nil
}
func (s *Service) insertCustomerAccount(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, relationshipID string, data CustomerAccountData, actor approval.Actor) (CustomerAccountView, error) {
	id := newID()
	n, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomerAccount})
	if err != nil {
		return CustomerAccountView{}, s.writeError("allocate customer account number", err)
	}
	code := fmt.Sprintf("CAC-%04d", n)
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: id, Entity: EntityCustomerAccount, Code: code, ActorID: actor.ID()}); err != nil {
		return CustomerAccountView{}, s.writeError("insert customer account", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, EntityCustomerAccount, id, code, true, actor)
	if err != nil {
		return CustomerAccountView{}, translateApprovalError(err)
	}
	if err = q.InsertBobCustomerAccountRelationship(ctx, dbsqlc.InsertBobCustomerAccountRelationshipParams{ObjectID: id, CustomerRelationshipID: relationshipID, ActorID: actor.ID()}); err != nil {
		return CustomerAccountView{}, s.writeError("bind customer account", err)
	}
	if err = writeCustomerAccountData(ctx, q, entry.ID, data, true); err != nil {
		return CustomerAccountView{}, s.writeError("insert customer account detail", err)
	}
	return CustomerAccountView{ObjectID: id, Code: code, ObjectRevision: 1, Enabled: true, OpenVersion: &CustomerVersionView{Approval: approval.VersionMetaFromEntry(entry), Data: data}}, nil
}
func (s *Service) CustomerGet(ctx context.Context, input GetInput) (CustomerDetailView, error) {
	if !validID(input.ObjectID) {
		return CustomerDetailView{}, domainError(ErrorValidation, "invalid customer relationship", nil, nil)
	}
	r, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: input.ObjectID, Entity: EntityCustomer})
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerDetailView{}, domainError(ErrorValidation, "customer relationship not found", nil, nil)
	}
	if err != nil {
		return CustomerDetailView{}, s.internal("get customer relationship", err)
	}
	identity, err := s.queries.GetBobCustomerRelationship(ctx, input.ObjectID)
	if err != nil {
		return CustomerDetailView{}, s.internal("get customer relationship", err)
	}
	party, err := s.queries.GetBobParty(ctx, identity.PartyID)
	if err != nil {
		return CustomerDetailView{}, s.internal("get customer party", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerDetailView{}, s.internal("begin customer read", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	operating, err := s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID)
	if err != nil {
		return CustomerDetailView{}, err
	}
	out := CustomerDetailView{ObjectID: r.ID, Code: r.Code, ObjectRevision: r.Revision, Enabled: r.Enabled, PartyID: party.ID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName, OperatingEntityID: identity.OperatingEntityID, OperatingEntityCode: operating.Code, OperatingEntityName: operating.Data.Name, UpdatedAt: r.UpdatedAt.Time, Accounts: []CustomerAccountView{}}
	accounts, err := s.queries.WithTx(tx).ListBobCustomerAccountObjects(ctx, input.ObjectID)
	if err != nil {
		return CustomerDetailView{}, s.internal("list customer accounts", err)
	}
	for _, account := range accounts {
		view := CustomerAccountView{ObjectID: account.ID, Code: account.Code, ObjectRevision: account.Revision, Enabled: account.Enabled}
		if latest, latestErr := s.queries.WithTx(tx).GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntityCustomerAccount, ObjectID: account.ID}); latestErr == nil {
			loaded, loadErr := s.loadCustomerVersionWithQueries(ctx, s.queries.WithTx(tx), latest)
			if loadErr != nil {
				return CustomerDetailView{}, loadErr
			}
			view.LatestApproved = &loaded
		} else if !errors.Is(latestErr, pgx.ErrNoRows) {
			return CustomerDetailView{}, s.internal("get latest approved customer account", latestErr)
		}
		if open, openErr := s.queries.WithTx(tx).GetBobOpenEntry(ctx, dbsqlc.GetBobOpenEntryParams{Entity: EntityCustomerAccount, ObjectID: account.ID}); openErr == nil {
			loaded, loadErr := s.loadCustomerVersionWithQueries(ctx, s.queries.WithTx(tx), open)
			if loadErr != nil {
				return CustomerDetailView{}, loadErr
			}
			view.OpenVersion = &loaded
		} else if !errors.Is(openErr, pgx.ErrNoRows) {
			return CustomerDetailView{}, s.internal("get open customer account", openErr)
		}
		out.Accounts = append(out.Accounts, view)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerDetailView{}, s.internal("commit customer read", err)
	}
	return out, nil
}
func (s *Service) CustomerSave(ctx context.Context, input CustomerSaveInput, actor approval.Actor) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validWriteInput(EntityCustomerAccount, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer account save", nil, nil)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer account", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin customer account save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: EntityCustomerAccount})
	if err != nil {
		return MutationResult{}, s.internal("lock customer account", err)
	}
	entry, err := s.entryForObject(ctx, q, EntityCustomerAccount, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != input.ApprovalRevision {
		return MutationResult{}, domainError(ErrorConflict, "customer account changed before save", nil, nil)
	}
	target := approvalEntry(entry)
	if approval.Status(entry.Status) == approval.StatusApproved {
		target, err = s.createNextApproval(ctx, tx, EntityCustomerAccount, input.ObjectID, object.Code, object.Enabled, actor)
		if err == nil {
			err = copyDetail(ctx, q, EntityCustomerAccount, target.ID, entry.ID)
		}
		if err != nil {
			return MutationResult{}, s.writeError("copy customer account payload", err)
		}
	} else if approval.Status(entry.Status) != approval.StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "only a draft or latest approved version can be saved", nil, nil)
	}
	relation, err := q.GetBobCustomerAccountRelationship(ctx, input.ObjectID)
	if err != nil {
		return MutationResult{}, s.internal("load customer account relationship", err)
	}
	customer, err := q.GetBobCustomerRelationship(ctx, relation.CustomerRelationshipID)
	if err != nil {
		return MutationResult{}, s.internal("load customer relationship", err)
	}
	if customer.OperatingEntityID != data.OperatingEntityID {
		return MutationResult{}, domainError(ErrorValidation, "customer account operating entity must match relationship", nil, nil)
	}
	if err = s.rejectCustomerSelfAttribution(ctx, q, customer.PartyID, data.PrimarySalesAttribution); err != nil {
		return MutationResult{}, err
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return MutationResult{}, err
	}
	if err = q.DeleteBobCustomerCreditLimits(ctx, target.ID); err != nil {
		return MutationResult{}, s.writeError("delete customer account credit limits", err)
	}
	if err = writeCustomerAccountData(ctx, q, target.ID, data, false); err != nil {
		return MutationResult{}, s.writeError("insert customer account detail", err)
	}
	target, err = s.transitionApproval(ctx, tx, EntityCustomerAccount, input.ObjectID, object.Code, object.Enabled, target.ID, target.Revision, approval.ActionSaved, "", actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: input.ObjectID, Entity: EntityCustomerAccount})
	if err != nil {
		return MutationResult{}, s.writeError("touch customer account", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit customer account save", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, target), nil
}
func (s *Service) loadCustomerVersionWithQueries(ctx context.Context, q *dbsqlc.Queries, entry dbsqlc.ApprovalEntry) (CustomerVersionView, error) {
	var row dbsqlc.BobCustomerVersion
	var err error
	if approval.Status(entry.Status) == approval.StatusApproved {
		row, err = q.GetBobCustomerPayload(ctx, entry.ID)
	} else {
		row, err = q.GetBobOpenCustomerPayload(ctx, entry.ID)
	}
	if err != nil {
		return CustomerVersionView{}, s.internal("load customer payload", err)
	}
	result := CustomerVersionView{Approval: approvalMeta(entry), Data: CustomerAccountData{Name: row.Name, ShortName: deref(row.ShortName), CustomerTypeCode: row.CustomerType, ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address), DefaultTransportMethodCode: deref(row.DefaultTransportMethodCode), DefaultTransportMethodName: deref(row.DefaultTransportMethodName), InternalReminder: deref(row.InternalReminder), DefaultSalesOrderRemark: deref(row.DefaultSalesOrderRemark)}}
	if err = json.Unmarshal(row.PricingPolicy, &result.Data.PricingPolicy); err != nil {
		return CustomerVersionView{}, s.internal("decode customer pricing policy", err)
	}
	result.Data.OperatingEntityID = deref(row.OperatingEntityID)
	if result.Data.OperatingEntityID != "" {
		result.Data.OperatingEntity = &CustomerSnapshot{SourceObjectID: result.Data.OperatingEntityID, ApprovalEntryID: deref(row.OperatingEntityApprovalEntryID), Code: deref(row.OperatingEntityCode), Name: deref(row.OperatingEntityName), TaxNumber: deref(row.OperatingEntityTaxNumber), Address: deref(row.OperatingEntityAddress), Phone: deref(row.OperatingEntityPhone)}
	}
	result.Data.SettlementMethodID = deref(row.SettlementMethodID)
	if result.Data.SettlementMethodID != "" {
		result.Data.SettlementMethod = &CustomerSnapshot{SourceObjectID: result.Data.SettlementMethodID, ApprovalEntryID: deref(row.SettlementMethodApprovalEntryID), Code: deref(row.SettlementMethodCode), Name: deref(row.SettlementMethodName), TermCode: deref(row.SettlementTermCode), RuleType: deref(row.SettlementRuleType), DueDays: row.SettlementDueDays, MonthOffset: row.SettlementMonthOffset, CutoffDay: row.SettlementCutoffDay, DefaultSalesSurcharge: fixeddecimal.Format(row.SettlementSalesSurchargeCents, 2, false)}
	}
	result.Data.PaymentMethodID = deref(row.PaymentMethodID)
	if result.Data.PaymentMethodID != "" {
		result.Data.PaymentMethod = &CustomerSnapshot{SourceObjectID: result.Data.PaymentMethodID, ApprovalEntryID: deref(row.PaymentMethodApprovalEntryID), Code: deref(row.PaymentMethodCode), Name: deref(row.PaymentMethodName), DefaultSalesSurcharge: fixeddecimal.Format(row.PaymentSalesSurchargeCents, 2, false)}
	}
	result.Data.TransportSurcharge = fixeddecimal.Format(row.TransportSurchargeCents, 2, false)
	result.Data.PrimarySalesAttribution = CustomerSalesAttributionInput{Type: deref(row.PrimarySalesAttributionType), SubjectObjectID: deref(row.PrimarySalesSubjectID)}
	result.Data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: result.Data.PrimarySalesAttribution, SubjectApprovalEntryID: deref(row.PrimarySalesSubjectApprovalEntryID), SubjectCode: deref(row.PrimarySalesSubjectCode), SubjectName: deref(row.PrimarySalesSubjectName)}
	limits, err := q.ListBobCustomerCreditLimits(ctx, entry.ID)
	if err != nil {
		return CustomerVersionView{}, s.internal("load customer credit limits", err)
	}
	result.Data.CreditLimits = make([]CustomerCreditLimit, 0, len(limits))
	for _, limit := range limits {
		result.Data.CreditLimits = append(result.Data.CreditLimits, CustomerCreditLimit{Currency: limit.Currency, Amount: fixeddecimal.Format(limit.AmountCents, 2, false)})
	}
	return result, nil
}

func writeCustomerAccountData(ctx context.Context, q *dbsqlc.Queries, versionID string, data CustomerAccountData, insert bool) error {
	policy, err := json.Marshal(data.PricingPolicy)
	if err != nil {
		return err
	}
	transportMinor, _ := fixeddecimal.ParsePositive(data.TransportSurcharge, 2, true)
	if insert {
		if err = q.InsertBobCustomerPayload(ctx, dbsqlc.InsertBobCustomerPayloadParams{ApprovalEntryID: versionID, Name: data.Name}); err != nil {
			return err
		}
	}
	rows, err := q.UpdateBobCustomerPayload(ctx, dbsqlc.UpdateBobCustomerPayloadParams{
		Name: data.Name, CustomerType: data.CustomerTypeCode, ShortName: nilIfEmpty(data.ShortName), ContactName: nilIfEmpty(data.ContactName), ContactPhone: nilIfEmpty(data.ContactPhone), Email: nilIfEmpty(data.Email), Address: nilIfEmpty(data.Address),
		OperatingEntityID: nilIfEmpty(data.OperatingEntityID), OperatingEntityApprovalEntryID: nilIfEmpty(snapshotApprovalEntryID(data.OperatingEntity)), OperatingEntityCode: nilIfEmpty(snapshotCode(data.OperatingEntity)), OperatingEntityName: nilIfEmpty(snapshotName(data.OperatingEntity)), OperatingEntityTaxNumber: nilIfEmpty(snapshotTax(data.OperatingEntity)), OperatingEntityAddress: nilIfEmpty(snapshotAddress(data.OperatingEntity)), OperatingEntityPhone: nilIfEmpty(snapshotPhone(data.OperatingEntity)),
		SettlementMethodID: nilIfEmpty(data.SettlementMethodID), SettlementMethodApprovalEntryID: nilIfEmpty(snapshotApprovalEntryID(data.SettlementMethod)), SettlementMethodCode: nilIfEmpty(snapshotCode(data.SettlementMethod)), SettlementMethodName: nilIfEmpty(snapshotName(data.SettlementMethod)), SettlementTermCode: nilIfEmpty(snapshotTerm(data.SettlementMethod)), SettlementRuleType: nilIfEmpty(snapshotRule(data.SettlementMethod)), SettlementDueDays: snapshotDueDays(data.SettlementMethod), SettlementMonthOffset: snapshotMonthOffset(data.SettlementMethod), SettlementCutoffDay: snapshotCutoffDay(data.SettlementMethod), SettlementSalesSurchargeCents: snapshotSurchargeMinor(data.SettlementMethod),
		PaymentMethodID: nilIfEmpty(data.PaymentMethodID), PaymentMethodApprovalEntryID: nilIfEmpty(snapshotApprovalEntryID(data.PaymentMethod)), PaymentMethodCode: nilIfEmpty(snapshotCode(data.PaymentMethod)), PaymentMethodName: nilIfEmpty(snapshotName(data.PaymentMethod)), PaymentSalesSurchargeCents: snapshotSurchargeMinor(data.PaymentMethod), DefaultTransportMethodCode: nilIfEmpty(data.DefaultTransportMethodCode), DefaultTransportMethodName: nilIfEmpty(data.DefaultTransportMethodName), TransportSurchargeCents: transportMinor, PricingPolicy: policy,
		PrimarySalesAttributionType: &data.PrimarySalesAttribution.Type, PrimarySalesSubjectID: &data.PrimarySalesAttribution.SubjectObjectID, PrimarySalesSubjectApprovalEntryID: &data.SalesAttribution.SubjectApprovalEntryID, PrimarySalesSubjectCode: &data.SalesAttribution.SubjectCode, PrimarySalesSubjectName: &data.SalesAttribution.SubjectName, InternalReminder: nilIfEmpty(data.InternalReminder), DefaultSalesOrderRemark: nilIfEmpty(data.DefaultSalesOrderRemark), ApprovalEntryID: versionID,
	})
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("customer account payload changed")
	}
	for _, limit := range data.CreditLimits {
		minor, _ := fixeddecimal.ParsePositive(limit.Amount, 2, true)
		if err = q.InsertBobCustomerCreditLimit(ctx, dbsqlc.InsertBobCustomerCreditLimitParams{ApprovalEntryID: versionID, Currency: limit.Currency, AmountCents: minor}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) resolveCustomerSnapshots(ctx context.Context, tx pgx.Tx, data CustomerAccountData) (CustomerAccountData, error) {
	if data.PrimarySalesAttribution.Type == SalesAttributionInternalEmployee {
		subject, err := s.ResolveLatestApprovedReference(ctx, tx, EntityEmployee, data.PrimarySalesAttribution.SubjectObjectID)
		if err != nil {
			return CustomerAccountData{}, err
		}
		data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: data.PrimarySalesAttribution, SubjectApprovalEntryID: subject.ApprovalEntryID, SubjectCode: subject.Code, SubjectName: subject.Data.Name}
	} else {
		partner, err := s.ResolveLatestApprovedReference(ctx, tx, EntitySalesPartner, data.PrimarySalesAttribution.SubjectObjectID)
		if err != nil {
			return CustomerAccountData{}, err
		}
		required := SalesCapabilityExternalPartTime
		if data.PrimarySalesAttribution.Type == SalesAttributionDealer {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(partner.Data.SalesCapabilities, required) {
			return CustomerAccountData{}, domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
		data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: data.PrimarySalesAttribution, SubjectApprovalEntryID: partner.ApprovalEntryID, SubjectCode: partner.Code, SubjectName: partner.Data.Name}
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
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, entity, objectID, "")
	if err != nil {
		return CustomerSnapshot{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return CustomerSnapshot{SourceObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID, Code: reference.Code, Name: mapString(reference.Data, "name"),
		TermCode: mapString(reference.Data, "termCode"), RuleType: mapString(reference.Data, "ruleType"),
		DueDays: int32(mapInt(reference.Data, "dayOffset")), MonthOffset: int32(mapInt(reference.Data, "monthOffset")),
		CutoffDay: int32(mapInt(reference.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(reference.Data, "defaultSalesSurcharge")}, nil
}

func (s *Service) resolveOperatingEntityReference(ctx context.Context, tx pgx.Tx, objectID string) (CustomerSnapshot, error) {
	reference, err := s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, objectID)
	if err != nil {
		return CustomerSnapshot{}, err
	}
	return CustomerSnapshot{SourceObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID, Code: reference.Code, Name: reference.Data.Name, TaxNumber: reference.Data.TaxNumber, Address: reference.Data.Address, Phone: reference.Data.Phone}, nil
}

func snapshotApprovalEntryID(value *CustomerSnapshot) string {
	if value == nil {
		return ""
	}
	return value.ApprovalEntryID
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
	partner, err := q.GetBobSalesPartnerRelationship(ctx, attribution.SubjectObjectID)
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

func approvalEntry(row dbsqlc.ApprovalEntry) approval.Entry {
	return approval.Entry{EntryRef: approval.EntryRef{ID: row.ID, Domain: row.Domain, Entity: row.Entity, SubjectID: row.SubjectID, VersionNo: row.VersionNo}, Status: approval.Status(row.Status), Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time, UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Time, SubmittedBy: row.SubmittedBy, ApprovedBy: row.ApprovedBy}
}
