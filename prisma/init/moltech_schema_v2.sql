-- ============================================================================
-- MOLTECH initial schema — English snake_case edition
-- Migration 2026-05-17: schema migrated to English snake_case (see docs/DATABASE_MIGRATIONS.md §2)
-- Original source: moltech_app/database/moltech_dbdiagram.dbml (read-only, DBML in Spanish)
-- The DBML is now obsolete as naming reference — this SQL file is the authoritative DDL.
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ============================================================================
-- ENUMS (14)
-- ============================================================================

CREATE TYPE auth_provider_enum AS ENUM (
    'email',
    'google',
    'facebook'
);

CREATE TYPE user_status_enum AS ENUM (
    'active',
    'suspended',
    'inactive'
);

CREATE TYPE station_status_enum AS ENUM (
    'online',
    'offline',
    'maintenance'
);

CREATE TYPE power_bank_status_enum AS ENUM (
    'available',
    'rented',
    'charging',
    'damaged',
    'retired'
);

CREATE TYPE rental_status_enum AS ENUM (
    'active',
    'completed',
    'cancelled',
    'penalized'
);

CREATE TYPE payment_method_type_enum AS ENUM (
    'visa',
    'mastercard',
    'amex',
    'dinersclub',
    'other'
);

CREATE TYPE payment_method_status_enum AS ENUM (
    'active',
    'expired',
    'deleted'
);

CREATE TYPE coupon_type_enum AS ENUM (
    'percentage',
    'fixed_amount'
);

CREATE TYPE coupon_status_enum AS ENUM (
    'active',
    'expired',
    'disabled'
);

CREATE TYPE notification_type_enum AS ENUM (
    'promotion',
    'rental',
    'payment',
    'system'
);

CREATE TYPE verification_token_type_enum AS ENUM (
    'email',
    'whatsapp',
    'reset_password'
);

CREATE TYPE payment_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected',
    'refunded',
    'error'
);

CREATE TYPE payment_concept_enum AS ENUM (
    'rental',
    'penalty',
    'refund'
);

CREATE TYPE payment_gateway_enum AS ENUM (
    'wompi',
    'payu',
    'mercadopago',
    'stripe',
    'other'
);

-- ============================================================================
-- TABLES (9) — dependency order: referenced tables first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: users
-- System users. Email or phone required (at least one).
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    id                   UUID               NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name           VARCHAR(100)       NOT NULL,
    last_name            VARCHAR(100)       NOT NULL,
    email                VARCHAR(150)       UNIQUE,
    phone                VARCHAR(20)        UNIQUE,
    password_hash        VARCHAR(255),
    country              VARCHAR(80),
    city                 VARCHAR(80),
    address              VARCHAR(200),
    photo_url            VARCHAR(300),
    rating               DECIMAL(2,1),
    email_verified       BOOLEAN            NOT NULL DEFAULT FALSE,
    phone_verified       BOOLEAN            NOT NULL DEFAULT FALSE,
    accepted_policy      BOOLEAN            NOT NULL DEFAULT FALSE,
    auth_provider        auth_provider_enum NOT NULL DEFAULT 'email',
    auth_provider_id     VARCHAR(200),
    status               user_status_enum   NOT NULL DEFAULT 'active',
    created_at           TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_users_password_email
        CHECK (auth_provider <> 'email' OR password_hash IS NOT NULL),
    CONSTRAINT chk_users_rating
        CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5))
);

COMMENT ON TABLE  users IS 'System users. Email or phone required (at least one).';
COMMENT ON COLUMN users.rating IS 'Nullable - ratings introduced in v2';

-- ----------------------------------------------------------------------------
-- TABLE: stations
-- Physical pick-up and return points for power banks.
-- ----------------------------------------------------------------------------

