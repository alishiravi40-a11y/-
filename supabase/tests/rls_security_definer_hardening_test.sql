-- LOCAL TEST ONLY
-- DO NOT RUN AGAINST PRODUCTION OR ANY LINKED REMOTE PROJECT

BEGIN;

-- Load pgTAP extension if available
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Plan exactly 93 tests
SELECT plan(93);

-- ==============================================================================
-- 1. CHEQUES TABLE AUDIT (13 Assertions)
-- ==============================================================================

-- 1. Table exists
SELECT has_table('public', 'cheques', 'Table public.cheques must exist');

-- 2. RLS enabled
SELECT results_eq(
    'SELECT rowsecurity FROM pg_tables WHERE schemaname = ''public'' AND tablename = ''cheques'';'::text,
    ARRAY[true]::text,
    'RLS must be enabled on public.cheques'
);

-- 3. No open policy with USING (true)
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''cheques'' AND pg_get_expr(p.polqual, p.polrelid) ILIKE ''%true%'';',
    'No open policy with USING (true) on public.cheques'
);

-- 4. No open policy with WITH CHECK (true)
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''cheques'' AND pg_get_expr(p.polwithcheck, p.polrelid) ILIKE ''%true%'';',
    'No open policy with WITH CHECK (true) on public.cheques'
);

-- 5. No policy FOR ALL for anon or authenticated
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''cheques'' AND p.polcmd = ''*'' AND (ARRAY[''anon'', ''authenticated''] && (SELECT array_agg(rolname::text) FROM pg_roles WHERE oid = ANY(p.polroles)));',
    'No policy FOR ALL for anon or authenticated on public.cheques'
);

-- 6-9. Role anon privileges (None)
SELECT ok(NOT has_table_privilege('anon', 'public.cheques', 'SELECT'), 'Role anon must NOT have SELECT privilege on public.cheques');
SELECT ok(NOT has_table_privilege('anon', 'public.cheques', 'INSERT'), 'Role anon must NOT have INSERT privilege on public.cheques');
SELECT ok(NOT has_table_privilege('anon', 'public.cheques', 'UPDATE'), 'Role anon must NOT have UPDATE privilege on public.cheques');
SELECT ok(NOT has_table_privilege('anon', 'public.cheques', 'DELETE'), 'Role anon must NOT have DELETE privilege on public.cheques');

-- 10-13. Role authenticated privileges (None)
SELECT ok(NOT has_table_privilege('authenticated', 'public.cheques', 'SELECT'), 'Role authenticated must NOT have SELECT privilege on public.cheques');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cheques', 'INSERT'), 'Role authenticated must NOT have INSERT privilege on public.cheques');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cheques', 'UPDATE'), 'Role authenticated must NOT have UPDATE privilege on public.cheques');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cheques', 'DELETE'), 'Role authenticated must NOT have DELETE privilege on public.cheques');

-- ==============================================================================
-- 2. ORDER_INVOICE_CONVERSIONS TABLE AUDIT (13 Assertions)
-- ==============================================================================

-- 14. Table exists
SELECT has_table('public', 'order_invoice_conversions', 'Table public.order_invoice_conversions must exist');

-- 15. RLS enabled
SELECT results_eq(
    'SELECT rowsecurity FROM pg_tables WHERE schemaname = ''public'' AND tablename = ''order_invoice_conversions'';'::text,
    ARRAY[true]::text,
    'RLS must be enabled on public.order_invoice_conversions'
);

-- 16. No open policy with USING (true)
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''order_invoice_conversions'' AND pg_get_expr(p.polqual, p.polrelid) ILIKE ''%true%'';',
    'No open policy with USING (true) on public.order_invoice_conversions'
);

-- 17. No open policy with WITH CHECK (true)
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''order_invoice_conversions'' AND pg_get_expr(p.polwithcheck, p.polrelid) ILIKE ''%true%'';',
    'No open policy with WITH CHECK (true) on public.order_invoice_conversions'
);

-- 18. No policy FOR ALL for anon or authenticated
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname = ''order_invoice_conversions'' AND p.polcmd = ''*'' AND (ARRAY[''anon'', ''authenticated''] && (SELECT array_agg(rolname::text) FROM pg_roles WHERE oid = ANY(p.polroles)));',
    'No policy FOR ALL for anon or authenticated on public.order_invoice_conversions'
);

