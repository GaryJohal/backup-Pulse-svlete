<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { defaultConfig, windowLabel, PSA_CONFIG, type ProblemConfig } from '$lib/types';

  const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
  const tok = () => localStorage.getItem('bp_token') ?? '';
  async function apiFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ── Tenant badge (derived from logged-in user) ────────────────────────────
  const TENANT_BADGE: Record<string, { bg: string; color: string; label: string }> = {
    platform:   { bg: '#EEEDFE', color: '#3C3489', label: 'Platform' },
    master_msp: { bg: '#E1F5EE', color: '#085041', label: 'Master MSP' },
    msp:        { bg: '#E6F1FB', color: '#0C447C', label: 'MSP' },
  };

  // ── Config state ──────────────────────────────────────────────────────────
  let pmConfig: ProblemConfig = defaultConfig();
  let saving = false;
  let saveSuccess = false;
  let saveError = '';

  // ── Scope data ────────────────────────────────────────────────────────────
  let msps: { id: number; name: string }[] = [];
  let clients: { id: number; name: string }[] = [];
  let scopeDevices: { id: number; name: string }[] = [];
  let scopeLoading = false;

  // Multi-select dropdown open state
  let scopeMspOpen = false;
  let excludeClientOpen = false;
  let excludeDeviceOpen = false;
  let devicesLoaded = false;

  // ── PSA integration status ────────────────────────────────────────────────
  let psaConnected = false;
  let psaIntegName = '';

  // ── Live PSA options ──────────────────────────────────────────────────────
  interface PsaOptions {
    provider: string | null; connected: boolean;
    boards: string[]; types: string[]; priorities: string[];
    statuses: string[]; agents: string[]; slas: string[];
    labels: { board?: string; type?: string; priority?: string };
    error?: string;
  }
  let psaOptions: PsaOptions = {
    provider: null, connected: false,
    boards: [], types: [], priorities: [], statuses: [], agents: [], slas: [],
    labels: {},
  };
  let psaOptionsLoading = false;

  async function loadPsaOptions() {
    psaOptionsLoading = true;
    try {
      psaOptions = await apiFetch('/api/v1/problem-management/psa-options') as PsaOptions;
      if (psaOptions.connected) { psaConnected = true; }
    } catch { /* keep defaults */ }
    finally { psaOptionsLoading = false; }
  }

  // ── Advanced section ──────────────────────────────────────────────────────
  let showAdvanced = false;

  // ── Reactive helpers ──────────────────────────────────────────────────────
  $: psaDef = PSA_CONFIG[pmConfig.psa_provider] ?? PSA_CONFIG.connectwise;
  $: tenantBadge = TENANT_BADGE[$auth?.tenant_type ?? 'msp'] ?? TENANT_BADGE.msp;

  // Live options with fallback to hardcoded PSA_CONFIG
  $: boardOptions    = psaOptions.boards.length     ? psaOptions.boards     : psaDef.boards;
  $: typeOptions     = psaOptions.types.length      ? psaOptions.types      : psaDef.types;
  $: priorityOptions = psaOptions.priorities.length ? psaOptions.priorities : psaDef.priorities;
  $: statusOptions   = psaOptions.statuses.length   ? psaOptions.statuses   : psaDef.statuses;
  $: agentOptions    = psaOptions.agents.length     ? psaOptions.agents
                       : ['Unassigned', 'NOC Team', 'Backup Specialist', 'Tier 2 Queue'];
  $: slaOptions      = psaOptions.slas.length       ? psaOptions.slas
                       : ['Standard SLA – 4 hr', 'Premium SLA – 1 hr', 'NBD', 'No SLA'];
  $: boardLabel    = psaOptions.labels.board    ?? psaDef.boardLabel;
  $: typeLabel     = psaOptions.labels.type     ?? psaDef.typeLabel;
  $: priorityLabel = psaOptions.labels.priority ?? psaDef.priorityLabel;

  const PSA_TOGGLES: { key: string; label: string; desc: string }[] = [
    { key: 'auto_create_ticket', label: 'Auto-create ticket when problem detected',
      desc: 'When a job crosses threshold, BackupPulse calls the PSA API to open a ticket.' },
    { key: 'dedupe_tickets', label: 'Prevent duplicate tickets',
      desc: 'Check PSA for an existing open ticket before creating. Appends a note if found.' },
    { key: 'auto_resolve', label: 'Auto-resolve when jobs recover',
      desc: 'Auto-closes the ticket after consecutive successful runs.' },
    { key: 'append_notes', label: 'Add internal note on each new failure',
      desc: 'Appends a private note with timestamp, device, and error on each subsequent failure.' },
  ];

  $: thresholdSummary =
    `Flag as problem when a job has ≥ ${pmConfig.failure_count_threshold} failures ${windowLabel(pmConfig.time_window)}, ` +
    `or ${pmConfig.consecutive_threshold} consecutive failures, ` +
    `or ≥ ${pmConfig.failure_pct_threshold}% of scheduled runs fail.`;

  $: titlePreview = pmConfig.title_template
    .replace(/{client}/g, 'Universal Data')
    .replace(/{device}/g, 'File Server')
    .replace(/{job}/g, 'Daily Full Backup')
    .replace(/{failure_count}/g, '5')
    .replace(/{window}/g, 'this week')
    .replace(/{source}/g, 'Cove')
    .replace(/{date}/g, new Date().toLocaleDateString())
    .replace(/{consecutive_count}/g, '3');

  $: mspScopeLabel = pmConfig.scope_msp_ids.length === 0
    ? 'All MSPs'
    : pmConfig.scope_msp_ids.length === 1
      ? (msps.find(m => m.id === pmConfig.scope_msp_ids[0])?.name ?? '1 MSP')
      : `${pmConfig.scope_msp_ids.length} MSPs selected`;

  $: clientExclLabel = pmConfig.excluded_client_ids.length === 0
    ? 'No exclusions'
    : pmConfig.excluded_client_ids.length === 1
      ? `Excl. ${clients.find(c => c.id === pmConfig.excluded_client_ids[0])?.name ?? '1 client'}`
      : `Excluding ${pmConfig.excluded_client_ids.length} clients`;

  $: deviceExclLabel = pmConfig.excluded_device_ids.length === 0
    ? 'No exclusions'
    : pmConfig.excluded_device_ids.length === 1
      ? `Excl. ${scopeDevices.find(d => d.id === pmConfig.excluded_device_ids[0])?.name ?? '1 device'}`
      : `Excluding ${pmConfig.excluded_device_ids.length} devices`;

  $: breadcrumb = (() => {
    const parts: string[] = [$auth?.display_name ?? ''];
    parts.push(mspScopeLabel);
    if (pmConfig.excluded_client_ids.length > 0) parts.push(clientExclLabel);
    if (pmConfig.excluded_device_ids.length > 0) parts.push(deviceExclLabel);
    return parts;
  })();

  // ── Load functions ────────────────────────────────────────────────────────
  async function loadScopeData() {
    scopeLoading = true;
    try {
      const tt = $auth?.tenant_type ?? 'msp';
      if (tt !== 'msp') {
        const [mspRes, clientRes] = await Promise.all([
          apiFetch('/api/v1/manage/companies?type=msp'),
          apiFetch('/api/v1/manage/companies?type=client'),
        ]);
        msps = mspRes.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name }));
        clients = clientRes.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name }));
      } else {
        const res = await apiFetch('/api/v1/manage/companies?type=client');
        clients = res.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name }));
      }
    } catch { /* silently handle */ }
    finally { scopeLoading = false; }
  }

  async function loadAllDevices() {
    if (devicesLoaded) return;
    devicesLoaded = true;
    try {
      const res = await apiFetch('/api/v1/manage/devices');
      scopeDevices = (res as { id: number; name: string }[]).map(d => ({ id: d.id, name: d.name }));
    } catch { scopeDevices = []; }
  }

  function toggleScopeMsp(id: number) {
    pmConfig.scope_msp_ids = pmConfig.scope_msp_ids.includes(id)
      ? pmConfig.scope_msp_ids.filter((x: number) => x !== id)
      : [...pmConfig.scope_msp_ids, id];
  }

  function toggleExcludeClient(id: number) {
    pmConfig.excluded_client_ids = pmConfig.excluded_client_ids.includes(id)
      ? pmConfig.excluded_client_ids.filter((x: number) => x !== id)
      : [...pmConfig.excluded_client_ids, id];
  }

  function toggleExcludeDevice(id: number) {
    pmConfig.excluded_device_ids = pmConfig.excluded_device_ids.includes(id)
      ? pmConfig.excluded_device_ids.filter((x: number) => x !== id)
      : [...pmConfig.excluded_device_ids, id];
  }

  async function loadConfig() {
    try {
      const cfg = await api.pmConfig() as Record<string, unknown>;
      if (cfg) {
        for (const [k, v] of Object.entries(cfg)) {
          if (k in pmConfig && v !== null && v !== undefined) {
            (pmConfig as Record<string, unknown>)[k] = v;
          }
        }
        pmConfig = { ...pmConfig };
      }
    } catch { /* no config yet, keep defaults */ }
  }

  async function loadPsaStatus() {
    try {
      const integrations = await apiFetch('/api/v1/integrations');
      const psa = (integrations as { category: string; display_name: string; is_enabled: boolean }[])
        .find(i => i.category === 'psa' && i.is_enabled);
      if (psa) { psaConnected = true; psaIntegName = psa.display_name; }
    } catch { /* no PSA */ }
  }

  onMount(async () => {
    await Promise.all([loadConfig(), loadScopeData(), loadPsaStatus(), loadPsaOptions()]);
  });

  async function saveConfig() {
    saving = true; saveSuccess = false; saveError = '';
    try {
      await api.savePmConfig(pmConfig);
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
    } catch (e: unknown) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally { saving = false; }
  }

  function resetConfig() { pmConfig = defaultConfig(); }

  // ── Clear all tickets ─────────────────────────────────────────────────────
  let clearingTickets = false;
  let clearTicketsSuccess = '';
  let clearTicketsError = '';

  async function clearAllTickets() {
    if (!confirm('Clear all problem ticket markers? This cannot be undone.')) return;
    clearingTickets = true;
    clearTicketsSuccess = '';
    clearTicketsError = '';
    try {
      const r = await apiFetch('/api/v1/problem-management/tickets', { method: 'DELETE' });
      clearTicketsSuccess = 'Cleared ' + r.cleared + ' ticket' + (r.cleared === 1 ? '' : 's');
      setTimeout(() => { clearTicketsSuccess = ''; }, 4000);
    } catch (e: unknown) {
      clearTicketsError = e instanceof Error ? e.message : 'Clear failed';
      setTimeout(() => { clearTicketsError = ''; }, 4000);
    } finally {
      clearingTickets = false;
    }
  }

  function addCustomField() {
    pmConfig.custom_fields = [...pmConfig.custom_fields, { fieldName: '', value: '', notes: '' }];
  }

  function removeCustomField(i: number) {
    pmConfig.custom_fields = pmConfig.custom_fields.filter((_, idx) => idx !== i);
  }

  function togglePsaFlag(key: string) {
    const cfg = pmConfig as Record<string, unknown>;
    cfg[key] = !cfg[key];
    pmConfig = { ...pmConfig };
  }

  function psaFlag(key: string): boolean {
    return !!(pmConfig as Record<string, unknown>)[key];
  }

  function closeAllScopeDropdowns() {
    scopeMspOpen = false;
    excludeClientOpen = false;
    excludeDeviceOpen = false;
  }
