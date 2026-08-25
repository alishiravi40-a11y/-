import { SupabaseClient } from '@supabase/supabase-js';

export interface PersonRecord {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  code: string;
  name: string;
  person_type: 'real' | 'legal';
  national_id?: string | null;
  national_id_normalized?: string | null;
  mobile?: string | null;
  mobile_normalized?: string | null;
  status: 'draft' | 'active' | 'inactive' | 'blocked';
  role?: 'debtor' | 'creditor' | 'both' | null;
  created_by?: string | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreatePersonParams {
  organization_id: string;
  branch_id?: string | null;
  code: string;
  name: string;
  person_type?: 'real' | 'legal';
  national_id?: string | null;
  mobile?: string | null;
  status?: 'draft' | 'active' | 'inactive' | 'blocked';
  role?: 'debtor' | 'creditor' | 'both' | null;
  user_id: string;
}

export interface UpdatePersonParams {
  name?: string;
  mobile?: string | null;
  status?: 'draft' | 'active' | 'inactive' | 'blocked';
  role?: 'debtor' | 'creditor' | 'both' | null;
  user_id: string;
}

export class PersonRepository {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /**
   * Get a single person by ID with strict organization isolation enforcement.
   */
  async getPersonById(personId: string, organizationId: string): Promise<PersonRecord | null> {
    const { data, error } = await this.client
      .from('persons')
      .select('*')
      .eq('id', personId)
      .eq('organization_id', organizationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to fetch person: ${error.message}`);
    }

    return data as PersonRecord;
  }

  /**
   * Get list of persons for a specific organization with strict organization isolation.
   */
  async listPersons(organizationId: string): Promise<PersonRecord[]> {
    const { data, error } = await this.client
      .from('persons')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list persons: ${error.message}`);
    }

    return (data || []) as PersonRecord[];
  }

  /**
   * Create a new person with uniqueness and organization enforcement.
   */
  async createPerson(params: CreatePersonParams): Promise<PersonRecord> {
    // Check if code already exists within this organization
    const { data: existingCode } = await this.client
      .from('persons')
      .select('id')
      .eq('organization_id', params.organization_id)
      .eq('code', params.code)
      .single();

    if (existingCode) {
      throw new Error(`Duplicate business code error: Person with code '${params.code}' already exists in this organization.`);
    }

    const { data, error } = await this.client
      .from('persons')
      .insert({
        organization_id: params.organization_id,
        branch_id: params.branch_id || null,
        code: params.code,
        name: params.name,
        person_type: params.person_type || 'real',
        national_id: params.national_id || null,
        mobile: params.mobile || null,
        status: params.status || 'active',
        role: params.role || 'both',
        created_by: params.user_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create person: ${error.message}`);
    }

    return data as PersonRecord;
  }

  /**
   * Update an existing person with strict organization isolation.
   */
  async updatePerson(personId: string, organizationId: string, params: UpdatePersonParams): Promise<PersonRecord> {
    // Verify existence within org first
    const existing = await this.getPersonById(personId, organizationId);
    if (!existing) {
      throw new Error('Person not found or access denied due to organization isolation.');
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (params.name !== undefined) updatePayload.name = params.name;
    if (params.mobile !== undefined) updatePayload.mobile = params.mobile;
    if (params.status !== undefined) updatePayload.status = params.status;
    if (params.role !== undefined) updatePayload.role = params.role;

    const { data, error } = await this.client
      .from('persons')
      .update(updatePayload)
      .eq('id', personId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update person: ${error.message}`);
    }

    return data as PersonRecord;
  }
}