-- 19-22. Role anon privileges (None)
SELECT ok(NOT has_table_privilege('anon', 'public.order_invoice_conversions', 'SELECT'), 'Role anon must NOT have SELECT privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('anon', 'public.order_invoice_conversions', 'INSERT'), 'Role anon must NOT have INSERT privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('anon', 'public.order_invoice_conversions', 'UPDATE'), 'Role anon must NOT have UPDATE privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('anon', 'public.order_invoice_conversions', 'DELETE'), 'Role anon must NOT have DELETE privilege on public.order_invoice_conversions');

-- 23-26. Role authenticated privileges (None)
SELECT ok(NOT has_table_privilege('authenticated', 'public.order_invoice_conversions', 'SELECT'), 'Role authenticated must NOT have SELECT privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.order_invoice_conversions', 'INSERT'), 'Role authenticated must NOT have INSERT privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.order_invoice_conversions', 'UPDATE'), 'Role authenticated must NOT have UPDATE privilege on public.order_invoice_conversions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.order_invoice_conversions', 'DELETE'), 'Role authenticated must NOT have DELETE privilege on public.order_invoice_conversions');

-- ==============================================================================
-- 3. FUNCTION 1: get_next_invoice_number (9 Assertions)
-- ==============================================================================

-- 27. Function exists with signature
SELECT has_function(
    'public',
    'get_next_invoice_number',
    ARRAY['uuid'],
    'Function public.get_next_invoice_number(UUID) must exist'
);

-- 28. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''get_next_invoice_number'';'::text,
    ARRAY[true]::text,
    'Function get_next_invoice_number must be SECURITY DEFINER'
);

-- 29. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''get_next_invoice_number'';'::text,
    ARRAY[true]::text,
    'Function get_next_invoice_number must have search_path set to empty string'
);

-- 30. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''get_next_invoice_number'';'::text,
    ARRAY[false]::text,
    'Function get_next_invoice_number must NOT contain pg_temp in configuration'
);

-- 31. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.get_next_invoice_number(uuid)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on get_next_invoice_number');

-- 32. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_next_invoice_number(uuid)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on get_next_invoice_number');

-- 33. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.get_next_invoice_number(uuid)', 'EXECUTE'), 'Role service_role must have EXECUTE on get_next_invoice_number');

-- 34. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''get_next_invoice_number'';'::text,
    ARRAY[false]::text,
    'Function get_next_invoice_number must NOT grant EXECUTE to PUBLIC'
);

-- 35. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''get_next_invoice_number'';'::text,
    ARRAY[false]::text,
    'Function get_next_invoice_number body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 4. FUNCTION 2: create_cheque_atomic (9 Assertions)
-- ==============================================================================

-- 36. Function exists with signature
SELECT has_function(
    'public',
    'create_cheque_atomic',
    ARRAY['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'numeric', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
    'Function public.create_cheque_atomic must exist with exact signature'
);

-- 37. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function create_cheque_atomic must be SECURITY DEFINER'
);

-- 38. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function create_cheque_atomic must have search_path set to empty string'
);

-- 39. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_cheque_atomic must NOT contain pg_temp in configuration'
);

-- 40. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.create_cheque_atomic(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on create_cheque_atomic');

-- 41. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.create_cheque_atomic(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on create_cheque_atomic');

-- 42. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.create_cheque_atomic(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE'), 'Role service_role must have EXECUTE on create_cheque_atomic');

-- 43. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_cheque_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 44. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_cheque_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 5. FUNCTION 3: transition_cheque_atomic (9 Assertions)
-- ==============================================================================

-- 45. Function exists with signature
SELECT has_function(
    'public',
    'transition_cheque_atomic',
    ARRAY['uuid', 'text', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'uuid', 'text', 'uuid'],
    'Function public.transition_cheque_atomic must exist with exact signature'
);

-- 46. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''transition_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function transition_cheque_atomic must be SECURITY DEFINER'
);

-- 47. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''transition_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function transition_cheque_atomic must have search_path set to empty string'
);

-- 48. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''transition_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function transition_cheque_atomic must NOT contain pg_temp in configuration'
);

-- 49. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.transition_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, uuid, text, uuid)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on transition_cheque_atomic');

-- 50. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.transition_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, uuid, text, uuid)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on transition_cheque_atomic');

