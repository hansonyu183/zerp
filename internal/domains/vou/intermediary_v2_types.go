package vou

import (
	"encoding/json"
	"time"
)

type IntermediaryV2ProductLineInput struct {
	Product              ReferenceInput `json:"product"`
	OrderedQuantity      string         `json:"orderedQuantity"`
	UnitPrice            string         `json:"unitPrice"`
	ContainerType        *string        `json:"containerType,omitempty"`
	QuantityPerContainer *string        `json:"quantityPerContainer,omitempty"`
	Remark               string         `json:"remark,omitempty"`
}

type IntermediaryV2DraftInput struct {
	BusinessDate string                           `json:"businessDate"`
	Currency     string                           `json:"currency"`
	Remark       string                           `json:"remark,omitempty"`
	Customer     ReferenceInput                   `json:"customer"`
	Salesperson  *ReferenceInput                  `json:"salesperson,omitempty"`
	ProductLines []IntermediaryV2ProductLineInput `json:"productLines"`
}

type IntermediaryActionInput struct {
	DocumentID    string          `json:"documentId"`
	RootRevision  int64           `json:"rootRevision"`
	ChildID       string          `json:"childId,omitempty"`
	ChildRevision int64           `json:"childRevision,omitempty"`
	Data          json.RawMessage `json:"data,omitempty"`
	Reason        string          `json:"reason,omitempty"`
}

type IntermediaryAttachmentInitiateInput struct {
	DocumentID    string `json:"documentId"`
	RootRevision  int64  `json:"rootRevision"`
	ChildID       string `json:"childId"`
	ChildRevision int64  `json:"childRevision"`
	FileName      string `json:"fileName"`
	ContentType   string `json:"contentType"`
	Size          int64  `json:"size"`
	SHA256        string `json:"sha256"`
}

type IntermediaryAttachmentDownloadInput struct {
	DocumentID string `json:"documentId"`
	ChildID    string `json:"childId"`
	FileID     string `json:"fileId"`
}

type IntermediaryAttachmentRemoveInput struct {
	DocumentID    string `json:"documentId"`
	RootRevision  int64  `json:"rootRevision"`
	ChildID       string `json:"childId"`
	ChildRevision int64  `json:"childRevision"`
	FileID        string `json:"fileId"`
}

type IntermediaryLineQuantityInput struct {
	RootLineID string `json:"rootLineId"`
	Quantity   string `json:"quantity"`
	Remark     string `json:"remark,omitempty"`
}

type IntermediaryProcurementLineInput struct {
	RootLineID string `json:"rootLineId"`
	Quantity   string `json:"quantity"`
	UnitPrice  string `json:"unitPrice,omitempty"`
	Remark     string `json:"remark,omitempty"`
}

type IntermediaryProcurementInput struct {
	Supplier     ReferenceInput                     `json:"supplier"`
	Purchaser    *ReferenceInput                    `json:"purchaser,omitempty"`
	PurchaseDate string                             `json:"purchaseDate"`
	Lines        []IntermediaryProcurementLineInput `json:"lines"`
	Remark       string                             `json:"remark,omitempty"`
}

type IntermediaryReceiptInput struct {
	ReceiptDate string                          `json:"receiptDate"`
	Lines       []IntermediaryLineQuantityInput `json:"lines"`
	Remark      string                          `json:"remark,omitempty"`
}

type IntermediaryDeliveryInput struct {
	DeliveryDate string                          `json:"deliveryDate"`
	Platform     ReferenceInput                  `json:"platform"`
	Vehicle      ReferenceInput                  `json:"vehicle"`
	Lines        []IntermediaryLineQuantityInput `json:"lines"`
	Remark       string                          `json:"remark,omitempty"`
}

type IntermediarySignoffLineInput struct {
	RootLineID       string `json:"rootLineId"`
	SignedQuantity   string `json:"signedQuantity"`
	RejectedQuantity string `json:"rejectedQuantity"`
	Remark           string `json:"remark,omitempty"`
}

type IntermediarySignoffInput struct {
	DeliveryChildID           string                         `json:"deliveryChildId"`
	SignoffDate               string                         `json:"signoffDate"`
	Lines                     []IntermediarySignoffLineInput `json:"lines"`
	ReturnedSolventContainers int64                          `json:"returnedSolventContainers"`
	ReturnedResinContainers   int64                          `json:"returnedResinContainers"`
	ContainerDifferenceReason string                         `json:"containerDifferenceReason,omitempty"`
	Remark                    string                         `json:"remark,omitempty"`
}

type IntermediaryLineBalance struct {
	RootLineID                 string `json:"rootLineId"`
	OrderedQuantity            string `json:"orderedQuantity"`
	ProcurementQuantity        string `json:"procurementQuantity,omitempty"`
	ConfirmedReceiptQuantity   string `json:"confirmedReceiptQuantity"`
	ExecutedDeliveryQuantity   string `json:"executedDeliveryQuantity"`
	SignedQuantity             string `json:"signedQuantity"`
	RejectedQuantity           string `json:"rejectedQuantity"`
	LossQuantity               string `json:"lossQuantity"`
	AvailableToDeliverQuantity string `json:"availableToDeliverQuantity"`
	RemainingToSignQuantity    string `json:"remainingToSignQuantity"`
}

type IntermediaryContainerBalance struct {
	ContainerType string `json:"containerType"`
	Quantity      int64  `json:"quantity"`
}

type IntermediaryBalances struct {
	Lines                 []IntermediaryLineBalance      `json:"lines"`
	Containers            []IntermediaryContainerBalance `json:"containers"`
	HasUnfinishedChildren bool                           `json:"hasUnfinishedChildren"`
}

type IntermediaryChildSummary struct {
	ChildID   string     `json:"childId"`
	ChildNo   string     `json:"childNo"`
	Stage     string     `json:"stage"`
	Status    string     `json:"status"`
	Revision  int64      `json:"revision"`
	CreatedAt time.Time  `json:"createdAt"`
	CreatedBy string     `json:"createdBy"`
	UpdatedAt time.Time  `json:"updatedAt"`
	UpdatedBy string     `json:"updatedBy"`
	CheckedAt *time.Time `json:"checkedAt,omitempty"`
	CheckedBy *string    `json:"checkedBy,omitempty"`
	FinalAt   *time.Time `json:"finalAt,omitempty"`
	FinalBy   *string    `json:"finalBy,omitempty"`
}
