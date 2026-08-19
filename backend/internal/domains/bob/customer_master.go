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
	SalesAttributionDealer           = "DEALER"
)

type CustomerGroupBankAccount struct {
	AccountName   string `json:"accountName"`
	BankName      string `json:"bankName"`
	BankBranch    string `json:"bankBranch"`
	AccountNumber string `json:"accountNumber"`
}

type CustomerGroupData struct {
	CompanyName    string                     `json:"companyName"`
	ShortName      string                     `json:"shortName,omitempty"`
	TaxNumber      string                     `json:"taxNumber,omitempty"`
	InvoiceTitle   string                     `json:"invoiceTitle,omitempty"`
	InvoiceAddress string                     `json:"invoiceAddress,omitempty"`
	InvoicePhone   string                     `json:"invoicePhone,omitempty"`
	BankAccounts   []CustomerGroupBankAccount `json:"bankAccounts"`
}

type CustomerGroupView struct {
	GroupID     string                   `json:"groupId"`
	Code        string                   `json:"code"`
	Revision    int64                    `json:"revision"`
	Data        CustomerGroupData        `json:"data"`
	UpdatedAt   time.Time                `json:"updatedAt"`
	UpdatedBy   string                   `json:"updatedBy"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}

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
	OperatingEntityID          string                        `json:"operatingEntityId,omitempty"`
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
	type customerAccountAlias CustomerAccountData
	return json.Marshal(struct {
		customerAccountAlias
		PrimarySalesAttribution CustomerSalesAttributionView `json:"primarySalesAttribution"`
	}{customerAccountAlias: customerAccountAlias(data), PrimarySalesAttribution: data.SalesAttribution})
}

type CustomerVersionView struct {
	Version     VersionMeta              `json:"version"`
	Data        CustomerAccountData      `json:"data"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}

