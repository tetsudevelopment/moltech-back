-- =============================================================================
-- MOLTECH Dev Seed — 6 Bogotá Stations + Power Banks
-- Idempotent: safe to run multiple times (ON CONFLICT DO UPDATE).
-- DO NOT delete the existing E2E test station row.
-- =============================================================================

-- Fixed UUIDs (deterministic, v4 format):
--   #1 MOLTECH Centro Andino         : af949262-4cdd-431c-994c-d81a307df134
--   #2 MOLTECH Parque de la 93       : aa53ce9a-f1f2-46e4-8953-ae60b58a9d7c
--   #3 MOLTECH Hacienda Santa Bárbara: 15a75fb6-7a97-4beb-9d26-2193356a1151
--   #4 MOLTECH Gran Estación         : 6e6755ba-aa85-4d39-8a8c-1f751ff9243d
--   #5 MOLTECH Plaza de Bolívar      : 5414cffd-3935-4c56-bf81-b32f9e17f519
--   #6 MOLTECH Titán Plaza           : 8efb9023-2e79-467e-891a-bf37c13193c2

-- -----------------------------------------------------------------------------
-- STATIONS
-- -----------------------------------------------------------------------------
INSERT INTO stations (
  id, name, city, zone, address,
  latitude, longitude,
  hourly_rate, currency,
  total_capacity, status,
  opening_time, closing_time
) VALUES
(
  'af949262-4cdd-431c-994c-d81a307df134',
  'MOLTECH Centro Andino', 'Bogotá', 'Chapinero', 'CC Andino, Cra 11 #82-01, Bogotá',
  4.6671000, -74.0540000,
  3000.00, 'COP',
  10, 'online',
  '06:00:00', '23:00:00'
),
(
  'aa53ce9a-f1f2-46e4-8953-ae60b58a9d7c',
  'MOLTECH Parque de la 93', 'Bogotá', 'Chapinero Alto', 'Parque de la 93, Cra 13 #93-40, Bogotá',
  4.6766000, -74.0488000,
  3000.00, 'COP',
  8, 'online',
  '06:00:00', '23:00:00'
),
(
  '15a75fb6-7a97-4beb-9d26-2193356a1151',
  'MOLTECH Hacienda Santa Bárbara', 'Bogotá', 'Usaquén', 'CC Hacienda Santa Bárbara, Cra 7 #115-60, Bogotá',
  4.7050000, -74.0307000,
  3000.00, 'COP',
  8, 'online',
  '06:00:00', '23:00:00'
),
(
  '6e6755ba-aa85-4d39-8a8c-1f751ff9243d',
  'MOLTECH Gran Estación', 'Bogotá', 'Salitre', 'CC Gran Estación, Av. El Dorado #65B-90, Bogotá',
  4.6486000, -74.0850000,
  3000.00, 'COP',
  10, 'offline',
  '06:00:00', '23:00:00'
),
(
  '5414cffd-3935-4c56-bf81-b32f9e17f519',
  'MOLTECH Plaza de Bolívar', 'Bogotá', 'La Candelaria', 'Plaza de Bolívar, Cra 8 #10-50, Bogotá',
  4.5981000, -74.0759000,
  3000.00, 'COP',
  6, 'maintenance',
  '06:00:00', '23:00:00'
),
(
  '8efb9023-2e79-467e-891a-bf37c13193c2',
  'MOLTECH Titán Plaza', 'Bogotá', 'Engativá', 'CC Titán Plaza, Av. Cali #10-60, Bogotá',
  4.6915000, -74.0844000,
  3000.00, 'COP',
  8, 'online',
  '06:00:00', '23:00:00'
)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  city           = EXCLUDED.city,
  zone           = EXCLUDED.zone,
  address        = EXCLUDED.address,
  latitude       = EXCLUDED.latitude,
  longitude      = EXCLUDED.longitude,
  hourly_rate    = EXCLUDED.hourly_rate,
  currency       = EXCLUDED.currency,
  total_capacity = EXCLUDED.total_capacity,
  status         = EXCLUDED.status,
  opening_time   = EXCLUDED.opening_time,
  closing_time   = EXCLUDED.closing_time;

