<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type DashboardStats, type DeviceSummary, type OrgSummary, type StorageAlert } from '$lib/api';
  import { auth } from '$lib/auth';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  let stats: DashboardStats | null = null;
  let trendStats: DashboardStats | null = null;
  let storageAlerts: StorageAlert[] = [];
  let error = '';
  let syncing = false;
  let resetting = false;

  // ── Date range ────────────────────────────────────────────────────────────
  function isoDate(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  // Default: last 24 hours
  const _now = new Date();
  const _yesterday = new Date(_now);
  _yesterday.setDate(_yesterday.getDate() - 1);

  let dateFrom: string = isoDate(_yesterday);
  let dateTo:   string = isoDate(_now);
  let pendingFrom: string = dateFrom;
  let pendingTo:   string = dateTo;
  let showDatePicker = false;


  function quickSelect(type: string) {
    const to = new Date();
    const from = new Date();
    if (type === 'week') {
      from.setDate(from.getDate() - 7);
    } else if (type === 'month') {
      from.setMonth(from.getMonth() - 1);
    } else if (type === 'this_quarter') {
      const qMonth = Math.floor(from.getMonth() / 3) * 3;
      from.setMonth(qMonth, 1);
    } else if (type === 'last_quarter') {
      const qMonth = Math.floor(from.getMonth() / 3) * 3;
      from.setMonth(qMonth - 3, 1);
      to.setMonth(qMonth, 0);
    }
    dateFrom = isoDate(from);
    dateTo   = isoDate(to);
    pendingFrom = dateFrom;
    pendingTo   = dateTo;
    showDatePicker = false;
    load();
  }

  function applyDateRange() {
    dateFrom = pendingFrom;
    dateTo   = pendingTo;
    showDatePicker = false;
    load();
  }

  // Drilldown — two levels for master_msp: MSP → sub-clients → devices
  let selectedOrg: OrgSummary | null = null;      // MSP or client row clicked in main table
  let subClients: OrgSummary[] = [];               // sub-clients under selected MSP
  let selectedSubClient: OrgSummary | null = null; // sub-client clicked in drilldown panel
  let devices: DeviceSummary[] = [];
  let panelLoading = false;


  onMount(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  });

  function dateParams() {
    return { from: dateFrom + 'T00:00:00', to: dateTo + 'T23:59:59' };
  }

  async function load() {
    try {
      [stats, trendStats, storageAlerts] = await Promise.all([
        api.stats(dateParams()),
        api.stats(),
        api.storageAlerts(),
      ]);
      selectedOrg = null;
      subClients = [];
      selectedSubClient = null;
      devices = [];
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Failed to load';
    }
  }

  async function doSync() {
    syncing = true;
    try {
      const r = await api.sync(30);
      alert(r.message);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      syncing = false;
    }
  }

  async function doReset() {
    if (!confirm('This will wipe all cached jobs and re-sync from scratch. Continue?')) return;
    resetting = true;
    try {
      const r = await api.resetAndSync();
      alert(r.message);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      resetting = false;
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  let chatOpen = false;
  let chatMessages: ChatMsg[] = [];
  let chatInput = '';
  let chatLoading = false;
  let chatEl: HTMLDivElement;

  // Voice
  let voiceOut = false;   // TTS: read replies aloud
  let isListening = false;
  let recognition: any = null;

  function toggleListening() {
    if (isListening) {
      recognition?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return; }
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart  = () => { isListening = true; };
    recognition.onend    = () => { isListening = false; };
    recognition.onerror  = () => { isListening = false; };
    recognition.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript) chatInput = transcript;
    };
    recognition.start();
  }

  function speak(text: string) {
    if (!voiceOut || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    window.speechSynthesis.speak(utt);
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    chatInput = '';
    chatMessages = [...chatMessages, { role: 'user', content: text }];
    chatLoading = true;
    try {
      const r = await api.chat(chatMessages);
      chatMessages = [...chatMessages, { role: 'assistant', content: r.reply }];
      speak(r.reply);
    } catch (e: unknown) {
      chatMessages = [...chatMessages, { role: 'assistant', content: e instanceof Error ? e.message : 'Error' }];
    } finally {
      chatLoading = false;
      setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 50);
    }
  }

  function chatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  }

  async function drilldown(org: OrgSummary) {
    selectedOrg = org;
    selectedSubClient = null;
    devices = [];
    subClients = [];
    panelLoading = true;
    try {
      if (stats?.view_level === 'msp') {
        subClients = await api.mspClients(org.org_id, dateParams());
      } else {
        devices = await api.orgDetail(org.org_id, dateParams());
      }
    } finally {
      panelLoading = false;
    }
  }

  async function drilldownSubClient(client: OrgSummary) {
    selectedSubClient = client;
    devices = [];
    panelLoading = true;
    try {
      devices = await api.orgDetail(client.org_id, dateParams());
    } finally {
      panelLoading = false;
    }
  }

  function pct(n: number, total: number) {
    return total === 0 ? 0 : Math.round((n / total) * 100);
  }

  $: trend7 = (trendStats ?? stats)?.trend_7_days ?? [];
  $: trend7Max = Math.max(...trend7.map(d => d.success + d.failed + d.action_required + d.warning), 1);

