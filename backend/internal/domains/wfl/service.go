package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type referenceResolver interface {
	ResolveEffectiveReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	ResolveCurrentEffectiveReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
}

type eventPublisher interface {
	Publish(context.Context, pgx.Tx, txevent.Event) error
}

type attachmentService interface {
	InitiateAttachment(context.Context, string, voudomain.AttachmentInitiateInput, string, string) (voudomain.AttachmentInitiateResult, error)
	CreateDownload(context.Context, string, voudomain.AttachmentDownloadInput, string) (voudomain.AttachmentDownloadResult, error)
	RemoveAttachment(context.Context, string, voudomain.AttachmentRemoveInput, string, string) (voudomain.MutationResult, error)
}

type Service struct {
	pool     *pgxpool.Pool
	resolver referenceResolver
	events   eventPublisher
	files    attachmentService
	logger   *slog.Logger
}

func NewService(pool *pgxpool.Pool, resolver referenceResolver, events eventPublisher, logger *slog.Logger) (*Service, error) {
	if pool == nil || resolver == nil || events == nil {
		return nil, errors.New("WFL pool, BOB resolver, and event publisher are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{pool: pool, resolver: resolver, events: events, logger: logger}, nil
}

func (s *Service) SetAttachmentService(files attachmentService) {
	s.files = files
}

type fixedCustomerLine struct {
	id                      string
	product                 bobdomain.EffectiveReference
	quantity, price, amount int64
	containerType           string
	perContainer            *int64
	remark                  *string
}

type fixedCustomerOrder struct {
	date                              time.Time
	currency                          string
	remark                            *string
	customer, salesperson, settlement bobdomain.EffectiveReference
	lines                             []fixedCustomerLine
	total                             int64
}

func (s *Service) Create(ctx context.Context, input CreateInput, actorID, requestID string) (MutationResult, error) {
	if !validID(actorID) {
		return MutationResult{}, validation("invalid actor", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, internal("begin workflow create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	fixed, err := s.resolveCustomerOrder(ctx, tx, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	documentID, documentNo, err := insertManagedDocument(ctx, tx, voudomain.EntityCustomerOrder,
		"", fixed.date, fixed.currency, fixed.total, fixed.remark, actorID)
	if err != nil {
		return MutationResult{}, internal("insert customer order", err)
	}
	if err = insertCustomerOrder(ctx, tx, documentID, fixed); err != nil {
		return MutationResult{}, internal("insert customer order detail", err)
	}
	processID := newID()
	if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_instances(
		id,process_type,definition_version,root_document_id,status,revision,created_by,updated_by
	) VALUES($1,'INTERMEDIARY_TRADE',1,$2,'DRAFT',1,$3,$3)`, processID, documentID, actorID); err != nil {
		return MutationResult{}, internal("insert process", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_documents(process_id,document_id,stage,sequence_no)
		VALUES($1,$2,'CUSTOMER_ORDER',1)`, processID, documentID); err != nil {
		return MutationResult{}, internal("link root document", err)
	}
	if err = insertVouAudit(ctx, tx, documentID, voudomain.EntityCustomerOrder, "CREATED",
		nil, "DRAFT", actorID, requestID, nil, map[string]any{"documentNo": documentNo}); err != nil {
		return MutationResult{}, err
	}
	if err = insertWFLAudit(ctx, tx, processID, "CREATED", nil, StatusDraft, StageCustomer,
		documentID, documentNo, "DRAFT", actorID, requestID, nil, map[string]any{}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, internal("commit workflow create", err)
	}
	return MutationResult{ProcessID: processID, ProcessRevision: 1, WorkflowStatus: StatusDraft,
		DocumentID: documentID, DocumentNo: documentNo, DocumentRevision: 1,
		DocumentStatus: StatusDraft}, nil
}

func (s *Service) Save(ctx context.Context, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if !validID(input.ProcessID) || !validID(input.DocumentID) || input.ProcessRevision < 1 ||
		input.DocumentRevision < 1 || !validID(actorID) {
		return MutationResult{}, validation("invalid save request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, internal("begin workflow save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	process, err := lockProcess(ctx, tx, input.ProcessID)
	if err = processConflict(err, process, input.ProcessRevision); err != nil {
		return MutationResult{}, err
	}
	if process.status != StatusDraft || process.rootID != input.DocumentID {
		return MutationResult{}, conflict("customer order is not editable", nil)
	}
	document, err := lockDocument(ctx, tx, input.DocumentID)
	if err = documentConflict(err, document, input.DocumentRevision, "DRAFT"); err != nil {
		return MutationResult{}, err
	}
	var children int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents
		WHERE process_id=$1 AND stage<>'CUSTOMER_ORDER'`, process.id).Scan(&children); err != nil {
		return MutationResult{}, err
	}
	if children != 0 {
		return MutationResult{}, conflict("customer order already has downstream documents", nil)
	}
	fixed, err := s.resolveCustomerOrder(ctx, tx, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_customer_order_lines WHERE document_id=$1`, document.id); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_customer_order_details WHERE document_id=$1`, document.id); err != nil {
		return MutationResult{}, err
	}
	if err = insertCustomerOrder(ctx, tx, document.id, fixed); err != nil {
		return MutationResult{}, err
	}
	var documentRevision int64
	if err = tx.QueryRow(ctx, `UPDATE vou_documents SET business_date=$1,currency=$2,total_amount_cents=$3,
		remark=$4,revision=revision+1,updated_at=now(),updated_by=$5
		WHERE id=$6 AND revision=$7 RETURNING revision`, fixed.date, fixed.currency, fixed.total,
		fixed.remark, actorID, document.id, document.revision).Scan(&documentRevision); err != nil {
		return MutationResult{}, conflict("customer order changed", nil)
	}
	processRevision, err := touchProcess(ctx, tx, process.id, process.revision, actorID, process.status)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertVouAudit(ctx, tx, document.id, document.entity, "SAVED",
		stringPtr("DRAFT"), "DRAFT", actorID, requestID, nil, map[string]any{"revision": documentRevision}); err != nil {
		return MutationResult{}, err
	}
	if err = insertWFLAudit(ctx, tx, process.id, "CUSTOMER_ORDER_SAVED", stringPtr(process.status),
		process.status, StageCustomer, document.id, document.number, "DRAFT", actorID, requestID,
		nil, map[string]any{"documentRevision": documentRevision}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ProcessID: process.id, ProcessRevision: processRevision,
		WorkflowStatus: process.status, DocumentID: document.id, DocumentNo: document.number,
		DocumentRevision: documentRevision, DocumentStatus: StatusDraft}, nil
}

type processRow struct {
	id, status, rootID string
	revision           int64
	rootNo             string
}

type documentRow struct {
	id, entity, number, status, parent string
	revision                           int64
	reviewedBy                         *string
}

func lockProcess(ctx context.Context, tx pgx.Tx, id string) (processRow, error) {
	var row processRow
	err := tx.QueryRow(ctx, `SELECT p.id,p.status,p.revision,p.root_document_id,d.document_no
		FROM wfl_process_instances p JOIN vou_documents d ON d.id=p.root_document_id
		WHERE p.id=$1 FOR UPDATE OF p`, id).Scan(&row.id, &row.status, &row.revision, &row.rootID, &row.rootNo)
	return row, err
}

func lockDocument(ctx context.Context, tx pgx.Tx, id string) (documentRow, error) {
	var row documentRow
	err := tx.QueryRow(ctx, `SELECT id,entity,document_no,status,revision,
		COALESCE(parent_document_id,''),reviewed_by FROM vou_documents
		WHERE id=$1 AND control_domain='WFL' FOR UPDATE`, id).Scan(
		&row.id, &row.entity, &row.number, &row.status, &row.revision, &row.parent, &row.reviewedBy)
	return row, err
}

func processConflict(err error, row processRow, revision int64) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return validation("process not found", nil)
	}
	if err != nil {
		return internal("lock process", err)
	}
	if row.revision != revision {
		return conflict("process changed", map[string]any{"processRevision": row.revision, "status": row.status})
	}
	return nil
}

func documentConflict(err error, row documentRow, revision int64, status string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return validation("document not found", nil)
	}
	if err != nil {
		return internal("lock document", err)
	}
	if row.revision != revision || (status != "" && row.status != status) {
		return conflict("document changed", map[string]any{"documentRevision": row.revision, "status": row.status})
	}
	return nil
}

func touchProcess(ctx context.Context, tx pgx.Tx, id string, revision int64, actorID, status string) (int64, error) {
	var next int64
	err := tx.QueryRow(ctx, `UPDATE wfl_process_instances SET revision=revision+1,status=$1,
		updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
		status, actorID, id, revision).Scan(&next)
	if err != nil {
		return 0, conflict("process changed", nil)
	}
	return next, nil
}

func insertManagedDocument(ctx context.Context, tx pgx.Tx, entity, parent string, date time.Time,
	currency string, total int64, remark *string, actorID string) (string, string, error) {
	var counter int32
	err := tx.QueryRow(ctx, `INSERT INTO vou_number_counters(entity,business_date,last_value)
		VALUES($1,$2,1) ON CONFLICT(entity,business_date)
		DO UPDATE SET last_value=vou_number_counters.last_value+1 RETURNING last_value`,
		entity, date).Scan(&counter)
	if err != nil {
		return "", "", err
	}
	id := newID()
	number := fmt.Sprintf("%s-%s-%06d", map[string]string{
		voudomain.EntityCustomerOrder: "CO", voudomain.EntityProcurementOrder: "PRO",
		voudomain.EntityGoodsReceipt: "GR", voudomain.EntityDeliveryNote: "DN",
		voudomain.EntitySignoffNote: "SN",
	}[entity], date.Format("20060102"), counter)
	var parentValue any
	if parent != "" {
		parentValue = parent
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,status,revision,business_date,currency,total_amount_cents,
		remark,created_by,updated_by,workflow_version,parent_document_id,control_domain
	) VALUES($1,$2,$3,'DRAFT',1,$4,$5,$6,$7,$8,$8,1,$9,'WFL')`,
		id, entity, number, date, currency, total, remark, actorID, parentValue)
	return id, number, err
}

func insertCustomerOrder(ctx context.Context, tx pgx.Tx, documentID string, fixed fixedCustomerOrder) error {
	_, err := tx.Exec(ctx, `INSERT INTO vou_customer_order_details(
		document_id,customer_object_id,customer_version_id,customer_code,customer_name,
		salesperson_object_id,salesperson_version_id,salesperson_code,salesperson_name,
		contact_name,contact_phone,delivery_address,settlement_object_id,settlement_version_id,
		settlement_code,settlement_name,settlement_rule_type,settlement_month_offset,
		settlement_day_of_month,settlement_day_offset
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
		documentID, fixed.customer.ObjectID, fixed.customer.VersionID, fixed.customer.Code, fixed.customer.Data.Name,
		fixed.salesperson.ObjectID, fixed.salesperson.VersionID, fixed.salesperson.Code, fixed.salesperson.Data.Name,
		nullable(fixed.customer.Data.ContactName), nullable(fixed.customer.Data.ContactPhone),
		nullable(fixed.customer.Data.Address), fixed.settlement.ObjectID, fixed.settlement.VersionID,
		fixed.settlement.Code, fixed.settlement.Data.Name, fixed.settlement.Data.RuleType,
		fixed.settlement.Data.MonthOffset, fixed.settlement.Data.DayOfMonth, fixed.settlement.Data.DayOffset)
	if err != nil {
		return err
	}
	for index, line := range fixed.lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_customer_order_lines(
			id,document_id,line_no,product_object_id,product_version_id,product_code,product_name,
			product_unit,ordered_qty_micros,sale_unit_price_cents,line_amount_cents,
			container_type,quantity_per_container_micros,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			line.id, documentID, index+1, line.product.ObjectID, line.product.VersionID, line.product.Code,
			line.product.Data.Name, line.product.Data.Unit, line.quantity, line.price, line.amount,
			line.containerType, line.perContainer, line.remark)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) resolveCustomerOrder(ctx context.Context, tx pgx.Tx, input CustomerOrderInput) (fixedCustomerOrder, error) {
	var result fixedCustomerOrder
	date, err := parseDate(input.BusinessDate)
	if err != nil {
		return result, err
	}
	currency := strings.ToUpper(strings.TrimSpace(input.Currency))
	if len(currency) != 3 || len(input.Lines) == 0 || len(input.Lines) > 200 {
		return result, validation("invalid customer order", nil)
	}
	customer, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityCustomer,
		input.Customer.ObjectID, input.Customer.VersionID)
	if err != nil {
		return result, referenceError("customer", err)
	}
	var salesperson bobdomain.EffectiveReference
	if input.Salesperson != nil {
		salesperson, err = s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			input.Salesperson.ObjectID, input.Salesperson.VersionID)
	} else {
		salesperson, err = s.resolver.ResolveCurrentEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			customer.Data.SalespersonEmployeeID)
	}
	if err != nil {
		return result, referenceError("salesperson", err)
	}
	settlement, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySettlementMethod,
		customer.Data.SettlementMethodID, customer.Data.SettlementMethodVersionID)
	if err != nil {
		return result, referenceError("customer settlement method", err)
	}
	lines := make([]fixedCustomerLine, 0, len(input.Lines))
	var total int64
	for _, raw := range input.Lines {
		quantity, qerr := fixedDecimal(raw.OrderedQuantity, 6, false)
		price, perr := fixedDecimal(raw.UnitPrice, 2, false)
		if qerr != nil || perr != nil {
			return result, validation("invalid quantity or unit price", nil)
		}
		product, rerr := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityProduct,
			raw.Product.ObjectID, raw.Product.VersionID)
		if rerr != nil {
			return result, referenceError("product", rerr)
		}
		amount, aerr := lineAmount(quantity, price)
		if aerr != nil {
			return result, validation("line amount out of range", nil)
		}
		containerType := product.Data.ContainerType
		perContainer := parseOptionalMicros(product.Data.QuantityPerContainer)
		if raw.ContainerType != nil {
			containerType = strings.ToUpper(strings.TrimSpace(*raw.ContainerType))
		}
		if raw.QuantityPerContainer != nil {
			value, parseErr := fixedDecimal(*raw.QuantityPerContainer, 6, false)
			if parseErr != nil {
				return result, validation("invalid quantity per container", nil)
			}
			perContainer = &value
		}
		if containerType == "NONE" {
			perContainer = nil
		} else if (containerType != "SOLVENT" && containerType != "RESIN") || perContainer == nil || *perContainer <= 0 {
			return result, validation("invalid container snapshot", nil)
		}
		remark, remarkErr := optionalRemark(raw.Remark)
		if remarkErr != nil {
			return result, remarkErr
		}
		total += amount
		lines = append(lines, fixedCustomerLine{id: newID(), product: product, quantity: quantity, price: price,
			amount: amount, containerType: containerType, perContainer: perContainer, remark: remark})
	}
	result = fixedCustomerOrder{date: date, currency: currency, remark: optional(strings.TrimSpace(input.Remark)),
		customer: customer, salesperson: salesperson, settlement: settlement, lines: lines, total: total}
	return result, nil
}

