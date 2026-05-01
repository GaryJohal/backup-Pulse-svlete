<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type AuditEntry } from '$lib/api';

  let logs: AuditEntry[] = [];
  let loading = true;
  let error = '';

  let filterType = '';
  let filterAction = '';

  const resourceTypes = ['org', 'connector', 'user', 'job', 'schedule'];
  const actions = ['created', 'updated', 'deleted', 'synced', 'reset', 'login'];

  async function load() {
    loading = true;
    error = '';
    try {
      logs = await api.auditLogs({
        resource_type: filterType || undefined,
        action: filterAction || undefined,
        limit: 500,
      });
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function impactClass(impact: string) {
    if (impact === 'critical') return 'bg-red-100 text-red-700';
    if (impact === 'warning')  return 'bg-yellow-100 text-yellow-700';
    return 'bg-blue-50 text-blue-700';
  }

  function actionClass(action: string) {
    if (action === 'deleted' || action === 'reset') return 'text-red-600 font-semibold';
    if (action === 'created') return 'text-green-600 font-semibold';
    if (action === 'updated') return 'text-blue-600 font-semibold';
    return 'text-gray-600';
  }

  function parseChanges(raw: string | null): { field: string; old: string; new: string }[] {
    if (!raw) return [];
    try {
      const obj = JSON.parse(raw);
      return Object.entries(obj).map(([field, val]: [string, unknown]) => {
        if (val && typeof val === 'object' && 'old' in (val as object)) {
          const v = val as { old: unknown; new: unknown };
          return { field, old: String(v.old ?? '—'), new: String(v.new ?? '—') };
        }
        return { field, old: '—', new: String(val) };
      });
    } catch {
      return [];
    }
  }

  let expandedId: number | null = null;
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-gray-900">Audit Log</h1>
    <button class="btn-secondary text-sm" on:click={load}>Refresh</button>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">{error}</div>
  {/if}

  <!-- Filters -->
  <div class="flex gap-3 flex-wrap">
    <select bind:value={filterType} on:change={load}
      class="border rounded px-3 py-1.5 text-sm text-gray-700">
      <option value="">All resource types</option>
      {#each resourceTypes as t}
        <option value={t}>{t}</option>
      {/each}
    </select>
    <select bind:value={filterAction} on:change={load}
      class="border rounded px-3 py-1.5 text-sm text-gray-700">
      <option value="">All actions</option>
      {#each actions as a}
        <option value={a}>{a}</option>
      {/each}
    </select>
    <span class="text-sm text-gray-400 self-center">{logs.length} entries</span>
  </div>

  <div class="bg-white rounded-lg shadow overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 border-b">
        <tr>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-40">Date / Time</th>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-36">Agent</th>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Action</th>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Resource</th>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
          <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-20">Impact</th>
          <th class="px-4 py-3 w-16"></th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
        {:else if logs.length === 0}
          <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No audit entries found.</td></tr>
        {:else}
          {#each logs as log}
            <tr class="border-b border-gray-100 hover:bg-gray-50">
              <td class="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                {new Date(log.created_at).toLocaleString()}
              </td>
              <td class="px-4 py-2.5 text-gray-700 font-medium text-xs">{log.user_name}</td>
              <td class="px-4 py-2.5 text-xs {actionClass(log.action)} capitalize">{log.action}</td>
              <td class="px-4 py-2.5 text-gray-500 text-xs capitalize">{log.resource_type}</td>
              <td class="px-4 py-2.5 text-gray-800 text-xs">{log.resource_name ?? '—'}</td>
              <td class="px-4 py-2.5">
                <span class="text-xs px-2 py-0.5 rounded-full capitalize {impactClass(log.impact)}">{log.impact}</span>
              </td>
              <td class="px-4 py-2.5">
                {#if log.changes}
                  <button class="text-xs text-blue-500 hover:text-blue-700"
                    on:click={() => expandedId = expandedId === log.id ? null : log.id}>
                    {expandedId === log.id ? 'Hide' : 'Details'}
                  </button>
                {/if}
              </td>
            </tr>
            {#if expandedId === log.id}
              <tr class="bg-blue-50 border-b border-blue-100">
                <td colspan="7" class="px-6 py-3">
                  <p class="text-xs font-semibold text-gray-600 mb-2">Changes</p>
                  <div class="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                    <span class="font-semibold text-gray-500">Field</span>
                    <span class="font-semibold text-gray-500">Before</span>
                    <span class="font-semibold text-gray-500">After</span>
                    {#each parseChanges(log.changes) as ch}
                      <span class="text-gray-700 capitalize">{ch.field}</span>
                      <span class="text-red-600 font-mono">{ch.old}</span>
                      <span class="text-green-600 font-mono">{ch.new}</span>
                    {/each}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
