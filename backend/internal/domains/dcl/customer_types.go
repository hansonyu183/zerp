package dcl

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Customer is the sole DCL approval subject. Subunits are stable child roots
// whose values are frozen in each Customer approval version.
type CustomerCreateInput struct {
	Data CustomerCreateDataInput `json:"data"`
}

type CustomerSaveInput struct {
	ObjectID         string                `json:"objectId"`
	ApprovalEntryID  string                `json:"approvalEntryId"`
	ApprovalRevision int64                 `json:"approvalRevision"`
	Data             CustomerRootDataInput `json:"data"`
}

// CustomerRootDataInput contains only Customer-owned facts.  Subunits are
// deliberately excluded so a root save cannot mutate the child collection.
type CustomerRootDataInput struct {
	Kind                     string                      `json:"kind"`
	LegalName                string                      `json:"legalName"`
	DisplayName              string                      `json:"displayName,omitempty"`
	LegalIdentifier          string                      `json:"legalIdentifier"`
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
}

type CustomerCreateDataInput struct {
	Root     CustomerRootDataInput      `json:"root"`
	Subunits []CustomerSubunitDataInput `json:"subunits"`
}

type CustomerSaveSubunitsInput struct {
	ObjectID         string                     `json:"objectId"`
	ApprovalEntryID  string                     `json:"approvalEntryId"`
	ApprovalRevision int64                      `json:"approvalRevision"`
	Subunits         []CustomerSubunitDataInput `json:"subunits"`
}

type CustomerRemittanceProfile struct {
	AccountName   string `json:"accountName"`
	BankName      string `json:"bankName,omitempty"`
	AccountNumber string `json:"accountNumber,omitempty"`
}

// CustomerData is the read model. It contains resolved references, stable
// subunit IDs/codes and attachments scoped to the enclosing revision.
// ImplicitSubunitID is derived after loading and is never persisted.
type CustomerData struct {
	Kind                     string                      `json:"kind"`
	LegalName                string                      `json:"legalName"`
	DisplayName              string                      `json:"displayName"`
	LegalIdentifier          string                      `json:"legalIdentifier"`
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
	Subunits                 []CustomerSubunitData       `json:"subunits"`
	ImplicitSubunitID        *string                     `json:"implicitSubunitId"`
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
