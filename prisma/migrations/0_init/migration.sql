-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "auth_provider_enum" AS ENUM ('email', 'google', 'facebook');

-- CreateEnum
CREATE TYPE "coupon_status_enum" AS ENUM ('active', 'expired', 'disabled');

-- CreateEnum
CREATE TYPE "coupon_type_enum" AS ENUM ('percentage', 'fixed_amount');

-- CreateEnum
CREATE TYPE "notification_type_enum" AS ENUM ('promotion', 'rental', 'payment', 'system');

-- CreateEnum
CREATE TYPE "payment_concept_enum" AS ENUM ('rental', 'penalty', 'refund');

-- CreateEnum
CREATE TYPE "payment_gateway_enum" AS ENUM ('wompi', 'payu', 'mercadopago', 'stripe', 'other');

-- CreateEnum
CREATE TYPE "payment_method_status_enum" AS ENUM ('active', 'expired', 'deleted');

-- CreateEnum
CREATE TYPE "payment_method_type_enum" AS ENUM ('visa', 'mastercard', 'amex', 'dinersclub', 'other');

-- CreateEnum
CREATE TYPE "payment_status_enum" AS ENUM ('pending', 'approved', 'rejected', 'refunded', 'error');

-- CreateEnum
CREATE TYPE "power_bank_status_enum" AS ENUM ('available', 'rented', 'charging', 'damaged', 'retired');

-- CreateEnum
CREATE TYPE "rental_status_enum" AS ENUM ('active', 'completed', 'cancelled', 'penalized');

-- CreateEnum
CREATE TYPE "station_status_enum" AS ENUM ('online', 'offline', 'maintenance');

-- CreateEnum
CREATE TYPE "user_status_enum" AS ENUM ('active', 'suspended', 'inactive');

-- CreateEnum
CREATE TYPE "verification_token_type_enum" AS ENUM ('email', 'whatsapp', 'reset_password');

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "discount_type" "coupon_type_enum" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "status" "coupon_status_enum" NOT NULL DEFAULT 'active',

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "body" TEXT NOT NULL,
    "type" "notification_type_enum" NOT NULL DEFAULT 'system',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "payment_method_type_enum" NOT NULL,
    "cardholder_name" VARCHAR(150) NOT NULL,
    "last_four_digits" CHAR(4) NOT NULL,
    "expiry_month" SMALLINT NOT NULL,
    "expiry_year" SMALLINT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "gateway_token" VARCHAR(300) NOT NULL,
    "status" "payment_method_status_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rental_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_method_id" UUID,
    "concept" "payment_concept_enum" NOT NULL DEFAULT 'rental',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "gateway" "payment_gateway_enum" NOT NULL,
    "transaction_id" VARCHAR(200) NOT NULL,
    "merchant_id" VARCHAR(200),
    "status" "payment_status_enum" NOT NULL DEFAULT 'pending',
    "gateway_message" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "power_banks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "station_id" UUID NOT NULL,
    "model" VARCHAR(100),
    "status" "power_bank_status_enum" NOT NULL DEFAULT 'available',
    "battery_level" INTEGER NOT NULL DEFAULT 100,
    "qr_code" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "power_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "power_bank_id" UUID NOT NULL,
    "pickup_station_id" UUID NOT NULL,
    "coupon_id" UUID,
    "payment_method_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMPTZ(6),
    "estimated_duration_hours" INTEGER NOT NULL,
    "actual_duration_hours" DECIMAL(5,2),
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "estimated_cost" DECIMAL(10,2) NOT NULL,
    "final_cost" DECIMAL(10,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "discount_applied" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "rental_status_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "zone" VARCHAR(100),
    "address" VARCHAR(200) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "total_capacity" INTEGER NOT NULL DEFAULT 0,
    "status" "station_status_enum" NOT NULL DEFAULT 'online',
    "description" TEXT,
    "opening_time" TIME(6),
    "closing_time" TIME(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150),
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255),
    "country" VARCHAR(80),
    "city" VARCHAR(80),
    "address" VARCHAR(200),
    "photo_url" VARCHAR(300),
    "rating" DECIMAL(2,1),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "accepted_policy" BOOLEAN NOT NULL DEFAULT false,
    "auth_provider" "auth_provider_enum" NOT NULL DEFAULT 'email',
    "auth_provider_id" VARCHAR(200),
    "status" "user_status_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "verification_token_type_enum" NOT NULL,
    "token" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupons_code" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupons_dates" ON "coupons"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_coupons_status" ON "coupons"("status");

-- CreateIndex
CREATE INDEX "idx_notifications_sent_at" ON "notifications"("sent_at");

-- CreateIndex
CREATE INDEX "idx_notifications_unread" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_notifications_user" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "idx_payment_methods_default" ON "payment_methods"("user_id", "is_default");

-- CreateIndex
CREATE INDEX "idx_payment_methods_status" ON "payment_methods"("status");

-- CreateIndex
CREATE INDEX "idx_payment_methods_user" ON "payment_methods"("user_id");

-- CreateIndex
CREATE INDEX "idx_payments_attempted_at" ON "payments"("attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payments_method" ON "payments"("payment_method_id");

-- CreateIndex
CREATE INDEX "idx_payments_rental" ON "payments"("rental_id");

-- CreateIndex
CREATE INDEX "idx_payments_status" ON "payments"("status");

-- CreateIndex
CREATE INDEX "idx_payments_user" ON "payments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_gateway_transaction" ON "payments"("gateway", "transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "power_banks_code_key" ON "power_banks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "power_banks_qr_code_key" ON "power_banks"("qr_code");

-- CreateIndex
CREATE INDEX "idx_power_banks_code" ON "power_banks"("code");

-- CreateIndex
CREATE INDEX "idx_power_banks_station" ON "power_banks"("station_id");

-- CreateIndex
CREATE INDEX "idx_power_banks_status" ON "power_banks"("status");

-- CreateIndex
CREATE INDEX "idx_rentals_active" ON "rentals"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_rentals_coupon" ON "rentals"("coupon_id");

-- CreateIndex
CREATE INDEX "idx_rentals_payment_method" ON "rentals"("payment_method_id");

-- CreateIndex
CREATE INDEX "idx_rentals_pickup_station" ON "rentals"("pickup_station_id");

-- CreateIndex
CREATE INDEX "idx_rentals_power_bank" ON "rentals"("power_bank_id");

-- CreateIndex
CREATE INDEX "idx_rentals_start_time" ON "rentals"("start_time");

-- CreateIndex
CREATE INDEX "idx_rentals_status" ON "rentals"("status");

-- CreateIndex
CREATE INDEX "idx_rentals_user" ON "rentals"("user_id");

-- CreateIndex
CREATE INDEX "idx_stations_city" ON "stations"("city");

-- CreateIndex
CREATE INDEX "idx_stations_coordinates" ON "stations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "idx_stations_status" ON "stations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "idx_users_auth" ON "users"("auth_provider", "auth_provider_id");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_phone" ON "users"("phone");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_verification_tokens_expiry" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "idx_verification_tokens_lookup" ON "verification_tokens"("user_id", "type", "token");

-- CreateIndex
CREATE INDEX "idx_verification_tokens_user" ON "verification_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notification_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "fk_payment_method_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payment_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payment_rental" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payment_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "power_banks" ADD CONSTRAINT "fk_power_bank_station" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "fk_rental_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "fk_rental_payment_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "fk_rental_pickup_station" FOREIGN KEY ("pickup_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "fk_rental_power_bank" FOREIGN KEY ("power_bank_id") REFERENCES "power_banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "fk_rental_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "fk_verification_token_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

