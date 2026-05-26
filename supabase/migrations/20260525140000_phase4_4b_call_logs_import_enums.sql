-- =============================================
-- phase4_4b_call_logs_import_enums
-- Prepara enums requeridos por Fase 4.4B en una
-- transaccion previa para permitir su uso seguro.
-- =============================================

alter type public.import_type add value if not exists 'call_logs_import';