-- -----------------------------------------------------------------------------
-- POWER BANKS
-- Codes are deterministic: PB-<ABBR>-<NN>, QR codes: QR-<ABBR>-<NN>
-- -----------------------------------------------------------------------------

-- Station #1 — Centro Andino: 7 available
INSERT INTO power_banks (code, station_id, model, status, battery_level, qr_code)
SELECT
  'PB-AND-' || LPAD(n::text, 2, '0'),
  'af949262-4cdd-431c-994c-d81a307df134',
  'MoltechPB-v1',
  'available',
  100,
  'QR-AND-' || LPAD(n::text, 2, '0')
FROM generate_series(1, 7) AS n
ON CONFLICT (code) DO UPDATE SET
  station_id = EXCLUDED.station_id,
  status     = EXCLUDED.status,
  qr_code    = EXCLUDED.qr_code;

-- Station #2 — Parque de la 93: 8 available
INSERT INTO power_banks (code, station_id, model, status, battery_level, qr_code)
SELECT
  'PB-P93-' || LPAD(n::text, 2, '0'),
  'aa53ce9a-f1f2-46e4-8953-ae60b58a9d7c',
  'MoltechPB-v1',
  'available',
  100,
  'QR-P93-' || LPAD(n::text, 2, '0')
FROM generate_series(1, 8) AS n
ON CONFLICT (code) DO UPDATE SET
  station_id = EXCLUDED.station_id,
  status     = EXCLUDED.status,
  qr_code    = EXCLUDED.qr_code;

-- Station #3 — Hacienda Santa Bárbara: 8 rented (0 available — full/all-out)
INSERT INTO power_banks (code, station_id, model, status, battery_level, qr_code)
SELECT
  'PB-HSB-' || LPAD(n::text, 2, '0'),
  '15a75fb6-7a97-4beb-9d26-2193356a1151',
  'MoltechPB-v1',
  'rented',
  100,
  'QR-HSB-' || LPAD(n::text, 2, '0')
FROM generate_series(1, 8) AS n
ON CONFLICT (code) DO UPDATE SET
  station_id = EXCLUDED.station_id,
  status     = EXCLUDED.status,
  qr_code    = EXCLUDED.qr_code;

-- Station #4 — Gran Estación: 5 available
INSERT INTO power_banks (code, station_id, model, status, battery_level, qr_code)
SELECT
  'PB-GES-' || LPAD(n::text, 2, '0'),
  '6e6755ba-aa85-4d39-8a8c-1f751ff9243d',
  'MoltechPB-v1',
  'available',
  100,
  'QR-GES-' || LPAD(n::text, 2, '0')
FROM generate_series(1, 5) AS n
ON CONFLICT (code) DO UPDATE SET
  station_id = EXCLUDED.station_id,
  status     = EXCLUDED.status,
  qr_code    = EXCLUDED.qr_code;

-- Station #5 — Plaza de Bolívar: 0 power banks (maintenance — nothing to seed)

-- Station #6 — Titán Plaza: 3 available
INSERT INTO power_banks (code, station_id, model, status, battery_level, qr_code)
SELECT
  'PB-TIT-' || LPAD(n::text, 2, '0'),
  '8efb9023-2e79-467e-891a-bf37c13193c2',
  'MoltechPB-v1',
  'available',
  100,
  'QR-TIT-' || LPAD(n::text, 2, '0')
FROM generate_series(1, 3) AS n
ON CONFLICT (code) DO UPDATE SET
  station_id = EXCLUDED.station_id,
  status     = EXCLUDED.status,
  qr_code    = EXCLUDED.qr_code;