-- 51. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.transition_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, uuid, text, uuid)', 'EXECUTE'), 'Role service_role must have EXECUTE on transition_cheque_atomic');

-- 52. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''transition_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function transition_cheque_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 53. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''transition_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function transition_cheque_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 6. FUNCTION 4: edit_cheque_atomic (9 Assertions)
-- ==============================================================================

-- 54. Function exists with signature
SELECT has_function(
    'public',
    'edit_cheque_atomic',
    ARRAY['uuid', 'text', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text'],
    'Function public.edit_cheque_atomic must exist with exact signature'
);

-- 55. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''edit_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function edit_cheque_atomic must be SECURITY DEFINER'
);

-- 56. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''edit_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function edit_cheque_atomic must have search_path set to empty string'
);

-- 57. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''edit_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function edit_cheque_atomic must NOT contain pg_temp in configuration'
);

-- 58. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.edit_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, text, uuid, text, text, text, text, text)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on edit_cheque_atomic');

-- 59. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.edit_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, text, uuid, text, text, text, text, text)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on edit_cheque_atomic');

-- 60. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.edit_cheque_atomic(uuid, text, uuid, integer, text, text, text, text, text, uuid, text, text, text, text, text)', 'EXECUTE'), 'Role service_role must have EXECUTE on edit_cheque_atomic');

-- 61. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''edit_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function edit_cheque_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 62. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''edit_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function edit_cheque_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 7. FUNCTION 5: reverse_cheque_atomic (9 Assertions)
-- ==============================================================================

-- 63. Function exists with signature
SELECT has_function(
    'public',
    'reverse_cheque_atomic',
    ARRAY['uuid', 'text', 'uuid', 'integer', 'text', 'text', 'text'],
    'Function public.reverse_cheque_atomic must exist with exact signature'
);

-- 64. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''reverse_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function reverse_cheque_atomic must be SECURITY DEFINER'
);

-- 65. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''reverse_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function reverse_cheque_atomic must have search_path set to empty string'
);

-- 66. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''reverse_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function reverse_cheque_atomic must NOT contain pg_temp in configuration'
);

-- 67. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.reverse_cheque_atomic(uuid, text, uuid, integer, text, text, text)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on reverse_cheque_atomic');

-- 68. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.reverse_cheque_atomic(uuid, text, uuid, integer, text, text, text)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on reverse_cheque_atomic');

-- 69. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.reverse_cheque_atomic(uuid, text, uuid, integer, text, text, text)', 'EXECUTE'), 'Role service_role must have EXECUTE on reverse_cheque_atomic');

-- 70. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''reverse_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function reverse_cheque_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 71. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''reverse_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function reverse_cheque_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 8. FUNCTION 6: delete_cheque_atomic (9 Assertions)
-- ==============================================================================

-- 72. Function exists with signature
SELECT has_function(
    'public',
    'delete_cheque_atomic',
    ARRAY['uuid', 'uuid', 'integer', 'text', 'text'],
    'Function public.delete_cheque_atomic must exist with exact signature'
);

-- 73. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''delete_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function delete_cheque_atomic must be SECURITY DEFINER'
);

-- 74. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''delete_cheque_atomic'';'::text,
    ARRAY[true]::text,
    'Function delete_cheque_atomic must have search_path set to empty string'
);

-- 75. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''delete_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function delete_cheque_atomic must NOT contain pg_temp in configuration'
);

-- 76. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.delete_cheque_atomic(uuid, uuid, integer, text, text)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on delete_cheque_atomic');

-- 77. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.delete_cheque_atomic(uuid, uuid, integer, text, text)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on delete_cheque_atomic');

-- 78. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.delete_cheque_atomic(uuid, uuid, integer, text, text)', 'EXECUTE'), 'Role service_role must have EXECUTE on delete_cheque_atomic');

-- 79. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''delete_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function delete_cheque_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 80. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''delete_cheque_atomic'';'::text,
    ARRAY[false]::text,
    'Function delete_cheque_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 9. FUNCTION 7: create_invoice_with_cheques_atomic (9 Assertions)
-- ==============================================================================

