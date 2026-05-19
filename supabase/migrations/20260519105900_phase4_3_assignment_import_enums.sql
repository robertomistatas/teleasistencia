-- =============================================
-- phase4_3_assignment_import_enums
-- Prepara enums requeridos por Fase 4.3 en una
-- transaccion previa para permitir su uso seguro.
-- =============================================

alter type public.import_type add value if not exists 'assignment_import';

alter type public.import_row_result_status add value if not exists 'reassigned';