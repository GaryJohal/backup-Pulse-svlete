<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, type Job } from '$lib/api';
  import { auth } from '$lib/auth';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  let jobs: Job[] = [];
  let loading = true;
  let error = '';
  let selectedJob: Job | null = null;
  let rechecking = false;
  let recheckResult = '';
  let analyzing = false;
  let analyzeResult = '';

  // Filters
  let orgId: number | '' = '';
  let clientId: number | '' = '';
  let status = '';
  let limit = 500;
  let deviceSearch = '';
  let dateFrom = '';
  let dateTo = '';

  // Org lists for dropdowns
  type OrgOption = { id: number; name: string; type: string; parent_id: number | null };
  let orgs: OrgOption[] = [];
  let allClients: OrgOption[] = [];

  // Clients visible in the Customer dropdown — filtered by selected MSP if one is chosen
  $: visibleClients = orgId
    ? allClients.filter(c => c.parent_id === orgId)
    : allClients;

  // When MSP changes, clear client selection if it no longer belongs to the new MSP
  $: if (orgId !== '' && clientId !== '') {
    if (!visibleClients.find(c => c.id === clientId)) clientId = '';
  }

  // Whether we have MSP-level orgs (master_msp tenant) — show Org dropdown only then
  $: hasMspOrgs = orgs.some(o => o.type === 'msp');

  onMount(async () => {
    const qOrgId = $page.url.searchParams.get('org_id');
    if (qOrgId) orgId = Number(qOrgId);
    try {
      [orgs, allClients] = await Promise.all([
        api.companies(),
        api.companies({ type: 'client' }),
      ]);
    } catch { /* ignore */ }
    load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      // Client takes priority over MSP for filtering
      const effectiveOrgId = clientId || orgId || undefined;
      jobs = await api.jobs({
        org_id: effectiveOrgId,
        status: status || undefined,
        limit,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Failed to load jobs';
    } finally {
      loading = false;
    }
  }

  function clearFilters() {
    orgId = ''; clientId = ''; status = ''; limit = 500; deviceSearch = ''; dateFrom = ''; dateTo = '';
    load();
  }

  // Client-side device filter applied on top of server results
  $: filteredJobs = deviceSearch.trim()
    ? jobs.filter(j => (j.device_name ?? '').toLowerCase().includes(deviceSearch.trim().toLowerCase()))
    : jobs;

  $: hasActiveFilters = orgId !== '' || clientId !== '' || status !== '' || deviceSearch !== '' || dateFrom !== '' || dateTo !== '';

  async function doRecheck() {
    if (!selectedJob) return;
    rechecking = true;
    recheckResult = '';
    analyzeResult = '';
    try {
      const r = await api.recheckJob(selectedJob.id);
      recheckResult = r.message;
      await load();
      // Refresh selectedJob from updated list
      selectedJob = jobs.find(j => j.id === selectedJob!.id) ?? selectedJob;
    } catch (e: unknown) {
      recheckResult = e instanceof Error ? e.message : 'Re-check failed';
    } finally {
      rechecking = false;
    }
  }

  async function doAnalyze() {
    if (!selectedJob) return;
    analyzing = true;
    analyzeResult = '';
    recheckResult = '';
    try {
      const r = await api.analyzeJob(selectedJob.id);
      if (r.ok && r.ai_analysis) {
        // Patch selectedJob so the AI Analysis section renders immediately
        selectedJob = { ...selectedJob, ai_analysis: r.ai_analysis as typeof selectedJob.ai_analysis };
        analyzeResult = 'Analysis complete.';
      } else {
        analyzeResult = r.message ?? 'Analysis unavailable — check OpenAI configuration.';
      }
    } catch (e: unknown) {
      analyzeResult = e instanceof Error ? e.message : 'Analysis failed';
    } finally {
      analyzing = false;
    }
  }

  function formatBytes(bytes: number | null) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
    return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  }

  // Status override — admins only
  $: canOverride = ['super_admin', 'tenant_admin', 'msp_admin'].includes($auth?.role ?? '');
  let statusDropdownId: number | null = null;
  let overriding = false;

  const STATUS_OPTIONS = [
    { value: 'success',         label: 'Success' },
    { value: 'warning',         label: 'Warning' },
    { value: 'failed',          label: 'Failed' },
    { value: 'action_required', label: 'Completed w/ Warnings' },
  ];

  async function overrideStatus(job: Job, newStatus: string) {
    if (newStatus === job.status) { statusDropdownId = null; return; }
    overriding = true;
    try {
      await api.overrideJobStatus(job.id, newStatus);
      jobs = jobs.map(j => j.id === job.id ? { ...j, status: newStatus } : j);
      if (selectedJob?.id === job.id) selectedJob = { ...selectedJob, status: newStatus };
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Status update failed';
    } finally {
      overriding = false;
      statusDropdownId = null;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-gray-900">Jobs</h1>
  </div>

  <!-- Filters -->
  <div class="bg-white rounded-lg shadow p-4 flex gap-3 flex-wrap items-end">
    {#if hasMspOrgs}
    <div>
      <label class="block text-xs text-gray-500 mb-1">Organisation</label>
      <select bind:value={orgId}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-brand-500 min-w-[140px]">
        <option value="">All Orgs</option>
        {#each orgs as org}
          <option value={org.id}>{org.name}</option>
        {/each}
      </select>
    </div>
    {/if}
    <div>
      <label class="block text-xs text-gray-500 mb-1">Customer</label>
      <select bind:value={clientId}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-brand-500 min-w-[150px]">
        <option value="">All Customers</option>
        {#each visibleClients as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">Device</label>
      <input
        type="text"
        bind:value={deviceSearch}
        placeholder="Search device…"
        class="border border-gray-300 rounded px-2 py-1.5 text-sm w-36 focus:ring-brand-500"
      />
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">Status</label>
      <select bind:value={status}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-brand-500">
        <option value="">All</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
        <option value="warning">Warning</option>
        <option value="action_required">Completed w/ Warnings</option>
      </select>
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">From</label>
      <input type="date" bind:value={dateFrom}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-brand-500" />
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">To</label>
      <input type="date" bind:value={dateTo}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-brand-500" />
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">Limit</label>
      <select bind:value={limit}
        class="border border-gray-300 rounded px-2 py-1.5 text-sm">
        <option value={100}>100</option>
        <option value={500}>500</option>
        <option value={1000}>1000</option>
        <option value={2000}>2000</option>
      </select>
    </div>
    <button class="btn-secondary" on:click={load}>Apply</button>
    {#if hasActiveFilters}
      <button class="text-xs text-gray-500 hover:text-gray-700 underline" on:click={clearFilters}>Clear</button>
    {/if}
  </div>

  {#if error}
    <p class="text-red-600 text-sm">{error}</p>
  {/if}

  <div class="flex gap-4">
    <!-- Jobs table -->
    <div class="flex-1 bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Device</th>
            <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Org</th>
            <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Tool</th>
            <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
            <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Time</th>
            <th class="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Size</th>
          </tr>
        </thead>
        <tbody>
          {#if loading}
            <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
          {:else if filteredJobs.length === 0}
            <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No jobs found.</td></tr>
          {:else}
            {#each filteredJobs as job}
              <tr
                class="border-b border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors
                  {selectedJob?.id === job.id ? 'bg-blue-50' : ''}"
                on:click={() => selectedJob = job}
              >
                <td class="px-4 py-2 font-medium text-gray-900 max-w-[160px] truncate" title={job.device_name ?? ''}>
                  {job.device_name ?? '—'}
                </td>
                <td class="px-4 py-2 text-gray-600 max-w-[120px] truncate">{job.org_name ?? '—'}</td>
                <td class="px-4 py-2 text-gray-500 uppercase text-xs">{job.tool}</td>
                <td class="px-4 py-2 relative" on:click|stopPropagation>
                  {#if canOverride}
                    <button
                      class="flex items-center gap-1 group"
                      title="Click to override status"
                      on:click={() => statusDropdownId = statusDropdownId === job.id ? null : job.id}
                    >
                      <StatusBadge status={job.status} />
                      <span class="text-gray-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">▾</span>
                    </button>
                    {#if statusDropdownId === job.id}
                      <div class="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded shadow-lg min-w-[180px]">
                        <p class="px-3 py-1.5 text-xs text-gray-400 border-b">Override status</p>
                        {#each STATUS_OPTIONS as opt}
                          <button
                            class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2
                              {job.status === opt.value ? 'font-semibold text-gray-900' : 'text-gray-700'}"
                            disabled={overriding}
                            on:click={() => overrideStatus(job, opt.value)}
                          >
                            <StatusBadge status={opt.value} />
                          </button>
                        {/each}
                      </div>
                    {/if}
                  {:else}
                    <StatusBadge status={job.status} />
                  {/if}
                </td>
                <td class="px-4 py-2 text-gray-500 text-xs">
                  {job.job_time ? new Date(job.job_time).toLocaleString() : '—'}
                </td>
                <td class="px-4 py-2 text-right text-gray-500 text-xs">{formatBytes(job.size_bytes)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Job detail panel -->
    {#if selectedJob}
      <div class="w-96 bg-white rounded-lg shadow flex flex-col overflow-hidden">
        <div class="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <span class="font-semibold text-gray-800 truncate max-w-[280px]">{selectedJob.device_name}</span>
          <button class="text-gray-400 hover:text-gray-700 text-lg" on:click={() => selectedJob = null}>×</button>
        </div>
        <div class="flex-1 overflow-auto p-4 space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <span class="text-gray-500">Status</span>
            <div class="flex items-center gap-2">
              <StatusBadge status={selectedJob.status} />
              {#if canOverride}
              <div class="relative">
                <button
                  class="text-xs text-gray-400 hover:text-gray-600 underline"
                  on:click={() => { statusDropdownId = statusDropdownId === selectedJob.id ? null : selectedJob.id; }}
                >override</button>
                {#if statusDropdownId === selectedJob.id}
                  <div class="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded shadow-lg min-w-[180px]">
                    <p class="px-3 py-1.5 text-xs text-gray-400 border-b">Set status to</p>
                    {#each STATUS_OPTIONS as opt}
                      <button
                        class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2
                          {selectedJob.status === opt.value ? 'font-semibold text-gray-900' : 'text-gray-700'}"
                        disabled={overriding}
                        on:click={() => overrideStatus(selectedJob, opt.value)}
                      >
                        <StatusBadge status={opt.value} />
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              {/if}
            </div>
            <span class="text-gray-500">Tool</span>        <span class="font-medium uppercase">{selectedJob.tool}</span>
            <span class="text-gray-500">Organisation</span><span>{selectedJob.org_name ?? '—'}</span>
            <span class="text-gray-500">Job name</span>    <span class="truncate" title={selectedJob.job_name ?? ''}>{selectedJob.job_name ?? '—'}</span>
            <span class="text-gray-500">Start time</span>  <span>{selectedJob.job_time ? new Date(selectedJob.job_time).toLocaleString() : '—'}</span>
            <span class="text-gray-500">End time</span>    <span>{selectedJob.end_time ? new Date(selectedJob.end_time).toLocaleString() : '—'}</span>
            <span class="text-gray-500">Size</span>        <span>{formatBytes(selectedJob.size_bytes)}</span>
          </div>

          {#if selectedJob.error_message}
            <div class="bg-red-50 border border-red-200 rounded p-3">
              <p class="text-xs font-semibold text-red-700 mb-1">Error</p>
              <p class="text-xs text-red-600 whitespace-pre-wrap">{selectedJob.error_message}</p>
            </div>
          {/if}

          {#if selectedJob.ai_analysis && $auth?.feature_flags?.ai_analysis !== false}
            <div class="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
              <p class="text-xs font-semibold text-blue-800">AI Analysis</p>
              <p class="text-xs text-blue-700"><strong>Root cause:</strong> {selectedJob.ai_analysis.root_cause}</p>
              <p class="text-xs text-blue-700"><strong>Severity:</strong> {selectedJob.ai_analysis.severity}</p>
              {#if selectedJob.ai_analysis.steps?.length}
                <div>
                  <p class="text-xs font-medium text-blue-700 mb-1">Remediation steps:</p>
                  <ol class="list-decimal list-inside space-y-0.5">
                    {#each selectedJob.ai_analysis.steps as step}
                      <li class="text-xs text-blue-700">{step}</li>
                    {/each}
                  </ol>
                </div>
              {/if}
              {#if selectedJob.ai_analysis.prevention}
                <p class="text-xs text-blue-600 italic">{selectedJob.ai_analysis.prevention}</p>
              {/if}
            </div>
          {/if}

          {#if selectedJob.status === 'failed' || selectedJob.status === 'warning'}
            <div class="border-t pt-3 space-y-2">
              <button
                class="w-full btn-secondary text-xs py-1.5"
                on:click={doRecheck}
                disabled={rechecking || analyzing}
              >
                {rechecking ? 'Re-checking…' : '↻ Re-check now'}
              </button>
              {#if !selectedJob.ai_analysis && $auth?.feature_flags?.ai_analysis !== false}
                <button
                  class="w-full text-xs py-1.5 rounded border transition-colors"
                  style="background: #1e3a40; border-color: #0094ba44; color: #0094ba;"
                  on:click={doAnalyze}
                  disabled={analyzing || rechecking}
                >
                  {analyzing ? 'Analyzing…' : '✦ Get AI Analysis'}
                </button>
              {/if}
              {#if recheckResult}
                <p class="text-xs text-center {recheckResult.includes('failed') ? 'text-red-600' : 'text-green-600'}">{recheckResult}</p>
              {/if}
              {#if analyzeResult}
                <p class="text-xs text-center {analyzeResult.includes('unavailable') || analyzeResult.includes('failed') ? 'text-red-500' : 'text-green-600'}">{analyzeResult}</p>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
