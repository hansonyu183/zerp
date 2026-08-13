package previewseed

import (
	"context"
	"errors"
	"fmt"

	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

const previewAccountingBookDescription = "seed-preview:business-control-book"

var previewVouEntities = []string{
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
		ctx, book.ID, accountingActor, "109901", "预览测试资金", accdomain.BalanceDirectionDebit,
	)
	if err != nil {
		return err
	}
	credit, err := s.ensureAccountingSubject(
		ctx, book.ID, accountingActor, "609901", "预览测试收入", accdomain.BalanceDirectionCredit,
	)
	if err != nil {
		return err
	}
	for _, entity := range previewVouEntities {
		definition := accdomain.MappingDefinition{
			Rules: []accdomain.MappingRule{}, Templates: []accdomain.PostingTemplate{},
		}
		result := accdomain.MappingResultUnpost
		if entity == voudomain.EntityOtherIncome {
			templateID := "preview-other-income"
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
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM acc_books WHERE description=$1 ORDER BY created_at,id LIMIT 1
	`, previewAccountingBookDescription).Scan(&bookID)
	if errors.Is(err, pgx.ErrNoRows) {
		book, createErr := s.accounting.CreateBook(ctx, accdomain.CreateBookInput{
			Name: "预览业务控制账簿", Description: previewAccountingBookDescription,
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
	opening, err := s.accounting.GetOpening(ctx, bookID, accountingActor)
	if err != nil {
		return err
	}
	if opening.State == accdomain.OpeningStateApproved {
		counts.add(outcomeSkipped)
		return nil
	}
	if opening.Revision != 0 || len(opening.Lines) != 0 || len(opening.Assets) != 0 ||
		len(opening.Bills) != 0 || len(opening.Containers) != 0 {
		return errors.New("preview accounting opening was changed by a tester")
	}
	opening, err = s.accounting.SaveOpening(ctx, accdomain.SaveOpeningInput{
		BookID: bookID, Revision: 0,
		Lines: []accdomain.OpeningLineInput{}, Assets: []accdomain.OpeningAssetInput{},
		Bills: []accdomain.OpeningBillInput{}, Containers: []accdomain.OpeningContainerInput{},
	}, accountingActor)
	if err != nil {
		return err
	}
	if _, err = s.accounting.ApproveOpening(ctx, bookID, opening.Revision, accountingActor); err != nil {
		return err
	}
	counts.add(outcomeCreated)
	return nil
}

func (s *Seeder) ensureAccountingSubject(
	ctx context.Context,
	bookID, accountingActor, code, name, direction string,
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
		Enabled: true, RequiredDimensions: []string{},
		SettlementPurpose: accdomain.SettlementPurposeNone,
	}, accountingActor)
}

func (s *Seeder) ensureAccountingMapping(
	ctx context.Context,
	bookID, accountingActor, entity, defaultResult string,
	definition accdomain.MappingDefinition,
) (outcome, error) {
	page, err := s.accounting.QueryMappings(ctx, accdomain.QueryMappingsInput{
		BookID: bookID, VouEntity: entity, Page: 1, PageSize: 200,
	}, accountingActor)
	if err != nil {
		return 0, err
	}
	for _, mapping := range page.Items {
		if mapping.State == accdomain.MappingStateApproved {
			return outcomeSkipped, nil
		}
	}
	if len(page.Items) != 0 {
		return 0, fmt.Errorf("unapproved mapping already exists")
	}
	mapping, err := s.accounting.CreateMapping(ctx, accdomain.CreateMappingInput{
		BookID: bookID, VouEntity: entity, DefaultResult: defaultResult,
		Definition: definition,
	}, accountingActor)
	if err != nil {
		return 0, err
	}
	if _, err = s.accounting.ApproveMapping(
		ctx, bookID, mapping.ID, mapping.Revision, accountingActor,
	); err != nil {
		return 0, err
	}
	return outcomeCreated, nil
}

func (s *Seeder) accountingActor(ctx context.Context) (string, error) {
	var userID string
	if err := s.pool.QueryRow(ctx, `
		SELECT id FROM app_users WHERE status='ENABLED' AND id<>$1 ORDER BY created_at,id LIMIT 1
	`, actorID).Scan(&userID); err != nil {
		return "", fmt.Errorf("load preview accounting actor: %w", err)
	}
	return userID, nil
}
