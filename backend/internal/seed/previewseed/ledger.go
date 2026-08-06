package previewseed

import (
	"context"
	"errors"
	"fmt"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func (s *Seeder) seedLedgerBaseline(ctx context.Context, counts *Counts) error {
	if err := s.ledger.EnsureReady(ctx); err != nil {
		return err
	}
	opening, err := s.ledger.GetOpening(ctx)
	if err != nil {
		return err
	}
	var documentCount, closingCount, externalAuditCount int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM vou_documents`).Scan(&documentCount); err != nil {
		return err
	}
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM led_closings`).Scan(&closingCount); err != nil {
		return err
	}
	if err = s.pool.QueryRow(ctx, `
		SELECT count(*) FROM led_audit_events WHERE request_id NOT LIKE $1
	`, seedPrefix+"%").Scan(&externalAuditCount); err != nil {
		return err
	}
	canSeedOpening := documentCount == 0 && closingCount == 0 && externalAuditCount == 0 &&
		len(opening.Inventory) == 0 && len(opening.Fund) == 0 &&
		len(opening.Party) == 0 && len(opening.Container) == 0
	if canSeedOpening && opening.Status == leddomain.StatusActive {
		reopened, reopenErr := s.ledger.Reopen(ctx, leddomain.ReopenInput{
			Revision: opening.Revision, Reason: "初始化预览测试期初",
		}, actorID, requestID("ledger-opening", "reopen"))
		if reopenErr != nil {
			return reopenErr
		}
		opening.Status, opening.Revision = reopened.Status, reopened.Revision
	}
	if canSeedOpening &&
		(opening.Status == leddomain.StatusDraft || opening.Status == leddomain.StatusReopening) {
		raw := s.bobRefs["raw-effective"]
		finished := s.bobRefs["finished-effective"]
		warehouse := s.bobRefs["warehouse-effective"]
		fund := s.bobRefs["fund-effective"]
		customer := s.bobRefs["customer-effective"]
		saved, saveErr := s.ledger.SaveOpening(ctx, leddomain.OpeningSaveInput{
			Revision: opening.Revision, CutoverDate: openingDate,
			Inventory: []leddomain.InventoryOpeningInput{
				{
					Warehouse: ledReference(warehouse), Product: ledReference(raw),
					Quantity: "1000", UnitPrice: "10.00", Currency: "CNY",
				},
				{
					Warehouse: ledReference(warehouse), Product: ledReference(finished),
					Quantity: "100", UnitPrice: "50.00", Currency: "CNY",
				},
			},
			Fund: []leddomain.FundOpeningInput{{
				FundAccount: ledReference(fund), BalanceType: "POSITIVE", Amount: "100000.00",
			}},
			Party: []leddomain.PartyOpeningInput{{
				CounterpartyType: "customer", Counterparty: ledReference(customer),
				Currency: "CNY", BalanceType: "RECEIVABLE", Amount: "5000.00",
			}},
			Container: []leddomain.ContainerOpeningInput{{
				Customer: ledReference(customer), ContainerType: "SOLVENT", Quantity: 20,
			}},
		}, actorID, requestID("ledger-opening", "save"))
		if saveErr != nil {
			return saveErr
		}
		if _, err = s.ledger.Activate(
			ctx,
			leddomain.RevisionInput{Revision: saved.Revision},
			actorID,
			requestID("ledger-opening", "activate"),
		); err != nil {
			return err
		}
		counts.add(outcomeCreated)
	} else {
		counts.add(outcomeSkipped)
	}

	if closingCount > 0 {
		counts.add(outcomeSkipped)
		return nil
	}
	closing, err := s.ledger.GetClosing(ctx)
	if err != nil {
		return err
	}
	calculationOutcome, err := s.seedZeroIntermediaryCalculation(ctx, historyDate)
	if err != nil {
		return err
	}
	counts.add(calculationOutcome)
	if _, err = s.ledger.Close(ctx, leddomain.ClosingInput{
		Revision: closing.Revision, ClosingDate: historyDate,
	}, actorID, requestID("ledger-closing", "close")); err != nil {
		return err
	}
	counts.add(outcomeCreated)
	return nil
}

func (s *Seeder) seedZeroIntermediaryCalculation(ctx context.Context, businessDate string) (outcome, error) {
	source, err := s.vouchers.IntermediarySource(ctx, voudomain.IntermediarySourceInput{
		BusinessDate: businessDate,
	})
	if err != nil {
		return 0, err
	}
	script, err := s.vouchers.GetIntermediaryScript(ctx)
	if err != nil {
		return 0, err
	}
	lines := make([]voudomain.IntermediaryResultLine, 0, len(source.Source.Lines))
	for _, item := range source.Source.Lines {
		lines = append(lines, voudomain.IntermediaryResultLine{
			SourceSignoffLineID:      item.SourceSignoffLineID,
			PremiumUnitPrice:         "0.00",
			BarrelQuantity:           item.BarrelQuantity,
			BaseCommission:           "0.00",
			PremiumCommission:        "0.00",
			LowPriceCommission:       "0.00",
			MarketMaintenanceSubsidy: "0.00",
			MarketDevelopmentSubsidy: "0.00",
			BillCost:                 "0.00",
			BillLineIDs:              []string{},
			EmployeeAmount:           "0.00",
			IntermediaryAmount:       "0.00",
			RebateAmount:             "0.00",
		})
	}
	_, _, result, err := s.ensureVoucher(
		ctx,
		"ledger-intermediary-calculation",
		voudomain.EntityIntermediaryCalculation,
		voudomain.StatusFinalized,
		func() (voudomain.MutationResult, error) {
			return s.vouchers.Create(ctx, voudomain.EntityIntermediaryCalculation, voudomain.CreateInput{
				Data: voudomain.DraftInput{
					BusinessDate: businessDate,
					Currency:     "CNY",
					Remark:       "预览历史期间零金额居间计算单",
					IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
						Source: source.Source, SourceHash: source.SourceHash, Script: script,
						Result: voudomain.IntermediaryCalculationResult{
							Lines: lines, Summaries: []voudomain.IntermediarySummary{},
						},
					},
				},
			}, actorID, requestID("ledger-intermediary-calculation", "create"))
		},
	)
	return result, err
}

