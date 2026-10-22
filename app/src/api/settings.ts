// Typed wrappers around the Rust commands of src-tauri/src/commands/settings.rs.
// The frontend never touches the disk itself: everything goes through `invoke`.
import { invoke } from "@tauri-apps/api/core";
import type { Settings, SettingsPatch } from "../types/settings";

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>("set_settings", { patch });
}