func (s *Service) Query(ctx context.Context, input QueryInput) (Page[ProcessView], error) {
	query, err := validateQuery(input)
	if err != nil {
		return Page[ProcessView]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT p.id FROM wfl_process_instances p JOIN vou_documents d
		ON d.id=p.root_document_id WHERE ($1='' OR d.document_no ILIKE '%'||$1||'%')
		AND (COALESCE(cardinality($2::text[]),0)=0 OR p.status=ANY($2::text[]))
		ORDER BY p.updated_at DESC,p.id DESC LIMIT $3 OFFSET $4`,
		query.keyword, query.statuses, query.pageSize, query.offset)
	if err != nil {
		return Page[ProcessView]{}, internal("query processes", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return Page[ProcessView]{}, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	items := make([]ProcessView, 0, len(ids))
	for _, id := range ids {
		view, getErr := s.Get(ctx, GetInput{ProcessID: id}, nil)
		if getErr != nil {
			return Page[ProcessView]{}, getErr
		}
		items = append(items, view)
	}
	var total int64
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM wfl_process_instances p JOIN vou_documents d
		ON d.id=p.root_document_id WHERE ($1='' OR d.document_no ILIKE '%'||$1||'%')
		AND (COALESCE(cardinality($2::text[]),0)=0 OR p.status=ANY($2::text[]))`,
		query.keyword, query.statuses).Scan(&total)
	return Page[ProcessView]{Items: items, Total: total, Page: query.page, PageSize: query.pageSize}, err
}

