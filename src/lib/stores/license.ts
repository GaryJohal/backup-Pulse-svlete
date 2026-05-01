import { derived, writable } from 'svelte/store';
import { auth } from '$lib/auth';

/** Derived from the auth store — always in sync with $auth, no separate fetch needed. */
export const licenseStore = derived(auth, ($auth) => ({
  plan:                      $auth?.plan_name ?? null,
  max_integrations:          $auth?.max_integrations ?? -1,
  max_integrations_per_tool: $auth?.max_integrations_per_tool ?? -1,
  allowed_tools:             $auth?.allowed_tools ?? null,
  feature_flags:             $auth?.feature_flags ?? {},
  addons: {
    test_restore_access:       ($auth?.addons?.test_restore_access      ?? false) as boolean,
    test_restore_device_limit: ($auth?.addons?.test_restore_device_limit ?? null)  as number | null,
  },
}));

/** Returns a derived boolean — true if the tenant has access to this feature. */
export function canUseFeature(key: string) {
  return derived(licenseStore, ($l) => {
    const flags = $l.feature_flags;
    if (Object.keys(flags).length === 0) return true;
    if (!(key in flags)) return true;
    return flags[key] === true;
  });
}

/** Returns a derived boolean — true if a specific integration provider is allowed. */
export function isToolAllowed(providerKey: string) {
  return derived(licenseStore, ($l) => {
    if (!$l.allowed_tools || $l.allowed_tools.length === 0) return true;
    return $l.allowed_tools.includes(providerKey);
  });
}

/** True when the tenant has Test Restore enabled. */
export const hasTestRestore = derived(
  licenseStore,
  ($l) => !!$l.addons.test_restore_access,
);

/** The configured device limit for Test Restore (null = not granted, -1 = unlimited). */
export const testRestoreDeviceLimit = derived(
  licenseStore,
  ($l) => $l.addons.test_restore_device_limit,
);

/** How many Test Restore schedules are currently active — populated when the page loads. */
export const testRestoreDevicesUsed = writable(0);

/** True when the tenant has hit their Test Restore schedule limit. */
export const isAtTestRestoreLimit = derived(
  [licenseStore, testRestoreDevicesUsed],
  ([$l, $used]) => {
    const limit = $l.addons.test_restore_device_limit;
    if (!limit || limit === -1) return false;
    return $used >= limit;
  },
);
