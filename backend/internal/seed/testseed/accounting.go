package testseed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

const testAccountingBookDescription = "seed-test:business-control-book"

var testVouEntities = []string{
	voudomain.EntitySalePricing, voudomain.EntitySaleOrder,
	voudomain.EntitySaleOutbound, voudomain.EntitySaleDelivery,
	voudomain.EntitySaleSignoff, voudomain.EntitySaleReturn,
	voudomain.EntityPurchaseOrder, voudomain.EntityPurchaseInbound,
	voudomain.EntityPurchaseReturn, voudomain.EntityPurchaseInquiry,
	voudomain.EntityOrderProduction, voudomain.EntitySelfProduction,
	voudomain.EntityInventoryCount, voudomain.EntitySalesReceipt,
	voudomain.EntityPurchaseRefund, voudomain.EntityOtherReceipt,
	voudomain.EntitySalesRefund, voudomain.EntityPurchasePayment,
	voudomain.EntityOtherPayment, voudomain.EntityEmployeeLoan,
	voudomain.EntityEmployeeRepayment, voudomain.EntityEmployeeLoanWriteoff,
	voudomain.EntityExpenseReimbursement, voudomain.EntityExpensePayment,
	voudomain.EntityOtherIncome, voudomain.EntityAssetAcquisition,
	voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation,
	voudomain.EntityBillReceipt, voudomain.EntityBillPayment,
	voudomain.EntityBillIssue, voudomain.EntityBillDiscount,
	voudomain.EntityBillMaturity, voudomain.EntityIntermediaryCalculation,
	voudomain.EntityServiceContract, voudomain.EntityServiceAcceptance,
}

