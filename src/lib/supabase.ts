import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
export const defaultDeviceId = import.meta.env.VITE_POOL_DEVICE_ID?.trim() || "pool-hub-001";
export const selectedDeviceStorageKey = "pool-dashboard-selected-device-id";

export function getSelectedDeviceId() {
  if (typeof window === "undefined") return defaultDeviceId;
  try {
    return window.localStorage.getItem(selectedDeviceStorageKey)?.trim() || defaultDeviceId;
  } catch {
    return defaultDeviceId;
  }
}

export function selectDeviceId(nextDeviceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(selectedDeviceStorageKey, nextDeviceId);
}

export function clearSelectedDeviceId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(selectedDeviceStorageKey);
}

export const deviceId = getSelectedDeviceId();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  return supabase;
}
