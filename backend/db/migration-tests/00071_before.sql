DO $$ BEGIN
    IF to_regclass('public.acc_asset_book_values') IS NULL THEN RAISE EXCEPTION 'asset values missing'; END IF;
END $$;
