package dcl

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
)

const (
	CustomerSalesAttributionInternalEmployee = "INTERNAL_EMPLOYEE"
	CustomerSalesAttributionExternalPartTime = "EXTERNAL_PART_TIME"
	CustomerSalesAttributionChannelPartner   = "CHANNEL_PARTNER"
	pricingCostBasisUnitPrice                = "UNIT_PRICE"
	pricingCostBasisOrderAmount              = "ORDER_AMOUNT"
)

type CustomerPricingCostItem struct {
	Name        string `json:"name"`
	Basis       string `json:"basis"`
	UnitPrice   string `json:"unitPrice,omitempty"`
	OrderAmount string `json:"orderAmount,omitempty"`
}
type CustomerPricingPolicy struct {
	DefaultPremiumUnitPrice                string                    `json:"defaultPremiumUnitPrice"`
	DefaultDiscountUnitPrice               string                    `json:"defaultDiscountUnitPrice"`
	CostItems                              []CustomerPricingCostItem `json:"costItems"`
	ThirdPartyIntermediaryFixedUnitCost    string                    `json:"thirdPartyIntermediaryFixedUnitCost"`
	ThirdPartyIntermediaryVariableUnitCost string                    `json:"thirdPartyIntermediaryVariableUnitCost"`
}
type CustomerCreditLimit struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}
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
type CustomerSalesAttributionSnapshot struct {
	CustomerSalesAttributionInput
	SubjectApprovalEntryID string `json:"subjectApprovalEntryId"`
	SubjectCode            string `json:"subjectCode"`
	SubjectName            string `json:"subjectName"`
}

// CustomerAccountDataInput deliberately contains no operating entity: the
// stable Customer relationship is the only source for that boundary.
type CustomerAccountDataInput struct {
	Name                       string                        `json:"name"`
	ShortName                  string                        `json:"shortName,omitempty"`
	CustomerTypeCode           string                        `json:"customerTypeCode"`
	ContactName                string                        `json:"contactName,omitempty"`
	ContactPhone               string                        `json:"contactPhone,omitempty"`
	Email                      string                        `json:"email,omitempty"`
	Address                    string                        `json:"address,omitempty"`
	SettlementMethodID         string                        `json:"settlementMethodId,omitempty"`
	PaymentMethodID            string                        `json:"paymentMethodId,omitempty"`
	DefaultTransportMethodCode string                        `json:"defaultTransportMethodCode,omitempty"`
	DefaultTransportMethodName string                        `json:"defaultTransportMethodName,omitempty"`
	TransportSurcharge         string                        `json:"transportSurcharge,omitempty"`
	PricingPolicy              CustomerPricingPolicy         `json:"pricingPolicy"`
	CreditLimits               []CustomerCreditLimit         `json:"creditLimits"`
	PrimarySalesAttribution    CustomerSalesAttributionInput `json:"primarySalesAttribution"`
	InternalReminder           string                        `json:"internalReminder,omitempty"`
	DefaultSalesOrderRemark    string                        `json:"defaultSalesOrderRemark,omitempty"`
}
type CustomerAccountData struct {
	CustomerAccountDataInput
	OperatingEntityID       string                           `json:"operatingEntityId"`
	OperatingEntity         *CustomerSnapshot                `json:"operatingEntity"`
	SettlementMethod        *CustomerSnapshot                `json:"settlementMethod,omitempty"`
	PaymentMethod           *CustomerSnapshot                `json:"paymentMethod,omitempty"`
	PrimarySalesAttribution CustomerSalesAttributionSnapshot `json:"primarySalesAttribution"`
}
type CustomerAccountCreateInput struct {
	CustomerRelationshipID string                   `json:"customerRelationshipId"`
	Data                   CustomerAccountDataInput `json:"data"`
}
type CustomerAccountSaveInput struct {
	ObjectID         string                   `json:"objectId"`
	ApprovalEntryID  string                   `json:"approvalEntryId"`
	ApprovalRevision int64                    `json:"approvalRevision"`
	Enabled          bool                     `json:"enabled"`
	Data             CustomerAccountDataInput `json:"data"`
}
type CustomerAccountVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

