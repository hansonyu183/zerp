package acc

import (
	"context"
	"strings"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func saveOpeningRegisters(ctx context.Context, tx pgx.Tx, input SaveOpeningInput) error {
	for _, table := range []string{"acc_opening_assets", "acc_opening_bills", "acc_opening_containers"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE book_id=$1`, input.BookID); err != nil {
			return databaseError("replace accounting opening registers", err)
		}
	}
	for index, asset := range input.Assets {
		asset.AssetID = strings.TrimSpace(asset.AssetID)
		createObject := asset.AssetID == ""
		if createObject {
			asset.AssetID = ulid.Make().String()
		} else if _, err := ulid.ParseStrict(asset.AssetID); err != nil {
			return domainError(ErrorValidation, "invalid opening asset id", err)
		} else {
			var exists bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM acc_assets WHERE id=$1)`, asset.AssetID).Scan(&exists); err != nil {
				return databaseError("check opening asset", err)
			}
			createObject = !exists
		}
		original, err := fixeddecimal.ParsePositive(asset.OriginalValue, 2, false)
		if err != nil {
			return domainError(ErrorValidation, "invalid opening asset value", err)
		}
		accumulated, err := fixeddecimal.ParsePositive(asset.AccumulatedDepreciation, 2, true)
		if err != nil || accumulated > original {
			return domainError(ErrorValidation, "invalid opening accumulated depreciation", err)
		}
		currency := strings.ToUpper(strings.TrimSpace(asset.Currency))
		var acquired any
		var residual int64
		if createObject {
			acquiredDate, dateErr := time.Parse("2006-01-02", asset.AcquiredOn)
			residual, err = fixeddecimal.ParsePositive(asset.ResidualRate, 4, true)
			if dateErr != nil || err != nil || residual > 10000 || asset.UsefulLifeMonths < 1 ||
				strings.TrimSpace(asset.AssetNo) == "" || strings.TrimSpace(asset.Name) == "" ||
				!validID(asset.CategoryID) || !validID(asset.DepartmentID) {
				return domainError(ErrorValidation, "invalid opening asset facts", firstError(dateErr, err))
			}
			acquired = acquiredDate
		}
		if !currencyPattern.MatchString(currency) {
			return domainError(ErrorValidation, "invalid opening asset currency", nil)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO acc_opening_assets(
			book_id,line_order,asset_id,create_object,asset_no,name,category_id,department_id,
			useful_life_months,residual_rate_bps,acquired_on,currency,original_minor,accumulated_minor
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, input.BookID, index,
			asset.AssetID, createObject, optionalRegisterText(asset.AssetNo), optionalRegisterText(asset.Name),
			optionalRegisterText(asset.CategoryID), optionalRegisterText(asset.DepartmentID),
			optionalPositiveInt(asset.UsefulLifeMonths), optionalResidual(createObject, residual), acquired,
			currency, original, accumulated); err != nil {
			return databaseError("save accounting opening asset", err)
		}
	}
	for index, bill := range input.Bills {
		if err := saveOpeningBill(ctx, tx, input.BookID, index, bill); err != nil {
			return err
		}
	}
	for index, container := range input.Containers {
		if !validID(container.CustomerID) || (container.ContainerType != "SOLVENT" && container.ContainerType != "RESIN") || container.Quantity == 0 {
			return domainError(ErrorValidation, "invalid opening container balance", nil)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO acc_opening_containers(book_id,line_order,customer_id,container_type,quantity)
			VALUES($1,$2,$3,$4,$5)`, input.BookID, index, container.CustomerID, container.ContainerType, container.Quantity); err != nil {
			return databaseError("save accounting opening container", err)
		}
	}
	return nil
}

func saveOpeningBill(ctx context.Context, tx pgx.Tx, bookID string, index int, bill OpeningBillInput) error {
	bill.BillID = strings.TrimSpace(bill.BillID)
	createObject := bill.BillID == ""
	if createObject {
		bill.BillID = ulid.Make().String()
	} else if _, err := ulid.ParseStrict(bill.BillID); err != nil {
		return domainError(ErrorValidation, "invalid opening bill id", err)
	} else {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM acc_bills WHERE id=$1)`, bill.BillID).Scan(&exists); err != nil {
			return databaseError("check opening bill", err)
		}
		createObject = !exists
	}
	value, err := fixeddecimal.ParsePositive(bill.ValueAmount, 2, false)
	if err != nil || !currencyPattern.MatchString(strings.ToUpper(strings.TrimSpace(bill.Currency))) {
		return domainError(ErrorValidation, "invalid opening bill value", err)
	}
	var face, interest, cost int64
	var issue, maturity any
	if createObject {
		face, err = fixeddecimal.ParsePositive(bill.FaceAmount, 2, false)
		var interestErr, costErr error
		interest, interestErr = fixeddecimal.ParsePositive(bill.InterestAmount, 2, true)
		cost, costErr = fixeddecimal.ParsePositive(bill.CustomerCostAmount, 2, true)
		issueDate, issueErr := time.Parse("2006-01-02", bill.IssueDate)
		maturityDate, maturityErr := time.Parse("2006-01-02", bill.MaturityDate)
		if err != nil || interestErr != nil || costErr != nil || issueErr != nil || maturityErr != nil || maturityDate.Before(issueDate) ||
			strings.TrimSpace(bill.BillNo) == "" || strings.TrimSpace(bill.Drawer) == "" || strings.TrimSpace(bill.Acceptor) == "" || strings.TrimSpace(bill.Payee) == "" ||
			(bill.PositionType != "ASSET" && bill.PositionType != "LIABILITY") || (bill.Medium != "PAPER" && bill.Medium != "ELECTRONIC") ||
			bill.AnnualRateBps < 0 || bill.InterestDays < 0 || !validID(bill.OriginatingParty.ObjectID) || !validID(bill.OriginatingParty.VersionID) {
			return domainError(ErrorValidation, "invalid opening bill facts", firstError(err, interestErr, costErr, issueErr, maturityErr))
		}
		issue, maturity = issueDate, maturityDate
	}
	_, err = tx.Exec(ctx, `INSERT INTO acc_opening_bills(
		book_id,line_order,bill_id,create_object,bill_no,bill_type,position_type,medium,currency,
		face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,
		interest_days,interest_amount_minor,customer_cost_amount_minor,origin_party_entity,
		origin_party_object_id,origin_party_version_id,origin_party_code,origin_party_name,value_minor
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
		bookID, index, bill.BillID, createObject, optionalRegisterText(bill.BillNo), optionalRegisterText(bill.BillType),
		optionalRegisterText(bill.PositionType), optionalRegisterText(bill.Medium), strings.ToUpper(strings.TrimSpace(bill.Currency)),
		optionalRegisterMoney(createObject, face), issue, maturity, optionalRegisterText(bill.Drawer), optionalRegisterText(bill.Acceptor), optionalRegisterText(bill.Payee),
		optionalRegisterInt(createObject, bill.AnnualRateBps), optionalRegisterInt(createObject, bill.InterestDays), optionalRegisterMoney(createObject, interest),
		optionalRegisterMoney(createObject, cost), optionalRegisterText(bill.OriginatingParty.Entity), optionalRegisterText(bill.OriginatingParty.ObjectID),
		optionalRegisterText(bill.OriginatingParty.VersionID), optionalRegisterText(bill.OriginatingParty.Code), optionalRegisterText(bill.OriginatingParty.Name), value)
	if err != nil {
		return databaseError("save accounting opening bill", err)
	}
	return nil
}

func loadOpeningRegisters(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, view *OpeningView) error {
	view.Assets, view.Bills, view.Containers = []OpeningAssetView{}, []OpeningBillView{}, []OpeningContainerView{}
	rows, err := q.Query(ctx, `SELECT asset_id,create_object,COALESCE(asset_no,''),COALESCE(name,''),
		COALESCE(category_id,''),COALESCE(department_id,''),COALESCE(useful_life_months,0),
		COALESCE(residual_rate_bps,0),acquired_on,currency,original_minor,accumulated_minor
		FROM acc_opening_assets WHERE book_id=$1 ORDER BY line_order`, view.BookID)
	if err != nil {
		return databaseError("load accounting opening assets", err)
	}
	for rows.Next() {
		var item OpeningAssetView
		var residual, original, accumulated int64
		var acquired *time.Time
		if err = rows.Scan(&item.AssetID, &item.CreateObject, &item.AssetNo, &item.Name, &item.CategoryID, &item.DepartmentID, &item.UsefulLifeMonths, &residual, &acquired, &item.Currency, &original, &accumulated); err != nil {
			rows.Close()
			return err
		}
		item.ResidualRate = fixeddecimal.Format(residual, 4, true)
		item.OriginalValue = fixeddecimal.Format(original, 2, false)
		item.AccumulatedDepreciation = fixeddecimal.Format(accumulated, 2, false)
		if acquired != nil {
			item.AcquiredOn = acquired.Format("2006-01-02")
		}
		view.Assets = append(view.Assets, item)
	}
	rows.Close()
	rows, err = q.Query(ctx, `SELECT bill_id,create_object,COALESCE(bill_no,''),COALESCE(bill_type,''),COALESCE(position_type,''),COALESCE(medium,''),currency,
		COALESCE(face_amount_minor,0),issue_date,maturity_date,COALESCE(drawer,''),COALESCE(acceptor,''),COALESCE(payee,''),COALESCE(annual_rate_bps,0),COALESCE(interest_days,0),
		COALESCE(interest_amount_minor,0),COALESCE(customer_cost_amount_minor,0),COALESCE(origin_party_entity,''),COALESCE(origin_party_object_id,''),COALESCE(origin_party_version_id,''),COALESCE(origin_party_code,''),COALESCE(origin_party_name,''),value_minor
		FROM acc_opening_bills WHERE book_id=$1 ORDER BY line_order`, view.BookID)
	if err != nil {
		return databaseError("load accounting opening bills", err)
	}
	for rows.Next() {
		var item OpeningBillView
		var face, interest, cost, value int64
		var issue, maturity *time.Time
		if err = rows.Scan(&item.BillID, &item.CreateObject, &item.BillNo, &item.BillType, &item.PositionType, &item.Medium, &item.Currency, &face, &issue, &maturity, &item.Drawer, &item.Acceptor, &item.Payee, &item.AnnualRateBps, &item.InterestDays, &interest, &cost, &item.OriginatingParty.Entity, &item.OriginatingParty.ObjectID, &item.OriginatingParty.VersionID, &item.OriginatingParty.Code, &item.OriginatingParty.Name, &value); err != nil {
			rows.Close()
			return err
		}
		item.FaceAmount = fixeddecimal.Format(face, 2, false)
		item.InterestAmount = fixeddecimal.Format(interest, 2, false)
		item.CustomerCostAmount = fixeddecimal.Format(cost, 2, false)
		item.ValueAmount = fixeddecimal.Format(value, 2, false)
		if issue != nil {
			item.IssueDate = issue.Format("2006-01-02")
		}
		if maturity != nil {
			item.MaturityDate = maturity.Format("2006-01-02")
		}
		view.Bills = append(view.Bills, item)
	}
	rows.Close()
	rows, err = q.Query(ctx, `SELECT customer_id,container_type,quantity FROM acc_opening_containers WHERE book_id=$1 ORDER BY line_order`, view.BookID)
	if err != nil {
		return databaseError("load accounting opening containers", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item OpeningContainerView
		if err = rows.Scan(&item.CustomerID, &item.ContainerType, &item.Quantity); err != nil {
			return err
		}
		view.Containers = append(view.Containers, item)
	}
	return rows.Err()
}

func approveOpeningRegisters(ctx context.Context, tx pgx.Tx, bookID string, lines []normalizedOpeningLine) error {
	type openingAssetRow struct {
		id                             string
		create                         bool
		no, name, category, department *string
		life, residual                 *int32
		acquired                       *time.Time
		currency                       string
		original, accumulated          int64
	}
	assetRows, err := tx.Query(ctx, `SELECT asset_id,create_object,asset_no,name,category_id,department_id,useful_life_months,residual_rate_bps,acquired_on,currency,original_minor,accumulated_minor FROM acc_opening_assets WHERE book_id=$1`, bookID)
	if err != nil {
		return err
	}
	assets := []openingAssetRow{}
	for assetRows.Next() {
		var asset openingAssetRow
		if err = assetRows.Scan(&asset.id, &asset.create, &asset.no, &asset.name, &asset.category, &asset.department, &asset.life, &asset.residual, &asset.acquired, &asset.currency, &asset.original, &asset.accumulated); err != nil {
			assetRows.Close()
			return err
		}
		assets = append(assets, asset)
	}
	assetRows.Close()
	var config AssetAccountingConfiguration
	if len(assets) > 0 {
		config, err = loadAssetAccountingConfiguration(ctx, tx, bookID)
		if err != nil {
			return err
		}
	}
	for _, asset := range assets {
		if !openingLineMatches(lines, config.AssetSubjectID, DimensionAsset, asset.id, asset.currency, asset.original, 0) || (asset.accumulated > 0 && !openingLineMatches(lines, config.AccumulatedDepreciationSubjectID, DimensionAsset, asset.id, asset.currency, 0, asset.accumulated)) {
			return domainError(ErrorConflict, "opening asset values do not reconcile", nil)
		}
		if asset.create {
			if _, err = tx.Exec(ctx, `INSERT INTO acc_assets(id,asset_no,source_document_id,source_line_id,name,category_id,department_id,useful_life_months,residual_rate_bps,acquired_on,state) VALUES($1,$2,$3,$1,$4,$5,$6,$7,$8,$9,'ACTIVE')`, asset.id, *asset.no, bookID, *asset.name, *asset.category, *asset.department, *asset.life, *asset.residual, *asset.acquired); err != nil {
				return databaseError("create opening asset", err)
			}
		} else {
			var active bool
			if err = tx.QueryRow(ctx, `SELECT state='ACTIVE' FROM acc_assets WHERE id=$1`, asset.id).Scan(&active); err != nil || !active {
				return domainError(ErrorConflict, "opening asset is not available", err)
			}
		}
		assetDimensions := []byte(`{"ASSET":"` + asset.id + `"}`)
		if _, err = tx.Exec(ctx, `INSERT INTO acc_asset_book_values(book_id,asset_id,currency,original_minor,accumulated_depreciation_minor,asset_subject_id,asset_dimensions,accumulated_subject_id,accumulated_dimensions,expense_subject_id,expense_dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,'{}')`, bookID, asset.id, asset.currency, asset.original, asset.accumulated, config.AssetSubjectID, assetDimensions, config.AccumulatedDepreciationSubjectID, config.DepreciationExpenseSubjectID); err != nil {
			return databaseError("create opening asset book value", err)
		}
	}
	type openingBillRow struct {
		id                             string
		create                         bool
		no, billType, position, medium *string
		currency                       string
		face                           *int64
		issue, maturity                *time.Time
		drawer, acceptor, payee        *string
		rate, days                     *int32
		interest, cost                 *int64
		pe, pid, pvid, pcode, pname    *string
		value                          int64
	}
	billRows, err := tx.Query(ctx, `SELECT bill_id,create_object,bill_no,bill_type,position_type,medium,currency,face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,interest_amount_minor,customer_cost_amount_minor,origin_party_entity,origin_party_object_id,origin_party_version_id,origin_party_code,origin_party_name,value_minor FROM acc_opening_bills WHERE book_id=$1`, bookID)
	if err != nil {
		return err
	}
	bills := []openingBillRow{}
	for billRows.Next() {
		var bill openingBillRow
		if err = billRows.Scan(&bill.id, &bill.create, &bill.no, &bill.billType, &bill.position, &bill.medium, &bill.currency, &bill.face, &bill.issue, &bill.maturity, &bill.drawer, &bill.acceptor, &bill.payee, &bill.rate, &bill.days, &bill.interest, &bill.cost, &bill.pe, &bill.pid, &bill.pvid, &bill.pcode, &bill.pname, &bill.value); err != nil {
			billRows.Close()
			return err
		}
		bills = append(bills, bill)
	}
	billRows.Close()
	for _, bill := range bills {
		debit, credit := bill.value, int64(0)
		if bill.position != nil && *bill.position == "LIABILITY" {
			debit, credit = 0, bill.value
		}
		if !openingAnyBillLineMatches(lines, bill.id, bill.currency, debit, credit) {
			return domainError(ErrorConflict, "opening bill value does not reconcile", nil)
		}
		if bill.create {
			if _, err = tx.Exec(ctx, `INSERT INTO acc_bills(id,bill_no,bill_type,position_type,currency,medium,face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,interest_amount_minor,customer_cost_amount_minor,origin_party_entity,origin_party_object_id,origin_party_version_id,origin_party_code,origin_party_name,state,source_document_id,source_line_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'AVAILABLE',$22,$1)`, bill.id, *bill.no, *bill.billType, *bill.position, bill.currency, *bill.medium, *bill.face, *bill.issue, *bill.maturity, *bill.drawer, *bill.acceptor, *bill.payee, *bill.rate, *bill.days, *bill.interest, *bill.cost, *bill.pe, *bill.pid, *bill.pvid, *bill.pcode, *bill.pname, bookID); err != nil {
				return databaseError("create opening bill", err)
			}
		} else {
			var available bool
			if err = tx.QueryRow(ctx, `SELECT state='AVAILABLE' FROM acc_bills WHERE id=$1`, bill.id).Scan(&available); err != nil || !available {
				return domainError(ErrorConflict, "opening bill is not available", err)
			}
		}
		if _, err = tx.Exec(ctx, `INSERT INTO acc_bill_book_values(book_id,bill_id,value_minor) VALUES($1,$2,$3)`, bookID, bill.id, bill.value); err != nil {
			return databaseError("create opening bill book value", err)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO acc_container_entries(id,customer_id,container_type,quantity_delta,source_document_id,source_revision) SELECT substr(md5(book_id||customer_id||container_type),1,26),customer_id,container_type,quantity,book_id,0 FROM acc_opening_containers WHERE book_id=$1`, bookID)
	if err != nil {
		return databaseError("create opening container balances", err)
	}
	return nil
}

