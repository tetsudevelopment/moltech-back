-- ============================================================================
-- MOLTECH initial schema (reconstructed from moltech_dbdiagram.dbml)
-- Source of truth: moltech_app/database/moltech_dbdiagram.dbml
-- The original moltech_app/database/moltech_schema_v2.sql is PARTIAL (only `pagos`);
-- this file is the full schema for the v2 baseline.
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

CREATE TYPE usuario_estado_enum AS ENUM (
    'activo',
    'suspendido',
    'inactivo'
);

CREATE TYPE estacion_estado_enum AS ENUM (
    'en_linea',
    'fuera_de_linea',
    'mantenimiento'
);

CREATE TYPE powerbank_estado_enum AS ENUM (
    'disponible',
    'alquilado',
    'cargando',
    'dañado',
    'retirado'
);

CREATE TYPE alquiler_estado_enum AS ENUM (
    'activo',
    'finalizado',
    'cancelado',
    'penalizado'
);

CREATE TYPE metodo_pago_tipo_enum AS ENUM (
    'visa',
    'mastercard',
    'amex',
    'dinersclub',
    'otro'
);

CREATE TYPE metodo_pago_estado_enum AS ENUM (
    'activo',
    'vencida',
    'eliminada'
);

CREATE TYPE cupon_tipo_enum AS ENUM (
    'porcentaje',
    'valor_fijo'
);

CREATE TYPE cupon_estado_enum AS ENUM (
    'activo',
    'vencido',
    'desactivado'
);

CREATE TYPE notif_tipo_enum AS ENUM (
    'promocion',
    'alquiler',
    'pago',
    'sistema'
);

CREATE TYPE token_tipo_enum AS ENUM (
    'email',
    'whatsapp',
    'reset_password'
);

CREATE TYPE pago_estado_enum AS ENUM (
    'pendiente',
    'aprobado',
    'rechazado',
    'reembolsado',
    'error'
);

CREATE TYPE pago_concepto_enum AS ENUM (
    'alquiler',
    'penalizacion',
    'reembolso'
);

CREATE TYPE pasarela_enum AS ENUM (
    'wompi',
    'payu',
    'mercadopago',
    'stripe',
    'otro'
);

-- ============================================================================
-- TABLES (9) — dependency order: referenced tables first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: usuarios
-- Usuarios del sistema. Email o teléfono obligatorio (al menos uno).
-- ----------------------------------------------------------------------------

CREATE TABLE usuarios (
    id                  UUID                NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    nombres             VARCHAR(100)        NOT NULL,
    apellidos           VARCHAR(100)        NOT NULL,
    email               VARCHAR(150)        UNIQUE,
    telefono            VARCHAR(20)         UNIQUE,
    password_hash       VARCHAR(255),
    pais                VARCHAR(80),
    ciudad              VARCHAR(80),
    direccion           VARCHAR(200),
    foto_url            VARCHAR(300),
    calificacion        DECIMAL(2,1),
    email_verificado    BOOLEAN             NOT NULL DEFAULT FALSE,
    telefono_verificado BOOLEAN             NOT NULL DEFAULT FALSE,
    acepta_politica     BOOLEAN             NOT NULL DEFAULT FALSE,
    auth_provider       auth_provider_enum  NOT NULL DEFAULT 'email',
    auth_provider_id    VARCHAR(200),
    estado              usuario_estado_enum NOT NULL DEFAULT 'activo',
    fecha_registro      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usuarios_password_email
        CHECK (auth_provider <> 'email' OR password_hash IS NOT NULL),
    CONSTRAINT chk_usuarios_calificacion
        CHECK (calificacion IS NULL OR (calificacion >= 0 AND calificacion <= 5))
);

COMMENT ON TABLE  usuarios IS 'Usuarios del sistema. Email o teléfono obligatorio (al menos uno).';
COMMENT ON COLUMN usuarios.calificacion IS 'Nullable - calificaciones en v2';

-- ----------------------------------------------------------------------------
-- TABLE: estaciones
-- Puntos físicos de retiro y devolución de power banks.
-- ----------------------------------------------------------------------------