type CustomerDetailView struct {
	ObjectID       string               `json:"objectId"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Group          CustomerGroupView    `json:"group"`
	Effective      *CustomerVersionView `json:"effective"`
	Candidate      *CustomerVersionView `json:"candidate"`
	UpdatedAt      time.Time            `json:"updatedAt"`
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
	GroupID string              `json:"groupId,omitempty"`
	Group   CustomerGroupData   `json:"group,omitempty"`
	Data    CustomerAccountData `json:"data"`
}

type CustomerSaveInput struct {
	ObjectID      string              `json:"objectId"`
	VersionID     string              `json:"versionId"`
	Revision      int64               `json:"revision"`
	GroupRevision int64               `json:"groupRevision"`
	Group         CustomerGroupData   `json:"group"`
	Data          CustomerAccountData `json:"data"`
}

type CustomerCreateResult struct {
	MutationResult
	GroupID string `json:"groupId"`
}

type CustomerTaxMatchInput struct {
	TaxNumber         string
	IncludeCustomer   bool
	IncludeSupplier   bool
	IncludeOtherParty bool
}

type CustomerTaxMatch struct {
	SourceEntity   string `json:"sourceEntity"`
	ObjectID       string `json:"objectId"`
	Code           string `json:"code"`
	CompanyName    string `json:"companyName"`
	ShortName      string `json:"shortName"`
	TaxNumber      string `json:"taxNumber"`
	InvoiceTitle   string `json:"invoiceTitle"`
	InvoiceAddress string `json:"invoiceAddress"`
	InvoicePhone   string `json:"invoicePhone"`
}

func (s *Service) CustomerTaxMatches(ctx context.Context, input CustomerTaxMatchInput) ([]CustomerTaxMatch, error) {
	taxNumber := strings.ToUpper(strings.TrimSpace(input.TaxNumber))
	if taxNumber == "" {
		return nil, domainError(ErrorValidation, "tax number is required", nil, nil)
	}
	rows, err := s.queries.QueryCustomerTaxMatches(ctx, dbsqlc.QueryCustomerTaxMatchesParams{
		IncludeCustomer: input.IncludeCustomer, IncludeSupplier: input.IncludeSupplier,
		IncludeOtherParty: input.IncludeOtherParty, TaxNumber: &taxNumber,
	})
	if err != nil {
		return nil, s.internal("query customer tax matches", err)
	}
	result := make([]CustomerTaxMatch, 0, len(rows))
	for _, row := range rows {
		result = append(result, CustomerTaxMatch{SourceEntity: row.SourceEntity, ObjectID: row.ObjectID,
			Code: row.Code, CompanyName: row.CompanyName, ShortName: row.ShortName, TaxNumber: row.TaxNumber,
			InvoiceTitle: row.InvoiceTitle, InvoiceAddress: row.InvoiceAddress, InvoicePhone: row.InvoicePhone})
	}
	return result, nil
}

type CustomerGroupSaveInput struct {
	GroupID  string            `json:"groupId"`
	Revision int64             `json:"revision"`
	Data     CustomerGroupData `json:"data"`
}

func (s *Service) CustomerQuery(ctx context.Context, input QueryInput) (Page[CustomerListItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 {
		return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer query", nil, nil)
	}
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer sort", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	if statuses == nil {
		statuses = []string{}
	}
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[CustomerListItem]{}, domainError(ErrorValidation, "invalid customer status", nil, nil)
		}
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	keyword := strings.TrimSpace(input.Filters.Keyword)
	customerType := strings.TrimSpace(input.Filters.CustomerType)
	operatingEntityID := strings.TrimSpace(input.Filters.OperatingEntityID)
	salesAttributionType := strings.TrimSpace(input.Filters.SalesAttributionType)
	salesAttributionSubjectID := strings.TrimSpace(input.Filters.SalesAttributionSubjectID)
	total, err := s.queries.CountBobCustomers(ctx, dbsqlc.CountBobCustomersParams{
		Keyword: keyword, Statuses: statuses, EnabledFilter: enabledFilter,
		CustomerType: customerType, OperatingEntityID: operatingEntityID,
		SalesAttributionType: salesAttributionType, SalesAttributionSubjectID: salesAttributionSubjectID,
	})
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("count customers", err)
	}
	rows, err := s.queries.ListBobCustomers(ctx, dbsqlc.ListBobCustomersParams{
		Keyword: keyword, Statuses: statuses, EnabledFilter: enabledFilter,
		CustomerType: customerType, OperatingEntityID: operatingEntityID,
		SalesAttributionType: salesAttributionType, SalesAttributionSubjectID: salesAttributionSubjectID,
		RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize),
	})
	if err != nil {
		return Page[CustomerListItem]{}, s.internal("list customers", err)
	}
	items := make([]CustomerListItem, 0, len(rows))
	for _, row := range rows {
		item := CustomerListItem{
			ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision,
			Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time,
		}
		if row.EffectiveVersionID != nil {
			item.Effective = &CustomerListVersion{VersionID: *row.EffectiveVersionID, Version: *row.EffectiveVersionNo,
				Status: deref(row.EffectiveStatus), Revision: *row.EffectiveRevision, Name: deref(row.EffectiveName),
				CustomerTypeCode: deref(row.EffectiveCustomerType), OperatingEntityName: row.EffectiveOperatingEntityName,
				SalesAttributionName: row.EffectiveSalesAttributionName, SubmittedBy: row.EffectiveSubmittedBy}
		}
		if row.CandidateVersionID != nil {
			item.Candidate = &CustomerListVersion{VersionID: *row.CandidateVersionID, Version: *row.CandidateVersionNo,
				Status: deref(row.CandidateStatus), Revision: *row.CandidateRevision, Name: deref(row.CandidateName),
				CustomerTypeCode: deref(row.CandidateCustomerType), SubmittedBy: row.CandidateSubmittedBy}
		}
		items = append(items, item)
	}
	return Page[CustomerListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func normalizeCustomerGroup(data CustomerGroupData) (CustomerGroupData, error) {
	data.CompanyName = strings.TrimSpace(data.CompanyName)
	data.ShortName = strings.TrimSpace(data.ShortName)
	data.TaxNumber = strings.ToUpper(strings.TrimSpace(data.TaxNumber))
	data.InvoiceTitle = strings.TrimSpace(data.InvoiceTitle)
	data.InvoiceAddress = strings.TrimSpace(data.InvoiceAddress)
	data.InvoicePhone = strings.TrimSpace(data.InvoicePhone)
	if data.CompanyName == "" || len(data.CompanyName) > 200 || len(data.BankAccounts) > 20 {
		return CustomerGroupData{}, errors.New("invalid customer group")
	}
	for index := range data.BankAccounts {
		account := &data.BankAccounts[index]
		account.AccountName = strings.TrimSpace(account.AccountName)
		account.BankName = strings.TrimSpace(account.BankName)
		account.BankBranch = strings.TrimSpace(account.BankBranch)
		account.AccountNumber = strings.TrimSpace(account.AccountNumber)
		if account.AccountName == "" || account.BankName == "" || account.AccountNumber == "" {
			return CustomerGroupData{}, errors.New("invalid customer group bank account")
		}
	}
	if data.BankAccounts == nil {
		data.BankAccounts = []CustomerGroupBankAccount{}
	}
	return data, nil
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
	if data.Name == "" || data.CustomerTypeCode == "" {
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

func (s *Service) CustomerCreate(
	ctx context.Context, input CustomerCreateInput, actorID, requestID string,
) (CustomerCreateResult, error) {
	hasNewGroup := strings.TrimSpace(input.Group.CompanyName) != ""
	if hasNewGroup == (input.GroupID != "") || (input.GroupID != "" && !validID(input.GroupID)) {
		return CustomerCreateResult{}, domainError(ErrorValidation, "exactly one customer group source is required", nil, nil)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil || !validActorAndRequest(actorID, requestID) {
		return CustomerCreateResult{}, domainError(ErrorValidation, "invalid customer account", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerCreateResult{}, s.internal("begin customer create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	groupID := input.GroupID
	if hasNewGroup {
		group, normalizeErr := normalizeCustomerGroup(input.Group)
		if normalizeErr != nil {
			return CustomerCreateResult{}, domainError(ErrorValidation, "invalid customer group", nil, normalizeErr)
		}
		groupID, _, err = s.insertCustomerGroup(ctx, tx, qtx, group, actorID, requestID)
		if err != nil {
			return CustomerCreateResult{}, err
		}
	} else {
		if _, err = qtx.LockBobCustomerGroup(ctx, groupID); errors.Is(err, pgx.ErrNoRows) {
			return CustomerCreateResult{}, domainError(ErrorValidation, "customer group not found", nil, nil)
		} else if err != nil {
			return CustomerCreateResult{}, s.internal("lock customer group", err)
		}
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	result, err := s.insertCustomerAccount(ctx, tx, qtx, groupID, data, actorID, requestID)
	if err != nil {
		return CustomerCreateResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerCreateResult{}, s.writeError("commit customer create", err)
	}
	return CustomerCreateResult{MutationResult: result, GroupID: groupID}, nil
}

func (s *Service) CustomerSave(
	ctx context.Context, input CustomerSaveInput, actorID, requestID string,
) (MutationResult, error) {
	group, err := normalizeCustomerGroup(input.Group)
	if err != nil || input.GroupRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer group save", nil, err)
	}
	data, err := normalizeCustomerAccount(input.Data)
	if err != nil || !validWriteInput(EntityCustomer, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid customer save", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, EntityCustomer, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "customer changed before save")
	}
	var groupID string
	if groupID, err = qtx.GetBobCustomerGroupID(ctx, input.ObjectID); err != nil {
		return MutationResult{}, s.internal("load customer group for save", err)
	}
	if err = saveCustomerGroupTx(ctx, tx, groupID, input.GroupRevision, group, actorID, requestID); err != nil {
		return MutationResult{}, err
	}
	data, err = s.resolveCustomerSnapshots(ctx, tx, data)
	if err != nil {
		return MutationResult{}, err
	}
	targetVersionID := input.VersionID
	targetVersionNo := version.VersionNo
	objectRevision := object.Revision
	createdCandidate := false
	if version.Status == StatusEffective && object.EffectiveVersionID != nil &&
		*object.EffectiveVersionID == input.VersionID {
		targetVersionID = newID()
		targetVersionNo = object.NextVersionNo
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: targetVersionID,
			ObjectID: input.ObjectID, Entity: EntityCustomer, VersionNo: targetVersionNo, ActorID: actorID}); err != nil {
			return MutationResult{}, s.writeError("insert customer candidate", err)
		}
		if err = qtx.CopyCustomerVersionAttachments(ctx, dbsqlc.CopyCustomerVersionAttachmentsParams{SourceVersionID: input.VersionID, TargetVersionID: targetVersionID}); err != nil {
			return MutationResult{}, s.writeError("copy customer candidate attachments", err)
		}
		rows, advanceErr := qtx.AdvanceBobCustomerCandidate(ctx, dbsqlc.AdvanceBobCustomerCandidateParams{VersionID: targetVersionID, ActorID: actorID, ObjectID: input.ObjectID, Revision: object.Revision, CurrentVersionID: input.VersionID})
		if advanceErr != nil {
			return MutationResult{}, s.writeError("advance customer candidate", advanceErr)
		}
		if rows != 1 {
			return MutationResult{}, conflict(object, version, "customer changed before save")
		}
		objectRevision++
		createdCandidate = true
	} else if version.Status != StatusDraft || object.CurrentVersionID == deref(object.EffectiveVersionID) {
		return MutationResult{}, conflict(object, version, "customer changed before save")
	}
	if err = qtx.DeleteBobCustomerCreditLimits(ctx, targetVersionID); err != nil {
		return MutationResult{}, s.writeError("delete customer credit limits", err)
	}
	if _, err = qtx.DeleteBobCustomerDetail(ctx, targetVersionID); err != nil {
		return MutationResult{}, s.writeError("replace customer detail", err)
	}
	if err = insertCustomerAccountData(ctx, qtx, targetVersionID, data); err != nil {
		return MutationResult{}, s.writeError("insert customer detail", err)
	}
	if createdCandidate {
		if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: targetVersionID,
			Entity: EntityCustomer, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
			Summary: map[string]any{"sourceVersionId": input.VersionID, "reason": "CUSTOMER_EDIT"}}); err != nil {
			return MutationResult{}, s.writeError("audit customer candidate", err)
		}
		if err = tx.Commit(ctx); err != nil {
			return MutationResult{}, s.writeError("commit customer candidate", err)
		}
		return MutationResult{ObjectID: input.ObjectID, ObjectRevision: objectRevision, Enabled: object.Enabled,
			VersionID: targetVersionID, Version: targetVersionNo, Status: StatusDraft, Revision: 1}, nil
	}
	rows, err := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{
		ActorID: actorID, ID: targetVersionID, ObjectID: input.ObjectID, Entity: EntityCustomer, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("mark customer saved", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "customer changed before save")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: EntityCustomer}); err != nil {
		return MutationResult{}, s.internal("touch customer", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: input.VersionID,
		Entity: EntityCustomer, Event: "SAVED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"pricingPolicy", "creditLimits", "primarySalesAttribution"}},
	}); err != nil {
		return MutationResult{}, s.writeError("audit customer save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit customer save", err)
	}
	return MutationResult{ObjectID: input.ObjectID, ObjectRevision: object.Revision, Enabled: object.Enabled,
		VersionID: targetVersionID, Version: targetVersionNo, Status: StatusDraft, Revision: input.Revision + 1}, nil
}

func (s *Service) CustomerGet(ctx context.Context, input GetInput) (CustomerDetailView, error) {
	if !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return CustomerDetailView{}, domainError(ErrorValidation, "invalid customer", nil, nil)
	}
	row, err := s.queries.GetBobCustomerDetail(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerDetailView{}, domainError(ErrorValidation, "customer not found", nil, nil)
	}
	if err != nil {
		return CustomerDetailView{}, s.internal("get customer", err)
	}
	result := CustomerDetailView{ObjectID: row.ID, Code: row.Code, ObjectRevision: row.Revision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
	result.Group, err = s.CustomerGroupGet(ctx, row.GroupID)
	if err != nil {
		return CustomerDetailView{}, err
	}
	if input.VersionID != "" {
		version, loadErr := s.loadCustomerVersion(ctx, input.ObjectID, input.VersionID)
		if loadErr != nil {
			return CustomerDetailView{}, loadErr
		}
		if version.Version.Status == StatusEffective || version.Version.Status == StatusInvalid {
			result.Effective = &version
		} else {
			result.Candidate = &version
		}
		return result, nil
	}
	if row.EffectiveVersionID != nil {
		version, loadErr := s.loadCustomerVersion(ctx, input.ObjectID, *row.EffectiveVersionID)
		if loadErr != nil {
			return CustomerDetailView{}, loadErr
		}
		result.Effective = &version
	}
	if row.EffectiveVersionID == nil || row.CurrentVersionID != *row.EffectiveVersionID {
		version, loadErr := s.loadCustomerVersion(ctx, input.ObjectID, row.CurrentVersionID)
		if loadErr != nil {
			return CustomerDetailView{}, loadErr
		}
		result.Candidate = &version
	}
	return result, nil
}

func (s *Service) CustomerGroupGet(ctx context.Context, groupID string) (CustomerGroupView, error) {
	if !validID(groupID) {
		return CustomerGroupView{}, domainError(ErrorValidation, "invalid customer group", nil, nil)
	}
	row, err := s.queries.GetBobCustomerGroup(ctx, groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerGroupView{}, domainError(ErrorValidation, "customer group not found", nil, nil)
	}
	if err != nil {
		return CustomerGroupView{}, s.internal("get customer group", err)
	}
	result := CustomerGroupView{GroupID: row.ID, Code: row.Code, Revision: row.Revision, UpdatedAt: row.UpdatedAt.Time, UpdatedBy: row.UpdatedBy, Data: CustomerGroupData{CompanyName: row.CompanyName, ShortName: row.ShortName, TaxNumber: row.TaxNumber, InvoiceTitle: row.InvoiceTitle, InvoiceAddress: row.InvoiceAddress, InvoicePhone: row.InvoicePhone, BankAccounts: []CustomerGroupBankAccount{}}}
	rows, err := s.queries.ListBobCustomerGroupBankAccounts(ctx, groupID)
	if err != nil {
		return CustomerGroupView{}, s.internal("get customer group bank accounts", err)
	}
	for _, account := range rows {
		result.Data.BankAccounts = append(result.Data.BankAccounts, CustomerGroupBankAccount{AccountName: account.AccountName, BankName: account.BankName, BankBranch: account.BankBranch, AccountNumber: account.AccountNumber})
	}
	return result, nil
}

func (s *Service) CustomerGroupSave(
	ctx context.Context, input CustomerGroupSaveInput, actorID, requestID string,
) (CustomerGroupView, error) {
	data, err := normalizeCustomerGroup(input.Data)
	if err != nil || !validID(input.GroupID) || input.Revision < 1 || !validActorAndRequest(actorID, requestID) {
		return CustomerGroupView{}, domainError(ErrorValidation, "invalid customer group save", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerGroupView{}, s.internal("begin customer group save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = saveCustomerGroupTx(ctx, tx, input.GroupID, input.Revision, data, actorID, requestID); err != nil {
		return CustomerGroupView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerGroupView{}, s.writeError("commit customer group save", err)
	}
	return s.CustomerGroupGet(ctx, input.GroupID)
}

func saveCustomerGroupTx(ctx context.Context, tx pgx.Tx, groupID string, revision int64, data CustomerGroupData, actorID, requestID string) error {
	q := dbsqlc.New(tx)
	rows, err := q.UpdateBobCustomerGroup(ctx, dbsqlc.UpdateBobCustomerGroupParams{GroupID: groupID, Revision: revision, CompanyName: data.CompanyName, ShortName: data.ShortName, TaxNumber: data.TaxNumber, InvoiceTitle: data.InvoiceTitle, InvoiceAddress: data.InvoiceAddress, InvoicePhone: data.InvoicePhone, ActorID: actorID})
	if err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "customer group changed before save", nil, nil)
	}
	if err = replaceCustomerGroupBankAccounts(ctx, tx, groupID, data.BankAccounts); err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	summary, _ := json.Marshal(map[string]any{"fields": []string{"companyName", "taxNumber", "bankAccounts"}})
	if err = q.InsertBobCustomerGroupAuditEvent(ctx, dbsqlc.InsertBobCustomerGroupAuditEventParams{ID: newID(), GroupID: groupID, EventType: "SAVED", ActorID: actorID, RequestID: requestID, Summary: summary}); err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	return nil
}

func (s *Service) CustomerGroupAuditHistory(ctx context.Context, input HistoryInput) (Page[AuditEventView], error) {
	offset, valid := pageOffset(input.Page, input.PageSize)
	if !validID(input.ObjectID) || !valid {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid customer group audit query", nil, nil)
	}
	total, err := s.queries.CountBobCustomerGroupAuditEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count customer group audit", err)
	}
	rows, err := s.queries.ListBobCustomerGroupAuditEvents(ctx, dbsqlc.ListBobCustomerGroupAuditEventsParams{GroupID: input.ObjectID, PageSize: int32(input.PageSize), PageOffset: offset})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list customer group audit", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, AuditEventView{ID: row.ID, ObjectID: input.ObjectID, Entity: "customer-group", EventType: row.EventType, ToStatus: "CURRENT", ActorID: row.ActorID, OccurredAt: row.OccurredAt.Time, RequestID: row.RequestID, Summary: row.Summary})
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
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

func (s *Service) insertCustomerGroup(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, data CustomerGroupData, actorID, requestID string,
) (string, string, error) {
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: "customer-group"})
	if err != nil {
		return "", "", s.writeError("allocate customer group number", err)
	}
	groupID, code := newID(), fmt.Sprintf("CGR-%04d", counter)
	err = qtx.InsertBobCustomerGroup(ctx, dbsqlc.InsertBobCustomerGroupParams{ID: groupID, Code: code, CompanyName: data.CompanyName, ShortName: data.ShortName, TaxNumber: data.TaxNumber, InvoiceTitle: data.InvoiceTitle, InvoiceAddress: data.InvoiceAddress, InvoicePhone: data.InvoicePhone, ActorID: actorID})
	if err != nil {
		return "", "", s.writeError("insert customer group", err)
	}
	if err = replaceCustomerGroupBankAccounts(ctx, tx, groupID, data.BankAccounts); err != nil {
		return "", "", s.writeError("insert customer group bank accounts", err)
	}
	summary, _ := json.Marshal(map[string]any{"fields": []string{"code", "companyName", "taxNumber", "bankAccounts"}})
	if err = qtx.InsertBobCustomerGroupAuditEvent(ctx, dbsqlc.InsertBobCustomerGroupAuditEventParams{ID: newID(), GroupID: groupID, EventType: "CREATED", ActorID: actorID, RequestID: requestID, Summary: summary}); err != nil {
		return "", "", s.writeError("audit customer group create", err)
	}
	return groupID, code, nil
}

func (s *Service) insertCustomerAccount(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, groupID string, data CustomerAccountData,
	actorID, requestID string,
) (MutationResult, error) {
	objectID, versionID := newID(), newID()
	counter, err := qtx.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityCustomer})
	if err != nil {
		return MutationResult{}, s.writeError("allocate customer number", err)
	}
	code := fmt.Sprintf("CUS-%04d", counter)
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: EntityCustomer, Code: code, CurrentVersionID: versionID, ActorID: actorID}); err != nil {
		return MutationResult{}, s.writeError("insert customer object", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: versionID, ObjectID: objectID, Entity: EntityCustomer, VersionNo: 1, ActorID: actorID}); err != nil {
		return MutationResult{}, s.writeError("insert customer version", err)
	}
	if err = qtx.InsertBobCustomerAccountGroupLink(ctx, dbsqlc.InsertBobCustomerAccountGroupLinkParams{ObjectID: objectID, GroupID: groupID}); err != nil {
		return MutationResult{}, s.writeError("link customer group", err)
	}
	if err = insertCustomerAccountData(ctx, qtx, versionID, data); err != nil {
		return MutationResult{}, s.writeError("insert customer account detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: objectID, VersionID: versionID, Entity: EntityCustomer,
		Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fields": []string{"code", "groupId", "pricingPolicy", "creditLimits", "primarySalesAttribution"}},
	}); err != nil {
		return MutationResult{}, s.writeError("audit customer create", err)
	}
	return MutationResult{ObjectID: objectID, ObjectRevision: 1, Enabled: true, VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, nil
}

func insertCustomerAccountData(ctx context.Context, q *dbsqlc.Queries, versionID string, data CustomerAccountData) error {
	policy, err := json.Marshal(data.PricingPolicy)
	if err != nil {
		return err
	}
	transportMinor, _ := fixeddecimal.ParsePositive(data.TransportSurcharge, 2, true)
	err = q.InsertBobCustomerAccountData(ctx, dbsqlc.InsertBobCustomerAccountDataParams{
		VersionID: versionID, Name: data.Name, CustomerType: data.CustomerTypeCode, ShortName: data.ShortName, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, SalespersonEmployeeID: data.PrimarySalesAttribution.SubjectObjectID,
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
	targetEntity := EntityEmployee
	if data.PrimarySalesAttribution.Type != SalesAttributionInternalEmployee {
		targetEntity = EntityOtherParty
	}
	subject, err := s.ResolveCurrentEffectiveReference(ctx, tx, targetEntity, data.PrimarySalesAttribution.SubjectObjectID)
	if err != nil {
		return CustomerAccountData{}, err
	}
	data.SalesAttribution = CustomerSalesAttributionView{CustomerSalesAttributionInput: data.PrimarySalesAttribution,
		SubjectVersionID: subject.VersionID, SubjectCode: subject.Code, SubjectName: subject.Data.Name}
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

func replaceCustomerGroupBankAccounts(ctx context.Context, tx pgx.Tx, groupID string, accounts []CustomerGroupBankAccount) error {
	q := dbsqlc.New(tx)
	if err := q.DeleteBobCustomerGroupBankAccounts(ctx, groupID); err != nil {
		return err
	}
	for index, account := range accounts {
		if err := q.InsertBobCustomerGroupBankAccount(ctx, dbsqlc.InsertBobCustomerGroupBankAccountParams{GroupID: groupID, LineNo: int32(index + 1), AccountName: account.AccountName, BankName: account.BankName, BankBranch: account.BankBranch, AccountNumber: account.AccountNumber}); err != nil {
			return err
		}
	}
	return nil
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
	if value == nil || value.DefaultSalesSurcharge == "" {
		return 0
	}
	minor, _ := fixeddecimal.ParsePositive(value.DefaultSalesSurcharge, 2, true)
	return minor
}
