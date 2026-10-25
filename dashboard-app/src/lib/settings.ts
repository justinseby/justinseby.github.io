import { currentUserId, list, upsert, useLoad } from "./db.ts";
import type { Settings } from "./types.ts";

export const DEFAULT_SETTINGS = { default_currency: "SEK", timezone: "Europe/Stockholm" };

export function useSettings() {
  const { data } = useLoad(async () => (await list<Settings>("settings"))[0] ?? null, []);
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const user_id = await currentUserId();
  const [current] = await list<Settings>("settings");
  await upsert("settings", { ...DEFAULT_SETTINGS, ...(current ?? {}), ...patch, user_id }, "user_id");
}
