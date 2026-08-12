DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname='public' AND tablename LIKE 'led\_%' ESCAPE '\'
    ) THEN
        RAISE EXCEPTION 'LED tables remain after migration 00072';
    END IF;
    IF to_regclass('public.vou_asset_depreciation_details') IS NOT NULL
       OR to_regclass('public.vou_asset_depreciation_lines') IS NOT NULL THEN
        RAISE EXCEPTION 'asset depreciation VOU tables remain after migration 00072';
    END IF;
    IF EXISTS (SELECT 1 FROM app_permissions WHERE domain='led' OR entity='asset-depreciation') THEN
        RAISE EXCEPTION 'obsolete LED or depreciation permissions remain after migration 00072';
    END IF;
    IF EXISTS (SELECT 1 FROM vou_documents WHERE entity='asset-depreciation') THEN
        RAISE EXCEPTION 'obsolete asset depreciation documents remain after migration 00072';
    END IF;
    IF to_regclass('public.acc_books') IS NULL
       OR to_regclass('public.acc_inventory_entries') IS NULL
       OR to_regclass('public.acc_assets') IS NULL THEN
        RAISE EXCEPTION 'ACC structures are unavailable after migration 00072';
    END IF;
END
$$;

INSERT INTO acc_books(
    id,code,name,start_month,base_currency,control_book,subject_template,created_by,updated_by
) VALUES (
    '01JACC72BOOK0000000000001','MIGRATION-72','Migration 72 verification','2026-01-01',
    'CNY',true,'EMPTY','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);
DELETE FROM acc_books WHERE id='01JACC72BOOK0000000000001';