CREATE TABLE estaciones (
    id               UUID                 NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre           VARCHAR(150)         NOT NULL,
    ciudad           VARCHAR(80)          NOT NULL,
    zona             VARCHAR(100),
    direccion        VARCHAR(200)         NOT NULL,
    latitud          DECIMAL(10,7)        NOT NULL,
    longitud         DECIMAL(10,7)        NOT NULL,
    tarifa_por_hora  DECIMAL(10,2)        NOT NULL,
    moneda           VARCHAR(10)          NOT NULL DEFAULT 'COP',
    capacidad_total  INTEGER              NOT NULL DEFAULT 0,
    estado           estacion_estado_enum NOT NULL DEFAULT 'en_linea',
    descripcion      TEXT,
    horario_apertura TIME,
    horario_cierre   TIME,
    fecha_creacion   TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- TABLE: power_banks
-- Dispositivos de carga portátil disponibles para alquiler.
-- ----------------------------------------------------------------------------

CREATE TABLE power_banks (
    id                   UUID                 NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo               VARCHAR(20)          NOT NULL UNIQUE,
    estacion_id          UUID                 NOT NULL,
    modelo               VARCHAR(100),
    estado               powerbank_estado_enum NOT NULL DEFAULT 'disponible',
    nivel_bateria        INTEGER              NOT NULL DEFAULT 100,
    qr_code              VARCHAR(300)         NOT NULL UNIQUE,
    fecha_creacion       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    ultima_actualizacion TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_powerbank_estacion
        FOREIGN KEY (estacion_id) REFERENCES estaciones (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_powerbank_nivel_bateria
        CHECK (nivel_bateria >= 0 AND nivel_bateria <= 100)
);

-- ----------------------------------------------------------------------------
-- TABLE: cupones
-- Cupones de descuento aplicables a alquileres.
-- ----------------------------------------------------------------------------

CREATE TABLE cupones (
    id              UUID              NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          VARCHAR(50)       NOT NULL UNIQUE,
    descripcion     VARCHAR(200),
    tipo_descuento  cupon_tipo_enum   NOT NULL,
    valor_descuento DECIMAL(10,2)     NOT NULL,
    fecha_inicio    TIMESTAMPTZ       NOT NULL,
    fecha_fin       TIMESTAMPTZ       NOT NULL,
    usos_maximos    INTEGER,
    usos_actuales   INTEGER           NOT NULL DEFAULT 0,
    estado          cupon_estado_enum NOT NULL DEFAULT 'activo',

    CONSTRAINT chk_cupon_fechas
        CHECK (fecha_fin > fecha_inicio),
    CONSTRAINT chk_cupon_usos
        CHECK (usos_actuales >= 0),
    CONSTRAINT chk_cupon_valor
        CHECK (valor_descuento > 0)
);

-- ----------------------------------------------------------------------------
-- TABLE: metodos_pago
-- Métodos de pago tokenizados de los usuarios (sin datos PCI).
-- ----------------------------------------------------------------------------

CREATE TABLE metodos_pago (
    id                UUID                    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id        UUID                    NOT NULL,
    tipo              metodo_pago_tipo_enum   NOT NULL,
    nombre_titular    VARCHAR(150)            NOT NULL,
    ultimos_4_digitos CHAR(4)                 NOT NULL,
    mes_vencimiento   SMALLINT                NOT NULL,
    anio_vencimiento  SMALLINT                NOT NULL,
    es_predeterminada BOOLEAN                 NOT NULL DEFAULT FALSE,
    token_pasarela    VARCHAR(300)            NOT NULL,
    estado            metodo_pago_estado_enum NOT NULL DEFAULT 'activo',
    fecha_creacion    TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_metodo_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_metodo_mes
        CHECK (mes_vencimiento BETWEEN 1 AND 12),
    CONSTRAINT chk_metodo_anio
        CHECK (anio_vencimiento BETWEEN 0 AND 99)
);

COMMENT ON COLUMN metodos_pago.mes_vencimiento  IS '1-12';
COMMENT ON COLUMN metodos_pago.anio_vencimiento IS '0-99 (ej: 28 para 2028)';
COMMENT ON COLUMN metodos_pago.token_pasarela   IS 'Token de la pasarela, no datos PCI';

-- ----------------------------------------------------------------------------
-- TABLE: alquileres
-- Evento completo de alquiler: desde retiro hasta devolución en la misma estación.
-- ----------------------------------------------------------------------------

CREATE TABLE alquileres (
    id                      UUID                 NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id              UUID                 NOT NULL,
    power_bank_id           UUID                 NOT NULL,
    estacion_retiro_id      UUID                 NOT NULL,
    cupon_id                UUID,
    metodo_pago_id          UUID                 NOT NULL,
    hora_inicio             TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    hora_fin                TIMESTAMPTZ,
    duracion_horas_estimada INTEGER              NOT NULL,
    duracion_horas_real     DECIMAL(5,2),
    tarifa_hora             DECIMAL(10,2)        NOT NULL,
    costo_estimado          DECIMAL(10,2)        NOT NULL,
    costo_final             DECIMAL(10,2),
    moneda                  VARCHAR(10)          NOT NULL DEFAULT 'COP',
    descuento_aplicado      DECIMAL(10,2)        NOT NULL DEFAULT 0,
    penalizacion            DECIMAL(10,2)        NOT NULL DEFAULT 0,
    estado                  alquiler_estado_enum NOT NULL DEFAULT 'activo',
    fecha_creacion          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_alquiler_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_alquiler_powerbank
        FOREIGN KEY (power_bank_id) REFERENCES power_banks (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_alquiler_estacion_retiro
        FOREIGN KEY (estacion_retiro_id) REFERENCES estaciones (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_alquiler_cupon
        FOREIGN KEY (cupon_id) REFERENCES cupones (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_alquiler_metodo_pago
        FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_alquiler_horas_validas
        CHECK (hora_fin IS NULL OR hora_fin > hora_inicio),
    CONSTRAINT chk_alquiler_costo_final
        CHECK (costo_final IS NULL OR costo_final >= 0),
    CONSTRAINT chk_alquiler_descuento
        CHECK (descuento_aplicado >= 0),
    CONSTRAINT chk_alquiler_penalizacion
        CHECK (penalizacion >= 0)
);

COMMENT ON TABLE  alquileres IS 'Devolución en la misma estación de retiro (sin estación de devolución separada).';
COMMENT ON COLUMN alquileres.estacion_retiro_id IS 'Devolución en la misma estación';

-- ----------------------------------------------------------------------------
-- TABLE: pagos
-- Trazabilidad de intentos de cobro contra la pasarela externa.
-- No almacena datos sensibles (PCI), solo la referencia de transacción.
-- Un alquiler puede tener varios pagos (alquiler + penalización + reembolso).
-- ----------------------------------------------------------------------------

CREATE TABLE pagos (
    id                  UUID               NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    alquiler_id         UUID               NOT NULL,
    usuario_id          UUID               NOT NULL,
    metodo_pago_id      UUID,
    concepto            pago_concepto_enum NOT NULL DEFAULT 'alquiler',
    monto               DECIMAL(10,2)      NOT NULL,
    moneda              VARCHAR(10)        NOT NULL DEFAULT 'COP',
    pasarela            pasarela_enum      NOT NULL,
    transaccion_id      VARCHAR(200)       NOT NULL,
    merchant_id         VARCHAR(200),
    estado              pago_estado_enum   NOT NULL DEFAULT 'pendiente',
    mensaje_pasarela    TEXT,
    fecha_intento       TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_pago_pasarela_transaccion
        UNIQUE (pasarela, transaccion_id),
    CONSTRAINT fk_pago_alquiler
        FOREIGN KEY (alquiler_id) REFERENCES alquileres (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_pago_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_pago_metodo
        FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_pago_monto
        CHECK (monto >= 0)
);

COMMENT ON COLUMN pagos.transaccion_id IS 'ID que devuelve la pasarela';
COMMENT ON COLUMN pagos.merchant_id    IS 'ID del merchant en la pasarela';

-- ----------------------------------------------------------------------------
-- TABLE: notificaciones
-- Notificaciones in-app enviadas a usuarios.
-- ----------------------------------------------------------------------------

CREATE TABLE notificaciones (
    id          UUID            NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID            NOT NULL,
    titulo      VARCHAR(150)    NOT NULL,
    cuerpo      TEXT            NOT NULL,
    tipo        notif_tipo_enum NOT NULL DEFAULT 'sistema',
    leida       BOOLEAN         NOT NULL DEFAULT FALSE,
    fecha_envio TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_notif_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ----------------------------------------------------------------------------
-- TABLE: tokens_verificacion
-- Tokens OTP de corta vida para verificación de email, WhatsApp y reset de password.
-- ----------------------------------------------------------------------------

CREATE TABLE tokens_verificacion (
    id             UUID            NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id     UUID            NOT NULL,
    tipo           token_tipo_enum NOT NULL,
    token          VARCHAR(10)     NOT NULL,
    expira_en      TIMESTAMPTZ     NOT NULL,
    usado          BOOLEAN         NOT NULL DEFAULT FALSE,
    fecha_creacion TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_token_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ============================================================================
-- INDICES
-- ============================================================================

-- usuarios
CREATE INDEX idx_usuarios_email    ON usuarios (email);
CREATE INDEX idx_usuarios_telefono ON usuarios (telefono);
CREATE INDEX idx_usuarios_estado   ON usuarios (estado);
CREATE INDEX idx_usuarios_auth     ON usuarios (auth_provider, auth_provider_id);

-- estaciones
CREATE INDEX idx_estaciones_ciudad       ON estaciones (ciudad);
CREATE INDEX idx_estaciones_estado       ON estaciones (estado);
CREATE INDEX idx_estaciones_coordenadas  ON estaciones (latitud, longitud);

-- power_banks
CREATE INDEX idx_powerbanks_estacion ON power_banks (estacion_id);
CREATE INDEX idx_powerbanks_estado   ON power_banks (estado);
CREATE INDEX idx_powerbanks_codigo   ON power_banks (codigo);

-- cupones
CREATE INDEX idx_cupones_codigo ON cupones (codigo);
CREATE INDEX idx_cupones_estado ON cupones (estado);
CREATE INDEX idx_cupones_fechas ON cupones (fecha_inicio, fecha_fin);

-- metodos_pago
CREATE INDEX idx_metodos_usuario        ON metodos_pago (usuario_id);
CREATE INDEX idx_metodos_estado         ON metodos_pago (estado);
CREATE INDEX idx_metodos_predeterminada ON metodos_pago (usuario_id, es_predeterminada);

-- alquileres
CREATE INDEX idx_alquileres_usuario         ON alquileres (usuario_id);
CREATE INDEX idx_alquileres_powerbank       ON alquileres (power_bank_id);
CREATE INDEX idx_alquileres_estacion_retiro ON alquileres (estacion_retiro_id);
CREATE INDEX idx_alquileres_estado          ON alquileres (estado);
CREATE INDEX idx_alquileres_fecha           ON alquileres (hora_inicio);
CREATE INDEX idx_alquileres_activos         ON alquileres (usuario_id, estado);
CREATE INDEX idx_alquileres_metodo_pago     ON alquileres (metodo_pago_id);
CREATE INDEX idx_alquileres_cupon           ON alquileres (cupon_id);

-- pagos
CREATE INDEX idx_pagos_alquiler   ON pagos (alquiler_id);
CREATE INDEX idx_pagos_usuario    ON pagos (usuario_id);
CREATE INDEX idx_pagos_metodo     ON pagos (metodo_pago_id);
CREATE INDEX idx_pagos_estado     ON pagos (estado);
CREATE INDEX idx_pagos_fecha      ON pagos (fecha_intento DESC);
CREATE INDEX idx_pagos_pendientes ON pagos (alquiler_id, estado)
    WHERE estado IN ('pendiente', 'error');

-- notificaciones
CREATE INDEX idx_notif_usuario   ON notificaciones (usuario_id);
CREATE INDEX idx_notif_no_leidas ON notificaciones (usuario_id, leida);
CREATE INDEX idx_notif_fecha     ON notificaciones (fecha_envio);

-- tokens_verificacion
CREATE INDEX idx_tokens_usuario ON tokens_verificacion (usuario_id);
CREATE INDEX idx_tokens_lookup  ON tokens_verificacion (usuario_id, tipo, token);
CREATE INDEX idx_tokens_expira  ON tokens_verificacion (expira_en);

-- ============================================================================
-- TRIGGERS — updated_at / fecha_actualizacion maintenance
-- ============================================================================

-- power_banks: ultima_actualizacion
CREATE OR REPLACE FUNCTION fn_update_power_bank_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.ultima_actualizacion = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_power_bank_updated
    BEFORE UPDATE ON power_banks
    FOR EACH ROW EXECUTE FUNCTION fn_update_power_bank_timestamp();

-- pagos: fecha_actualizacion
CREATE OR REPLACE FUNCTION fn_update_pago_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.fecha_actualizacion = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pago_updated
    BEFORE UPDATE ON pagos
    FOR EACH ROW EXECUTE FUNCTION fn_update_pago_timestamp();
