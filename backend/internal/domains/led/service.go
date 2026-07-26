package led

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type effectiveReferenceResolver interface {
	ResolveEffectiveReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
}

type Service struct {
	pool     *pgxpool.Pool
	queries  *dbsqlc.Queries
	resolver effectiveReferenceResolver
}

func NewService(pool *pgxpool.Pool, resolver effectiveReferenceResolver) (*Service, error) {
	if pool == nil || resolver == nil {
		return nil, errors.New("LED pool and BOB resolver are required")
	}
	return &Service{pool: pool, queries: dbsqlc.New(pool), resolver: resolver}, nil
}

func (s *Service) GetOpening(ctx context.Context) (OpeningView, error) {
	control, err := s.queries.GetLedControl(ctx)
	if err != nil {
		return OpeningView{}, s.internal("get ledger control", err)
	}
	view := OpeningView{
		Status: control.Status, Revision: control.Revision,
		CutoverDate: formatDate(control.CutoverDate),
		Inventory:   make([]InventoryOpeningView, 0),
		Fund:        make([]FundOpeningView, 0), Party: make([]PartyOpeningView, 0),
		Container: make([]ContainerOpeningView, 0),
	}
	if control.ActiveGenerationID != nil {
		view.ActiveGenerationID = *control.ActiveGenerationID
	}
	useActive := control.Status == StatusActive && control.ActiveGenerationID != nil
	if useActive {
		inventory, loadErr := s.queries.ListLedOpeningInventory(ctx, *control.ActiveGenerationID)
		if loadErr != nil {
			return OpeningView{}, s.internal("list active inventory opening", loadErr)
		}
		fund, loadErr := s.queries.ListLedOpeningFund(ctx, *control.ActiveGenerationID)
		if loadErr != nil {
			return OpeningView{}, s.internal("list active fund opening", loadErr)
		}
		party, loadErr := s.queries.ListLedOpeningParty(ctx, *control.ActiveGenerationID)
		if loadErr != nil {
			return OpeningView{}, s.internal("list active party opening", loadErr)
		}
		containers, loadErr := s.queries.ListLedOpeningContainer(ctx, *control.ActiveGenerationID)
		if loadErr != nil {
			return OpeningView{}, s.internal("list active container opening", loadErr)
		}
		for _, row := range inventory {
			view.Inventory = append(view.Inventory, openingInventoryView(row.ID, row.WarehouseObjectID, row.WarehouseVersionID,
				row.WarehouseCode, row.WarehouseName, row.ProductObjectID, row.ProductVersionID,
				row.ProductCode, row.ProductName, row.ProductUnit, row.QuantityMicros))
		}
		for _, row := range fund {
			view.Fund = append(view.Fund, openingFundView(row.ID, row.FundAccountObjectID, row.FundAccountVersionID,
				row.FundAccountCode, row.FundAccountName, row.Currency, row.AmountCents))
		}
		for _, row := range party {
			view.Party = append(view.Party, openingPartyView(row.ID, row.CounterpartyEntity, row.CounterpartyObjectID,
				row.CounterpartyVersionID, row.CounterpartyCode, row.CounterpartyName, row.Currency, row.AmountCents))
		}
		for _, row := range containers {
			view.Container = append(view.Container, containerOpeningView(row.ID, row.CustomerObjectID,
				row.CustomerVersionID, row.CustomerCode, row.CustomerName, row.ContainerType, row.Quantity))
		}
		return view, nil
	}
	inventory, err := s.queries.ListLedDraftInventory(ctx)
	if err != nil {
		return OpeningView{}, s.internal("list draft inventory opening", err)
	}
	fund, err := s.queries.ListLedDraftFund(ctx)
	if err != nil {
		return OpeningView{}, s.internal("list draft fund opening", err)
	}
	party, err := s.queries.ListLedDraftParty(ctx)
	if err != nil {
		return OpeningView{}, s.internal("list draft party opening", err)
	}
	containers, err := s.queries.ListLedDraftContainer(ctx)
	if err != nil {
		return OpeningView{}, s.internal("list draft container opening", err)
	}
	for _, row := range inventory {
		view.Inventory = append(view.Inventory, openingInventoryView(row.ID, row.WarehouseObjectID, row.WarehouseVersionID,
			row.WarehouseCode, row.WarehouseName, row.ProductObjectID, row.ProductVersionID,
			row.ProductCode, row.ProductName, row.ProductUnit, row.QuantityMicros))
	}
	for _, row := range fund {
		view.Fund = append(view.Fund, openingFundView(row.ID, row.FundAccountObjectID, row.FundAccountVersionID,
			row.FundAccountCode, row.FundAccountName, row.Currency, row.AmountCents))
	}
	for _, row := range party {
		view.Party = append(view.Party, openingPartyView(row.ID, row.CounterpartyEntity, row.CounterpartyObjectID,
			row.CounterpartyVersionID, row.CounterpartyCode, row.CounterpartyName, row.Currency, row.AmountCents))
	}
	for _, row := range containers {
		view.Container = append(view.Container, containerOpeningView(row.ID, row.CustomerObjectID,
			row.CustomerVersionID, row.CustomerCode, row.CustomerName, row.ContainerType, row.Quantity))
	}
	return view, nil
}