CREATE TABLE stations (
    id               UUID                NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(150)        NOT NULL,
    city             VARCHAR(80)         NOT NULL,
    zone             VARCHAR(100),
    address          VARCHAR(200)        NOT NULL,
    latitude         DECIMAL(10,7)       NOT NULL,
    longitude        DECIMAL(10,7)       NOT NULL,
    hourly_rate      DECIMAL(10,2)       NOT NULL,
    currency         VARCHAR(10)         NOT NULL DEFAULT 'COP',
    total_capacity   INTEGER             NOT NULL DEFAULT 0,
    status           station_status_enum NOT NULL DEFAULT 'online',
    description      TEXT,
    opening_time     TIME,
    closing_time     TIME,
    created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- TABLE: power_banks
-- Portable charging devices available for rental.
-- ----------------------------------------------------------------------------

CREATE TABLE power_banks (
    id           UUID                  NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(20)           NOT NULL UNIQUE,
    station_id   UUID                  NOT NULL,
    model        VARCHAR(100),
    status       power_bank_status_enum NOT NULL DEFAULT 'available',
    battery_level INTEGER              NOT NULL DEFAULT 100,
    qr_code      VARCHAR(300)          NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_power_bank_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_power_banks_battery_level
        CHECK (battery_level >= 0 AND battery_level <= 100)
);

-- ----------------------------------------------------------------------------
-- TABLE: coupons
-- Discount coupons applicable to rentals.
-- ----------------------------------------------------------------------------

CREATE TABLE coupons (
    id                      UUID              NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    VARCHAR(50)       NOT NULL UNIQUE,
    description             VARCHAR(200),
    discount_type           coupon_type_enum  NOT NULL,
    discount_value          DECIMAL(10,2)     NOT NULL,
    start_date              TIMESTAMPTZ       NOT NULL,
    end_date                TIMESTAMPTZ       NOT NULL,
    max_uses                INTEGER,
    current_uses            INTEGER           NOT NULL DEFAULT 0,
    status                  coupon_status_enum NOT NULL DEFAULT 'active',

    CONSTRAINT chk_coupons_dates
        CHECK (end_date > start_date),
    CONSTRAINT chk_coupons_uses
        CHECK (current_uses >= 0),
    CONSTRAINT chk_coupons_value
        CHECK (discount_value > 0)
);

-- ----------------------------------------------------------------------------
-- TABLE: payment_methods
-- Tokenized user payment methods (no PCI data stored).
-- ----------------------------------------------------------------------------

CREATE TABLE payment_methods (
    id                UUID                       NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID                       NOT NULL,
    type              payment_method_type_enum   NOT NULL,
    cardholder_name   VARCHAR(150)               NOT NULL,
    last_four_digits  CHAR(4)                    NOT NULL,
    expiry_month      SMALLINT                   NOT NULL,
    expiry_year       SMALLINT                   NOT NULL,
    is_default        BOOLEAN                    NOT NULL DEFAULT FALSE,
    gateway_token     VARCHAR(300)               NOT NULL,
    status            payment_method_status_enum NOT NULL DEFAULT 'active',
    created_at        TIMESTAMPTZ                NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_payment_method_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_payment_methods_expiry_month
        CHECK (expiry_month BETWEEN 1 AND 12),
    CONSTRAINT chk_payment_methods_expiry_year
        CHECK (expiry_year BETWEEN 0 AND 99)
);

COMMENT ON COLUMN payment_methods.expiry_month    IS '1-12';
COMMENT ON COLUMN payment_methods.expiry_year     IS '0-99 (e.g. 28 for 2028)';
COMMENT ON COLUMN payment_methods.gateway_token   IS 'Opaque token from the payment gateway — no PCI data';

-- ----------------------------------------------------------------------------
-- TABLE: rentals
-- Full rental lifecycle: pick-up to return at the same station.
-- ----------------------------------------------------------------------------

CREATE TABLE rentals (
    id                        UUID               NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID               NOT NULL,
    power_bank_id             UUID               NOT NULL,
    pickup_station_id         UUID               NOT NULL,
    coupon_id                 UUID,
    payment_method_id         UUID               NOT NULL,
    start_time                TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    end_time                  TIMESTAMPTZ,
    estimated_duration_hours  INTEGER            NOT NULL,
    actual_duration_hours     DECIMAL(5,2),
    hourly_rate               DECIMAL(10,2)      NOT NULL,
    estimated_cost            DECIMAL(10,2)      NOT NULL,
    final_cost                DECIMAL(10,2),
    currency                  VARCHAR(10)        NOT NULL DEFAULT 'COP',
    discount_applied          DECIMAL(10,2)      NOT NULL DEFAULT 0,
    penalty                   DECIMAL(10,2)      NOT NULL DEFAULT 0,
    status                    rental_status_enum NOT NULL DEFAULT 'active',
    created_at                TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_rental_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rental_power_bank
        FOREIGN KEY (power_bank_id) REFERENCES power_banks (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rental_pickup_station
        FOREIGN KEY (pickup_station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rental_coupon
        FOREIGN KEY (coupon_id) REFERENCES coupons (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rental_payment_method
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_rentals_end_time
        CHECK (end_time IS NULL OR end_time > start_time),
    CONSTRAINT chk_rentals_final_cost
        CHECK (final_cost IS NULL OR final_cost >= 0),
    CONSTRAINT chk_rentals_discount
        CHECK (discount_applied >= 0),
    CONSTRAINT chk_rentals_penalty
        CHECK (penalty >= 0)
);

COMMENT ON TABLE  rentals IS 'Return at the same station as pick-up (no separate return station).';
COMMENT ON COLUMN rentals.pickup_station_id IS 'Return happens at the same station as pick-up';

-- ----------------------------------------------------------------------------
-- TABLE: payments
-- Traceability of charge attempts against the external payment gateway.
-- No sensitive data stored (PCI-free) — only the gateway transaction reference.
-- One rental can have multiple payments (rental + penalty + refund).
-- ----------------------------------------------------------------------------

CREATE TABLE payments (
    id              UUID                  NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id       UUID                  NOT NULL,
    user_id         UUID                  NOT NULL,
    payment_method_id UUID,
    concept         payment_concept_enum  NOT NULL DEFAULT 'rental',
    amount          DECIMAL(10,2)         NOT NULL,
    currency        VARCHAR(10)           NOT NULL DEFAULT 'COP',
    gateway         payment_gateway_enum  NOT NULL,
    transaction_id  VARCHAR(200)          NOT NULL,
    merchant_id     VARCHAR(200),
    status          payment_status_enum   NOT NULL DEFAULT 'pending',
    gateway_message TEXT,
    attempted_at    TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payments_gateway_transaction
        UNIQUE (gateway, transaction_id),
    CONSTRAINT fk_payment_rental
        FOREIGN KEY (rental_id) REFERENCES rentals (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_method
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_payments_amount
        CHECK (amount >= 0)
);

COMMENT ON COLUMN payments.transaction_id IS 'ID returned by the payment gateway';
COMMENT ON COLUMN payments.merchant_id    IS 'Merchant ID within the gateway';

-- ----------------------------------------------------------------------------
-- TABLE: notifications
-- In-app notifications sent to users.
-- ----------------------------------------------------------------------------

CREATE TABLE notifications (
    id          UUID                   NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID                   NOT NULL,
    title       VARCHAR(150)           NOT NULL,
    body        TEXT                   NOT NULL,
    type        notification_type_enum NOT NULL DEFAULT 'system',
    is_read     BOOLEAN                NOT NULL DEFAULT FALSE,
    sent_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_notification_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ----------------------------------------------------------------------------
-- TABLE: verification_tokens
-- Short-lived OTP tokens for email, WhatsApp and password reset verification.
-- ----------------------------------------------------------------------------

CREATE TABLE verification_tokens (
    id          UUID                        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID                        NOT NULL,
    type        verification_token_type_enum NOT NULL,
    token       VARCHAR(10)                 NOT NULL,
    expires_at  TIMESTAMPTZ                 NOT NULL,
    used        BOOLEAN                     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_verification_token_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ============================================================================
-- INDICES
-- ============================================================================

-- users
CREATE INDEX idx_users_email         ON users (email);
CREATE INDEX idx_users_phone         ON users (phone);
CREATE INDEX idx_users_status        ON users (status);
CREATE INDEX idx_users_auth          ON users (auth_provider, auth_provider_id);

-- stations
CREATE INDEX idx_stations_city        ON stations (city);
CREATE INDEX idx_stations_status      ON stations (status);
CREATE INDEX idx_stations_coordinates ON stations (latitude, longitude);

-- power_banks
CREATE INDEX idx_power_banks_station ON power_banks (station_id);
CREATE INDEX idx_power_banks_status  ON power_banks (status);
CREATE INDEX idx_power_banks_code    ON power_banks (code);

-- coupons
CREATE INDEX idx_coupons_code   ON coupons (code);
CREATE INDEX idx_coupons_status ON coupons (status);
CREATE INDEX idx_coupons_dates  ON coupons (start_date, end_date);

-- payment_methods
CREATE INDEX idx_payment_methods_user       ON payment_methods (user_id);
CREATE INDEX idx_payment_methods_status     ON payment_methods (status);
CREATE INDEX idx_payment_methods_default    ON payment_methods (user_id, is_default);

-- rentals
CREATE INDEX idx_rentals_user            ON rentals (user_id);
CREATE INDEX idx_rentals_power_bank      ON rentals (power_bank_id);
CREATE INDEX idx_rentals_pickup_station  ON rentals (pickup_station_id);
CREATE INDEX idx_rentals_status          ON rentals (status);
CREATE INDEX idx_rentals_start_time      ON rentals (start_time);
CREATE INDEX idx_rentals_active          ON rentals (user_id, status);
CREATE INDEX idx_rentals_payment_method  ON rentals (payment_method_id);
CREATE INDEX idx_rentals_coupon          ON rentals (coupon_id);

-- payments
CREATE INDEX idx_payments_rental         ON payments (rental_id);
CREATE INDEX idx_payments_user           ON payments (user_id);
CREATE INDEX idx_payments_method         ON payments (payment_method_id);
CREATE INDEX idx_payments_status         ON payments (status);
CREATE INDEX idx_payments_attempted_at   ON payments (attempted_at DESC);
CREATE INDEX idx_payments_pending        ON payments (rental_id, status)
    WHERE status IN ('pending', 'error');

-- notifications
CREATE INDEX idx_notifications_user     ON notifications (user_id);
CREATE INDEX idx_notifications_unread   ON notifications (user_id, is_read);
CREATE INDEX idx_notifications_sent_at  ON notifications (sent_at);

-- verification_tokens
CREATE INDEX idx_verification_tokens_user   ON verification_tokens (user_id);
CREATE INDEX idx_verification_tokens_lookup ON verification_tokens (user_id, type, token);
CREATE INDEX idx_verification_tokens_expiry ON verification_tokens (expires_at);

-- ============================================================================
-- TRIGGERS — updated_at maintenance
-- ============================================================================

-- power_banks: updated_at
CREATE OR REPLACE FUNCTION fn_update_power_banks_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_power_banks_updated
    BEFORE UPDATE ON power_banks
    FOR EACH ROW EXECUTE FUNCTION fn_update_power_banks_timestamp();

-- payments: updated_at
CREATE OR REPLACE FUNCTION fn_update_payments_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_updated
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION fn_update_payments_timestamp();
