package previewseed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
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
	Auxiliary  Counts
	Business   Counts
	Workflows  Counts
	Vouchers   Counts
	Accounting Counts
}

type outcome int

const (
	outcomeCreated outcome = iota + 1
	outcomeResumed
	outcomeSkipped
)

type Seeder struct {
	pool       *pgxpool.Pool
	queries    *dbsqlc.Queries
	auxiliary  *auxdomain.Service
	business   *bobdomain.Service
	vouchers   *voudomain.Service
	workflows  *wfldomain.Service
	accounting *accdomain.Service
	auxRefs    map[string]auxdomain.ObjectView
	bobRefs    map[string]bobdomain.ObjectView
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
	business.SetAuxiliaryResolver(auxiliaryrefs.New(auxiliary))
	events := txevent.NewBus()
	accounting := accdomain.NewService(pool)
	vouchers, err := voudomain.NewService(
		pool,
		business,
		auxiliaryrefs.New(auxiliary),
		events,
		voudomain.AttachmentOptions{Root: attachmentRoot},
		logger,
		voudomain.WithAccountingControl(accounting),
	)
	if err != nil {
		return nil, fmt.Errorf("create voucher service: %w", err)
	}
	workflows, err := wfldomain.NewService(pool, events, vouchers, logger)
	if err != nil {
		return nil, fmt.Errorf("create workflow service: %w", err)
	}
	if err = accounting.RegisterSubscriptions(events); err != nil {
		return nil, fmt.Errorf("register accounting subscriptions: %w", err)
	}
	return &Seeder{
		pool: pool, queries: dbsqlc.New(pool), auxiliary: auxiliary, business: business,
		vouchers: vouchers, workflows: workflows, accounting: accounting,
		auxRefs: make(map[string]auxdomain.ObjectView),
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
	if err := s.seedWorkflows(ctx, &result.Workflows); err != nil {
		return result, fmt.Errorf("seed workflow data: %w", err)
	}
	if err := s.seedVouchers(ctx, &result.Vouchers); err != nil {
		return result, fmt.Errorf("seed voucher data: %w", err)
	}
	if err := s.seedAccounting(ctx, &result.Accounting); err != nil {
		return result, fmt.Errorf("seed accounting data: %w", err)
	}
	if err := s.seedExtendedVouchers(ctx, &result.Vouchers); err != nil {
		return result, fmt.Errorf("seed extended voucher data: %w", err)
	}
	return result, nil
}

func requestID(key, action string) string {
	return seedPrefix + key + "-" + action
}
