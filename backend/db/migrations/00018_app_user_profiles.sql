-- +goose Up
CREATE TABLE app_user_profiles (
    user_id varchar(26) PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    avatar_url varchar(500) NOT NULL
        CHECK (length(btrim(avatar_url)) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26)
);

-- +goose Down
DROP TABLE app_user_profiles;
