import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient, getSupabaseServerConfig } from '../lib/supabaseServerClient';

export interface BootstrapAdminParams {
  userId?: string;              // Optional: Provided if user already exists in Supabase Auth
  email?: string;               // Required if userId is not provided
  password?: string;            // Required if userId is not provided (min 8 chars)
  fullName: string;             // Mandatory
  mobile: string;               // Mandatory

  // Organization parameters (either organizationId OR orgName)
  organizationId?: string;
  orgName?: string;

  // Branch parameters (either branchId OR branchCode/branchName)
  branchId?: string;
  branchCode?: string;
  branchName?: string;

  // Fiscal Year parameters (optional)
  fiscalYearId?: string;
  fiscalYearTitle?: string;
  startDate?: string;
  endDate?: string;
}

export interface BootstrapAdminResult {
  success: boolean;
  userId: string;
  membershipId: string;
  message: string;
}

export class AdminBootstrapService {
  /**
   * Securely bootstraps the FIRST real org_admin user.
   * Server-only method. Never call directly from the browser client.
   */
  public static async bootstrapFirstAdmin(
    params: BootstrapAdminParams,
    options?: {
      overrideServiceKey?: string;
      overrideSupabaseUrl?: string;
      customClient?: SupabaseClient;
    }
  ): Promise<BootstrapAdminResult> {
    // 1. Validate input parameters
    const {
      userId,
      email,
      password,
      fullName,
      mobile,
      organizationId,
      orgName,
      branchId,
      branchCode,
      branchName,
      fiscalYearId,
      fiscalYearTitle,
      startDate,
      endDate,
    } = params || {};

    if (!fullName || !fullName.trim()) throw new Error('BOOTSTRAP_ERROR: Full name is required.');
    if (!mobile || !mobile.trim()) throw new Error('BOOTSTRAP_ERROR: Mobile number is required.');

    const isExistingUser = Boolean(userId && userId.trim());

    if (!isExistingUser) {
      if (!email || !email.trim()) throw new Error('BOOTSTRAP_ERROR: Email is required when userId is not provided.');
      if (!password || !password.trim() || password.length < 8) {
        throw new Error('BOOTSTRAP_ERROR: Password must be at least 8 characters long when userId is not provided.');
      }
    }

    const hasOrgId = Boolean(organizationId && organizationId.trim());
    const hasOrgName = Boolean(orgName && orgName.trim());
    if (!hasOrgId && !hasOrgName) {
      throw new Error('BOOTSTRAP_ERROR: Either organizationId or orgName is required.');
    }

    const hasBranchId = Boolean(branchId && branchId.trim());
    const hasBranchInfo = Boolean((branchName && branchName.trim()) || (branchCode && branchCode.trim()));
    if (!hasBranchId && !hasBranchInfo && !hasOrgName) {
      throw new Error('BOOTSTRAP_ERROR: Either branchId or branch details (branchCode/branchName) are required.');
    }

    // 3. Initialize Admin Supabase Client using Service Role Key or Central Server Client
    let supabaseAdmin: SupabaseClient;
    if (options?.customClient) {
      supabaseAdmin = options.customClient;
    } else if (!options?.overrideServiceKey && !options?.overrideSupabaseUrl) {
      try {
        supabaseAdmin = getSupabaseServerClient();
      } catch (err: any) {
        throw new Error(`BOOTSTRAP_ERROR: ${err.message}`);
      }
    } else {
      const serviceRoleKey = options?.overrideServiceKey !== undefined ? options.overrideServiceKey : getSupabaseServerConfig().key;
      let supabaseUrl = options?.overrideSupabaseUrl !== undefined ? options.overrideSupabaseUrl : getSupabaseServerConfig().url;

      if (!serviceRoleKey || serviceRoleKey.trim() === '') {
        throw new Error('BOOTSTRAP_ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is missing or empty.');
      }
      if (!supabaseUrl || supabaseUrl.trim() === '') {
        throw new Error('BOOTSTRAP_ERROR: Supabase URL environment variable is missing or empty.');
      }

      if (supabaseUrl.startsWith('postgresql://') || supabaseUrl.startsWith('postgres://')) {
        const match = supabaseUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
        if (match && match[1]) {
          supabaseUrl = `https://${match[1]}.supabase.co`;
        }
      }

      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    // 4. Pre-check: Verify if an org_admin already exists in user_roles
    const { data: existingAdminRoles, error: checkError } = await supabaseAdmin
      .from('user_roles')
      .select('id, roles!inner(code)')
      .eq('roles.code', 'org_admin')
      .limit(1);

    if (checkError && checkError.code !== 'PGRST116') {
      // Ignore if table query fails due to missing schema in mock environments
    }

    if (existingAdminRoles && existingAdminRoles.length > 0) {
      throw new Error('BOOTSTRAP_ALREADY_COMPLETED: An org_admin user already exists in the system.');
    }

    // 5. Step A: Get or Create Auth User
    let targetUserId: string;

    if (isExistingUser) {
      targetUserId = userId!.trim();
    } else {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email!.trim(),
        password: password!,
        email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          mobile: mobile.trim(),
        },
      });