func (s *Service) Get(ctx context.Context, input GetInput, permissions []string) (ProcessView, error) {
	if !validID(input.ProcessID) {
		return ProcessView{}, validation("invalid process", nil)
	}
	var view ProcessView
	err := s.pool.QueryRow(ctx, `SELECT p.id,p.process_type,p.definition_version,p.status,p.revision,
		p.root_document_id,d.document_no,p.created_at,p.created_by,p.updated_at,p.updated_by
		FROM wfl_process_instances p JOIN vou_documents d ON d.id=p.root_document_id WHERE p.id=$1`,
		input.ProcessID).Scan(&view.ProcessID, &view.ProcessType, &view.DefinitionVersion, &view.Status,
		&view.Revision, &view.RootDocumentID, &view.RootDocumentNo, &view.CreatedAt, &view.CreatedBy,
		&view.UpdatedAt, &view.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return view, validation("process not found", nil)
	}
	if err != nil {
		return view, internal("get process", err)
	}
	view.Documents, err = s.loadDocuments(ctx, input.ProcessID, permissions)
	if err != nil {
		return view, err
	}
	view.Balances, err = loadBalances(ctx, s.pool, input.ProcessID, hasPermission(permissions, "/wfl/intermediary-trade/procurement-get"))
	if err != nil {
		return view, err
	}
	view.CurrentStage = currentStage(view)
	return view, nil
}