</script>

<div class="space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
    <div class="flex gap-2 items-center flex-wrap">

      <!-- ── Date range picker ── -->
      <div style="position:relative;">
        <button
          on:click={() => { showDatePicker = !showDatePicker; pendingFrom = dateFrom; pendingTo = dateTo; }}
          style="display:flex; align-items:center; gap:0.5rem; background:#23233a; border:1px solid #0094ba; border-radius:0.375rem; padding:0.4rem 0.875rem; color:#d1d5db; font-size:0.8125rem; cursor:pointer; white-space:nowrap;">
          📅 Date Range
        </button>

        {#if showDatePicker}
          <!-- backdrop -->
          <button style="position:fixed; inset:0; z-index:40; background:transparent; border:none; cursor:default;" on:click={() => showDatePicker = false}></button>

          <div style="position:absolute; right:0; top:calc(100% + 6px); z-index:50; background:#1e2d3a; border:1px solid #0094ba55; border-radius:0.75rem; padding:1.25rem; min-width:280px; box-shadow:0 8px 24px rgba(0,0,0,0.5);">

            <!-- Quick select -->
            <p style="font-size:0.6875rem; color:#9ca3af; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.625rem;">Quick select</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:1rem;">
              <button on:click={() => quickSelect('week')}
                style="background:#23233a; border:1px solid #0094ba55; border-radius:0.375rem; padding:0.5rem; color:#d1d5db; font-size:0.8125rem; cursor:pointer;">Week</button>
              <button on:click={() => quickSelect('month')}
                style="background:#23233a; border:1px solid #0094ba55; border-radius:0.375rem; padding:0.5rem; color:#d1d5db; font-size:0.8125rem; cursor:pointer;">Month</button>
              <button on:click={() => quickSelect('this_quarter')}
                style="background:#23233a; border:1px solid #0094ba55; border-radius:0.375rem; padding:0.5rem; color:#d1d5db; font-size:0.8125rem; cursor:pointer;">This Quarter</button>
              <button on:click={() => quickSelect('last_quarter')}
                style="background:#23233a; border:1px solid #0094ba55; border-radius:0.375rem; padding:0.5rem; color:#d1d5db; font-size:0.8125rem; cursor:pointer;">Last Quarter</button>
            </div>

            <!-- Custom range -->
            <p style="font-size:0.6875rem; color:#9ca3af; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.625rem;">Custom range</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:1rem;">
              <div>
                <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">From</p>
                <input type="date" bind:value={pendingFrom}
                  style="width:100%; background:#23233a; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.5rem; color:#d1d5db; font-size:0.8125rem; box-sizing:border-box;" />
              </div>
              <div>
                <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">To</p>
                <input type="date" bind:value={pendingTo}
                  style="width:100%; background:#23233a; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.5rem; color:#d1d5db; font-size:0.8125rem; box-sizing:border-box;" />
              </div>
            </div>

            <button on:click={applyDateRange}
              style="width:100%; background:#0094ba; color:#fff; border:none; border-radius:0.375rem; padding:0.5rem; font-size:0.875rem; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
              ↻ Apply
            </button>
          </div>
        {/if}
      </div>

      <button class="btn-secondary" on:click={doSync} disabled={syncing}>
        {syncing ? 'Syncing…' : 'Sync (30 days)'}
      </button>
      <button class="btn-danger" on:click={doReset} disabled={resetting}>
        {resetting ? 'Resetting…' : 'Reset & Re-sync'}
      </button>
    </div>
  </div>

  {#if error}
    <p class="text-red-600">{error}</p>
  {/if}

  {#if !stats}
    <p class="text-gray-500">Loading…</p>
  {:else}
    <!-- Stat cards — 5 cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div class="stat-card">
        <span class="text-sm text-gray-500">Total Jobs</span>
        <span class="text-3xl font-bold">{stats.total_jobs}</span>
      </div>
      <div class="stat-card border-l-4 border-green-400">
        <span class="text-sm text-gray-500">Success</span>
        <span class="text-3xl font-bold text-green-600">{stats.success}</span>
        <span class="text-xs text-gray-400">{pct(stats.success, stats.total_jobs)}%</span>
      </div>
      <div class="stat-card border-l-4 border-red-400">
        <span class="text-sm text-gray-500">Failed</span>
        <span class="text-3xl font-bold text-red-600">{stats.failed}</span>
        <span class="text-xs text-gray-400">{pct(stats.failed, stats.total_jobs)}%</span>
      </div>
      <div class="stat-card border-l-4 border-orange-400">
        <span class="text-sm text-gray-500">w/ Warnings</span>
        <span class="text-3xl font-bold text-orange-600">{stats.action_required}</span>
        <span class="text-xs text-gray-400">{pct(stats.action_required, stats.total_jobs)}%</span>
      </div>
      <div class="stat-card border-l-4 {storageAlerts.length > 0 ? 'border-amber-400' : 'border-gray-200'}">
        <span class="text-sm text-gray-500">Storage Alerts</span>
        <span class="text-3xl font-bold {storageAlerts.length > 0 ? 'text-amber-500' : 'text-gray-400'}">{storageAlerts.length}</span>
        <span class="text-xs {storageAlerts.length > 0 ? 'text-amber-500' : 'text-gray-400'}">{storageAlerts.length > 0 ? 'device issues' : 'all clear'}</span>
      </div>
    </div>

    <!-- 7-day trend -->
    <div class="bg-white rounded-lg shadow p-5">
      <h2 class="text-sm font-semibold text-gray-700 mb-3">7-Day Trend</h2>
      <div class="flex items-end gap-2 h-24">
        {#each trend7 as day}
          {@const total = day.success + day.failed + day.action_required + day.warning}
          <div class="flex-1 flex flex-col items-center gap-1">
            <div class="w-full flex flex-col-reverse rounded overflow-hidden" style="height:64px">
              {#if total > 0}
                <div style="height:{(day.success / trend7Max) * 64}px; background:#4ade80;"></div>
                <div style="height:{(day.failed / trend7Max) * 64}px; background:#f87171;"></div>
                <div style="height:{(day.action_required / trend7Max) * 64}px; background:#fb923c;"></div>
                <div style="height:{(day.warning / trend7Max) * 64}px; background:#fde047;"></div>
              {:else}
                <div class="h-full" style="background:#f3f4f6;"></div>
              {/if}
            </div>
            <span class="text-[10px] text-gray-400">{day.date.split(' ')[1]}</span>
          </div>
        {/each}
      </div>
      <div class="flex gap-4 mt-2 text-xs text-gray-500">
        <span class="flex items-center gap-1"><span class="w-2 h-2 inline-block rounded-sm" style="background:#4ade80;"></span>Success</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 inline-block rounded-sm" style="background:#f87171;"></span>Failed</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 inline-block rounded-sm" style="background:#fb923c;"></span>w/ Warnings</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 inline-block rounded-sm" style="background:#fde047;"></span>Warning</span>
      </div>
    </div>

    <!-- Storage Alerts detail — only shown when there are alerts -->
    {#if storageAlerts.length > 0}
    <div class="bg-amber-50 border border-amber-200 rounded-lg shadow p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-amber-600 font-semibold text-sm">⚠ Storage Alerts</span>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-200 text-amber-800">
          {storageAlerts.length} device{storageAlerts.length !== 1 ? 's' : ''}
        </span>
        <span class="text-xs text-amber-600">— backup failures with storage-related errors</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-amber-200">
              <th class="text-left py-1.5 pr-4 text-amber-700 font-semibold">Device</th>
              <th class="text-left py-1.5 pr-4 text-amber-700 font-semibold">Client</th>
              <th class="text-left py-1.5 pr-4 text-amber-700 font-semibold uppercase">Tool</th>
              <th class="text-left py-1.5 pr-4 text-amber-700 font-semibold">Last Backup</th>
              <th class="text-left py-1.5 text-amber-700 font-semibold">Error</th>
            </tr>
          </thead>
          <tbody>
            {#each storageAlerts as alert}
              <tr class="border-b border-amber-100">
                <td class="py-1.5 pr-4 font-medium text-amber-900">{alert.device_name}</td>
                <td class="py-1.5 pr-4 text-amber-800">{alert.org_name}</td>
                <td class="py-1.5 pr-4 text-amber-700 uppercase">{alert.tool}</td>
                <td class="py-1.5 pr-4 text-amber-700">{alert.last_backup ? new Date(alert.last_backup).toLocaleDateString() : '—'}</td>
                <td class="py-1.5 text-amber-700 truncate max-w-xs" title={alert.last_error ?? ''}>{alert.last_error ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    {/if}

    <!-- Org table + drilldown -->
    <div class="flex gap-4">
      <!-- Main table: MSPs (master_msp) or Clients (msp) -->
      <div class="flex-1 bg-white rounded-lg shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {stats.view_level === 'msp' ? 'MSP' : 'Client'}
              </th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">OK</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Failed</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">w/ Warnings</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Backup</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.orgs as org}
              <tr
                class="border-b border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors
                  {selectedOrg?.org_id === org.org_id ? 'bg-blue-50' : ''}"
                on:click={() => drilldown(org)}
              >
                <td class="px-4 py-3 font-medium text-gray-900">{org.org_name}</td>
                <td class="px-4 py-3 text-right text-gray-600">{org.total}</td>
                <td class="px-4 py-3 text-right text-green-600 font-medium">{org.success}</td>
                <td class="px-4 py-3 text-right text-red-600 font-medium">{org.failed}</td>
                <td class="px-4 py-3 text-right text-orange-600 font-medium">{org.action_required}</td>
                <td class="px-4 py-3 text-gray-500 text-xs">
                  {org.last_backup ? new Date(org.last_backup).toLocaleString() : '—'}
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No data. Run a sync first.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Drilldown panel -->
      {#if selectedOrg}
        <div class="w-96 bg-white rounded-lg shadow overflow-hidden flex flex-col">
          <div class="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 class="font-semibold text-gray-800">{selectedOrg.org_name}</h2>
              {#if selectedSubClient}
                <span class="text-xs text-gray-500">→ {selectedSubClient.org_name}</span>
              {/if}
            </div>
            <button class="text-gray-400 hover:text-gray-700 text-lg leading-none" on:click={() => { selectedOrg = null; selectedSubClient = null; subClients = []; devices = []; }}>×</button>
          </div>

          <div class="flex-1 overflow-auto">
            {#if panelLoading}
              <p class="p-4 text-sm text-gray-400">Loading…</p>

            {:else if stats.view_level === 'msp' && !selectedSubClient}
              <!-- Master MSP: show sub-clients of selected MSP -->
              {#if subClients.length === 0}
                <p class="p-4 text-sm text-gray-400">No clients found.</p>
              {:else}
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 sticky top-0">
                    <tr>
                      <th class="text-left px-3 py-2 text-gray-500">Client</th>
                      <th class="text-right px-3 py-2 text-gray-500">OK</th>
                      <th class="text-right px-3 py-2 text-gray-500">Fail</th>
                      <th class="text-right px-3 py-2 text-gray-500">w/ Warn</th>
                      <th class="px-3 py-2 text-gray-500">Last Backup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each subClients as c}
                      <tr
                        class="border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors
                          {selectedSubClient?.org_id === c.org_id ? 'bg-blue-50' : ''}"
                        on:click={() => drilldownSubClient(c)}
                      >
                        <td class="px-3 py-2 font-medium text-gray-800 max-w-[130px] truncate" title={c.org_name}>{c.org_name}</td>
                        <td class="px-3 py-2 text-right text-green-600">{c.success}</td>
                        <td class="px-3 py-2 text-right text-red-600">{c.failed}</td>
                        <td class="px-3 py-2 text-right text-orange-600">{c.action_required}</td>
                        <td class="px-3 py-2 text-gray-400 text-[10px]">
                          {c.last_backup ? new Date(c.last_backup).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}

            {:else}
              <!-- Devices for a client (either from regular MSP click, or sub-client click in master_msp) -->
              {#if devices.length === 0}
                <p class="p-4 text-sm text-gray-400">No devices found.</p>
              {:else}
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 sticky top-0">
                    <tr>
                      <th class="text-left px-3 py-2 text-gray-500">Device</th>
                      <th class="text-right px-3 py-2 text-gray-500">OK</th>
                      <th class="text-right px-3 py-2 text-gray-500">Fail</th>
                      <th class="px-3 py-2 text-gray-500">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each devices as d}
                      <tr class="border-b border-gray-50 hover:bg-gray-50">
                        <td class="px-3 py-2 font-medium text-gray-800 max-w-[120px] truncate" title={d.device_name}>{d.device_name}</td>
                        <td class="px-3 py-2 text-right text-green-600">{d.success}</td>
                        <td class="px-3 py-2 text-right text-red-600">{d.failed}</td>
                        <td class="px-3 py-2">
                          <StatusBadge status={d.last_status} />
                        </td>
                      </tr>
                      {#if d.last_error}
                        <tr class="bg-red-50">
                          <td colspan="4" class="px-3 py-1 text-red-700 text-[10px] italic">{d.last_error}</td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              {/if}
            {/if}
          </div>

          <div class="px-4 py-2 border-t border-gray-200 flex items-center justify-between">
            {#if stats.view_level === 'msp' && selectedSubClient}
              <button class="text-xs text-gray-500 hover:underline" on:click={() => { selectedSubClient = null; devices = []; }}>← Back to clients</button>
              <a href="/jobs?org_id={selectedSubClient.org_id}" class="text-xs text-brand-600 hover:underline">View all jobs →</a>
            {:else if stats.view_level === 'msp'}
              <span></span>
              <a href="/jobs?org_id={selectedOrg.org_id}" class="text-xs text-brand-600 hover:underline">View all jobs →</a>
            {:else}
              <span></span>
              <a href="/jobs?org_id={selectedOrg.org_id}" class="text-xs text-brand-600 hover:underline">View all jobs →</a>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- ── Chat widget (fixed, bottom-right) ───────────────────────────────── -->
{#if $auth?.feature_flags?.chatbot_access !== false}
<div class="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

  {#if chatOpen}
    <div class="w-96 h-[540px] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
         style="background:#252525; border:1px solid #3a3a3a;">
      <!-- Header -->
      <div class="px-4 py-3 flex items-center justify-between" style="background:#0094ba;">
        <div>
          <p class="font-semibold text-sm text-white">BackupPulse Assistant</p>
          <p class="text-xs" style="color:#b3e9f6;">Read-only · answers based on live backup data</p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Speaker toggle -->
          <button
            on:click={() => { voiceOut = !voiceOut; if (!voiceOut) window.speechSynthesis?.cancel(); }}
            title={voiceOut ? 'Mute responses' : 'Read responses aloud'}
            style="background:{voiceOut ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}; border:none; border-radius:6px; padding:4px 6px; cursor:pointer; display:flex; align-items:center; color:white;"
          >
            {#if voiceOut}
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-width="1.8" stroke-linejoin="round"/>
                <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            {:else}
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-width="1.8" stroke-linejoin="round"/>
                <line x1="23" y1="9" x2="17" y2="15" stroke-width="1.8" stroke-linecap="round"/>
                <line x1="17" y1="9" x2="23" y2="15" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            {/if}
          </button>
          <button class="text-white hover:opacity-70 text-xl leading-none" on:click={() => chatOpen = false}>×</button>
        </div>
      </div>

      <!-- Messages -->
      <div bind:this={chatEl} class="flex-1 overflow-y-auto p-4 space-y-3 text-sm" style="background:#252525;">
        {#if chatMessages.length === 0}
          <p class="text-xs text-center pt-8" style="color:#9a9a9a;">
            Ask me anything — e.g.<br>
            "Which clients had failures this week?"<br>
            "What's the success rate for TruAdvantage?"<br>
            "Are there any storage issues?"
          </p>
        {/if}
        {#each chatMessages as msg}
          <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap"
                 style="{msg.role === 'user'
                   ? 'background:#00adda; color:#ffffff; border-radius:16px 16px 4px 16px;'
                   : 'background:#1e3540; color:#d4d4d4; border:1px solid #2a4a55; border-radius:16px 16px 16px 4px;'}">
              {msg.content}
            </div>
          </div>
        {/each}
        {#if chatLoading}
          <div class="flex justify-start">
            <div class="text-xs px-3 py-2 rounded-2xl" style="background:#1e3540; color:#9a9a9a; border:1px solid #2a4a55;">
              Thinking…
            </div>
          </div>
        {/if}
      </div>

      <!-- Input -->
      <div class="px-3 py-3 flex gap-2" style="background:#1e1e1e; border-top:1px solid #3a3a3a;">
        <textarea
          bind:value={chatInput}
          on:keydown={chatKeydown}
          placeholder="Ask a question… (Enter to send)"
          rows={2}
          class="flex-1 resize-none rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1"
          style="background:#2d2d2d; border:1px solid #4a4a4a; color:#e8e8e8; focus-ring-color:#00adda;"
        ></textarea>
        <div class="flex flex-col gap-1.5 self-end">
          <!-- Mic button -->
          <button
            on:click={toggleListening}
            title={isListening ? 'Stop listening' : 'Speak your question'}
            style="
              width:32px; height:32px; border-radius:8px; border:none; cursor:pointer;
              display:flex; align-items:center; justify-content:center;
              background:{isListening ? '#ef4444' : '#2d2d2d'};
              border:1px solid {isListening ? '#ef4444' : '#4a4a4a'};
              transition: background 0.2s;
              {isListening ? 'animation: pulse-mic 1s infinite;' : ''}
            "
          >
            <svg width="14" height="14" fill="none" stroke="{isListening ? 'white' : '#9ca3af'}" viewBox="0 0 24 24">
              <rect x="9" y="2" width="6" height="11" rx="3" stroke-width="1.8"/>
              <path d="M5 10a7 7 0 0014 0" stroke-width="1.8" stroke-linecap="round"/>
              <line x1="12" y1="17" x2="12" y2="21" stroke-width="1.8" stroke-linecap="round"/>
              <line x1="9" y1="21" x2="15" y2="21" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
          <!-- Send button -->
          <button
            on:click={sendChat}
            disabled={chatLoading || !chatInput.trim()}
            class="text-white text-xs rounded-lg disabled:opacity-40"
            style="background:#00adda; width:32px; height:32px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center;"
            title="Send"
          >
            <svg width="14" height="14" fill="none" stroke="white" viewBox="0 0 24 24">
              <path d="M22 2L11 13" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Toggle button -->
  <button
    on:click={() => chatOpen = !chatOpen}
    class="w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center text-2xl transition-transform {chatOpen ? 'rotate-45' : ''}"
    style="background:#00adda;"
    title="BackupPulse Assistant"
  >
    {#if chatOpen}
      <span style="font-size:1.5rem; line-height:1;">×</span>
    {:else}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="6" width="18" height="13" rx="3" fill="#b3e9f6"/>
        <line x1="12" y1="2" x2="12" y2="6" stroke="#b3e9f6" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="2" r="1.2" fill="#b3e9f6"/>
        <circle cx="8.5" cy="12" r="1.8" fill="#00adda"/>
        <circle cx="15.5" cy="12" r="1.8" fill="#00adda"/>
        <rect x="8" y="15.5" width="8" height="1.5" rx="0.75" fill="#00adda"/>
        <rect x="1" y="9.5" width="2" height="4" rx="1" fill="#b3e9f6"/>
        <rect x="21" y="9.5" width="2" height="4" rx="1" fill="#b3e9f6"/>
      </svg>
    {/if}
  </button>
</div>
{/if}