// CustomerAccountDeleteInput identifies the draft declaration to delete. An
// account that has reached approval is never deleted through this operation.
type CustomerAccountDeleteInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type CustomerAccountReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type CustomerAccountGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type CustomerAccountHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}
type CustomerAccountQueryFilters struct {
	Keyword                   string            `json:"keyword,omitempty"`
	Status                    []approval.Status `json:"status,omitempty"`
	Enabled                   *bool             `json:"enabled,omitempty"`
	CustomerType              string            `json:"customerType,omitempty"`
	CustomerRelationshipID    string            `json:"customerRelationshipId,omitempty"`
	OperatingEntityID         string            `json:"operatingEntityId,omitempty"`
	SalesAttributionType      string            `json:"salesAttributionType,omitempty"`
	SalesAttributionSubjectID string            `json:"salesAttributionSubjectId,omitempty"`
}
type CustomerAccountSortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}
type CustomerAccountQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  CustomerAccountQueryFilters `json:"filters"`
	Sort     []CustomerAccountSortItem   `json:"sort"`
}
type CustomerAccountMutation struct {
	ObjectID               string               `json:"objectId"`
	ObjectRevision         int64                `json:"objectRevision"`
	CustomerRelationshipID string               `json:"customerRelationshipId"`
	Enabled                bool                 `json:"enabled"`
	Approval               approval.VersionMeta `json:"approval"`
}
type CustomerAccountVersionView struct {
	Approval    approval.VersionMeta     `json:"approval"`
	Enabled     bool                     `json:"enabled"`
	Data        CustomerAccountData      `json:"data"`
	Attachments []CustomerAttachmentView `json:"attachments"`
}
type CustomerAccountView struct {
	ObjectID               string                   `json:"objectId"`
	Entity                 string                   `json:"entity"`
	Code                   string                   `json:"code"`
	CustomerRelationshipID string                   `json:"customerRelationshipId"`
	ObjectRevision         int64                    `json:"objectRevision"`
	Enabled                bool                     `json:"enabled"`
	Approval               approval.VersionMeta     `json:"approval"`
	Data                   CustomerAccountData      `json:"data"`
	Attachments            []CustomerAttachmentView `json:"attachments"`
	UpdatedAt              time.Time                `json:"updatedAt"`
}
type CustomerAccountQueryItem struct {
	ObjectID               string                      `json:"objectId"`
	Entity                 string                      `json:"entity"`
	Code                   string                      `json:"code"`
	CustomerRelationshipID string                      `json:"customerRelationshipId"`
	ObjectRevision         int64                       `json:"objectRevision"`
	Enabled                bool                        `json:"enabled"`
	LatestApproved         *CustomerAccountVersionView `json:"latestApproved"`
	OpenVersion            *CustomerAccountVersionView `json:"openVersion"`
	UpdatedAt              time.Time                   `json:"updatedAt"`
}