func unapproveOpeningRegisters(ctx context.Context, tx pgx.Tx, bookID string) error {
	var referenced bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM acc_opening_assets opening JOIN acc_asset_book_values value ON value.asset_id=opening.asset_id WHERE opening.book_id=$1 AND opening.create_object AND value.book_id<>$1) OR EXISTS(SELECT 1 FROM acc_opening_bills opening JOIN acc_bill_book_values value ON value.bill_id=opening.bill_id WHERE opening.book_id=$1 AND opening.create_object AND value.book_id<>$1)`, bookID).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return domainError(ErrorConflict, "opening global object is used by another book", nil)
	}
	statements := []string{
		`DELETE FROM acc_container_entries WHERE source_document_id=$1 AND source_revision=0`,
		`DELETE FROM acc_asset_book_values WHERE book_id=$1`,
		`DELETE FROM acc_bill_book_values WHERE book_id=$1`,
		`DELETE FROM acc_assets WHERE source_document_id=$1 AND id IN(SELECT asset_id FROM acc_opening_assets WHERE book_id=$1 AND create_object)`,
		`DELETE FROM acc_bills WHERE source_document_id=$1 AND id IN(SELECT bill_id FROM acc_opening_bills WHERE book_id=$1 AND create_object)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, bookID); err != nil {
			return databaseError("reverse opening registers", err)
		}
	}
	return nil
}

func openingLineMatches(lines []normalizedOpeningLine, subject, dimension, object, currency string, debit, credit int64) bool {
	for _, line := range lines {
		if line.subjectID == subject && line.currency == currency && line.dimensions[dimension] == object && line.debitMinor == debit && line.creditMinor == credit {
			return true
		}
	}
	return false
}
func openingAnyBillLineMatches(lines []normalizedOpeningLine, id, currency string, debit, credit int64) bool {
	for _, line := range lines {
		if line.currency == currency && line.dimensions[DimensionBill] == id && line.debitMinor == debit && line.creditMinor == credit {
			return true
		}
	}
	return false
}
func optionalRegisterText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
func optionalPositiveInt(value int32) *int32 {
	if value <= 0 {
		return nil
	}
	return &value
}
func optionalResidual(enabled bool, value int64) *int64 {
	if !enabled {
		return nil
	}
	return &value
}
func optionalRegisterMoney(enabled bool, value int64) *int64 {
	if !enabled {
		return nil
	}
	return &value
}
func optionalRegisterInt(enabled bool, value int32) *int32 {
	if !enabled {
		return nil
	}
	return &value
}
func firstError(errors ...error) error {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(strings.TrimSpace(value))
	return err == nil
}