</script>

<svelte:window on:click={closeAllScopeDropdowns} />

<!-- ── Page ───────────────────────────────────────────────────────────────── -->
<div style="max-width:900px; margin:0 auto; padding-bottom:40px;">

  <!-- Header row -->
  <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px;">
    <div>
      <h1 style="font-size:15px; font-weight:700; color:#ffffff; margin:0 0 4px;">Problem management</h1>
      <p style="font-size:12px; color:#9ca3af; margin:0;">Set failure thresholds and auto-ticketing rules.</p>
    </div>
    <!-- PSA status badge + clear tickets + tenant sim -->
    <div style="display:flex; align-items:center; gap:12px;">
      {#if clearTicketsSuccess}
        <span style="font-size:11px; padding:3px 10px; border-radius:99px;
                     background:#1a2e1a; color:#4ade80; border:1px solid #2d4a2d;">
          ✓ {clearTicketsSuccess}
        </span>
      {/if}
      {#if clearTicketsError}
        <span style="font-size:11px; padding:3px 10px; border-radius:99px;
                     background:#3b2a1a; color:#fb923c; border:1px solid #4a3a2a;">
          {clearTicketsError}
        </span>
      {/if}
      <button on:click={clearAllTickets} disabled={clearingTickets}
        style="font-size:12px; padding:5px 14px; border-radius:6px; cursor:pointer;
               background:#3b1a1a; color:#f87171; border:1px solid #5a2a2a;
               opacity:{clearingTickets ? '0.6' : '1'};">
        {clearingTickets ? 'Clearing…' : 'Clear All Tickets'}
      </button>
      {#if psaConnected}
        <span style="font-size:11px; padding:3px 10px; border-radius:99px;
                     background:#1a2e1a; color:#4ade80; border:1px solid #2d4a2d;">
          ✓ {psaIntegName} connected
        </span>
      {:else}
        <span style="font-size:11px; padding:3px 10px; border-radius:99px;
                     background:#3b2a1a; color:#fb923c; border:1px solid #4a3a2a;">
          ⚠ No PSA connected
        </span>
      {/if}
    </div>
  </div>

  <!-- ── SECTION 1: Select scope ── -->
  <div style="background:#23233a; border-radius:10px; border-left:4px solid #a78bfa;
               padding:18px 20px; margin-bottom:16px;">
    <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
               color:#6b7280; margin:0 0 14px; font-weight:600;">1 — Select scope</p>

    <!-- Context bar -->
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:16px; padding:8px 12px;
                background:#1e1e35; border-radius:8px; border:1px solid #2d2d45;">
      <span style="font-size:11px; padding:2px 8px; border-radius:99px;
                   background:{tenantBadge.bg}; color:{tenantBadge.color}; font-weight:600;">{tenantBadge.label}</span>
      <span style="font-size:12px; color:#d1d5db; font-weight:500;">{$auth?.display_name ?? ''}</span>
      <span style="font-size:11px; color:#6b7280; margin-left:4px;">
        {$auth?.tenant_type === 'platform' ? '— full platform access' :
         $auth?.tenant_type === 'master_msp' ? '— manages multiple MSPs' : '— direct client access'}
      </span>
    </div>

    <!-- 3-step multi-select / exclusion dropdowns -->
    <div style="display:flex; flex-direction:column; gap:12px;">

      <!-- Step 1 — Select MSPs (multi-select include, hidden for msp tenants) -->
      {#if $auth?.tenant_type !== 'msp'}
        <div style="display:flex; align-items:flex-start; gap:12px;">
          <div style="width:20px; height:20px; border-radius:50%; display:flex; align-items:center;
                       justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; margin-top:22px;
                       background:#4ade80; color:#000;">1</div>
          <div style="flex:1; position:relative;">
            <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Select MSPs</label>
            <button type="button" on:click|stopPropagation={() => { scopeMspOpen = !scopeMspOpen; excludeClientOpen = false; excludeDeviceOpen = false; }}
              style="width:100%; background:#1e1e35; border:1px solid #374151; color:{pmConfig.scope_msp_ids.length ? '#d1d5db' : '#6b7280'};
                     border-radius:6px; padding:7px 10px; font-size:12px; text-align:left; cursor:pointer;
                     display:flex; justify-content:space-between; align-items:center;">
              <span>{mspScopeLabel}</span>
              <span style="color:#6b7280; font-size:10px;">{scopeMspOpen ? '▲' : '▼'}</span>
            </button>
            {#if scopeMspOpen}
              <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
              <div on:click|stopPropagation
                style="position:absolute; top:100%; left:0; right:0; z-index:50; margin-top:2px;
                       background:#1e1e35; border:1px solid #374151; border-radius:6px;
                       max-height:220px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.5);">
                <label style="display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer;
                               border-bottom:1px solid #2d2d45; color:#d1d5db; font-size:12px;
                               background:{pmConfig.scope_msp_ids.length === 0 ? '#2d2d45' : 'transparent'};">
                  <input type="checkbox" checked={pmConfig.scope_msp_ids.length === 0}
                    on:change={() => { pmConfig.scope_msp_ids = []; }}
                    style="accent-color:#a78bfa;" />
                  All MSPs
                </label>
                {#each msps as m}
                  <label style="display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer;
                                 color:#d1d5db; font-size:12px;
                                 background:{pmConfig.scope_msp_ids.includes(m.id) ? '#2a2a42' : 'transparent'};">
                    <input type="checkbox" checked={pmConfig.scope_msp_ids.includes(m.id)}
                      on:change={() => toggleScopeMsp(m.id)}
                      style="accent-color:#a78bfa;" />
                    {m.name}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Step 2 — Except these clients (multi-select exclusion) -->
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:20px; height:20px; border-radius:50%; display:flex; align-items:center;
                     justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; margin-top:22px;
                     background:#4ade80; color:#000;">{$auth?.tenant_type === 'msp' ? 1 : 2}</div>
        <div style="flex:1; position:relative;">
          <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Except these clients</label>
          <button type="button" on:click|stopPropagation={() => { excludeClientOpen = !excludeClientOpen; scopeMspOpen = false; excludeDeviceOpen = false; }}
            style="width:100%; background:#1e1e35; border:1px solid #374151;
                   color:{pmConfig.excluded_client_ids.length ? '#f87171' : '#6b7280'};
                   border-radius:6px; padding:7px 10px; font-size:12px; text-align:left; cursor:pointer;
                   display:flex; justify-content:space-between; align-items:center;">
            <span>{clientExclLabel}</span>
            <span style="color:#6b7280; font-size:10px;">{excludeClientOpen ? '▲' : '▼'}</span>
          </button>
          {#if excludeClientOpen}
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
            <div on:click|stopPropagation
              style="position:absolute; top:100%; left:0; right:0; z-index:50; margin-top:2px;
                     background:#1e1e35; border:1px solid #374151; border-radius:6px;
                     max-height:220px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.5);">
              {#if clients.length === 0}
                <div style="padding:10px 12px; color:#6b7280; font-size:12px;">No clients found</div>
              {:else}
                {#each clients as c}
                  <label style="display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer;
                                 color:{pmConfig.excluded_client_ids.includes(c.id) ? '#f87171' : '#d1d5db'}; font-size:12px;
                                 background:{pmConfig.excluded_client_ids.includes(c.id) ? '#2e1e1e' : 'transparent'};">
                    <input type="checkbox" checked={pmConfig.excluded_client_ids.includes(c.id)}
                      on:change={() => toggleExcludeClient(c.id)}
                      style="accent-color:#f87171;" />
                    {c.name}
                  </label>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Step 3 — Except these devices (multi-select exclusion) -->
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:20px; height:20px; border-radius:50%; display:flex; align-items:center;
                     justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; margin-top:22px;
                     background:#4ade80; color:#000;">{$auth?.tenant_type === 'msp' ? 2 : 3}</div>
        <div style="flex:1; position:relative;">
          <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Except these devices</label>
          <button type="button" on:click|stopPropagation={() => { excludeDeviceOpen = !excludeDeviceOpen; scopeMspOpen = false; excludeClientOpen = false; loadAllDevices(); }}
            style="width:100%; background:#1e1e35; border:1px solid #374151;
                   color:{pmConfig.excluded_device_ids.length ? '#f87171' : '#6b7280'};
                   border-radius:6px; padding:7px 10px; font-size:12px; text-align:left; cursor:pointer;
                   display:flex; justify-content:space-between; align-items:center;">
            <span>{deviceExclLabel}</span>
            <span style="color:#6b7280; font-size:10px;">{excludeDeviceOpen ? '▲' : '▼'}</span>
          </button>
          {#if excludeDeviceOpen}
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
            <div on:click|stopPropagation
              style="position:absolute; top:100%; left:0; right:0; z-index:50; margin-top:2px;
                     background:#1e1e35; border:1px solid #374151; border-radius:6px;
                     max-height:220px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.5);">
              {#if scopeDevices.length === 0}
                <div style="padding:10px 12px; color:#6b7280; font-size:12px;">
                  {devicesLoaded ? 'No devices found' : 'Loading…'}
                </div>
              {:else}
                {#each scopeDevices as d}
                  <label style="display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer;
                                 color:{pmConfig.excluded_device_ids.includes(d.id) ? '#f87171' : '#d1d5db'}; font-size:12px;
                                 background:{pmConfig.excluded_device_ids.includes(d.id) ? '#2e1e1e' : 'transparent'};">
                    <input type="checkbox" checked={pmConfig.excluded_device_ids.includes(d.id)}
                      on:change={() => toggleExcludeDevice(d.id)}
                      style="accent-color:#f87171;" />
                    {d.name}
                  </label>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>

    </div>

    <!-- Breadcrumb -->
    {#if breadcrumb.length > 1}
      <div style="display:flex; align-items:center; gap:6px; margin-top:14px; flex-wrap:wrap;">
        {#each breadcrumb as part, i}
          {#if i > 0}<span style="color:#6b7280; font-size:11px;">›</span>{/if}
          {@const colors = [
            ['#EEEDFE','#3C3489'], ['#E1F5EE','#085041'], ['#E6F1FB','#0C447C'], ['#1e1e35','#9ca3af']
          ][Math.min(i, 3)]}
          <span style="font-size:11px; padding:2px 8px; border-radius:99px;
                       background:{colors[0]}; color:{colors[1]};">{part}</span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ── SECTION 2: Failure threshold ── -->
  <div style="background:#23233a; border-radius:10px; border-left:4px solid #f87171;
               padding:18px 20px; margin-bottom:16px;">
    <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
               color:#6b7280; margin:0 0 14px; font-weight:600;">2 — Failure threshold</p>

    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Time window</label>
        <select bind:value={pmConfig.time_window}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="rolling_7">Rolling 7 days</option>
          <option value="rolling_30">Rolling 30 days</option>
        </select>
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Failure count ≥</label>
        <input type="number" bind:value={pmConfig.failure_count_threshold} min="1" max="30"
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;" />
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Consecutive ≥</label>
        <input type="number" bind:value={pmConfig.consecutive_threshold} min="1" max="10"
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;" />
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Failure % ≥</label>
        <input type="number" bind:value={pmConfig.failure_pct_threshold} min="1" max="100"
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;" />
      </div>
    </div>

    <!-- Live summary -->
    <div style="background:#1e1e35; border-radius:8px; padding:10px 14px; margin-bottom:14px;
                border:1px solid #2d2d45;">
      <p style="font-size:12px; color:#d1d5db; margin:0; line-height:1.6;">{thresholdSummary}</p>
    </div>

    <!-- Preview rows -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      {#each [
        { label: 'Daily Full Backup', count: pmConfig.failure_count_threshold, consec: pmConfig.consecutive_threshold,
          status: 'action', statusLabel: 'Action required', statusBg: '#3b2a1a', statusColor: '#fb923c' },
        { label: 'Incremental Sync', count: pmConfig.failure_count_threshold - 1, consec: pmConfig.consecutive_threshold - 1,
          status: 'approaching', statusLabel: 'Approaching', statusBg: '#2a2a1a', statusColor: '#fbbf24' },
        { label: 'Weekly Archive', count: 0, consec: 0,
          status: 'healthy', statusLabel: 'Healthy', statusBg: '#1a2e1a', statusColor: '#4ade80' },
      ] as row}
        <div style="display:flex; align-items:center; justify-content:space-between;
                    padding:8px 12px; background:#141420; border-radius:6px; border:1px solid #2d2d45;">
          <span style="font-size:12px; color:#d1d5db;">{row.label}</span>
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:11px; color:#6b7280;">{row.count} failure{row.count !== 1 ? 's' : ''} · {row.consec} consec.</span>
            <span style="font-size:11px; padding:2px 8px; border-radius:99px;
                         background:{row.statusBg}; color:{row.statusColor};">{row.statusLabel}</span>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ── SECTION 3: PSA ticket configuration ── -->
  <div style="background:#23233a; border-radius:10px; border-left:4px solid #38bdf8;
               padding:18px 20px; margin-bottom:16px;">
    <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
               color:#6b7280; margin:0 0 14px; font-weight:600;">3 — PSA ticket configuration</p>

    <!-- Toggle rows -->
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
      {#each PSA_TOGGLES as row}
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
          <div>
            <p style="font-size:12px; font-weight:500; color:#d1d5db; margin:0 0 2px;">{row.label}</p>
            <p style="font-size:11px; color:#6b7280; margin:0;">{row.desc}</p>
          </div>
          <!-- Toggle switch -->
          <button
            on:click={() => togglePsaFlag(row.key)}
            role="switch"
            aria-checked={psaFlag(row.key)}
            style="position:relative; width:34px; height:18px; border-radius:99px; border:none;
                   cursor:pointer; flex-shrink:0; margin-top:2px;
                   background:{psaFlag(row.key) ? '#1a73e8' : '#374151'}; transition:background 0.2s;">
            <span style="position:absolute; top:3px; width:12px; height:12px; border-radius:50%;
                          background:#fff; transition:left 0.2s;
                          left:{psaFlag(row.key) ? '19px' : '3px'};"></span>
          </button>
        </div>
      {/each}
    </div>

    <!-- PSA not connected warning -->
    {#if !psaConnected && pmConfig.auto_create_ticket}
      <div style="background:#3b2a1a; border:1px solid #4a3a2a; border-radius:8px;
                  padding:10px 14px; margin-bottom:16px;">
        <p style="font-size:12px; color:#fb923c; margin:0;">
          ⚠ PSA not connected — configure in Settings → Integrations before enabling auto-ticketing.
        </p>
      </div>
    {/if}

    <!-- Row 1: PSA + Board -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">
          Connected PSA
          {#if psaConnected}<span style="color:#4ade80; margin-left:6px;">● Connected</span>{/if}
        </label>
        <select bind:value={pmConfig.psa_provider}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          <option value="connectwise">ConnectWise Manage</option>
          <option value="halopsa">HaloPSA</option>
          <option value="autotask">Autotask</option>
          <option value="freshservice">Freshservice</option>
        </select>
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">{boardLabel}</label>
        <select bind:value={pmConfig.psa_board}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each boardOptions as b}<option value={b}>{b}</option>{/each}
        </select>
      </div>
    </div>

    <!-- Row 2: Priority / Type / Assign -->
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px;">
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">{priorityLabel}</label>
        <select bind:value={pmConfig.psa_priority}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each priorityOptions as p}<option value={p}>{p}</option>{/each}
        </select>
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">{typeLabel}</label>
        <select bind:value={pmConfig.psa_ticket_type}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each typeOptions as t}<option value={t}>{t}</option>{/each}
        </select>
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Assign to</label>
        <select bind:value={pmConfig.psa_assign_to}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each agentOptions as a}<option value={a}>{a}</option>{/each}
        </select>
        <p style="font-size:10px; color:#6b7280; margin:3px 0 0;">Leave unassigned to follow board routing rules.</p>
      </div>
    </div>

    <!-- Row 3: SLA / Status -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">SLA / Response target</label>
        <select bind:value={pmConfig.psa_sla}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each slaOptions as s}<option value={s}>{s}</option>{/each}
        </select>
        <p style="font-size:10px; color:#6b7280; margin:3px 0 0;">Must match an agreement in your PSA.</p>
      </div>
      <div>
        <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Status on creation</label>
        <select bind:value={pmConfig.psa_status_on_create}
          style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                 border-radius:6px; padding:7px 10px; font-size:12px;">
          {#each statusOptions as s}<option value={s}>{s}</option>{/each}
        </select>
        <p style="font-size:10px; color:#6b7280; margin:3px 0 0;">Useful if your board has automation rules on status change.</p>
      </div>
    </div>

    <!-- Row 4: Title template -->
    <div style="margin-bottom:12px;">
      <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Ticket title template</label>
      <input type="text" bind:value={pmConfig.title_template}
        style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
               border-radius:6px; padding:7px 10px; font-size:12px; box-sizing:border-box;" />
      <p style="font-size:10px; color:#6b7280; margin:4px 0 4px;">
        Tokens: {'{client}'} {'{device}'} {'{job}'} {'{failure_count}'} {'{window}'} {'{source}'} {'{date}'} {'{consecutive_count}'}
      </p>
      <div style="background:#141420; border:1px solid #2d2d45; border-radius:6px; padding:8px 10px;">
        <p style="font-size:10px; color:#6b7280; margin:0 0 2px; text-transform:uppercase;">Preview</p>
        <p style="font-size:11px; color:#a78bfa; margin:0; font-family:monospace;">{titlePreview}</p>
      </div>
    </div>

    <!-- Row 5: Body template -->
    <div style="margin-bottom:16px;">
      <label style="font-size:11px; color:#9ca3af; display:block; margin-bottom:4px;">Ticket body template</label>
      <textarea bind:value={pmConfig.body_template} rows={10}
        style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
               border-radius:6px; padding:7px 10px; font-size:11px; font-family:monospace;
               resize:vertical; box-sizing:border-box;"></textarea>
    </div>

    <!-- Advanced: custom field mapping -->
    <div>
      <button
        on:click={() => showAdvanced = !showAdvanced}
        style="font-size:11px; color:#a78bfa; background:none; border:none; cursor:pointer; padding:0;">
        {showAdvanced ? '▼' : '▶'} Advanced — custom field mapping
      </button>

      {#if showAdvanced}
        <div style="margin-top:10px; border:1px solid #2d2d45; border-radius:8px; overflow:hidden;">
          <table style="width:100%; border-collapse:collapse; font-size:11px;">
            <thead>
              <tr style="background:#1e1e35;">
                {#each ['PSA custom field', 'Value to set', 'Notes', ''] as h}
                  <th style="padding:8px 12px; text-align:left; color:#6b7280;
                              font-size:10px; text-transform:uppercase; font-weight:600;">{h}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each pmConfig.custom_fields as cf, i}
                <tr style="border-top:1px solid #2d2d45;">
                  <td style="padding:6px 12px;">
                    <input type="text" bind:value={cf.fieldName}
                      style="width:100%; background:#141420; border:1px solid #374151; color:#d1d5db;
                             border-radius:4px; padding:4px 8px; font-size:11px;" />
                  </td>
                  <td style="padding:6px 12px;">
                    <input type="text" bind:value={cf.value}
                      style="width:100%; background:#141420; border:1px solid #374151; color:#a78bfa;
                             border-radius:4px; padding:4px 8px; font-size:11px; font-family:monospace;" />
                  </td>
                  <td style="padding:6px 12px; color:#6b7280;">{cf.notes}</td>
                  <td style="padding:6px 12px;">
                    <button on:click={() => removeCustomField(i)}
                      style="color:#f87171; background:none; border:none; cursor:pointer; font-size:14px;">×</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div style="padding:8px 12px; background:#1e1e35; border-top:1px solid #2d2d45;">
            <button on:click={addCustomField}
              style="font-size:11px; color:#38bdf8; background:none; border:none; cursor:pointer; padding:0;">
              + Add custom field
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- ── SECTION 4: Notifications ── -->
  <div style="background:#23233a; border-radius:10px; border-left:4px solid #a3e635;
               padding:18px 20px; margin-bottom:20px;">
    <p style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
               color:#6b7280; margin:0 0 14px; font-weight:600;">4 — Notifications</p>

    <div style="display:flex; flex-direction:column; gap:14px;">
      <!-- Email alert -->
      <div>
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:6px;">
          <div>
            <p style="font-size:12px; font-weight:500; color:#d1d5db; margin:0 0 2px;">Email alert when problem detected</p>
            <p style="font-size:11px; color:#6b7280; margin:0;">Send to NOC distribution list on threshold breach</p>
          </div>
          <button
            on:click={() => { pmConfig.email_alert = !pmConfig.email_alert; pmConfig = pmConfig; }}
            role="switch" aria-checked={pmConfig.email_alert}
            style="position:relative; width:34px; height:18px; border-radius:99px; border:none; cursor:pointer;
                   flex-shrink:0; margin-top:2px; background:{pmConfig.email_alert ? '#1a73e8' : '#374151'};">
            <span style="position:absolute; top:3px; width:12px; height:12px; border-radius:50%;
                          background:#fff; left:{pmConfig.email_alert ? '19px' : '3px'};"></span>
          </button>
        </div>
        {#if pmConfig.email_alert}
          <input type="email" bind:value={pmConfig.email_address} placeholder="noc@company.com"
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                   border-radius:6px; padding:7px 10px; font-size:12px; box-sizing:border-box;" />
        {/if}
      </div>

      <!-- Teams/Slack alert -->
      <div>
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:6px;">
          <div>
            <p style="font-size:12px; font-weight:500; color:#d1d5db; margin:0 0 2px;">Teams / Slack notification</p>
            <p style="font-size:11px; color:#6b7280; margin:0;">Post to configured webhook channel</p>
          </div>
          <button
            on:click={() => { pmConfig.teams_alert = !pmConfig.teams_alert; pmConfig = pmConfig; }}
            role="switch" aria-checked={pmConfig.teams_alert}
            style="position:relative; width:34px; height:18px; border-radius:99px; border:none; cursor:pointer;
                   flex-shrink:0; margin-top:2px; background:{pmConfig.teams_alert ? '#1a73e8' : '#374151'};">
            <span style="position:absolute; top:3px; width:12px; height:12px; border-radius:50%;
                          background:#fff; left:{pmConfig.teams_alert ? '19px' : '3px'};"></span>
          </button>
        </div>
        {#if pmConfig.teams_alert}
          <input type="text" bind:value={pmConfig.webhook_url} placeholder="https://hooks.slack.com/services/..."
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db;
                   border-radius:6px; padding:7px 10px; font-size:12px; box-sizing:border-box;" />
        {/if}
      </div>
    </div>
  </div>

  <!-- ── Footer ── -->
  <div style="display:flex; align-items:center; justify-content:flex-end; gap:12px;">
    {#if saveSuccess}
      <span style="font-size:12px; color:#4ade80;">✓ Saved</span>
    {/if}
    {#if saveError}
      <span style="font-size:12px; color:#f87171;">{saveError}</span>
    {/if}
    <button
      on:click={resetConfig}
      style="font-size:12px; padding:8px 18px; border-radius:6px; cursor:pointer;
             background:transparent; border:1px solid #374151; color:#9ca3af;">
      Reset to defaults
    </button>
    <button
      on:click={saveConfig}
      disabled={saving}
      style="font-size:12px; padding:8px 18px; border-radius:6px; cursor:pointer;
             background:#fb923c; border:none; color:#ffffff; opacity:{saving ? 0.7 : 1};">
      {saving ? 'Saving…' : 'Save configuration'}
    </button>
  </div>
</div>
