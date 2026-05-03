<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';

  const BASE = import.meta.env.VITE_API_BASE ?? '';
  const tok = () => localStorage.getItem('bp_token') ?? '';

  async function apiFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  type Asset = {
    id: number;
    name: string;
    description: string | null;
    source: string;
    source_id: string | null;
    is_active: boolean;
    org_id: number | null;
    client: string | null;
    msp: string | null;
    backup_enabled: boolean;
    last_backup: string | null;
    last_success: string | null;
    backup_status: string | null;
    // Retention from BCDR connector
    local_retention_days: number | null;
    offsite_retention_days: number | null;
    local_snapshot_count: number | null;
    local_storage_bytes: number | null;
    offsite_storage_bytes: number | null;
    latest_offsite_at: string | null;
    appliance_storage_pct: number | null;
    retention_alert: boolean;
    retention_synced_at: string | null;
    // RTO / RPO
    rto_target_minutes: number | null;
    rpo_threshold_hours: number | null;
    last_rpo_minutes: number | null;
    rpo_breached: boolean | null;
    last_restore_at: string | null;
  };

  type SyncStatus = {
    psa_devices: number;
    backup_devices: number;
    unprotected: number;
    total: number;
  };

  let assets: Asset[] = [];
  let syncStatus: SyncStatus = { psa_devices: 0, backup_devices: 0, unprotected: 0, total: 0 };
  let loading = true;
  let syncing = false;
  let syncMsg = '';
  let syncingRetention = false;
  let retentionMsg = '';
  let error = '';

  // Filters
  let filterClient = '';
  let filterProtected = 'all'; // 'all' | 'protected' | 'unprotected'
  let filterSource   = 'all'; // 'all' | 'psa' | 'backup_connector'
  let search = '';

  $: protectedCount   = assets.filter(a => a.backup_enabled).length;
  $: unprotectedCount = assets.filter(a => !a.backup_enabled).length;

  $: filtered = assets.filter(a => {
    if (filterClient && a.client !== filterClient) return false;
    if (filterProtected === 'protected'   && !a.backup_enabled) return false;
    if (filterProtected === 'unprotected' &&  a.backup_enabled) return false;
    if (filterSource !== 'all' && a.source !== filterSource) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())
               && !(a.client ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  $: clients = [...new Set(assets.map(a => a.client).filter(Boolean))] as string[];

  onMount(async () => {
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      const [devData, statusData] = await Promise.all([
        apiFetch('/api/v1/assets'),
        apiFetch('/api/v1/assets/sync-status'),
      ]);
      assets     = devData.devices ?? [];
      syncStatus = statusData;
    } catch (e: any) {
      error = e.message ?? 'Failed to load assets';
    } finally {
      loading = false;
    }
  }

  async function syncNow() {
    syncing = true; syncMsg = '';
    try {
      const res = await apiFetch('/api/v1/integrations/psa/sync-devices', { method: 'POST' });
      syncMsg = `Sync complete — ${res.created ?? 0} created, ${res.updated ?? 0} updated`;
      await load();
    } catch (e: any) {
      syncMsg = e.message ?? 'Sync failed';
    } finally {
      syncing = false;
    }
  }

  async function syncRetention() {
    syncingRetention = true; retentionMsg = '';
    try {
      const res = await apiFetch('/api/v1/assets/sync-retention', { method: 'POST' });
      retentionMsg = res.message ?? 'Retention sync complete';
      await load();
    } catch (e: any) {
      retentionMsg = e.message ?? 'Retention sync failed';
    } finally {
      syncingRetention = false;
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function formatRto(mins: number | null): string {
    if (!mins) return '—';
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }

  function formatRpo(hrs: number | null): string {
    if (!hrs) return '—';
    return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
  }

  function formatBytes(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function retentionLabel(asset: Asset): string {
    if (asset.local_retention_days || asset.offsite_retention_days) {
      const local  = asset.local_retention_days  ? `L: ${asset.local_retention_days}d` : null;
      const remote = asset.offsite_retention_days ? `O: ${asset.offsite_retention_days}d` : null;
      return [local, remote].filter(Boolean).join(' / ');
    }
    if (asset.local_snapshot_count !== null) return `${asset.local_snapshot_count} snapshots`;
    return '—';
  }

  function hasRetentionData(asset: Asset): boolean {
    return asset.local_retention_days !== null
      || asset.offsite_retention_days !== null
      || asset.local_snapshot_count !== null
      || asset.appliance_storage_pct !== null
      || asset.latest_offsite_at !== null;
  }

  function storageColor(pct: number | null): string {
    if (pct === null) return '';
    if (pct >= 90) return 'text-red-600';
    if (pct >= 80) return 'text-yellow-600';
    return 'text-gray-500';
  }

  function statusColor(asset: Asset): string {
    if (!asset.backup_enabled) return 'text-red-600 bg-red-50';
    if (asset.backup_status === 'failed') return 'text-red-600 bg-red-50';
    if (asset.backup_status === 'warning') return 'text-yellow-700 bg-yellow-50';
    return 'text-green-700 bg-green-50';
  }

  function statusLabel(asset: Asset): string {
    if (!asset.backup_enabled) return 'No Backup';
    if (asset.backup_status === 'failed') return 'Failed';
    if (asset.backup_status === 'warning') return 'Warning';
    if (asset.backup_status === 'success') return 'Protected';
    return 'Protected';
  }
</script>

<div class="p-6 space-y-5">

  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-xl font-semibold text-gray-800">Assets</h1>
      <p class="text-sm text-gray-500 mt-0.5">All devices synced from PSA and backup connectors</p>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button
        on:click={syncRetention}
        disabled={syncingRetention}
        class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
        {#if syncingRetention}
          <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Syncing Retention…
        {:else}
          Sync Retention
        {/if}
      </button>
      <button
        on:click={syncNow}
        disabled={syncing}
        class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
        {#if syncing}
          <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Syncing…
        {:else}
          Sync PSA Assets
        {/if}
      </button>
    </div>
  </div>

  {#if syncMsg}
    <div class="text-sm px-4 py-2 rounded-lg bg-blue-50 text-blue-700">{syncMsg}</div>
  {/if}
  {#if retentionMsg}
    <div class="text-sm px-4 py-2 rounded-lg bg-green-50 text-green-700">{retentionMsg}</div>
  {/if}

  <!-- Summary cards -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
    <div class="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-3">
      <div class="text-xs text-gray-500 mb-1">Total Assets</div>
      <div class="text-2xl font-bold text-gray-800">{syncStatus.total}</div>
    </div>
    <div class="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-3">
      <div class="text-xs text-gray-500 mb-1">PSA Devices</div>
      <div class="text-2xl font-bold text-blue-600">{syncStatus.psa_devices}</div>
    </div>
    <div class="bg-green-50 rounded-lg border border-green-100 shadow-sm px-4 py-3">
      <div class="text-xs text-green-700 mb-1">Protected</div>
      <div class="text-2xl font-bold text-green-700">{protectedCount}</div>
    </div>
    <div class="bg-red-50 rounded-lg border border-red-100 shadow-sm px-4 py-3">
      <div class="text-xs text-red-600 mb-1">Unprotected</div>
      <div class="text-2xl font-bold text-red-600">{unprotectedCount}</div>
    </div>
  </div>

  <!-- Filters -->
  <div class="flex flex-wrap gap-3 items-center">
    <input
      bind:value={search}
      placeholder="Search device or client…"
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300" />

    <select bind:value={filterClient}
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
      <option value="">All Clients</option>
      {#each clients as c}<option value={c}>{c}</option>{/each}
    </select>

    <select bind:value={filterProtected}
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
      <option value="all">All Status</option>
      <option value="protected">Protected</option>
      <option value="unprotected">Unprotected</option>
    </select>

    <select bind:value={filterSource}
      class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
      <option value="all">All Sources</option>
      <option value="psa">PSA Only</option>
      <option value="backup_connector">Backup Connector</option>
    </select>

    <span class="text-xs text-gray-400 ml-auto">{filtered.length} device{filtered.length !== 1 ? 's' : ''}</span>
  </div>

  <!-- Table -->
  {#if loading}
    <div class="text-center py-12 text-gray-400 text-sm">Loading assets…</div>
  {:else if error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
  {:else if filtered.length === 0}
    <div class="text-center py-12 text-gray-400 text-sm">
      {#if syncStatus.psa_devices === 0}
        No PSA assets synced yet. Click <strong>Sync PSA Assets</strong> to pull devices from HaloPSA.
      {:else}
        No devices match the current filters.
      {/if}
    </div>
  {:else}
    <div class="bg-white rounded-lg shadow border border-gray-100 overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <th class="px-4 py-3 text-left font-medium">Device</th>
            <th class="px-4 py-3 text-left font-medium">Client</th>
            <th class="px-4 py-3 text-left font-medium">Source</th>
            <th class="px-4 py-3 text-left font-medium">Backup</th>
            <th class="px-4 py-3 text-left font-medium">Last Backup</th>
            <th class="px-4 py-3 text-left font-medium">Retention</th>
            <th class="px-4 py-3 text-left font-medium">RTO</th>
            <th class="px-4 py-3 text-left font-medium">RPO</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          {#each filtered as asset}
            <tr class="hover:bg-gray-50 transition-colors">

              <!-- Device name -->
              <td class="px-4 py-3">
                <div class="font-medium text-gray-800">{asset.name}</div>
                {#if asset.description}
                  <div class="text-xs text-gray-400">{asset.description}</div>
                {/if}
              </td>

              <!-- Client -->
              <td class="px-4 py-3 text-gray-600">{asset.client ?? '—'}</td>

              <!-- Source badge -->
              <td class="px-4 py-3">
                {#if asset.source === 'psa'}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">PSA</span>
                {:else}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Backup</span>
                {/if}
              </td>

              <!-- Backup status -->
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-0.5 rounded-full font-medium {statusColor(asset)}">
                  {statusLabel(asset)}
                </span>
              </td>

              <!-- Last backup -->
              <td class="px-4 py-3 text-gray-600">{formatDate(asset.last_backup)}</td>

              <!-- Retention from BCDR connector -->
              <td class="px-4 py-3">
                {#if hasRetentionData(asset)}
                  <div class="flex items-center gap-1.5">
                    <span class="text-gray-700 text-xs font-medium">{retentionLabel(asset)}</span>
                    {#if asset.retention_alert}
                      <span title="Alert: paused or archived" class="text-yellow-500 text-xs">⚠</span>
                    {/if}
                  </div>
                  {#if asset.appliance_storage_pct !== null}
                    <div class="text-xs {storageColor(asset.appliance_storage_pct)} mt-0.5">
                      {asset.appliance_storage_pct.toFixed(0)}% appliance storage
                    </div>
                  {/if}
                  {#if asset.latest_offsite_at}
                    <div class="text-xs text-gray-400">offsite {formatDate(asset.latest_offsite_at)}</div>
                  {/if}
                {:else}
                  <span class="text-gray-400">—</span>
                {/if}
              </td>

              <!-- RTO -->
              <td class="px-4 py-3 text-gray-600">{formatRto(asset.rto_target_minutes)}</td>

              <!-- RPO -->
              <td class="px-4 py-3">
                {#if asset.rpo_breached}
                  <span class="text-xs text-red-600 font-medium">⚠ Breached</span>
                {:else}
                  <span class="text-gray-600">{formatRpo(asset.rpo_threshold_hours)}</span>
                {/if}
              </td>

            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
