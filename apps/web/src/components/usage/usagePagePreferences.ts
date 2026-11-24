import { isAldoCloud } from "../../aldo/api";
import { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

// Aldo has no Limits tab, so it opens on Cost, even when Limits was picked before.
const DEFAULT_PREFERENCES: UsagePagePreferences = {
  metric: isAldoCloud ? "cost" : "limits",
  windowDays: 30,
};

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    const preferences = getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema);
    if (isAldoCloud && preferences?.metric === "limits") return { ...preferences, metric: "cost" };
    return preferences ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}
