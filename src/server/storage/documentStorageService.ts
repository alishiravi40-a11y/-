import { SupabaseClient } from '@supabase/supabase-js';

export interface StorageUploadOptions {
  bucketName?: string;
  upsert?: boolean;
}

export interface StorageResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server-side Document Storage Service Interface & Implementation.
 * Abstracts physical file operations (upload, download, remove, exists)
 * so that shifting from Supabase Storage to an internal S3/minio/on-prem server
 * requires ZERO UI or route changes.
 */
export class DocumentStorageService {
  private static defaultBucket = 'credit-documents';
  private static simulatedStore: Map<string, { buffer: Buffer; mimeType: string }> = new Map();
  private static isSimulated = false;

  /**
   * Enable in-memory simulation mode (primarily for isolated test suites)
   */
  static setSimulatedMode(enabled: boolean) {
    this.isSimulated = enabled;
  }

  /**
   * Clear in-memory simulated storage
   */
  static clearSimulatedStore() {
    this.simulatedStore.clear();
  }

  /**
   * Upload a file buffer to storage
   */
  static async upload(
    storageKey: string,
    fileBuffer: Buffer,
    mimeType: string,
    supabaseClient?: SupabaseClient,
    options?: StorageUploadOptions
  ): Promise<StorageResult> {
    if (this.isSimulated || !supabaseClient) {
      if (this.simulatedStore.has(storageKey) && options?.upsert === false) {
        return { success: false, error: 'ERR_FILE_ALREADY_EXISTS' };
      }
      this.simulatedStore.set(storageKey, { buffer: fileBuffer, mimeType });
      return { success: true };
    }

    try {
      const bucket = options?.bucketName || this.defaultBucket;
      const { error } = await supabaseClient.storage
        .from(bucket)
        .upload(storageKey, fileBuffer, {
          contentType: mimeType,
          upsert: options?.upsert ?? false
        });

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error uploading file to storage' };
    }
  }

  /**
   * Download a file buffer from storage
   */
  static async download(
    storageKey: string,
    supabaseClient?: SupabaseClient,
    bucketName?: string
  ): Promise<StorageResult<{ buffer: Buffer; mimeType?: string }>> {
    if (this.isSimulated || !supabaseClient) {
      const item = this.simulatedStore.get(storageKey);
      if (!item) {
        return { success: false, error: 'ERR_FILE_NOT_FOUND_IN_STORAGE' };
      }
      return { success: true, data: item };
    }

    try {
      const bucket = bucketName || this.defaultBucket;
      const { data, error } = await supabaseClient.storage
        .from(bucket)
        .download(storageKey);

      if (error || !data) {
        return { success: false, error: error?.message || 'ERR_FILE_NOT_FOUND' };
      }

      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return { success: true, data: { buffer, mimeType: data.type } };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error downloading file from storage' };
    }
  }

  /**
   * Remove a file from storage (used in rollback/compensation)
   */
  static async remove(
    storageKey: string,
    supabaseClient?: SupabaseClient,
    bucketName?: string
  ): Promise<StorageResult> {
    if (this.isSimulated || !supabaseClient) {
      this.simulatedStore.delete(storageKey);
      return { success: true };
    }

    try {
      const bucket = bucketName || this.defaultBucket;
      const { error } = await supabaseClient.storage
        .from(bucket)
        .remove([storageKey]);

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error removing file from storage' };
    }
  }

  /**
   * Check if file exists in storage
   */
  static async exists(
    storageKey: string,
    supabaseClient?: SupabaseClient,
    bucketName?: string
  ): Promise<boolean> {
    if (this.isSimulated || !supabaseClient) {
      return this.simulatedStore.has(storageKey);
    }

    try {
      const res = await this.download(storageKey, supabaseClient, bucketName);
      return res.success;
    } catch {
      return false;
    }
  }
}
