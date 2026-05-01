<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/auth';
  import { api, type Plan, type PlanCreate, type AdminTenant, type MspOrg, type AddonStatus } from '$lib/api';
  import { FEATURES, PLAN_FEATURES, SURERESTORE_TYPE_FEATURES } from '$lib/config/features';

  // All provider keys for the allowed_tools checklist
  const ALL_PROVIDERS = [
    { key: 'halopsa',      label: 'HaloPSA',              category: 'PSA' },
    { key: 'connectwise',  label: 'ConnectWise Manage',   category: 'PSA' },
    { key: 'autotask',     label: 'AutoTask (Datto PSA)',  category: 'PSA' },
    { key: 'custom_psa',   label: 'Custom PSA',           category: 'PSA' },
    { key: 'datto_rmm',    label: 'Datto RMM',            category: 'Backup' },
    { key: 'acronis_cloud',label: 'Acronis Cyber Cloud',  category: 'Backup' },
    { key: 'smtp',         label: 'SMTP / Email',         category: 'Mailbox' },
    { key: 'microsoft365', label: 'Microsoft 365 Mail',   category: 'Mailbox' },
    { key: 'webhook',      label: 'Webhook',              category: 'Other' },
    { key: 'slack',        label: 'Slack',                category: 'Other' },
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let plans: Plan[]        = [];
  let tenants: AdminTenant[] = [];
  let loading = true;
  let loadErr = '';

  // Plan form
  let formName        = '';
  let formUnlimited   = true;
  let formDeviceLimit = 50;
  let formPriceMonth  = '';
  let formPriceAnnual = '';
  let formFlags: Record<string, boolean> = {};
  // Integration controls
  let formMaxInteg        = -1;
  let formMaxIntegUnlimited = true;
  let formMaxPerTool      = -1;
  let formMaxPerToolUnlimited = true;
  let formAllowAllTools   = true;
  let formAllowedTools: Record<string, boolean> = {};
  let formRetentionDays   = 90;
  let formRetentionForever = false;
  let editingPlanId: number | null = null;
  let saving = false;
  let formErr = '';
  let formSuccess = '';

  // Master MSP breakdown
  let expandedMspTenantId: number | null = null;
  let mspOrgs: Record<number, MspOrg[]> = {};
  let mspLoading: Record<number, boolean> = {};

  // Assignment
  let assignErr: Record<number, string> = {};
  let assignSuccess: Record<number, string> = {};
  let assigning: Record<number, boolean> = {};

  // Per-tenant retention override editing
  let retentionEdit: Record<number, string> = {};   // input value while editing
  let retentionSaving: Record<number, boolean> = {};
  let retentionSuccess: Record<number, string> = {};

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onMount(async () => {
    if ($auth?.tenant_type !== 'platform') { goto('/'); return; }
    await loadAll();
  });

  async function loadAll() {
    loading = true; loadErr = '';
    try {
      [plans, tenants] = await Promise.all([api.plans(), api.adminTenants()]);
      // Load addon status for all tenants in parallel (non-blocking)
      await Promise.all(tenants.map(t => loadAddon(t.id)));
    } catch (e: any) {
      loadErr = e.message;
    } finally {
      loading = false;
    }
  }

  // ── Plan form helpers ──────────────────────────────────────────────────────
  function resetForm() {
    formName = ''; formUnlimited = true; formDeviceLimit = 50;
    formPriceMonth = ''; formPriceAnnual = '';
    formFlags = Object.fromEntries(
      [...PLAN_FEATURES, ...SURERESTORE_TYPE_FEATURES].map((f: { key: string }) => [f.key, false])
    );
    formMaxInteg = -1; formMaxIntegUnlimited = true;
    formMaxPerTool = -1; formMaxPerToolUnlimited = true;
    formAllowAllTools = true;
    formAllowedTools = Object.fromEntries(ALL_PROVIDERS.map(p => [p.key, false]));
    formRetentionDays = 90; formRetentionForever = false;
    editingPlanId = null; formErr = ''; formSuccess = '';
  }

  function startEdit(p: Plan) {
    editingPlanId = p.id;
    formName        = p.name;
    formUnlimited   = p.device_limit === -1;
    formDeviceLimit = p.device_limit === -1 ? 50 : p.device_limit;
    formPriceMonth  = p.price_monthly != null ? String(p.price_monthly) : '';
    formPriceAnnual = p.price_annual  != null ? String(p.price_annual)  : '';
    formFlags       = {
      ...Object.fromEntries([...PLAN_FEATURES, ...SURERESTORE_TYPE_FEATURES].map((f: { key: string }) => [f.key, false])),
      ...p.feature_flags,
    };
    formMaxInteg = p.max_integrations ?? -1;
    formMaxIntegUnlimited = formMaxInteg === -1;
    formMaxPerTool = p.max_integrations_per_tool ?? -1;
    formMaxPerToolUnlimited = formMaxPerTool === -1;
    formAllowAllTools = p.allowed_tools === null;
    formAllowedTools = Object.fromEntries(
      ALL_PROVIDERS.map(pr => [pr.key, p.allowed_tools ? p.allowed_tools.includes(pr.key) : false])
    );
    formRetentionForever = p.audit_log_retention_days === -1;
    formRetentionDays = p.audit_log_retention_days === -1 ? 90 : (p.audit_log_retention_days ?? 90);
    formErr = ''; formSuccess = '';
  }

  async function submitPlan() {
    if (!formName.trim()) { formErr = 'Plan name is required'; return; }
    saving = true; formErr = ''; formSuccess = '';
    const allowedToolsList = formAllowAllTools
      ? null
      : ALL_PROVIDERS.filter(pr => formAllowedTools[pr.key]).map(pr => pr.key);
    const body: PlanCreate = {
      name:                     formName.trim(),
      device_limit:             formUnlimited ? -1 : formDeviceLimit,
      price_monthly:            formPriceMonth  ? parseFloat(formPriceMonth)  : null,
      price_annual:             formPriceAnnual ? parseFloat(formPriceAnnual) : null,
      feature_flags:            formFlags,
      max_integrations:         formMaxIntegUnlimited ? -1 : formMaxInteg,
      max_integrations_per_tool: formMaxPerToolUnlimited ? -1 : formMaxPerTool,
      allowed_tools:            allowedToolsList,
      audit_log_retention_days: formRetentionForever ? -1 : formRetentionDays,
    };
    try {
      if (editingPlanId !== null) {
        const updated = await api.updatePlan(editingPlanId, body);
        plans = plans.map(p => p.id === editingPlanId ? updated : p);
        formSuccess = 'Plan updated.';
      } else {
        const created = await api.createPlan(body);
        plans = [...plans, created];
        formSuccess = 'Plan created.';
      }
      resetForm();
    } catch (e: any) {
      formErr = e.message;
    } finally {
      saving = false;
    }
  }

  async function archivePlan(id: number) {
    try {
      await api.archivePlan(id);
      plans = plans.filter(p => p.id !== id);
    } catch (e: any) {
      loadErr = e.message;
    }
  }

  // ── Assignment ─────────────────────────────────────────────────────────────
  async function assignPlan(tenantId: number, planIdStr: string) {
    if (!planIdStr) return;
    const planId = parseInt(planIdStr, 10);
    assigning = { ...assigning, [tenantId]: true };
    assignErr = { ...assignErr, [tenantId]: '' };
    assignSuccess = { ...assignSuccess, [tenantId]: '' };
    try {
      const res = await api.assignTenantPlan(tenantId, planId);
      tenants = tenants.map(t =>
        t.id === tenantId
          ? { ...t, plan_id: planId, plan_name: res.plan_name,
              device_limit: plans.find(p => p.id === planId)?.device_limit ?? t.device_limit }
          : t
      );
      assignSuccess = { ...assignSuccess, [tenantId]: 'Assigned' };
    } catch (e: any) {
      assignErr = { ...assignErr, [tenantId]: e.message };
    } finally {
      assigning = { ...assigning, [tenantId]: false };
    }
  }

  // ── Per-tenant retention override ──────────────────────────────────────────
  async function saveRetention(tenantId: number) {
    const raw = retentionEdit[tenantId];
    const days = raw === '' || raw === null ? null : parseInt(raw, 10);
    retentionSaving = { ...retentionSaving, [tenantId]: true };
    retentionSuccess = { ...retentionSuccess, [tenantId]: '' };
    try {
      await api.setTenantRetention(tenantId, days);
      tenants = tenants.map(t =>
        t.id === tenantId
          ? { ...t,
              audit_log_retention_override: days,
              audit_log_retention_days: days ?? (plans.find(p => p.id === t.plan_id)?.audit_log_retention_days ?? 90) }
          : t
      );
      retentionSuccess = { ...retentionSuccess, [tenantId]: '✓' };
    } catch (e: any) {
      assignErr = { ...assignErr, [tenantId]: e.message };
    } finally {
      retentionSaving = { ...retentionSaving, [tenantId]: false };
    }
  }

  // ── Master MSP breakdown ───────────────────────────────────────────────────
  async function toggleMspBreakdown(tenantId: number) {
    if (expandedMspTenantId === tenantId) {
      expandedMspTenantId = null;
      return;
    }
    expandedMspTenantId = tenantId;
    if (!mspOrgs[tenantId]) {
      mspLoading = { ...mspLoading, [tenantId]: true };
      try {
        mspOrgs = { ...mspOrgs, [tenantId]: await api.adminMsps(tenantId) };
      } catch {
        mspOrgs = { ...mspOrgs, [tenantId]: [] };
      } finally {
        mspLoading = { ...mspLoading, [tenantId]: false };
      }
    }
  }

  // ── Add-on management ──────────────────────────────────────────────────────
  let addonStatus: Record<number, AddonStatus> = {};
  let addonToggling: Record<number, boolean>   = {};
  let addonLimitEdit: Record<number, string>   = {};
  let addonLimitSaving: Record<number, boolean> = {};
  let addonErr: Record<number, string>         = {};
  let addonFilter = 'all';

  // Usage slide-over
  let usagePanel: (AdminTenant & { addon: AddonStatus }) | null = null;

  async function loadAddon(tenantId: number) {
    try {
      const s = await api.getTenantAddons(tenantId);
      addonStatus = { ...addonStatus, [tenantId]: s };
    } catch { /* non-critical */ }
  }

  async function toggleTestRestore(t: AdminTenant) {
    const current = addonStatus[t.id]?.test_restore_access ?? false;
    addonToggling = { ...addonToggling, [t.id]: true };
    addonErr      = { ...addonErr,      [t.id]: '' };
    try {
      const updated = await api.updateTenantAddons(t.id, { test_restore_access: !current });
      addonStatus = { ...addonStatus, [t.id]: updated };
    } catch (e: any) {
      addonErr = { ...addonErr, [t.id]: e.message };
    } finally {
      addonToggling = { ...addonToggling, [t.id]: false };
    }
  }

  async function saveAddonLimit(t: AdminTenant) {
    const raw = addonLimitEdit[t.id];
    const isUnlimited = raw === '' || raw === '-1';
    const val = isUnlimited ? -1 : parseInt(raw, 10);
    addonLimitSaving = { ...addonLimitSaving, [t.id]: true };
    addonErr         = { ...addonErr,         [t.id]: '' };
    try {
      const updated = await api.updateTenantAddons(t.id, { test_restore_device_limit: val });
      addonStatus    = { ...addonStatus, [t.id]: updated };
      addonLimitEdit = { ...addonLimitEdit, [t.id]: '' };
    } catch (e: any) {
      addonErr = { ...addonErr, [t.id]: e.message };
    } finally {
      addonLimitSaving = { ...addonLimitSaving, [t.id]: false };
    }
  }

  function openUsagePanel(t: AdminTenant) {
    const addon = addonStatus[t.id] ?? { test_restore_access: false, test_restore_device_limit: null, surerestore_file_restore: false, surerestore_vm_virtualization: false, surerestore_cloud_bcdr: false, surerestore_physical_host: false };
    usagePanel = { ...t, addon };
  }

  function getAddonFlag(addon: AddonStatus, key: string): boolean {
    return !!(addon as Record<string, unknown>)[key];
  }

  async function toggleRestoreType(key: string) {
    if (!usagePanel) return;
    const current = getAddonFlag(usagePanel.addon, key);
    const tid = usagePanel.id;
    addonToggling = { ...addonToggling, [tid]: true };
    try {
      const updated = await api.updateTenantAddons(tid, { [key]: !current } as Partial<AddonStatus>);
      addonStatus = { ...addonStatus, [tid]: updated };
      usagePanel = { ...usagePanel, addon: updated };
    } catch { /* silent */ } finally {
      addonToggling = { ...addonToggling, [tid]: false };
    }
  }

  async function quickToggleFromPanel(enable: boolean) {
    if (!usagePanel) return;
    const t = tenants.find(x => x.id === usagePanel!.id);
    if (!t) return;
    addonToggling = { ...addonToggling, [t.id]: true };
    try {
      const updated = await api.updateTenantAddons(t.id, { test_restore_access: enable });
      addonStatus = { ...addonStatus, [t.id]: updated };
      usagePanel = { ...usagePanel, addon: updated };
    } catch { /* show nothing */ } finally {
      addonToggling = { ...addonToggling, [t.id]: false };
    }
  }

  $: addonFilteredTenants = tenants.filter(t => {
    if (addonFilter === 'on')  return addonStatus[t.id]?.test_restore_access === true;
    if (addonFilter === 'off') return !addonStatus[t.id]?.test_restore_access;
    return true;
  });

  // ── Display helpers ────────────────────────────────────────────────────────
  function deviceLimitLabel(limit: number): string {
    return limit === -1 ? 'Unlimited' : String(limit);
  }

  function integLimitLabel(limit: number): string {
    return limit === -1 ? 'Unlimited' : String(limit);
  }

  function usageColor(used: number, limit: number): string {
    if (limit === -1) return '#4ade80';
    const pct = used / limit;
    if (pct >= 1)   return '#f87171';
    if (pct >= 0.8) return '#fb923c';
    return '#4ade80';
  }

  $: activePlans = plans.filter(p => p.is_active);

  onMount(() => {
    resetForm();
  });
</script>

<div style="color: #d1d5db; min-height: 100vh;">
  <!-- Header -->
  <div class="mb-6">
    <h1 style="font-size: 1.5rem; font-weight: 700; color: #ffffff;">Plan Manager</h1>
    <p style="font-size: 0.875rem; color: #9ca3af; margin-top: 0.25rem;">
      Define subscription plans and assign them to tenants.
    </p>
  </div>

  {#if loading}
    <p style="color: #9ca3af; text-align: center; padding: 3rem 0;">Loading…</p>
  {:else if loadErr}
    <div style="background: #450a0a; border: 1px solid #f87171; color: #f87171; border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1.5rem;">
      {loadErr}
    </div>
  {:else}
    <div class="grid grid-cols-1 xl:grid-cols-5 gap-6">

      <!-- ── Left: Plans ─────────────────────────────────────────────────── -->
      <div class="xl:col-span-2 flex flex-col gap-4">

        <!-- Active plan list -->
        <div style="background: #23233a; border: 1px solid #374151; border-radius: 0.75rem; padding: 1.25rem;">
          <h2 style="font-size: 0.9375rem; font-weight: 600; color: #ffffff; margin-bottom: 1rem;">
            Active Plans
            <span style="font-size: 0.75rem; font-weight: 400; color: #9ca3af; margin-left: 0.5rem;">
              ({activePlans.length})
            </span>
          </h2>

          {#if activePlans.length === 0}
            <p style="color: #9ca3af; font-size: 0.875rem; text-align: center; padding: 1.5rem 0;">
              No plans yet. Create one below.
            </p>
          {:else}
            <div class="flex flex-col gap-3">
              {#each activePlans as plan (plan.id)}
                <div style="background: #1a1a2e; border: 1px solid #374151; border-radius: 0.5rem; padding: 0.875rem;">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div style="font-weight: 600; color: #ffffff; font-size: 0.9375rem;">
                        {plan.name}
                      </div>
                      <div class="flex flex-wrap gap-1 mt-1.5">
                        <span style="font-size: 0.6875rem; background: #1e3a3a; color: #0094ba; border: 1px solid #0094ba44; border-radius: 9999px; padding: 1px 8px;">
                          {deviceLimitLabel(plan.device_limit)} devices
                        </span>
                        {#if plan.price_monthly != null}
                          <span style="font-size: 0.6875rem; background: #1a2040; color: #d1d5db; border: 1px solid #374151; border-radius: 9999px; padding: 1px 8px;">
                            ${plan.price_monthly}/mo
                          </span>
                        {/if}
                        {#each PLAN_FEATURES as f}
                          {#if plan.feature_flags[f.key]}
                            <span style="font-size: 0.6875rem; background: #14401e; color: #4ade80; border: 1px solid #4ade8044; border-radius: 9999px; padding: 1px 8px;">
                              {f.label}
                            </span>
                          {/if}
                        {/each}
                        <span style="font-size: 0.6875rem; background: #1a2040; color: #9ca3af; border: 1px solid #374151; border-radius: 9999px; padding: 1px 8px;">
                          {integLimitLabel(plan.max_integrations ?? -1)} integrations
                        </span>
                        {#if plan.allowed_tools != null && plan.allowed_tools.length >= 0}
                          <span style="font-size: 0.6875rem; background: #2d1a3a; color: #c084fc; border: 1px solid #c084fc44; border-radius: 9999px; padding: 1px 8px;">
                            {plan.allowed_tools.length} provider{plan.allowed_tools.length !== 1 ? 's' : ''} allowed
                          </span>
                        {/if}
                        <span style="font-size: 0.6875rem; background: #1a2a1a; color: #86efac; border: 1px solid #86efac44; border-radius: 9999px; padding: 1px 8px;">
                          {plan.audit_log_retention_days === -1 ? '∞ audit logs' : `${plan.audit_log_retention_days}d audit logs`}
                        </span>
                      </div>
                    </div>
                    <div class="flex gap-2 shrink-0">
                      <button
                        on:click={() => startEdit(plan)}
                        style="font-size: 0.75rem; color: #0094ba; background: none; border: none; cursor: pointer; padding: 0;">
                        Edit
                      </button>
                      <button
                        on:click={() => archivePlan(plan.id)}
                        style="font-size: 0.75rem; color: #f87171; background: none; border: none; cursor: pointer; padding: 0;">
                        Archive
                      </button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Create / Edit form -->
        <div style="background: #23233a; border: 1px solid #374151; border-radius: 0.75rem; padding: 1.25rem;">
          <h2 style="font-size: 0.9375rem; font-weight: 600; color: #ffffff; margin-bottom: 1rem;">
            {editingPlanId !== null ? 'Edit Plan' : 'New Plan'}
          </h2>

          <form on:submit|preventDefault={submitPlan} class="flex flex-col gap-3">
            <!-- Name -->
            <div>
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem;">
                Plan Name
              </label>
              <input
                type="text"
                bind:value={formName}
                placeholder="e.g. Starter, Professional, Enterprise"
                style="width: 100%; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                       padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #ffffff; outline: none;
                       box-sizing: border-box;"
              />
            </div>

            <!-- Device limit -->
            <div>
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem;">
                Device Limit
              </label>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                  <input type="checkbox" bind:checked={formUnlimited}
                    style="accent-color: #0094ba; width: 14px; height: 14px;" />
                  Unlimited
                </label>
                {#if !formUnlimited}
                  <input
                    type="number"
                    bind:value={formDeviceLimit}
                    min="1"
                    style="width: 80px; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                           padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #ffffff; outline: none;"
                  />
                {/if}
              </div>
            </div>

            <!-- Pricing -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem;">
                  Price / month ($)
                </label>
                <input
                  type="number"
                  bind:value={formPriceMonth}
                  min="0" step="0.01"
                  placeholder="—"
                  style="width: 100%; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                         padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #ffffff; outline: none;
                         box-sizing: border-box;"
                />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem;">
                  Price / year ($)
                </label>
                <input
                  type="number"
                  bind:value={formPriceAnnual}
                  min="0" step="0.01"
                  placeholder="—"
                  style="width: 100%; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                         padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #ffffff; outline: none;
                         box-sizing: border-box;"
                />
              </div>
            </div>

            <!-- Feature flags -->
            <div>
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.5rem;">
                Features
              </label>
              <div class="flex flex-col gap-1.5">
                {#each PLAN_FEATURES as f}
                  <label class="flex items-center gap-2" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                    <input
                      type="checkbox"
                      bind:checked={formFlags[f.key]}
                      style="accent-color: #0094ba; width: 14px; height: 14px;"
                    />
                    {f.label}
                  </label>
                {/each}
              </div>
            </div>

            <!-- SureRestore Restore Types -->
            <div style="border-top: 1px solid #374151; padding-top: 0.75rem; margin-top: 0.25rem;">
              <p style="font-size: 0.75rem; font-weight: 600; color: #9ca3af; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em;">
                SureRestore — Restore Types
              </p>
              <p style="font-size: 0.6875rem; color: #6b7280; margin-bottom: 0.75rem;">
                Sets the default for new tenants assigned this plan. Per-tenant overrides in Add-on Management.
              </p>

              <p style="font-size: 0.6875rem; font-weight: 600; color: #0094ba; margin-bottom: 0.375rem; text-transform: uppercase; letter-spacing: 0.04em;">
                Phase 1 — Available Now
              </p>
              <div class="flex flex-col gap-1.5" style="margin-bottom: 0.75rem;">
                {#each SURERESTORE_TYPE_FEATURES.filter(f => f.phase === 1) as f}
                  <label class="flex items-start gap-2" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;" title={f.description}>
                    <input
                      type="checkbox"
                      bind:checked={formFlags[f.key]}
                      style="accent-color: #0094ba; width: 14px; height: 14px; margin-top: 1px; flex-shrink: 0;"
                    />
                    <span>{f.label}</span>
                  </label>
                {/each}
              </div>

              <p style="font-size: 0.6875rem; font-weight: 600; color: #6b7280; margin-bottom: 0.375rem; text-transform: uppercase; letter-spacing: 0.04em;">
                Phase 2 — Planned
              </p>
              <div class="flex flex-col gap-1.5">
                {#each SURERESTORE_TYPE_FEATURES.filter(f => f.phase === 2) as f}
                  <label class="flex items-start gap-2" style="font-size: 0.8125rem; cursor: pointer; color: #6b7280;" title={f.description}>
                    <input
                      type="checkbox"
                      bind:checked={formFlags[f.key]}
                      style="accent-color: #6b7280; width: 14px; height: 14px; margin-top: 1px; flex-shrink: 0;"
                    />
                    <span>{f.label}</span>
                  </label>
                {/each}
              </div>
            </div>

            <!-- Integration Controls -->
            <div style="border-top: 1px solid #374151; padding-top: 0.75rem; margin-top: 0.25rem;">
              <p style="font-size: 0.75rem; font-weight: 600; color: #9ca3af; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
                Integration Controls
              </p>

              <!-- Max total integrations -->
              <div class="mb-3">
                <p style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.35rem;">
                  Max Integrations (total)
                </p>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-1.5" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                    <input type="checkbox" bind:checked={formMaxIntegUnlimited}
                      style="accent-color: #0094ba; width: 14px; height: 14px;" />
                    Unlimited
                  </label>
                  {#if !formMaxIntegUnlimited}
                    <input
                      type="number"
                      bind:value={formMaxInteg}
                      min="1"
                      style="width: 70px; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                             padding: 0.375rem 0.5rem; font-size: 0.875rem; color: #ffffff; outline: none;"
                    />
                  {/if}
                </div>
              </div>

              <!-- Max per category -->
              <div class="mb-3">
                <p style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.35rem;">
                  Max Integrations per Category
                </p>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-1.5" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                    <input type="checkbox" bind:checked={formMaxPerToolUnlimited}
                      style="accent-color: #0094ba; width: 14px; height: 14px;" />
                    Unlimited
                  </label>
                  {#if !formMaxPerToolUnlimited}
                    <input
                      type="number"
                      bind:value={formMaxPerTool}
                      min="1"
                      style="width: 70px; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                             padding: 0.375rem 0.5rem; font-size: 0.875rem; color: #ffffff; outline: none;"
                    />
                  {/if}
                </div>
              </div>

              <!-- Allowed tools whitelist -->
              <div>
                <p style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.35rem;">
                  Allowed Integration Providers
                </p>
                <label class="flex items-center gap-1.5 mb-2" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                  <input type="checkbox" bind:checked={formAllowAllTools}
                    style="accent-color: #0094ba; width: 14px; height: 14px;" />
                  Allow all providers
                </label>
                {#if !formAllowAllTools}
                  <div class="flex flex-col gap-1" style="padding-left: 0.5rem; border-left: 2px solid #374151;">
                    {#each ALL_PROVIDERS as pr}
                      <label class="flex items-center gap-2" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                        <input
                          type="checkbox"
                          bind:checked={formAllowedTools[pr.key]}
                          style="accent-color: #0094ba; width: 14px; height: 14px;"
                        />
                        <span>{pr.label}</span>
                        <span style="font-size: 0.6875rem; color: #6b7280;">({pr.category})</span>
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <!-- Audit Log Retention -->
            <div style="border-top: 1px solid #374151; padding-top: 0.75rem; margin-top: 0.25rem;">
              <p style="font-size: 0.75rem; font-weight: 600; color: #9ca3af; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
                Audit Log Retention
              </p>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5" style="font-size: 0.8125rem; cursor: pointer; color: #d1d5db;">
                  <input type="checkbox" bind:checked={formRetentionForever}
                    style="accent-color: #0094ba; width: 14px; height: 14px;" />
                  Keep forever
                </label>
                {#if !formRetentionForever}
                  <input
                    type="number"
                    bind:value={formRetentionDays}
                    min="1"
                    style="width: 70px; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                           padding: 0.375rem 0.5rem; font-size: 0.875rem; color: #ffffff; outline: none;"
                  />
                  <span style="font-size: 0.8125rem; color: #9ca3af;">days</span>
                {/if}
              </div>
            </div>

            {#if formErr}
              <div style="background: #450a0a; border: 1px solid #f87171; color: #f87171;
                          border-radius: 0.375rem; padding: 0.5rem 0.75rem; font-size: 0.8125rem;">
                {formErr}
              </div>
            {/if}
            {#if formSuccess}
              <div style="background: #14401e; border: 1px solid #4ade8044; color: #4ade80;
                          border-radius: 0.375rem; padding: 0.5rem 0.75rem; font-size: 0.8125rem;">
                {formSuccess}
              </div>
            {/if}

            <div class="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                style="flex: 1; background: #0094ba; color: #ffffff; border: none; border-radius: 0.375rem;
                       padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer;
                       opacity: {saving ? 0.6 : 1};"
              >
                {saving ? 'Saving…' : (editingPlanId !== null ? 'Update Plan' : 'Add Plan')}
              </button>
              {#if editingPlanId !== null}
                <button
                  type="button"
                  on:click={resetForm}
                  style="background: #374151; color: #d1d5db; border: none; border-radius: 0.375rem;
                         padding: 0.5rem 1rem; font-size: 0.875rem; cursor: pointer;"
                >
                  Cancel
                </button>
              {/if}
            </div>
          </form>
        </div>
      </div>

      <!-- ── Right: Tenant Assignment ────────────────────────────────────── -->
      <div class="xl:col-span-3">
        <div style="background: #23233a; border: 1px solid #374151; border-radius: 0.75rem; padding: 1.25rem;">
          <h2 style="font-size: 0.9375rem; font-weight: 600; color: #ffffff; margin-bottom: 1rem;">
            Tenant Assignment
          </h2>

          {#if tenants.length === 0}
            <p style="color: #9ca3af; font-size: 0.875rem; text-align: center; padding: 1.5rem 0;">
              No tenants provisioned yet.
            </p>
          {:else}
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.8125rem;">
                <thead>
                  <tr style="border-bottom: 1px solid #374151;">
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Tenant</th>
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Type</th>
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Devices</th>
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Current Plan</th>
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Assign</th>
                    <th style="text-align: left; padding: 0.5rem 0.75rem; color: #9ca3af; font-weight: 500;">Audit Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {#each tenants as t (t.id)}
                    {@const uc = usageColor(t.device_used, t.device_limit)}
                    <tr style="border-bottom: 1px solid #2a2a42;">
                      <!-- Tenant name -->
                      <td style="padding: 0.625rem 0.75rem; color: #ffffff; font-weight: 500;">
                        <div class="flex items-center gap-1.5">
                          {t.name}
                          {#if !t.is_active}
                            <span style="font-size: 0.625rem; color: #9ca3af;">(inactive)</span>
                          {/if}
                          {#if t.type === 'master_msp'}
                            <button
                              on:click={() => toggleMspBreakdown(t.id)}
                              title="View MSP breakdown"
                              style="font-size: 0.6875rem; color: #0094ba; background: none; border: none;
                                     cursor: pointer; padding: 0; line-height: 1;"
                            >
                              {expandedMspTenantId === t.id ? '▲' : '▼'}
                            </button>
                          {/if}
                        </div>
                      </td>

                      <!-- Type badge -->
                      <td style="padding: 0.625rem 0.75rem;">
                        <span style="font-size: 0.6875rem; border-radius: 9999px; padding: 2px 8px;
                          background: {t.type === 'master_msp' ? '#1e2d40' : '#1a1a2e'};
                          color: {t.type === 'master_msp' ? '#0094ba' : '#d1d5db'};
                          border: 1px solid {t.type === 'master_msp' ? '#0094ba44' : '#374151'};">
                          {t.type === 'master_msp' ? 'Master MSP' : 'MSP'}
                        </span>
                      </td>

                      <!-- Device usage -->
                      <td style="padding: 0.625rem 0.75rem;">
                        <span style="color: {uc}; font-weight: 500;">
                          {t.device_used}
                        </span>
                        <span style="color: #9ca3af;">
                          / {deviceLimitLabel(t.device_limit)}
                        </span>
                      </td>

                      <!-- Current plan -->
                      <td style="padding: 0.625rem 0.75rem;">
                        {#if t.plan_name}
                          <span style="color: #d1d5db;">{t.plan_name}</span>
                        {:else}
                          <span style="color: #9ca3af; font-style: italic;">No plan</span>
                        {/if}
                      </td>

                      <!-- Assign dropdown -->
                      <td style="padding: 0.625rem 0.75rem; min-width: 160px;">
                        <div class="flex items-center gap-2">
                          <select
                            value={t.plan_id != null ? String(t.plan_id) : ''}
                            on:change={e => assignPlan(t.id, e.currentTarget.value)}
                            disabled={assigning[t.id]}
                            style="background: #1a1a2e; border: 1px solid #374151; color: #d1d5db;
                                   border-radius: 0.375rem; padding: 0.375rem 0.5rem;
                                   font-size: 0.8125rem; cursor: pointer; flex: 1;"
                          >
                            <option value="">— No plan —</option>
                            {#each activePlans as p (p.id)}
                              <option value={String(p.id)}>{p.name}</option>
                            {/each}
                          </select>
                          {#if assigning[t.id]}
                            <span style="font-size: 0.6875rem; color: #9ca3af;">Saving…</span>
                          {:else if assignSuccess[t.id]}
                            <span style="font-size: 0.6875rem; color: #4ade80;">✓</span>
                          {/if}
                        </div>
                        {#if assignErr[t.id]}
                          <div style="color: #f87171; font-size: 0.6875rem; margin-top: 2px;">
                            {assignErr[t.id]}
                          </div>
                        {/if}
                      </td>

                      <!-- Audit retention override -->
                      <td style="padding: 0.625rem 0.75rem; min-width: 140px;">
                        <div class="flex items-center gap-1">
                          <input
                            type="number"
                            min="1"
                            placeholder={t.audit_log_retention_days === -1 ? '∞' : String(t.audit_log_retention_days)}
                            value={retentionEdit[t.id] ?? (t.audit_log_retention_override != null ? String(t.audit_log_retention_override) : '')}
                            on:input={e => { retentionEdit = { ...retentionEdit, [t.id]: e.currentTarget.value }; retentionSuccess = { ...retentionSuccess, [t.id]: '' }; }}
                            style="width: 60px; background: #1a1a2e; border: 1px solid #374151; border-radius: 0.375rem;
                                   padding: 0.25rem 0.4rem; font-size: 0.8125rem; color: #ffffff; outline: none;"
                          />
                          <span style="font-size: 0.75rem; color: #6b7280;">d</span>
                          <button
                            on:click={() => saveRetention(t.id)}
                            disabled={retentionSaving[t.id]}
                            title="Save override (blank = use plan default)"
                            style="font-size: 0.6875rem; background: #1e3a3a; color: #0094ba; border: 1px solid #0094ba44;
                                   border-radius: 0.25rem; padding: 2px 6px; cursor: pointer;"
                          >
                            {retentionSaving[t.id] ? '…' : 'Set'}
                          </button>
                          {#if retentionSuccess[t.id]}
                            <span style="font-size: 0.6875rem; color: #4ade80;">{retentionSuccess[t.id]}</span>
                          {/if}
                        </div>
                        <div style="font-size: 0.6875rem; color: #6b7280; margin-top: 2px;">
                          {#if t.audit_log_retention_override != null}
                            override: {t.audit_log_retention_override === -1 ? '∞' : `${t.audit_log_retention_override}d`}
                          {:else}
                            from plan: {t.audit_log_retention_days === -1 ? '∞' : `${t.audit_log_retention_days}d`}
                          {/if}
                        </div>
                      </td>
                    </tr>

                    <!-- Master MSP breakdown row -->
                    {#if t.type === 'master_msp' && expandedMspTenantId === t.id}
                      <tr style="background: #161628; border-bottom: 1px solid #2a2a42;">
                        <td colspan="6" style="padding: 0.75rem 1.25rem;">
                          {#if mspLoading[t.id]}
                            <p style="color: #9ca3af; font-size: 0.8125rem;">Loading MSPs…</p>
                          {:else if mspOrgs[t.id]?.length === 0}
                            <p style="color: #9ca3af; font-size: 0.8125rem; font-style: italic;">No MSP sub-orgs found.</p>
                          {:else}
                            <div style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.5rem; font-weight: 500;">
                              MSP Breakdown — {t.name}
                            </div>
                            <div class="flex flex-wrap gap-2">
                              {#each (mspOrgs[t.id] ?? []) as msp (msp.id)}
                                <div style="background: #1e1e38; border: 1px solid #374151; border-radius: 0.5rem;
                                            padding: 0.5rem 0.75rem; min-width: 140px;">
                                  <div style="font-weight: 600; color: #ffffff; font-size: 0.8125rem; margin-bottom: 0.25rem;">
                                    {msp.name}
                                    {#if !msp.is_active}
                                      <span style="font-size: 0.625rem; color: #9ca3af; font-weight: 400;"> (inactive)</span>
                                    {/if}
                                  </div>
                                  <div style="font-size: 0.6875rem; color: #9ca3af;">
                                    {msp.client_count} client{msp.client_count !== 1 ? 's' : ''}
                                    · {msp.device_count} device{msp.device_count !== 1 ? 's' : ''}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>

    </div>

    <!-- ── Add-on Management ─────────────────────────────────────────────── -->
    <div style="margin-top: 2rem;">
      <div style="background: #23233a; border: 1px solid #374151; border-radius: 0.75rem; padding: 1.25rem;">
        <div class="mb-4">
          <h2 style="font-size: 0.9375rem; font-weight: 600; color: #ffffff;">Add-on Management</h2>
          <p style="font-size: 0.8125rem; color: #9ca3af; margin-top: 0.25rem;">
            Enable or disable premium modules per tenant independently of their plan.
          </p>
        </div>

        <!-- Filters -->
        <div class="flex gap-2 mb-4">
          {#each [['all','All tenants'],['on','Test Restore ON'],['off','Test Restore OFF']] as [val, label]}
            <button
              on:click={() => addonFilter = val}
              style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; cursor: pointer; border: 1px solid;
                border-color: {addonFilter === val ? '#0094ba' : '#374151'};
                background: {addonFilter === val ? '#0094ba22' : 'transparent'};
                color: {addonFilter === val ? '#0094ba' : '#9ca3af'};"
            >{label}</button>
          {/each}
        </div>

        {#if addonFilteredTenants.length === 0}
          <p style="color: #9ca3af; font-size: 0.875rem; text-align: center; padding: 1.5rem 0;">No tenants match this filter.</p>
        {:else}
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.8125rem;">
              <thead>
                <tr style="border-bottom: 1px solid #374151;">
                  <th style="text-align:left; padding: 0.5rem 0.75rem; color:#9ca3af; font-weight:500;">Tenant</th>
                  <th style="text-align:left; padding: 0.5rem 0.75rem; color:#9ca3af; font-weight:500;">Plan</th>
                  <th style="text-align:left; padding: 0.5rem 0.75rem; color:#9ca3af; font-weight:500;">Test Restore</th>
                  <th style="text-align:left; padding: 0.5rem 0.75rem; color:#9ca3af; font-weight:500;">Device Limit</th>
                  <th style="text-align:left; padding: 0.5rem 0.75rem; color:#9ca3af; font-weight:500;">Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each addonFilteredTenants as t (t.id)}
                  {@const addon = addonStatus[t.id] ?? { test_restore_access: false, test_restore_device_limit: null }}
                  {@const isOn  = addon.test_restore_access}
                  {@const lim   = addon.test_restore_device_limit}
                  <tr style="border-bottom: 1px solid #2a2a42;">

                    <!-- Tenant -->
                    <td style="padding: 0.625rem 0.75rem; color:#ffffff; font-weight:500;">{t.name}</td>

                    <!-- Plan -->
                    <td style="padding: 0.625rem 0.75rem; color:#9ca3af;">
                      {t.plan_name ?? '—'}
                    </td>

                    <!-- Toggle -->
                    <td style="padding: 0.625rem 0.75rem;">
                      <button
                        on:click={() => toggleTestRestore(t)}
                        disabled={addonToggling[t.id]}
                        title="{isOn ? 'Disable' : 'Enable'} Test Restore"
                        style="display:inline-flex; align-items:center; gap:6px; padding:3px 10px;
                          border-radius:9999px; border:none; cursor:{addonToggling[t.id] ? 'wait' : 'pointer'};
                          background:{isOn ? '#0094ba' : '#374151'};
                          color:#ffffff; font-size:0.75rem; font-weight:500;
                          opacity:{addonToggling[t.id] ? 0.6 : 1}; transition: background 0.2s;"
                      >
                        {#if addonToggling[t.id]}
                          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;
                            border:2px solid #ffffff44;border-top-color:#fff;animation:spin 0.6s linear infinite;"></span>
                        {:else}
                          <span style="width:8px;height:8px;border-radius:50%;background:{isOn ? '#fff' : '#9ca3af'};"></span>
                        {/if}
                        {isOn ? 'Enabled' : 'Disabled'}
                      </button>
                      {#if addonErr[t.id]}
                        <div style="color:#f87171;font-size:0.6875rem;margin-top:2px;">{addonErr[t.id]}</div>
                      {/if}
                    </td>

                    <!-- Device limit (only when enabled) -->
                    <td style="padding: 0.625rem 0.75rem; min-width:160px;">
                      {#if isOn}
                        <div class="flex items-center gap-2">
                          <input
                            type="number"
                            min="-1"
                            placeholder={lim === -1 ? 'Unlimited' : String(lim ?? 10)}
                            value={addonLimitEdit[t.id] ?? (lim != null ? String(lim) : '')}
                            on:input={e => { addonLimitEdit = { ...addonLimitEdit, [t.id]: e.currentTarget.value }; }}
                            on:keydown={e => { if (e.key === 'Enter') saveAddonLimit(t); }}
                            on:blur={() => { if (addonLimitEdit[t.id] !== undefined && addonLimitEdit[t.id] !== '') saveAddonLimit(t); }}
                            style="width:70px; background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem;
                                   padding:0.25rem 0.4rem; font-size:0.8125rem; color:#ffffff; outline:none;"
                          />
                          <label class="flex items-center gap-1" style="font-size:0.75rem; color:#9ca3af; cursor:pointer; white-space:nowrap;">
                            <input
                              type="checkbox"
                              checked={lim === -1}
                              on:change={e => {
                                const val = e.currentTarget.checked ? '-1' : '10';
                                addonLimitEdit = { ...addonLimitEdit, [t.id]: val };
                                saveAddonLimit(t);
                              }}
                              style="accent-color:#0094ba;"
                            />
                            Unlimited
                          </label>
                          {#if addonLimitSaving[t.id]}
                            <span style="font-size:0.6875rem;color:#9ca3af;">…</span>
                          {/if}
                        </div>
                        <div style="font-size:0.6875rem;color:#6b7280;margin-top:2px;">
                          current: {lim === -1 ? 'Unlimited' : lim === null ? 'not set' : String(lim)}
                        </div>
                      {:else}
                        <span style="color:#6b7280;font-size:0.75rem;">—</span>
                      {/if}
                    </td>

                    <!-- Actions -->
                    <td style="padding: 0.625rem 0.75rem;">
                      <button
                        on:click={() => openUsagePanel(t)}
                        style="font-size:0.75rem; color:#0094ba; background:none; border:none; cursor:pointer; padding:0;"
                      >View Usage</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>

  {/if}
</div>

<!-- ── Add-on Usage slide-over ────────────────────────────────────────────── -->
{#if usagePanel}
  <!-- Backdrop -->
  <div
    on:click={() => usagePanel = null}
    on:keydown={e => e.key === 'Escape' && (usagePanel = null)}
    role="button"
    tabindex="-1"
    style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:40;"
  ></div>

  <!-- Panel -->
  <div style="position:fixed;top:0;right:0;height:100%;width:480px;max-width:100%;
              background:#1a1a2e;border-left:1px solid #374151;z-index:50;
              overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem;">

    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h2 style="font-size:1rem;font-weight:700;color:#ffffff;">{usagePanel.name}</h2>
        <p style="font-size:0.8125rem;color:#9ca3af;margin-top:0.125rem;">Add-on Usage</p>
      </div>
      <button
        on:click={() => usagePanel = null}
        style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:1.25rem;line-height:1;padding:0;"
      >✕</button>
    </div>

    <!-- Test Restore section -->
    <div style="background:#23233a;border:1px solid #374151;border-radius:0.75rem;padding:1rem;">
      <div class="flex items-center justify-between mb-3">
        <span style="font-size:0.875rem;font-weight:600;color:#ffffff;">Test Restore</span>
        {#if usagePanel.addon.test_restore_access}
          <span style="font-size:0.75rem;background:#14401e;color:#4ade80;border:1px solid #4ade8044;
                        border-radius:9999px;padding:2px 10px;">Enabled</span>
        {:else}
          <span style="font-size:0.75rem;background:#1a1a2e;color:#9ca3af;border:1px solid #374151;
                        border-radius:9999px;padding:2px 10px;">Disabled</span>
        {/if}
      </div>

      <div class="flex flex-col gap-1.5" style="font-size:0.8125rem;">
        <div class="flex justify-between">
          <span style="color:#9ca3af;">Device limit</span>
          <span style="color:#d1d5db;">
            {usagePanel.addon.test_restore_device_limit === -1
              ? 'Unlimited'
              : usagePanel.addon.test_restore_device_limit === null
                ? 'Not set'
                : String(usagePanel.addon.test_restore_device_limit)}
          </span>
        </div>
      </div>

      {#if usagePanel.addon.test_restore_access}
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #374151;">
          <p style="font-size:0.6875rem;font-weight:600;color:#9ca3af;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.05em;">
            Restore Types
          </p>
          <div class="flex flex-col gap-2">
            {#each SURERESTORE_TYPE_FEATURES as f}
              {@const enabled = getAddonFlag(usagePanel.addon, f.key)}
              <div class="flex items-center justify-between">
                <div>
                  <span style="font-size:0.8125rem;color:#d1d5db;">{f.label}</span>
                  {#if (f.phase ?? 1) === 2}
                    <span style="font-size:0.625rem;color:#6b7280;margin-left:4px;">Phase 2</span>
                  {/if}
                </div>
                <button
                  on:click={() => toggleRestoreType(f.key)}
                  disabled={addonToggling[usagePanel.id]}
                  style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;
                    border-radius:9999px;border:none;cursor:pointer;
                    background:{enabled ? '#0094ba' : '#374151'};
                    color:#ffffff;font-size:0.6875rem;font-weight:500;
                    opacity:{addonToggling[usagePanel.id] ? 0.6 : 1};"
                >
                  <span style="width:6px;height:6px;border-radius:50%;background:{enabled ? '#fff' : '#9ca3af'};"></span>
                  {enabled ? 'On' : 'Off'}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Quick action -->
      <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid #374151;">
        {#if usagePanel.addon.test_restore_access}
          <button
            on:click={() => quickToggleFromPanel(false)}
            disabled={addonToggling[usagePanel.id]}
            style="width:100%;background:#450a0a;color:#f87171;border:1px solid #f8717144;
                   border-radius:0.375rem;padding:0.5rem;font-size:0.8125rem;cursor:pointer;
                   opacity:{addonToggling[usagePanel.id] ? 0.6 : 1};"
          >
            {addonToggling[usagePanel.id] ? 'Saving…' : 'Disable Test Restore'}
          </button>
        {:else}
          <button
            on:click={() => quickToggleFromPanel(true)}
            disabled={addonToggling[usagePanel.id]}
            style="width:100%;background:#0094ba;color:#ffffff;border:none;
                   border-radius:0.375rem;padding:0.5rem;font-size:0.8125rem;cursor:pointer;
                   opacity:{addonToggling[usagePanel.id] ? 0.6 : 1};"
          >
            {addonToggling[usagePanel.id] ? 'Saving…' : 'Enable Test Restore'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