func (s *Service) SaveOpening(
	ctx context.Context, input OpeningSaveInput, actorID, requestID string,
) (MutationResult, error) {
	cutover, err := validateSave(input)
	if err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save opening", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return MutationResult{}, s.internal("lock ledger control", err)
	}
	if control.Revision != input.Revision || (control.Status != StatusDraft && control.Status != StatusReopening) {
		return MutationResult{}, domainError(ErrorConflict, "ledger opening changed", nil, nil)
	}
	snapshot, err := s.loadOpeningDraft(ctx, q)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.clearOpeningDraft(ctx, q); err != nil {
		return MutationResult{}, err
	}
	if err = s.replaceInventoryOpening(ctx, tx, q, snapshot.Inventory, input.Inventory); err != nil {
		return MutationResult{}, err
	}
	if err = s.replaceFundOpening(ctx, tx, q, snapshot.Fund, input.Fund); err != nil {
		return MutationResult{}, err
	}
	if err = s.replacePartyOpening(ctx, tx, q, snapshot.Party, input.Party); err != nil {
		return MutationResult{}, err
	}
	if err = s.replaceContainerOpening(ctx, tx, q, snapshot.Container, input.Container); err != nil {
		return MutationResult{}, err
	}

	revision, err := q.SaveLedDraftControl(ctx, dbsqlc.SaveLedDraftControlParams{
		CutoverDate: dateValue(cutover), ActorID: &actorID, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("save opening control", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		Event: "OPENING_SAVED", From: &control.Status, To: control.Status, Revision: revision,
		ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"inventoryCount": len(input.Inventory), "fundCount": len(input.Fund),
			"partyCount": len(input.Party), "containerCount": len(input.Container)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit opening save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit opening save", err)
	}
	return MutationResult{Status: control.Status, Revision: revision}, nil
}

func (s *Service) Reopen(
	ctx context.Context, input ReopenInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReopen(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin reopen", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return MutationResult{}, s.internal("lock ledger control", err)
	}
	if control.Status != StatusActive || control.Revision != input.Revision || control.ActiveGenerationID == nil {
		return MutationResult{}, domainError(ErrorConflict, "ledger cannot be reopened", nil, nil)
	}
	if err = clearDraft(ctx, q); err != nil {
		return MutationResult{}, s.writeError("clear reopen draft", err)
	}
	if err = q.CopyLedOpeningToDraftInventory(ctx, *control.ActiveGenerationID); err != nil {
		return MutationResult{}, s.writeError("copy inventory opening", err)
	}
	if err = q.CopyLedOpeningToDraftFund(ctx, *control.ActiveGenerationID); err != nil {
		return MutationResult{}, s.writeError("copy fund opening", err)
	}
	if err = q.CopyLedOpeningToDraftParty(ctx, *control.ActiveGenerationID); err != nil {
		return MutationResult{}, s.writeError("copy party opening", err)
	}
	if err = q.CopyLedOpeningToDraftContainer(ctx, *control.ActiveGenerationID); err != nil {
		return MutationResult{}, s.writeError("copy container opening", err)
	}
	revision, err := q.ReopenLedControl(ctx, dbsqlc.ReopenLedControlParams{ActorID: &actorID, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, s.writeError("reopen ledger control", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		Event: "REOPENED", From: stringPtr(StatusActive), To: StatusReopening,
		GenerationID: control.ActiveGenerationID, Revision: revision, ActorID: actorID,
		Reason: reason, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit reopen", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit reopen", err)
	}
	return MutationResult{Status: StatusReopening, Revision: revision, GenerationID: *control.ActiveGenerationID}, nil
}

func (s *Service) CancelReopen(
	ctx context.Context, input RevisionInput, actorID, requestID string,
) (MutationResult, error) {
	if input.Revision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid revision", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin cancel reopen", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return MutationResult{}, s.internal("lock ledger control", err)
	}
	if control.Status != StatusReopening || control.Revision != input.Revision || control.ActiveGenerationID == nil {
		return MutationResult{}, domainError(ErrorConflict, "ledger reopen changed", nil, nil)
	}
	revision, err := q.CancelLedReopen(ctx, dbsqlc.CancelLedReopenParams{ActorID: &actorID, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, s.writeError("cancel ledger reopen", err)
	}
	if err = clearDraft(ctx, q); err != nil {
		return MutationResult{}, s.writeError("clear cancelled draft", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		Event: "REOPEN_CANCELLED", From: stringPtr(StatusReopening), To: StatusActive,
		GenerationID: control.ActiveGenerationID, Revision: revision, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit cancel reopen", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit cancel reopen", err)
	}
	return MutationResult{Status: StatusActive, Revision: revision, GenerationID: *control.ActiveGenerationID}, nil
}

func (s *Service) AuditHistory(ctx context.Context, input HistoryInput) (Page[AuditEventView], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid history query", nil, nil)
	}
	total, err := s.queries.CountLedAuditEvents(ctx)
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count ledger audit", err)
	}
	rows, err := s.queries.ListLedAuditEvents(ctx, dbsqlc.ListLedAuditEventsParams{
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list ledger audit", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, AuditEventView{
			ID: row.ID, EventType: row.EventType, FromStatus: deref(row.FromStatus), ToStatus: row.ToStatus,
			GenerationID: deref(row.GenerationID), Revision: row.Revision, ActorID: row.ActorID,
			OccurredAt: row.OccurredAt.Time, Reason: deref(row.Reason), RequestID: row.RequestID, Summary: row.Summary,
		})
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) resolve(
	ctx context.Context, tx pgx.Tx, entity string, input ReferenceInput,
) (bobdomain.EffectiveReference, error) {
	ref, err := s.resolver.ResolveEffectiveReference(ctx, tx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return bobdomain.EffectiveReference{}, domainError(ErrorConflict, entity+" reference is not effective", nil, err)
	}
	return ref, nil
}