func ledReference(view bobdomain.ObjectView) leddomain.ReferenceInput {
	return leddomain.ReferenceInput{
		ObjectID: view.ObjectID, VersionID: view.Version.VersionID,
	}
}

func (s *Seeder) seedInventoryBalance(ctx context.Context, counts *Counts) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var generationID string
	if err = tx.QueryRow(ctx, `
		SELECT active_generation_id
		FROM led_control
		WHERE singleton AND status='ACTIVE' AND active_generation_id IS NOT NULL
		FOR UPDATE
	`).Scan(&generationID); errors.Is(err, pgx.ErrNoRows) {
		return errors.New("active ledger generation is required")
	} else if err != nil {
		return err
	}

	warehouse := s.bobRefs["warehouse-effective"]
	type inventoryBalance struct {
		key                    string
		product                bobdomain.ObjectView
		quantityMicros         int64
		unitPrice, amountCents int64
	}
	balances := []inventoryBalance{
		{
			key: "raw", product: s.bobRefs["raw-effective"],
			quantityMicros: 1_000_000_000, unitPrice: 1_000, amountCents: 1_000_000,
		},
		{
			key: "finished", product: s.bobRefs["finished-effective"],
			quantityMicros: 100_000_000, unitPrice: 5_000, amountCents: 500_000,
		},
	}
	created := false
	for _, balance := range balances {
		var exists bool
		if err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM led_inventory_entries
				WHERE generation_id=$1 AND entry_type='OPENING'
				  AND warehouse_object_id=$2 AND product_object_id=$3
			)
		`, generationID, warehouse.ObjectID, balance.product.ObjectID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		id := ulid.Make().String()
		if _, err = tx.Exec(ctx, `
			INSERT INTO led_inventory_entries(
				id,generation_id,entry_type,source_entity,source_line_id,effective_date,
				occurred_at,actor_id,request_id,remark,
				warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
				product_object_id,product_version_id,product_code,product_name,product_unit,
				quantity_delta_micros,currency,unit_price_cents,amount_cents
			) VALUES(
				$1,$2,'OPENING','opening',$1,'2026-07-01',$3,$4,$5,$6,
				$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'CNY',$17,$18
			)
		`, id, generationID, time.Now().UTC(), actorID,
			requestID("inventory-balance-"+balance.key, "opening"),
			"预览测试开放期间库存期初",
			warehouse.ObjectID, warehouse.Version.VersionID, warehouse.Code, warehouse.Data.Name,
			balance.product.ObjectID, balance.product.Version.VersionID,
			balance.product.Code, balance.product.Data.Name, balance.product.Data.Unit,
			balance.quantityMicros, balance.unitPrice, balance.amountCents); err != nil {
			return fmt.Errorf("insert preview inventory opening: %w", err)
		}
		created = true
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if created {
		counts.add(outcomeCreated)
	} else {
		counts.add(outcomeSkipped)
	}
	return nil
}

func (s *Seeder) seedContainerBalance(ctx context.Context, counts *Counts) error {
	var exists int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM led_container_entries
		WHERE request_id=$1
	`, requestID("container-balance", "opening")).Scan(&exists)
	if err != nil {
		return err
	}
	if exists > 0 {
		counts.add(outcomeSkipped)
		return nil
	}
	customer := s.bobRefs["customer-effective"]
	var generationID string
	err = s.pool.QueryRow(ctx, `
		SELECT active_generation_id
		FROM led_control
		WHERE singleton AND status='ACTIVE' AND active_generation_id IS NOT NULL
	`).Scan(&generationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("active ledger generation is required")
	}
	if err != nil {
		return err
	}
	var occupied int
	if err = s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM led_container_entries
		WHERE generation_id=$1 AND entry_type='OPENING'
		  AND source_document_id='' AND source_revision=0 AND container_type='RESIN'
	`, generationID).Scan(&occupied); err != nil {
		return err
	}
	if occupied > 0 {
		counts.add(outcomeSkipped)
		return nil
	}
	// Container movements no longer originate from VOU. A preserved preview
	// database can already have an active generation that cannot safely be
	// reopened, so add one uniquely marked open-period balance row directly.
	// The insert uses the same constraints and shape as a normal opening entry.
	_, err = s.pool.Exec(ctx, `
		INSERT INTO led_container_entries(
			id,generation_id,entry_type,source_entity,source_line_id,effective_date,
			occurred_at,actor_id,request_id,remark,customer_object_id,customer_version_id,
			customer_code,customer_name,container_type,quantity_delta
		) VALUES($1,$2,'OPENING','opening',$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RESIN',12)
	`, ulid.Make().String(), generationID, "2026-07-01", time.Now().UTC(), actorID,
		requestID("container-balance", "opening"), "预览测试开放期间容器期初",
		customer.ObjectID, customer.Version.VersionID, customer.Code, customer.Data.Name)
	if err != nil {
		return fmt.Errorf("insert preview container opening: %w", err)
	}
	counts.add(outcomeCreated)
	return nil
}