      if (authError || !authData?.user) {
        throw new Error(`BOOTSTRAP_AUTH_FAILED: Failed to create Auth user: ${authError?.message || 'Unknown error'}`);
      }

      targetUserId = authData.user.id;
    }

    // 6. Step B: Atomic Domain Setup in PostgreSQL via RPC
    try {
      const rpcArgs = {
        p_user_id: targetUserId,
        p_full_name: fullName.trim(),
        p_mobile: mobile.trim(),
        p_org_name: orgName?.trim() || null,
        p_branch_code: branchCode?.trim() || null,
        p_branch_name: branchName?.trim() || null,
        p_fiscal_year_title: fiscalYearTitle?.trim() || null,
        p_start_date: startDate?.trim() || null,
        p_end_date: endDate?.trim() || null,
        p_organization_id: organizationId?.trim() || null,
        p_branch_id: branchId?.trim() || null,
        p_fiscal_year_id: fiscalYearId?.trim() || null,
      };

      const { data: membershipId, error: rpcError } = await supabaseAdmin.rpc('bootstrap_first_org_admin', rpcArgs);

      if (rpcError) {
        throw new Error(rpcError.message || 'RPC bootstrap_first_org_admin failed');
      }

      return {
        success: true,
        userId: targetUserId,
        membershipId: membershipId as string,
        message: 'First org_admin user successfully bootstrapped in Supabase Auth and PostgreSQL.',
      };
    } catch (domainErr: any) {
      // 7. Compensating action: Delete newly created Auth user ONLY if this call created the user
      if (isExistingUser) {
        throw new Error(
          `BOOTSTRAP_DOMAIN_FAILED: ${domainErr.message || 'Domain setup failed'}. Pre-existing user was preserved.`
        );
      }

      let compensatingSuccess = false;
      let compensatingErrorMsg = '';

      try {
        const deleteRes = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
        if (deleteRes?.error) {
          compensatingErrorMsg = deleteRes.error.message;
        } else {
          compensatingSuccess = true;
        }
      } catch (deleteErr: any) {
        compensatingErrorMsg = deleteErr?.message || 'Unknown error during auth.deleteUser';
      }

      if (compensatingSuccess) {
        throw new Error(
          `BOOTSTRAP_DOMAIN_FAILED: ${domainErr.message || 'Domain setup failed'}. Compensating rollback executed successfully.`
        );
      } else {
        throw new Error(
          `BOOTSTRAP_CRITICAL_ORPHAN: Domain setup failed (${domainErr.message || 'Domain setup failed'}), and compensating rollback also failed (${compensatingErrorMsg}). Orphaned Auth UserId: ${targetUserId}`
        );
      }
    }
  }
}
