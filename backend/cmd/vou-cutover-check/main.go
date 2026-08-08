package main

import (
	"context"
	"fmt"
	"os"

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/database"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	"github.com/jackc/pgx/v5"
)

func main() {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		fail()
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout)
	if err != nil {
		fail()
	}
	defer pool.Close()

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		fail()
	}
	defer func() { _ = tx.Rollback(ctx) }()

	documents, err := dbsqlc.New(tx).ListVouApprovedCutoverDocuments(ctx, leddomain.PostingVOUEntities())
	if err != nil {
		fail()
	}
	if err := tx.Commit(ctx); err != nil {
		fail()
	}

	fmt.Printf("VOU approval cutover check: total=%d\n", len(documents))
	for index := 0; index < len(documents); {
		entity := documents[index].Entity
		count := 0
		for index+count < len(documents) && documents[index+count].Entity == entity {
			count++
		}
		fmt.Printf("entity %s: %d\n", entity, count)
		index += count
	}
	for _, document := range documents {
		fmt.Printf(
			"document entity=%s number=%s business_date=%s status=%s\n",
			document.Entity, document.DocumentNo, document.BusinessDate, document.Status,
		)
	}

	if len(documents) > 0 {
		os.Exit(1)
	}
}

func fail() {
	fmt.Fprintln(os.Stderr, "VOU approval cutover check failed")
	os.Exit(1)
}