func validateCustomerAccountData(in CustomerAccountDataInput) (CustomerAccountDataInput, error) {
	in.Name, in.ShortName, in.CustomerTypeCode = strings.TrimSpace(in.Name), strings.TrimSpace(in.ShortName), strings.TrimSpace(in.CustomerTypeCode)
	in.ContactName, in.ContactPhone, in.Email, in.Address = strings.TrimSpace(in.ContactName), strings.TrimSpace(in.ContactPhone), strings.TrimSpace(in.Email), strings.TrimSpace(in.Address)
	in.SettlementMethodID, in.PaymentMethodID = strings.TrimSpace(in.SettlementMethodID), strings.TrimSpace(in.PaymentMethodID)
	in.DefaultTransportMethodCode, in.DefaultTransportMethodName = strings.TrimSpace(in.DefaultTransportMethodCode), strings.TrimSpace(in.DefaultTransportMethodName)
	in.InternalReminder, in.DefaultSalesOrderRemark = strings.TrimSpace(in.InternalReminder), strings.TrimSpace(in.DefaultSalesOrderRemark)
	in.PrimarySalesAttribution.Type, in.PrimarySalesAttribution.SubjectObjectID = strings.TrimSpace(in.PrimarySalesAttribution.Type), strings.TrimSpace(in.PrimarySalesAttribution.SubjectObjectID)
	if in.Name == "" || len(in.Name) > 200 || in.CustomerTypeCode == "" || !validID(in.PrimarySalesAttribution.SubjectObjectID) || !slices.Contains([]string{CustomerSalesAttributionInternalEmployee, CustomerSalesAttributionExternalPartTime, CustomerSalesAttributionChannelPartner}, in.PrimarySalesAttribution.Type) || (in.SettlementMethodID != "" && !validID(in.SettlementMethodID)) || (in.PaymentMethodID != "" && !validID(in.PaymentMethodID)) {
		return CustomerAccountDataInput{}, newError(ErrorValidation, "validation_failed", "invalid customer account data", nil, nil)
	}
	var err error
	in.TransportSurcharge, err = normalizeCustomerMoney(in.TransportSurcharge, true)
	if err != nil {
		return CustomerAccountDataInput{}, newError(ErrorValidation, "validation_failed", "invalid transport surcharge", nil, err)
	}
	in.PricingPolicy, err = normalizeCustomerPricingPolicy(in.PricingPolicy)
	if err != nil {
		return CustomerAccountDataInput{}, newError(ErrorValidation, "validation_failed", "invalid customer pricing policy", nil, err)
	}
	seen := map[string]struct{}{}
	for i := range in.CreditLimits {
		l := &in.CreditLimits[i]
		l.Currency = strings.ToUpper(strings.TrimSpace(l.Currency))
		l.Amount, err = normalizeCustomerMoney(l.Amount, true)
		if err != nil || l.Currency != "CNY" {
			return CustomerAccountDataInput{}, newError(ErrorValidation, "validation_failed", "invalid customer credit limit", nil, err)
		}
		if _, ok := seen[l.Currency]; ok {
			return CustomerAccountDataInput{}, newError(ErrorValidation, "validation_failed", "duplicate customer credit currency", nil, nil)
		}
		seen[l.Currency] = struct{}{}
	}
	if in.CreditLimits == nil {
		in.CreditLimits = []CustomerCreditLimit{}
	}
	return in, nil
}
func normalizeCustomerMoney(value string, allowZero bool) (string, error) {
	if strings.TrimSpace(value) == "" && allowZero {
		return "0.00", nil
	}
	minor, err := fixeddecimal.ParsePositive(strings.TrimSpace(value), 2, allowZero)
	if err != nil {
		return "", err
	}
	return fixeddecimal.Format(minor, 2, false), nil
}
func normalizeCustomerPricingPolicy(p CustomerPricingPolicy) (CustomerPricingPolicy, error) {
	var err error
	if p.DefaultPremiumUnitPrice, err = normalizeCustomerMoney(p.DefaultPremiumUnitPrice, true); err != nil {
		return CustomerPricingPolicy{}, err
	}
	if p.DefaultDiscountUnitPrice, err = normalizeCustomerMoney(p.DefaultDiscountUnitPrice, true); err != nil {
		return CustomerPricingPolicy{}, err
	}
	if p.ThirdPartyIntermediaryFixedUnitCost, err = normalizeCustomerMoney(p.ThirdPartyIntermediaryFixedUnitCost, true); err != nil {
		return CustomerPricingPolicy{}, err
	}
	if p.ThirdPartyIntermediaryVariableUnitCost, err = normalizeCustomerMoney(p.ThirdPartyIntermediaryVariableUnitCost, true); err != nil {
		return CustomerPricingPolicy{}, err
	}
	seen := map[string]struct{}{}
	for i := range p.CostItems {
		item := &p.CostItems[i]
		item.Name = strings.TrimSpace(item.Name)
		key := strings.ToLower(strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, item.Name))
		if key == "" {
			return CustomerPricingPolicy{}, errors.New("cost item name is required")
		}
		if _, ok := seen[key]; ok {
			return CustomerPricingPolicy{}, fmt.Errorf("duplicate cost item %q", item.Name)
		}
		seen[key] = struct{}{}
		switch item.Basis {
		case pricingCostBasisUnitPrice:
			if item.OrderAmount != "" {
				return CustomerPricingPolicy{}, errors.New("unit price item contains order amount")
			}
			item.UnitPrice, err = normalizeCustomerMoney(item.UnitPrice, false)
		case pricingCostBasisOrderAmount:
			if item.UnitPrice != "" {
				return CustomerPricingPolicy{}, errors.New("order amount item contains unit price")
			}
			item.OrderAmount, err = normalizeCustomerMoney(item.OrderAmount, false)
		default:
			return CustomerPricingPolicy{}, errors.New("invalid cost item basis")
		}
		if err != nil {
			return CustomerPricingPolicy{}, err
		}
	}
	sort.Slice(p.CostItems, func(i, j int) bool { return p.CostItems[i].Name < p.CostItems[j].Name })
	if p.CostItems == nil {
		p.CostItems = []CustomerPricingCostItem{}
	}
	return p, nil
}
