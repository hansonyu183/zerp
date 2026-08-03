package previewseed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	actorID      = systemidentity.UserID
	reviewerID   = systemidentity.UserID
	seedPrefix   = "seed-preview-"
	historyDate  = "2026-06-30"
	openingDate  = "2026-06-01"
	businessDate = "2026-07-15"
)

type Counts struct {
	Created int
	Resumed int
	Skipped int
}

func (c *Counts) add(outcome outcome) {
	switch outcome {
	case outcomeCreated:
		c.Created++
	case outcomeResumed:
		c.Resumed++
	case outcomeSkipped:
		c.Skipped++
	}
}

func (c Counts) Total() int { return c.Created + c.Resumed + c.Skipped }

type Result struct {
	Auxiliary Counts
	Business  Counts
	Vouchers  Counts
	Ledger    Counts
}

type outcome int

const (
	outcomeCreated outcome = iota + 1
	outcomeResumed
	outcomeSkipped
)

type auxReferenceAdapter struct {
	service *auxdomain.Service
}

func (adapter auxReferenceAdapter) ResolveAuxiliaryReference(
	ctx context.Context,
	tx pgx.Tx,
	entity, objectID, versionID string,
) (bobdomain.AuxiliaryReference, error) {
	reference, err := adapter.service.Resolve(ctx, tx, entity, objectID, versionID)
	if err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return bobdomain.AuxiliaryReference{
		ObjectID: reference.ObjectID, VersionID: reference.VersionID,
		Entity: reference.Entity, Code: reference.Code, Data: reference.Data,
	}, nil
}

func (adapter auxReferenceAdapter) ResolveAuxiliaryCode(
	ctx context.Context,
	tx pgx.Tx,
	entity, code string,
) (bobdomain.AuxiliaryReference, error) {
	reference, err := adapter.service.ResolveCode(ctx, tx, entity, code)
	if err != nil {
		return bobdomain.AuxiliaryReference{}, err
	}
	return bobdomain.AuxiliaryReference{
		ObjectID: reference.ObjectID, VersionID: reference.VersionID,
		Entity: reference.Entity, Code: reference.Code, Data: reference.Data,
	}, nil
}

type Seeder struct {
	pool      *pgxpool.Pool
	auxiliary *auxdomain.Service
	business  *bobdomain.Service
	ledger    *leddomain.Service
	vouchers  *voudomain.Service
	auxRefs   map[string]auxdomain.ObjectView
	bobRefs   map[string]bobdomain.ObjectView
}

func New(
	pool *pgxpool.Pool,
	attachmentRoot string,
	logger *slog.Logger,
) (*Seeder, error) {
	if pool == nil {
		return nil, errors.New("preview seed pool is required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool)
	business.SetAuxiliaryResolver(auxReferenceAdapter{service: auxiliary})
	events := txevent.NewBus()
	ledger, err := leddomain.NewService(pool, business)
	if err != nil {
		return nil, fmt.Errorf("create ledger service: %w", err)
	}
	if err = ledger.RegisterSubscriptions(events); err != nil {
		return nil, fmt.Errorf("register ledger subscriptions: %w", err)
	}
	workflow, err := wfldomain.NewService(pool, business, events, logger)
	if err != nil {
		return nil, fmt.Errorf("create workflow service: %w", err)
	}
	vouchers, err := voudomain.NewService(
		pool,
		business,
		events,
		voudomain.AttachmentOptions{Root: attachmentRoot},
		logger,
	)
	if err != nil {
		return nil, fmt.Errorf("create voucher service: %w", err)
	}
	workflow.SetSalesVoucherService(vouchers)
	workflow.SetPurchaseVoucherService(vouchers)
	workflow.SetWorkflowDocumentConverter(vouchers)
	return &Seeder{
		pool: pool, auxiliary: auxiliary, business: business, ledger: ledger,
		vouchers: vouchers, auxRefs: make(map[string]auxdomain.ObjectView),
		bobRefs: make(map[string]bobdomain.ObjectView),
	}, nil
}

func (s *Seeder) Seed(ctx context.Context) (Result, error) {
	var result Result
	if err := s.seedAuxiliary(ctx, &result.Auxiliary); err != nil {
		return result, fmt.Errorf("seed auxiliary data: %w", err)
	}
	if err := s.seedBusiness(ctx, &result.Business); err != nil {
		return result, fmt.Errorf("seed business data: %w", err)
	}
	if err := s.seedLedgerBaseline(ctx, &result.Ledger); err != nil {
		return result, fmt.Errorf("seed ledger baseline: %w", err)
	}
	if err := s.seedInventoryBalance(ctx, &result.Ledger); err != nil {
		return result, fmt.Errorf("seed inventory balance: %w", err)
	}
	if err := s.seedVouchers(ctx, &result.Vouchers); err != nil {
		return result, fmt.Errorf("seed voucher data: %w", err)
	}
	if err := s.seedContainerBalance(ctx, &result.Ledger); err != nil {
		return result, fmt.Errorf("seed container ledger: %w", err)
	}
	return result, nil
}

func requestID(key, action string) string {
	return seedPrefix + key + "-" + action
}