func (s *Seeder) seedAccounting(ctx context.Context, counts *Counts) error {
	accountingActor, err := s.accountingActor(ctx)
	if err != nil {
		return err
	}
	book, created, err := s.ensureAccountingBook(ctx, accountingActor)
	if err != nil {
		return err
	}
	counts.add(created)
	if err = s.ensureAccountingOpening(ctx, book.ID, accountingActor, counts); err != nil {
		return err
	}
	debit, err := s.ensureAccountingSubject(
		ctx, book.ID, accountingActor, "109901", "测试资金", accdomain.BalanceDirectionDebit,
	)
	if err != nil {
		return err
	}
	credit, err := s.ensureAccountingSubject(
		ctx, book.ID, accountingActor, "609901", "测试收入", accdomain.BalanceDirectionCredit,
	)
	if err != nil {
		return err
	}
	serviceExpense, err := s.ensureAccountingSubjectWithConfiguration(
		ctx, book.ID, accountingActor, "660901", "测试服务费用", accdomain.BalanceDirectionDebit,
		[]string{}, accdomain.SettlementPurposeNone,
	)
	if err != nil {
		return err
	}
	serviceIncome, err := s.ensureAccountingSubjectWithConfiguration(
		ctx, book.ID, accountingActor, "605901", "测试服务收入", accdomain.BalanceDirectionCredit,
		[]string{}, accdomain.SettlementPurposeNone,
	)
	if err != nil {
		return err
	}
	serviceReceivable, err := s.ensureAccountingSubjectWithConfiguration(
		ctx, book.ID, accountingActor, "122102", "测试服务往来应收", accdomain.BalanceDirectionDebit,
		[]string{accdomain.DimensionOtherUnit}, accdomain.SettlementPurposeOther,
	)
	if err != nil {
		return err
	}
	servicePayable, err := s.ensureAccountingSubjectWithConfiguration(
		ctx, book.ID, accountingActor, "224102", "测试服务往来应付", accdomain.BalanceDirectionCredit,
		[]string{accdomain.DimensionOtherUnit}, accdomain.SettlementPurposeOther,
	)
	if err != nil {
		return err
	}
	for _, entity := range testVouEntities {
		definition := accdomain.MappingDefinition{
			Rules: []accdomain.MappingRule{}, Templates: []accdomain.PostingTemplate{},
		}
		result := accdomain.MappingResultUnpost
		if entity == voudomain.EntityOtherIncome {
			templateID := "test-other-income"
			definition.DefaultTemplateID = &templateID
			definition.Templates = []accdomain.PostingTemplate{{
				ID: templateID,
				Lines: []accdomain.PostingLineTemplate{
					{SubjectSource: "FIXED", SubjectValue: debit.ID, Direction: accdomain.BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
					{SubjectSource: "FIXED", SubjectValue: credit.ID, Direction: accdomain.BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
				},
			}}
			result = accdomain.MappingResultPost
		}
		if entity == voudomain.EntityServiceAcceptance {
			payableTemplateID, receivableTemplateID := "test-service-acceptance-payable", "test-service-acceptance-receivable"
			definition.Rules = []accdomain.MappingRule{
				{Conditions: []accdomain.MappingCondition{{Field: "serviceAcceptance.settlementDirection", Operator: "EQ", Values: []string{"PAYABLE"}}}, Result: accdomain.MappingResultPost, TemplateID: &payableTemplateID},
				{Conditions: []accdomain.MappingCondition{{Field: "serviceAcceptance.settlementDirection", Operator: "EQ", Values: []string{"RECEIVABLE"}}}, Result: accdomain.MappingResultPost, TemplateID: &receivableTemplateID},
			}
			definition.Templates = []accdomain.PostingTemplate{
				{ID: payableTemplateID, Lines: []accdomain.PostingLineTemplate{
					{SubjectSource: "FIXED", SubjectValue: serviceExpense.ID, Direction: accdomain.BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
					{SubjectSource: "FIXED", SubjectValue: servicePayable.ID, Direction: accdomain.BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{accdomain.DimensionOtherUnit: "counterparty.objectId"}},
				}},
				{ID: receivableTemplateID, Lines: []accdomain.PostingLineTemplate{
					{SubjectSource: "FIXED", SubjectValue: serviceReceivable.ID, Direction: accdomain.BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{accdomain.DimensionOtherUnit: "counterparty.objectId"}},
					{SubjectSource: "FIXED", SubjectValue: serviceIncome.ID, Direction: accdomain.BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
				}},
			}
			result = accdomain.MappingResultUnpost
		}
		mappingOutcome, mappingErr := s.ensureAccountingMapping(
			ctx, book.ID, accountingActor, entity, result, definition,
		)
		if mappingErr != nil {
			return fmt.Errorf("%s mapping: %w", entity, mappingErr)
		}
		counts.add(mappingOutcome)
	}
	return nil
}

func (s *Seeder) ensureAccountingBook(
	ctx context.Context,
	accountingActor string,
) (accdomain.BookView, outcome, error) {
	var bookID string
	bookID, err := s.queries.FindAccountingBookIDByDescription(ctx, testAccountingBookDescription)
	if errors.Is(err, pgx.ErrNoRows) {
		book, createErr := s.accounting.CreateBook(ctx, accdomain.CreateBookInput{
			Name: "测试业务控制账簿", Description: testAccountingBookDescription,
			StartMonth: "2026-06", BaseCurrency: "CNY",
			SubjectTemplate: accdomain.SubjectTemplateEmpty,
		}, accountingActor)
		return book, outcomeCreated, createErr
	}
	if err != nil {
		return accdomain.BookView{}, 0, err
	}
	book, err := s.accounting.GetBook(ctx, bookID, accountingActor)
	return book, outcomeSkipped, err
}

func (s *Seeder) ensureAccountingOpening(
	ctx context.Context,
	bookID string,
	accountingActor string,
	counts *Counts,
) error {
	actor, err := seedActor(accountingActor, "seed-acc-opening-"+bookID)
	if err != nil {
		return err
	}
	opening, err := s.accounting.GetOpening(ctx, bookID, actor)
	if err != nil {
		return err
	}
	if opening.Approval.Status == approval.StatusApproved {
		counts.add(outcomeSkipped)
		return nil
	}
	if opening.Approval.Revision != 0 || len(opening.Lines) != 0 || len(opening.Assets) != 0 ||
		len(opening.Bills) != 0 || len(opening.Containers) != 0 {
		return errors.New("test accounting opening was changed by a tester")
	}
	opening, err = s.accounting.SaveOpening(ctx, accdomain.SaveOpeningInput{
		BookID: bookID, Revision: 0,
		Lines: []accdomain.OpeningLineInput{}, Assets: []accdomain.OpeningAssetInput{},
		Bills: []accdomain.OpeningBillInput{}, Containers: []accdomain.OpeningContainerInput{},
	}, actor)
	if err != nil {
		return err
	}
	opening, err = s.accounting.SubmitOpening(ctx, bookID, opening.Approval.Revision, actor)
	if err != nil {
		return err
	}
	reviewer, actorErr := approval.TrustedSystemActor("seed-acc-opening-approve-" + bookID)
	if actorErr != nil {
		return actorErr
	}
	if _, err = s.accounting.ApproveOpening(ctx, bookID, opening.Approval.Revision, reviewer); err != nil {
		return err
	}
	counts.add(outcomeCreated)
	return nil
}

func (s *Seeder) ensureAccountingSubject(
	ctx context.Context,
	bookID, accountingActor, code, name, direction string,
) (accdomain.SubjectView, error) {
	return s.ensureAccountingSubjectWithConfiguration(
		ctx, bookID, accountingActor, code, name, direction, []string{}, accdomain.SettlementPurposeNone,
	)
}

func (s *Seeder) ensureAccountingSubjectWithConfiguration(
	ctx context.Context,
	bookID, accountingActor, code, name, direction string,
	requiredDimensions []string,
	settlementPurpose string,
) (accdomain.SubjectView, error) {
	page, err := s.accounting.QuerySubjects(ctx, accdomain.QuerySubjectsInput{
		BookID: bookID, Page: 1, PageSize: 200, Keyword: code,
	}, accountingActor)
	if err != nil {
		return accdomain.SubjectView{}, err
	}
	for _, subject := range page.Items {
		if subject.Code == code {
			return subject, nil
		}
	}
	return s.accounting.CreateSubject(ctx, accdomain.CreateSubjectInput{
		BookID: bookID, Code: code, Name: name, BalanceDirection: direction,
		Enabled: true, RequiredDimensions: requiredDimensions,
		SettlementPurpose: settlementPurpose,
	}, accountingActor)
}

func (s *Seeder) ensureAccountingMapping(
	ctx context.Context,
	bookID, accountingActor, entity, defaultResult string,
	definition accdomain.MappingDefinition,
) (outcome, error) {
	actor, err := seedActor(accountingActor, "seed-acc-mapping-"+entity)
	if err != nil {
		return 0, err
	}
	page, err := s.accountMappings.Query(ctx, dcldomain.AccMappingQueryInput{
		BookID: bookID, Page: 1, PageSize: 100,
		Filters: dcldomain.AccMappingQueryFilters{VouEntity: entity},
	}, actor)
	if err != nil {
		return 0, fmt.Errorf("query DCL accounting mapping: %w", err)
	}
	for _, mapping := range page.Items {
		if mapping.Approval.Status == approval.StatusApproved {
			return outcomeSkipped, nil
		}
	}
	if len(page.Items) != 0 {
		return 0, fmt.Errorf("unapproved mapping already exists")
	}
	encodedDefinition, err := json.Marshal(definition)
	if err != nil {
		return 0, err
	}
	mapping, err := s.accountMappings.Create(ctx, dcldomain.AccMappingCreateInput{
		BookID: bookID, VouEntity: entity,
		Data: dcldomain.AccMappingData{DefaultResult: defaultResult, Definition: encodedDefinition},
	}, actor)
	if err != nil {
		return 0, fmt.Errorf("create DCL accounting mapping: %w", err)
	}
	mapping, err = s.accountMappings.Submit(ctx, dcldomain.AccMappingVersionInput{BookID: bookID, VouEntity: entity, ApprovalEntryID: mapping.Approval.ApprovalEntryID, ApprovalRevision: mapping.Approval.Revision}, actor)
	if err != nil {
		return 0, fmt.Errorf("submit DCL accounting mapping: %w", err)
	}
	reviewer, actorErr := approval.TrustedSystemActor("seed-acc-mapping-approve-" + entity)
	if actorErr != nil {
		return 0, actorErr
	}
	if _, err = s.accountMappings.Approve(ctx, dcldomain.AccMappingVersionInput{BookID: bookID, VouEntity: entity, ApprovalEntryID: mapping.Approval.ApprovalEntryID, ApprovalRevision: mapping.Approval.Revision}, reviewer); err != nil {
		return 0, fmt.Errorf("approve DCL accounting mapping: %w", err)
	}
	return outcomeCreated, nil
}

func (s *Seeder) accountingActor(ctx context.Context) (string, error) {
	userID, err := s.queries.FindEnabledAppUserIDExcludingID(ctx, actorID)
	if err != nil {
		return "", fmt.Errorf("load test accounting actor: %w", err)
	}
	return userID, nil
}