-- 81. Function exists with signature
SELECT has_function(
    'public',
    'create_invoice_with_cheques_atomic',
    ARRAY['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'text', 'text', 'boolean', 'numeric', 'numeric', 'text', 'numeric', 'numeric', 'text', 'numeric', 'uuid', 'jsonb', 'jsonb', 'text', 'text'],
    'Function public.create_invoice_with_cheques_atomic must exist with exact signature'
);

-- 82. SECURITY DEFINER
SELECT results_eq(
    'SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_invoice_with_cheques_atomic'';'::text,
    ARRAY[true]::text,
    'Function create_invoice_with_cheques_atomic must be SECURITY DEFINER'
);

-- 83. search_path empty
SELECT results_eq(
    'SELECT ''search_path='' = ANY(p.proconfig) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_invoice_with_cheques_atomic'';'::text,
    ARRAY[true]::text,
    'Function create_invoice_with_cheques_atomic must have search_path set to empty string'
);

-- 84. pg_temp not present
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proconfig, '','') LIKE ''%pg_temp%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_invoice_with_cheques_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_invoice_with_cheques_atomic must NOT contain pg_temp in configuration'
);

-- 85. Execution not permitted for anon
SELECT ok(NOT has_function_privilege('anon', 'public.create_invoice_with_cheques_atomic(uuid, uuid, uuid, text, text, uuid, text, text, boolean, numeric, numeric, text, numeric, numeric, text, numeric, uuid, jsonb, jsonb, text, text)', 'EXECUTE'), 'Role anon must NOT have EXECUTE on create_invoice_with_cheques_atomic');

-- 86. Execution not permitted for authenticated
SELECT ok(NOT has_function_privilege('authenticated', 'public.create_invoice_with_cheques_atomic(uuid, uuid, uuid, text, text, uuid, text, text, boolean, numeric, numeric, text, numeric, numeric, text, numeric, uuid, jsonb, jsonb, text, text)', 'EXECUTE'), 'Role authenticated must NOT have EXECUTE on create_invoice_with_cheques_atomic');

-- 87. Execution permitted for service_role
SELECT ok(has_function_privilege('service_role', 'public.create_invoice_with_cheques_atomic(uuid, uuid, uuid, text, text, uuid, text, text, boolean, numeric, numeric, text, numeric, numeric, text, numeric, uuid, jsonb, jsonb, text, text)', 'EXECUTE'), 'Role service_role must have EXECUTE on create_invoice_with_cheques_atomic');

-- 88. PUBLIC does not have execution privilege in ACL
SELECT results_eq(
    'SELECT COALESCE(array_to_string(p.proacl, '','') LIKE ''%=X/%'', false) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_invoice_with_cheques_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_invoice_with_cheques_atomic must NOT grant EXECUTE to PUBLIC'
);

-- 89. No stub/mock keywords
SELECT results_eq(
    'SELECT pg_get_functiondef(p.oid) ~* ''\y(TODO|STUB|MOCK|PLACEHOLDER)\y'' FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ''public'' AND p.proname = ''create_invoice_with_cheques_atomic'';'::text,
    ARRAY[false]::text,
    'Function create_invoice_with_cheques_atomic body must not contain stub or placeholder markers'
);

-- ==============================================================================
-- 10. GENERAL ARCHITECTURAL & ACCESS AUDITS (4 Assertions)
-- ==============================================================================

-- 90. No policy on cheques or order_invoice_conversions references is_org_member
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname IN (''cheques'', ''order_invoice_conversions'') AND (pg_get_expr(p.polqual, p.polrelid) LIKE ''%is_org_member%'' OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE ''%is_org_member%'');',
    'No policies on target tables should reference is_org_member'
);

-- 91. service_role has table privileges on cheques
SELECT ok(has_table_privilege('service_role', 'public.cheques', 'SELECT, INSERT, UPDATE, DELETE'), 'Role service_role must have full table privileges on public.cheques');

-- 92. service_role has table privileges on order_invoice_conversions
SELECT ok(has_table_privilege('service_role', 'public.order_invoice_conversions', 'SELECT, INSERT, UPDATE, DELETE'), 'Role service_role must have full table privileges on public.order_invoice_conversions');

-- 93. No direct client RLS policies exist on target tables
SELECT is_empty(
    'SELECT polname FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = ''public'' AND c.relname IN (''cheques'', ''order_invoice_conversions'');',
    'No direct client RLS policies must exist on target tables'
);

-- Finish test suite and rollback any transactional metadata mutations
SELECT * FROM finish();
ROLLBACK;