type auditInput struct {
	Event, To, ActorID, RequestID string
	From, GenerationID, Reason    *string
	Revision                      int64
	Summary                       map[string]any
}

func insertAudit(ctx context.Context, q *dbsqlc.Queries, input auditInput) error {
	summary, err := json.Marshal(input.Summary)
	if err != nil {
		return err
	}
	return q.InsertLedAuditEvent(ctx, dbsqlc.InsertLedAuditEventParams{
		ID: newID(), EventType: input.Event, FromStatus: input.From, ToStatus: input.To,
		GenerationID: input.GenerationID, Revision: input.Revision, ActorID: input.ActorID,
		Reason: input.Reason, RequestID: input.RequestID, Summary: summary,
	})
}

func clearDraft(ctx context.Context, q *dbsqlc.Queries) error {
	if err := q.DeleteLedDraftInventory(ctx); err != nil {
		return err
	}
	if err := q.DeleteLedDraftFund(ctx); err != nil {
		return err
	}
	if err := q.DeleteLedDraftParty(ctx); err != nil {
		return err
	}
	return q.DeleteLedDraftContainer(ctx)
}

func openingInventoryView(
	id, warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName,
	productObjectID, productVersionID, productCode, productName, productUnit string,
	quantity int64,
) InventoryOpeningView {
	return InventoryOpeningView{
		ID:        id,
		Warehouse: ReferenceView{ObjectID: warehouseObjectID, VersionID: warehouseVersionID, Entity: bobdomain.EntityWarehouse, Code: warehouseCode, Name: warehouseName},
		Product:   ReferenceView{ObjectID: productObjectID, VersionID: productVersionID, Entity: bobdomain.EntityProduct, Code: productCode, Name: productName, Unit: productUnit},
		Quantity:  formatQuantity(quantity),
	}
}

func openingFundView(id, objectID, versionID, code, name, currency string, amount int64) FundOpeningView {
	balanceType := "POSITIVE"
	if amount < 0 {
		balanceType = "OVERDRAFT"
	}
	return FundOpeningView{
		ID: id, FundAccount: ReferenceView{ObjectID: objectID, VersionID: versionID, Entity: bobdomain.EntityFundAccount, Code: code, Name: name, Currency: currency},
		BalanceType: balanceType, Amount: formatAbsoluteMoney(amount),
	}
}

func containerOpeningView(
	id, objectID, versionID, code, name, containerType string, quantity int64,
) ContainerOpeningView {
	return ContainerOpeningView{
		ID: id, Customer: ReferenceView{ObjectID: objectID, VersionID: versionID,
			Entity: bobdomain.EntityCustomer, Code: code, Name: name},
		ContainerType: containerType, Quantity: quantity,
	}
}

func openingPartyView(id, entity, objectID, versionID, code, name, currency string, amount int64) PartyOpeningView {
	balanceType := "RECEIVABLE"
	if amount < 0 {
		balanceType = "PAYABLE"
	}
	return PartyOpeningView{
		ID: id, CounterpartyType: entity,
		Counterparty: ReferenceView{ObjectID: objectID, VersionID: versionID, Entity: entity, Code: code, Name: name},
		Currency:     currency, BalanceType: balanceType, Amount: formatAbsoluteMoney(amount),
	}
}

func newID() string { return ulid.Make().String() }

func dateValue(value time.Time) pgtype.Date { return pgtype.Date{Time: value, Valid: true} }

func formatDate(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format(dateLayout)
}

func stringPtr(value string) *string { return &value }

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
