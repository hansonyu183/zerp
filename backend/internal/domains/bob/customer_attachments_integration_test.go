//go:build integration

package bob

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestCustomerAttachmentGroupAndAccountRoundTripIntegration(t *testing.T) {
	pool := integrationPool(t)
	master := NewService(pool)
	master.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, master, EntityEmployee, CreateDetailInput{Name: "附件归属员工"}, "customer-attachment-employee")
	_, operating := createApprovedIntegration(t, master, EntityOperatingEntity, CreateDetailInput{
		Name: "附件测试经营主体有限公司", TaxNumber: "91440300CUSTOMERATT",
	}, "customer-attachment-operating")
	created, err := master.CustomerCreate(t.Context(), CustomerCreateInput{
		Group: CustomerGroupData{CompanyName: "附件测试集团", BankAccounts: []CustomerGroupBankAccount{}},
		Data: CustomerAccountData{
			Name: "附件测试结算户", CustomerTypeCode: CustomerTypeEndUser, OperatingEntityID: operating.ObjectID,
			SettlementMethodID: "01J00000000000000000000081", PaymentMethodID: "01J00000000000000000000082",
			DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提",
			PricingPolicy: defaultPricingPolicy(),
			CreditLimits:  []CustomerCreditLimit{}, PrimarySalesAttribution: CustomerSalesAttributionInput{
				Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID,
			},
		},
	}, integrationActorOne, "customer-attachment-create")
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	attachments, err := NewCustomerAttachmentService(pool, CustomerAttachmentOptions{Root: t.TempDir()})
	if err != nil {
		t.Fatalf("create attachment service: %v", err)
	}
	content := []byte("%PDF-1.7\ncustomer attachment")
	sum := sha256.Sum256(content)
	upload := func(scope, ownerID string, revision int64, name string) CustomerAttachmentInitiateResult {
		t.Helper()
		result, initiateErr := attachments.Initiate(t.Context(), CustomerAttachmentInitiateInput{
			Scope: scope, OwnerID: ownerID, Revision: revision,
			CategoryObjectID: "01JCDT00000000000000000003", FileName: name,
			ContentType: "application/pdf", Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
		}, integrationActorOne, "customer-attachment-initiate")
		if initiateErr != nil {
			t.Fatalf("initiate %s attachment: %v", scope, initiateErr)
		}
		token := strings.TrimPrefix(result.UploadURL, "/files/customer-attachments/upload/")
		if uploadErr := attachments.Upload(t.Context(), token, bytes.NewReader(content), int64(len(content)), "application/pdf"); uploadErr != nil {
			t.Fatalf("upload %s attachment: %v", scope, uploadErr)
		}
		return result
	}
	groupFile := upload(CustomerAttachmentScopeGroup, created.GroupID, 1, "license.pdf")
	accountFile := upload(CustomerAttachmentScopeAccount, created.VersionID, 1, "contract.pdf")

	detail, err := master.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get customer: %v", err)
	}
	if err = attachments.EnrichDetail(t.Context(), &detail); err != nil {
		t.Fatalf("enrich customer attachments: %v", err)
	}
	if len(detail.Group.Attachments) != 1 || detail.Group.Attachments[0].CategoryName != "营业执照" {
		t.Fatalf("group attachments = %#v", detail.Group.Attachments)
	}
	if detail.Candidate == nil || len(detail.Candidate.Attachments) != 1 || detail.Candidate.Attachments[0].FileID != accountFile.FileID {
		t.Fatalf("account attachments = %#v", detail.Candidate)
	}
	download, err := attachments.CreateDownload(t.Context(), CustomerAttachmentDownloadInput{
		Scope: CustomerAttachmentScopeGroup, OwnerID: created.GroupID, FileID: groupFile.FileID,
	}, integrationActorOne)
	if err != nil {
		t.Fatalf("create download: %v", err)
	}
	opened, err := attachments.OpenDownload(t.Context(), strings.TrimPrefix(download.DownloadURL, "/files/customer-attachments/download/"))
	if err != nil {
		t.Fatalf("open download: %v", err)
	}
	defer opened.Reader.Close()
	buffer := make([]byte, len(content))
	if _, err = opened.Reader.Read(buffer); err != nil || !bytes.Equal(buffer, content) {
		t.Fatalf("download content=%q err=%v", buffer, err)
	}
	if _, err = attachments.Remove(t.Context(), CustomerAttachmentRemoveInput{
		Scope: CustomerAttachmentScopeGroup, OwnerID: created.GroupID, Revision: groupFile.Revision, FileID: groupFile.FileID,
	}, integrationActorOne, "customer-attachment-remove"); err != nil {
		t.Fatalf("remove group attachment: %v", err)
	}
	submitted, err := master.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: accountFile.Revision,
	}, integrationActorOne, "customer-attachment-submit")
	if err != nil {
		t.Fatalf("submit customer with attachment: %v", err)
	}
	approved, err := master.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: created.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "customer-attachment-approve")
	if err != nil {
		t.Fatalf("approve customer with attachment: %v", err)
	}
	unapproved, err := master.Unapprove(t.Context(), EntityCustomer, ReverseInput{
		ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
		VersionID: approved.VersionID, Revision: approved.Revision, Reason: "附件继承检查",
	}, integrationActorOne, "customer-attachment-unapprove")
	if err != nil {
		t.Fatalf("unapprove customer with attachment: %v", err)
	}
	detail, err = master.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get unapproved customer: %v", err)
	}
	if err = attachments.EnrichDetail(t.Context(), &detail); err != nil {
		t.Fatalf("enrich copied customer attachments: %v", err)
	}
	if detail.Candidate == nil || detail.Candidate.Version.VersionID != unapproved.VersionID ||
		len(detail.Candidate.Attachments) != 1 || detail.Candidate.Attachments[0].FileID != accountFile.FileID {
		t.Fatalf("copied account attachments = %#v", detail.Candidate)
	}
	draft, err := master.Unsubmit(t.Context(), EntityCustomer, ReverseInput{
		ObjectID: created.ObjectID, ObjectRevision: unapproved.ObjectRevision,
		VersionID: unapproved.VersionID, Revision: unapproved.Revision, Reason: "返回草稿清理附件",
	}, integrationActorOne, "customer-attachment-unsubmit")
	if err != nil {
		t.Fatalf("unsubmit copied customer version: %v", err)
	}
	if _, err = attachments.Remove(t.Context(), CustomerAttachmentRemoveInput{
		Scope: CustomerAttachmentScopeAccount, OwnerID: draft.VersionID, Revision: draft.Revision, FileID: accountFile.FileID,
	}, integrationActorOne, "customer-attachment-remove"); err != nil {
		t.Fatalf("remove account attachment: %v", err)
	}
}
