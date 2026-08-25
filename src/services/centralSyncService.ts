import { getSupabase, getSupabaseConfig, setSupabaseConfig } from '../lib/supabaseClient';
import { AppState } from '../types';

const EMERGENCY_BACKUP_KEY = 'localStorage_emergency_backup_v1';
const LAST_SYNC_KEY = 'supabase_last_sync_timestamp';

// Unique Device ID for detecting remote changes vs local edits
const DEVICE_ID = 'dev_' + Math.random().toString(36).substring(2, 9);

let lastPushedTimestamp = 0;
let isSyncing = false;
let currentLocalVersion = 0;

function sanitizeObjectForBackup<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeObjectForBackup(item)) as unknown as T;
  }
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('service_role')
    ) {
      continue;
    }
    sanitized[key] = sanitizeObjectForBackup((data as any)[key]);
  }
  return sanitized as T;
}

/**
 * 1. Backs up current localStorage contents to an emergency backup key.
 */
export function backupLocalStorageBeforeMigration(): boolean {
  try {
    if (localStorage.getItem(EMERGENCY_BACKUP_KEY)) {
      return true;
    }
    const backupData: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      
      const lowerKey = key.toLowerCase();
      // Skip all token, session, auth, secret, or supabase keys
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('session') ||
        lowerKey.includes('secret') ||
        lowerKey.startsWith('sb-') ||
        lowerKey.startsWith('supabase.')
      ) {
        continue;
      }

      if (key.startsWith('accounting_') || key.startsWith('knowledge_')) {
        const itemVal = localStorage.getItem(key);
        if (itemVal) {
          try {
            const parsed = JSON.parse(itemVal);
            backupData[key] = JSON.stringify(sanitizeObjectForBackup(parsed));
          } catch {
            backupData[key] = itemVal;
          }
        }
      }
    }
    localStorage.setItem(EMERGENCY_BACKUP_KEY, JSON.stringify({
      timestamp: new Date().toISOString(),
      data: backupData
    }));
    return true;
  } catch (err) {
    console.error('Failed to create emergency backup:', err);
    return false;
  }
}

/**
 * Restores state from emergency backup if needed.
 */
export function restoreFromEmergencyBackup(): boolean {
  try {
    const raw = localStorage.getItem(EMERGENCY_BACKUP_KEY);
    if (!raw) return false;
    const backupObj = JSON.parse(raw);
    if (!backupObj || !backupObj.data) return false;

    Object.keys(backupObj.data).forEach(key => {
      if (backupObj.data[key] !== null) {
        localStorage.setItem(key, backupObj.data[key]);
      }
    });
    return true;
  } catch (e) {
    console.error('Error restoring from emergency backup:', e);
    return false;
  }
}

/**
 * 2. Fetch central state from Express Server API or Supabase
 */
export async function fetchCentralAppState(): Promise<{ state: AppState; timestamp: string; source: 'supabase' | 'server' } | null> {
  // First, check if server has config or state
  try {
    const serverRes = await fetch('/api/app-state');
    if (serverRes.ok) {
      const serverData = await serverRes.json();
      if (serverData && serverData.data) {
        currentLocalVersion = serverData.version || Date.now();
        return {
          state: serverData.data as AppState,
          timestamp: new Date(currentLocalVersion).toISOString(),
          source: 'server'
        };
      }
    }
  } catch (e) {
    // Server fetch failed, try Supabase fallback
  }

  // Fallback to Supabase if configured
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('app_state_store')
        .select('data, updated_at, updated_by')
        .eq('id', 'default_app_state')
        .single();

      if (!error && data && data.data) {
        return {
          state: data.data as AppState,
          timestamp: data.updated_at,
          source: 'supabase'
        };
      }
    } catch (err) {
      console.error('Failed to fetch state from Supabase:', err);
    }
  }

  return null;
}

/**
 * 3. Push central state to Express Server API and Supabase
 */
let debounceTimer: any = null;

export function pushAppStateToCentral(state: AppState) {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    isSyncing = true;
    lastPushedTimestamp = Date.now();
    const now = new Date().toISOString();

    // 1. Push to Express Server Central Store
    try {
      const res = await fetch('/api/app-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, deviceId: DEVICE_ID })
      });
      if (res.ok) {
        const resData = await res.json();
        currentLocalVersion = resData.version || Date.now();
        localStorage.setItem(LAST_SYNC_KEY, now);
      }
    } catch (e) {
      console.warn('Could not push to Express server central store:', e);
    }

    // 2. Push to Supabase if active
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('app_state_store')
          .upsert(
            {
              id: 'default_app_state',
              data: state,
              updated_at: now,
              updated_by: DEVICE_ID
            },
            { onConflict: 'id' }
          );
      } catch (e) {
        console.warn('Supabase push error:', e);
      }
    }

    isSyncing = false;
  }, 800);
}

/**
 * 4. Live Multi-Device Realtime Polling & Sync Engine
 */
export function startLiveSync(
  onRemoteStateChange: (remoteState: AppState) => void,
  onStatusChange?: (status: { connected: boolean; syncing: boolean; lastSyncTime: string | null; mode: string }) => void
): () => void {
  let lastSeenVersion = currentLocalVersion;

  // Poll server every 2.5 seconds
  const intervalId = setInterval(async () => {
    // Avoid overwriting if local edits were pushed very recently
    if (Date.now() - lastPushedTimestamp < 1800 || isSyncing) {
      return;
    }

    // Check Express Server for new state version
    try {
      const res = await fetch('/api/app-state');
      if (res.ok) {
        const data = await res.json();
        if (data && data.version && data.data) {
          // If another device updated the version
          if (data.version > lastSeenVersion && data.updatedBy !== DEVICE_ID) {
            lastSeenVersion = data.version;
            currentLocalVersion = data.version;
            console.log('🔄 Multi-device sync: Remote change received from central server!');
            onRemoteStateChange(data.data as AppState);
            onStatusChange?.({
              connected: true,
              syncing: false,
              lastSyncTime: new Date(data.version).toLocaleTimeString('fa-IR'),
              mode: 'مرکزی آنلاین (پایگاه داده سرور)'
            });
            return;
          }
        }
      }
    } catch (e) {
      // Server fetch failed
    }

    // Also check Supabase if configured
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('app_state_store')
          .select('data, updated_at, updated_by')
          .eq('id', 'default_app_state')
          .single();

        if (!error && data && data.data && data.updated_by !== DEVICE_ID) {
          onStatusChange?.({
            connected: true,
            syncing: false,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            mode: 'پایگاه داده Supabase'
          });
        }
      } catch (e) {
        // Supabase error
      }
    } else {
      onStatusChange?.({
        connected: true,
        syncing: false,
        lastSyncTime: localStorage.getItem(LAST_SYNC_KEY) || new Date().toLocaleTimeString('fa-IR'),
        mode: 'سرور مرکزی هوشمند'
      });
    }
  }, 2500);

  return () => {
    clearInterval(intervalId);
  };
}