func (s *Service) History(ctx context.Context, input HistoryInput) (Page[AuditView], error) {
	if !validID(input.ProcessID) {
		return Page[AuditView]{}, validation("invalid process", nil)
	}
	if input.Page < 1 {
		input.Page = 1
	}
	if input.PageSize < 1 {
		input.PageSize = 20
	}
	if input.PageSize > 100 {
		return Page[AuditView]{}, validation("pageSize exceeds 100", nil)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,event_type,from_status,to_status,stage,document_id,
		document_no,document_status,actor_id,occurred_at,reason,request_id,summary
		FROM wfl_audit_events WHERE process_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`,
		input.ProcessID, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[AuditView]{}, err
	}
	defer rows.Close()
	items := []AuditView{}
	for rows.Next() {
		var item AuditView
		if err = rows.Scan(&item.ID, &item.EventType, &item.FromStatus, &item.ToStatus,
			&item.Stage, &item.DocumentID, &item.DocumentNo, &item.DocumentStatus, &item.ActorID, &item.OccurredAt,
			&item.Reason, &item.RequestID, &item.Summary); err != nil {
			return Page[AuditView]{}, err
		}
		items = append(items, item)
	}
	var total int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM wfl_audit_events WHERE process_id=$1`, input.ProcessID).Scan(&total); err != nil {
		return Page[AuditView]{}, err
	}
	return Page[AuditView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func insertVouAudit(ctx context.Context, tx pgx.Tx, documentID, entity, event string, from *string, to, actor, request string, reason *string, summary any) error {
	encoded, _ := json.Marshal(summary)
	_, err := tx.Exec(ctx, `INSERT INTO vou_audit_events(id,document_id,entity,event_type,from_status,to_status,
		actor_id,reason,request_id,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		newID(), documentID, entity, event, from, to, actor, reason, request, encoded)
	return err
}

func insertWFLAudit(ctx context.Context, tx pgx.Tx, processID, event string, from *string, to, stage,
	documentID, documentNo, documentStatus, actor, request string, reason *string, summary any) error {
	encoded, _ := json.Marshal(summary)
	_, err := tx.Exec(ctx, `INSERT INTO wfl_audit_events(id,process_id,event_type,from_status,to_status,
		stage,document_id,document_no,document_status,actor_id,reason,request_id,summary)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),
		$10,$11,$12,$13)`, newID(), processID, event, from, to, stage, documentID, documentNo, documentStatus,
		actor, reason, request, encoded)
	return err
}

func newID() string             { return ulid.Make().String() }
func validID(value string) bool { _, err := ulid.ParseStrict(value); return err == nil }
func validation(message string, data any) error {
	return &DomainError{Kind: ErrorValidation, Message: message, Data: data}
}
func conflict(message string, data any) error {
	return &DomainError{Kind: ErrorConflict, Message: message, Data: data}
}
func internal(message string, err error) error {
	return &DomainError{Kind: ErrorInternal, Message: message, Cause: err}
}
func referenceError(name string, err error) error {
	if err == nil {
		return validation("invalid "+name+" reference", nil)
	}
	return validation("invalid "+name+" reference", map[string]any{"cause": err.Error()})
}
func stringPtr(value string) *string { return &value }
func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
func optionalRemark(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 1000 {
		return nil, validation("remark is too long", nil)
	}
	return optional(value), nil
}

type validatedQuery struct {
	page, pageSize int
	keyword        string
	statuses       []string
	offset         int64
}

func validateQuery(input QueryInput) (validatedQuery, error) {
	page, pageSize := input.Page, input.PageSize
	if page == 0 {
		page = 1
	}
	if pageSize == 0 {
		pageSize = 20
	}
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return validatedQuery{}, validation("invalid pagination", nil)
	}
	pageIndex := int64(page - 1)
	if pageIndex > int64(1<<31-1)/int64(pageSize) {
		return validatedQuery{}, validation("invalid pagination", nil)
	}
	keyword := strings.TrimSpace(input.Keyword)
	if utf8.RuneCountInString(keyword) > 200 {
		return validatedQuery{}, validation("invalid keyword", nil)
	}
	allowed := map[string]bool{
		StatusDraft:          true,
		StatusChecked:        true,
		StatusApproved:       true,
		StatusCompleted:      true,
		StatusShortRequested: true,
		StatusShortClosed:    true,
	}
	statuses := make([]string, 0, len(input.Statuses))
	seen := make(map[string]bool, len(input.Statuses))
	for _, raw := range input.Statuses {
		status := strings.ToUpper(strings.TrimSpace(raw))
		if !allowed[status] || seen[status] {
			return validatedQuery{}, validation("invalid status filter", nil)
		}
		seen[status] = true
		statuses = append(statuses, status)
	}
	return validatedQuery{
		page: page, pageSize: pageSize, keyword: keyword, statuses: statuses,
		offset: pageIndex * int64(pageSize),
	}, nil
}

func parseDate(value string) (time.Time, error) {
	date, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, validation("invalid business date", nil)
	}
	return date, nil
}
func parseOptionalMicros(value string) *int64 {
	if value == "" {
		return nil
	}
	parsed, err := fixedDecimal(value, 6, false)
	if err != nil {
		return nil
	}
	return &parsed
}

func fixedDecimal(value string, scale int, zero bool) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.HasPrefix(value, "+") {
		return 0, errors.New("invalid decimal")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid decimal")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" || len(fraction) > scale {
			return 0, errors.New("invalid scale")
		}
	}
	for _, part := range parts {
		for _, char := range part {
			if char < '0' || char > '9' {
				return 0, errors.New("invalid decimal")
			}
		}
	}
	fraction += strings.Repeat("0", scale-len(fraction))
	digits := strings.TrimLeft(parts[0]+fraction, "0")
	if digits == "" {
		digits = "0"
	}
	parsed, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || (!zero && parsed <= 0) {
		return 0, errors.New("invalid decimal")
	}
	return parsed, nil
}

func lineAmount(quantity, price int64) (int64, error) {
	if quantity < 0 || price < 0 {
		return 0, errors.New("overflow")
	}
	if price == 0 {
		return 0, nil
	}
	if quantity > 9_000_000_000_000_000/price {
		return 0, errors.New("overflow")
	}
	product := quantity * price
	return (product + 500_000) / 1_000_000, nil
}

func formatFixed(value int64, scale int) string {
	if scale == 6 {
		whole, fraction := value/1_000_000, value%1_000_000
		result := fmt.Sprintf("%d.%06d", whole, fraction)
		result = strings.TrimRight(result, "0")
		return strings.TrimSuffix(result, ".")
	}
	return fmt.Sprintf("%d.%02d", value/100, value%100)
}

func hasPermission(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func currentStage(view ProcessView) string {
	if view.Status == StatusCompleted || view.Status == StatusShortClosed {
		return ""
	}
	if view.Status == StatusDraft || view.Status == StatusChecked {
		return StageCustomer
	}
	for _, doc := range view.Documents {
		if doc.Stage == StageSignoff && doc.Status != "CONFIRMED" {
			return StageSignoff
		}
	}
	for _, doc := range view.Documents {
		if doc.Stage == StageDelivery && doc.Status != "EXECUTED" {
			return StageDelivery
		}
	}
	for _, doc := range view.Documents {
		if doc.Stage == StageReceipt && doc.Status != "CONFIRMED" {
			return StageReceipt
		}
	}
	for _, doc := range view.Documents {
		if doc.Stage == StageProcurement && doc.Status != "ORDERED" {
			return StageProcurement
		}
	}
	return StageDelivery
}
