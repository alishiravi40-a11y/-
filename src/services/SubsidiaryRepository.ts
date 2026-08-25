import { SupabaseClient } from '@supabase/supabase-js';

export interface SubsidiaryRecord {
  id: string;
  organization_id: string;
  general_id: string;
  code: string;
  name: string;
  system_key?: string | null;
  is_active: boolean;
  is_system: boolean;
  requires_person: boolean;
  requires_cost_center: boolean;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSubsidiaryParams {
  organization_id: string;
  general_id: string;
  code: string;
  name: string;
  system_key?: string | null;
  is_active?: boolean;
  is_system?: boolean;
  requires_person?: boolean;
  requires_cost_center?: boolean;
  user_id: string;
}

export interface UpdateSubsidiaryParams {
  name?: string;
  is_active?: boolean;
  requires_person?: boolean;
  requires_cost_center?: boolean;
  user_id: string;
}

export class SubsidiaryRepository {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /**
   * Get a single subsidiary account by ID with strict organization isolation enforcement.
   */
  async getSubsidiaryById(subsidiaryId: string, organizationId: string): Promise<SubsidiaryRecord | null> {
    const { data, error } = await this.client
      .from('account_subsidiaries')
      .select('*')
      .eq('id', subsidiaryId)
      .eq('organization_id', organizationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to fetch subsidiary account: ${error.message}`);
    }

    return data as SubsidiaryRecord;
  }

  /**
   * Get list of subsidiary accounts for a specific organization with strict organization isolation.
   */
  async listSubsidiaries(organizationId: string): Promise<SubsidiaryRecord[]> {
    const { data, error } = await this.client
      .from('account_subsidiaries')
      .select('*')
      .eq('organization_id', organizationId)
      .order('code', { ascending: true });

    if (error) {
      throw new Error(`Failed to list subsidiary accounts: ${error.message}`);
    }

    return (data || []) as SubsidiaryRecord[];
  }

  /**
   * Create a new subsidiary account with uniqueness and organization enforcement.
   */
  async createSubsidiary(params: CreateSubsidiaryParams): Promise<SubsidiaryRecord> {
    // Check if code already exists within this organization
    const { data: existingCode } = await this.client
      .from('account_subsidiaries')
      .select('id')
      .eq('organization_id', params.organization_id)
      .eq('code', params.code)
      .single();

    if (existingCode) {
      throw new Error(`Duplicate business code error: Subsidiary account with code '${params.code}' already exists in this organization.`);
    }

    const { data, error } = await this.client
      .from('account_subsidiaries')
      .insert({
        organization_id: params.organization_id,
        general_id: params.general_id,
        code: params.code,
        name: params.name,
        system_key: params.system_key || null,
        is_active: params.is_active ?? true,
        is_system: params.is_system ?? false,
        requires_person: params.requires_person ?? false,
        requires_cost_center: params.requires_cost_center ?? false,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create subsidiary account: ${error.message}`);
    }

    return data as SubsidiaryRecord;
  }

  /**
   * Update an existing subsidiary account with strict organization isolation.
   */
  async updateSubsidiary(subsidiaryId: string, organizationId: string, params: UpdateSubsidiaryParams): Promise<SubsidiaryRecord> {
    const existing = await this.getSubsidiaryById(subsidiaryId, organizationId);
    if (!existing) {
      throw new Error('Subsidiary account not found or access denied due to organization isolation.');
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (params.name !== undefined) updatePayload.name = params.name;
    if (params.is_active !== undefined) updatePayload.is_active = params.is_active;
    if (params.requires_person !== undefined) updatePayload.requires_person = params.requires_person;
    if (params.requires_cost_center !== undefined) updatePayload.requires_cost_center = params.requires_cost_center;

    const { data, error } = await this.client
      .from('account_subsidiaries')
      .update(updatePayload)
      .eq('id', subsidiaryId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update subsidiary account: ${error.message}`);
    }

    return data as SubsidiaryRecord;
  }
}
