package testseed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/config"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/integrations/workflowactions"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	actorID      = systemidentity.UserID
	reviewerID   = systemidentity.UserID
	seedPrefix   = "seed-test-"
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
	Accounts   Counts
	Auxiliary  Counts
	Business   Counts
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
	app        *appdomain.Service
	accounts   AccountSeed
	auxiliary  *auxdomain.Service
	business   *bobdomain.Service
	vouchers   *voudomain.Service
	accounting *accdomain.Service
	auxRefs    map[string]auxdomain.ObjectView
	bobRefs    map[string]bobdomain.ObjectView
}

type AccountSeed struct {
	AdminUsername    string
	AdminDisplayName string
	AdminPassword    string
	UserUsername     string
	UserDisplayName  string
	UserPassword     string
}

func New(
	pool *pgxpool.Pool,
	cfg config.Config,
	accounts AccountSeed,
	attachmentRoot string,
	logger *slog.Logger,
) (*Seeder, error) {
	if pool == nil {
		return nil, errors.New("test seed pool is required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	accounts.AdminUsername = strings.TrimSpace(accounts.AdminUsername)
	accounts.AdminDisplayName = strings.TrimSpace(accounts.AdminDisplayName)
	accounts.UserUsername = strings.TrimSpace(accounts.UserUsername)
	accounts.UserDisplayName = strings.TrimSpace(accounts.UserDisplayName)
	if accounts.AdminUsername == "" || accounts.AdminDisplayName == "" || accounts.AdminPassword == "" ||
		accounts.UserUsername == "" || accounts.UserDisplayName == "" || accounts.UserPassword == "" ||
		strings.EqualFold(accounts.AdminUsername, accounts.UserUsername) {
		return nil, errors.New("two distinct test seed accounts are required")
	}
	cfg.AttachmentStorageRoot = attachmentRoot
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
	_, err = wfldomain.NewService(pool, events, workflowactions.New(vouchers), logger)
	if err != nil {
		return nil, fmt.Errorf("create workflow service: %w", err)
	}
	if err = accounting.RegisterSubscriptions(events); err != nil {
		return nil, fmt.Errorf("register accounting subscriptions: %w", err)
	}
	return &Seeder{
		pool: pool, queries: dbsqlc.New(pool), app: appdomain.NewService(pool, cfg, logger), accounts: accounts,
		auxiliary: auxiliary, business: business,
		vouchers: vouchers, accounting: accounting,
		auxRefs: make(map[string]auxdomain.ObjectView),
		bobRefs: make(map[string]bobdomain.ObjectView),
	}, nil
}

func (s *Seeder) Seed(ctx context.Context) (Result, error) {
	var result Result
	if err := s.seedAccounts(ctx, &result.Accounts); err != nil {
		return result, err
	}
	if err := s.seedAuxiliary(ctx, &result.Auxiliary); err != nil {
		return result, fmt.Errorf("seed auxiliary data: %w", err)
	}
	if err := s.seedBusiness(ctx, &result.Business); err != nil {
		return result, fmt.Errorf("seed business data: %w", err)
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

func (s *Seeder) seedAccounts(ctx context.Context, counts *Counts) error {
	admin, err := s.queries.GetAppUserByUsername(ctx, s.accounts.AdminUsername)
	if errors.Is(err, pgx.ErrNoRows) {
		created, createErr := s.createTestAdministrator(ctx)
		if createErr != nil {
			return fmt.Errorf("create test administrator: %w", createErr)
		}
		admin, err = s.queries.GetAppUserByID(ctx, created.ID)
		if err != nil {
			return fmt.Errorf("read created test administrator: %w", err)
		}
		counts.Created++
	} else if err != nil {
		return fmt.Errorf("find test administrator: %w", err)
	} else {
		counts.Skipped++
	}
	if admin.Status != appdomain.StatusEnabled {
		return errors.New("test administrator is not enabled")
	}
	superadmin, err := s.queries.ActorHasEnabledSuperadminRole(ctx, admin.ID)
	if err != nil {
		return fmt.Errorf("check test administrator role: %w", err)
	}
	if !superadmin {
		return errors.New("test administrator is not a superadministrator")
	}

	user, err := s.queries.GetAppUserByUsername(ctx, s.accounts.UserUsername)
	if err == nil {
		if user.Status != appdomain.StatusEnabled {
			return errors.New("test user is not enabled")
		}
		if user.PasswordChangeRequired {
			var createdBySeed bool
			if queryErr := s.pool.QueryRow(ctx, `
				SELECT EXISTS(
					SELECT 1 FROM app_audit_events
					WHERE target_type='user' AND target_id=$1 AND request_id=$2
				)
			`, user.ID, requestID("test-user", "create")).Scan(&createdBySeed); queryErr != nil {
				return fmt.Errorf("check test user seed ownership: %w", queryErr)
			}
			if !createdBySeed {
				return errors.New("existing test user is not managed by test seed")
			}
			if activateErr := s.activateTestUserPassword(ctx, user.ID); activateErr != nil {
				return activateErr
			}
		}
		counts.Skipped++
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("find test user: %w", err)
	}
	var roleID string
	if err = s.pool.QueryRow(ctx, `
		SELECT id FROM app_roles WHERE code='superadmin' AND status='ENABLED'
	`).Scan(&roleID); err != nil {
		return fmt.Errorf("find superadministrator role: %w", err)
	}
	created, err := s.app.CreateUser(
		ctx,
		appdomain.CreateUserInput{
			Username: s.accounts.UserUsername, DisplayName: s.accounts.UserDisplayName,
			Password: s.accounts.UserPassword, RoleIDs: []string{roleID},
		},
		appdomain.Principal{User: appdomain.UserSummary{ID: admin.ID}},
		requestID("test-user", "create"),
	)
	if err != nil {
		return fmt.Errorf("create test user: %w", err)
	}
	if err = s.activateTestUserPassword(ctx, created.ID); err != nil {
		return err
	}
	counts.Created++
	return nil
}

func (s *Seeder) createTestAdministrator(ctx context.Context) (dbsqlc.AppUser, error) {
	var actorID, roleID string
	err := s.pool.QueryRow(ctx, `
		SELECT u.id,r.id
		FROM app_users u
		JOIN app_user_roles ur ON ur.user_id=u.id
		JOIN app_roles r ON r.id=ur.role_id
		WHERE u.status='ENABLED' AND r.status='ENABLED' AND r.code='superadmin'
		ORDER BY u.created_at,u.id
		LIMIT 1
	`).Scan(&actorID, &roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		created, createErr := s.app.BootstrapAdmin(
			ctx,
			s.accounts.AdminUsername,
			s.accounts.AdminDisplayName,
			s.accounts.AdminPassword,
		)
		if createErr != nil {
			return dbsqlc.AppUser{}, createErr
		}
		return s.queries.GetAppUserByID(ctx, created.ID)
	}
	if err != nil {
		return dbsqlc.AppUser{}, fmt.Errorf("find existing superadministrator: %w", err)
	}
	created, err := s.app.CreateUser(
		ctx,
		appdomain.CreateUserInput{
			Username: s.accounts.AdminUsername, DisplayName: s.accounts.AdminDisplayName,
			Password: s.accounts.AdminPassword, RoleIDs: []string{roleID},
		},
		appdomain.Principal{User: appdomain.UserSummary{ID: actorID}},
		requestID("test-admin", "create"),
	)
	if err != nil {
		return dbsqlc.AppUser{}, err
	}
	if err = s.activateTestUserPassword(ctx, created.ID); err != nil {
		return dbsqlc.AppUser{}, err
	}
	return s.queries.GetAppUserByID(ctx, created.ID)
}

func (s *Seeder) activateTestUserPassword(ctx context.Context, userID string) error {
	commandTag, err := s.pool.Exec(ctx, `
		UPDATE app_users SET password_change_required=false WHERE id=$1
	`, userID)
	if err != nil {
		return fmt.Errorf("activate test user password: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return errors.New("activate test user password affected an unexpected number of rows")
	}
	return nil
}

func requestID(key, action string) string {
	return seedPrefix + key + "-" + action
}
