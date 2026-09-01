package dcl

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Customer is the sole DCL approval subject. Accounts are stable child roots
// whose values are frozen in each Customer approval version.
type CustomerCreateInput struct {
	Data CustomerDataInput `json:"data"`
}

type CustomerSaveInput struct {
	ObjectID         string            `json:"objectId"`
	ApprovalEntryID  string            `json:"approvalEntryId"`
	ApprovalRevision int64             `json:"approvalRevision"`
	Data             CustomerDataInput `json:"data"`
}

type CustomerDataInput struct {
	Kind                     string                      `json:"kind"`
	LegalName                string                      `json:"legalName"`
	DisplayName              string                      `json:"displayName,omitempty"`
	TaxNumber                string                      `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput   `json:"strongIdentifiers"`
	Phone                    string                      `json:"phone,omitempty"`
	Email                    string                      `json:"email,omitempty"`
	Address                  string                      `json:"address,omitempty"`
	InvoiceTitle             string                      `json:"invoiceTitle,omitempty"`
	InvoiceAddress           string                      `json:"invoiceAddress,omitempty"`
	InvoicePhone             string                      `json:"invoicePhone,omitempty"`
	InvoiceBankName          string                      `json:"invoiceBankName,omitempty"`
	InvoiceBankAccount       string                      `json:"invoiceBankAccount,omitempty"`
	RemittanceProfiles       []CustomerRemittanceProfile `json:"remittanceProfiles"`
	DefaultOperatingEntityID string                      `json:"defaultOperatingEntityId"`
	Enabled                  bool                        `json:"enabled"`
	Accounts                 []CustomerAccountDataInput  `json:"accounts"`
}

type BusinessIdentifierInput struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}
type CustomerRemittanceProfile struct {
	AccountName   string `json:"accountName"`
	BankName      string `json:"bankName,omitempty"`
	AccountNumber string `json:"accountNumber,omitempty"`
}

// CustomerData is the read model. It contains resolved references, stable
// account IDs/codes and attachments scoped to the enclosing revision.
type CustomerData struct {
	Kind                     string                      `json:"kind"`
	LegalName                string                      `json:"legalName"`
	DisplayName              string                      `json:"displayName"`
	TaxNumber                string                      `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput   `json:"strongIdentifiers"`
	Phone                    string                      `json:"phone,omitempty"`
	Email                    string                      `json:"email,omitempty"`
	Address                  string                      `json:"address,omitempty"`
	InvoiceTitle             string                      `json:"invoiceTitle,omitempty"`
	InvoiceAddress           string                      `json:"invoiceAddress,omitempty"`
	InvoicePhone             string                      `json:"invoicePhone,omitempty"`
	InvoiceBankName          string                      `json:"invoiceBankName,omitempty"`
	InvoiceBankAccount       string                      `json:"invoiceBankAccount,omitempty"`
	RemittanceProfiles       []CustomerRemittanceProfile `json:"remittanceProfiles"`
	DefaultOperatingEntityID string                      `json:"defaultOperatingEntityId"`
	DefaultOperatingEntity   CustomerSnapshot            `json:"defaultOperatingEntity"`
	Enabled                  bool                        `json:"enabled"`
	Accounts                 []CustomerAccountData       `json:"accounts"`
}

type CustomerVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type CustomerReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type CustomerDeleteInput = CustomerVersionInput
type CustomerMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}
