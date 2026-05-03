<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/auth';
  import { api } from '$lib/api';
  import type { ScheduledReport, ReportTarget } from '$lib/api';

  onMount(() => {
    const flags = $auth?.feature_flags ?? {};
    const hasFlags = Object.keys(flags).length > 0;
    if (hasFlags && flags['reports'] === false) {
      goto('/');
    }
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  let tab: 'ondemand' | 'scheduled' | 'ai' = 'ondemand';

  // ── AI Reports ────────────────────────────────────────────────────────────
  let aiDays = 30;
  let aiOrgId = '';
  let aiPrompt = '';
  let aiLoading = false;
  let aiStreaming = false;
  let aiError = '';
  let aiPdfLoading = false;

  type AiMessage = { role: 'user' | 'assistant'; text: string; prompt?: string };
  let aiMessages: AiMessage[] = [];
  let aiMsgPdfLoading: Record<number, boolean> = {};

  const SUGGESTED_PROMPTS = [
    'Write an executive summary report for senior management',
    'Which clients need immediate attention and why?',
    'List all devices that have not been backed up recently',
    'What are the top recurring backup errors and their root causes?',
    'How is our SureRestore compliance this month?',
    'Compare backup success rates across all clients',
    'Summarise all retention and storage alerts',
    'Which devices are failing most frequently?',
  ];

  async function sendAiPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? aiPrompt).trim();
    if (!prompt || aiLoading) return;

    aiLoading = true;
    aiStreaming = true;
    aiError = '';
    aiPrompt = '';

    const userMsg: AiMessage = { role: 'user', text: prompt };
    const assistantMsg: AiMessage = { role: 'assistant', text: '', prompt };
    aiMessages = [...aiMessages, userMsg, assistantMsg];
    const idx = aiMessages.length - 1;

    try {
      const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
      const tok = localStorage.getItem('bp_token');
      const res = await fetch(`${BASE}/api/v1/reports/ai-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, days: aiDays, org_id: aiOrgId ? Number(aiOrgId) : null }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        aiMessages[idx] = { ...aiMessages[idx], text: aiMessages[idx].text + chunk };
        aiMessages = [...aiMessages]; // trigger reactivity
      }
    } catch (e: unknown) {
      aiError = e instanceof Error ? e.message : String(e);
      aiMessages = aiMessages.slice(0, -2); // remove the failed pair
    } finally {
      aiLoading = false;
      aiStreaming = false;
    }
  }

  function handleAiKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAiPrompt();
    }
  }

  async function downloadAiReport() {
    aiPdfLoading = true;
    try {
      const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
      const tok = localStorage.getItem('bp_token');
      const qs = new URLSearchParams({ days: String(aiDays) });
      if (aiOrgId) qs.set('org_id', aiOrgId);
      const res = await fetch(`${BASE}/api/v1/reports/ai-executive?${qs}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `executive_report_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      aiError = e instanceof Error ? e.message : String(e);
    } finally {
      aiPdfLoading = false;
    }
  }

  async function downloadChatPdf(msgIdx: number, msg: AiMessage) {
    if (!msg.text || !msg.prompt) return;
    aiMsgPdfLoading = { ...aiMsgPdfLoading, [msgIdx]: true };
    try {
      const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
      const tok = localStorage.getItem('bp_token');
      const res = await fetch(`${BASE}/api/v1/reports/ai-chat-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: msg.prompt,
          response: msg.text,
          days: aiDays,
          org_id: aiOrgId ? Number(aiOrgId) : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai_report_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      aiError = e instanceof Error ? e.message : String(e);
    } finally {
      aiMsgPdfLoading = { ...aiMsgPdfLoading, [msgIdx]: false };
    }
  }

  // ── Report definitions ───────────────────────────────────────────────────
  const REPORTS = {
    backup: [
      {
        id: 'backup-detail',
        label: 'Backup Detail Report',
        desc: 'Full list of every backup job with status and error details.',
        params: [
          { key: 'days', label: 'Days back', type: 'number', default: 7 },
          { key: 'status', label: 'Status filter', type: 'select',
            options: ['', 'success', 'failed', 'warning', 'action_required'], default: '' },
        ],
      },
      {
        id: 'backup-overview',
        label: 'Backup Overview Report',
        desc: 'Per-device summary — totals, success rate, last backup.',
        params: [{ key: 'days', label: 'Days back', type: 'number', default: 7 }],
      },
      {
        id: 'monthly-backup',
        label: 'Monthly Backup Report',
        desc: 'Month-by-month breakdown of all backup outcomes.',
        params: [{ key: 'months', label: 'Months back', type: 'number', default: 3 }],
      },
      {
        id: 'weekly-backup',
        label: 'Weekly Backup Report',
        desc: 'Week-by-week backup summary.',
        params: [{ key: 'weeks', label: 'Weeks back', type: 'number', default: 4 }],
      },
    ],
    compliance: [
      {
        id: 'failed-backups',
        label: 'Failed Backup Report',
        desc: 'All failed and action-required jobs with error messages.',
        params: [{ key: 'days', label: 'Days back', type: 'number', default: 7 }],
      },
      {
        id: 'missing-backups',
        label: 'Missing Backup Report',
        desc: 'Devices that have not reported a backup within a given window.',
        params: [{ key: 'hours', label: 'Hours threshold', type: 'number', default: 24 }],
      },
      {
        id: 'success-rate',
        label: 'Success Rate Report',
        desc: 'Per-organisation backup success rate over a period.',
        params: [{ key: 'days', label: 'Days back', type: 'number', default: 30 }],
      },
    ],
    admin: [
      {
        id: 'connector-status',
        label: 'Connector Status Report',
        desc: 'Status of all configured BCDR connectors.',
        params: [],
      },
      {
        id: 'org-summary',
        label: 'Organisation Summary Report',
        desc: 'List of all orgs with client count, device count, and contact info.',
        params: [],
      },
      {
        id: 'user-activity',
        label: 'User Activity Report',
        desc: 'Audit trail of all user actions (logins, config changes, syncs).',
        params: [{ key: 'days', label: 'Days back', type: 'number', default: 30 }],
      },
    ],
  };

  // ── State ─────────────────────────────────────────────────────────────────
  type Report = typeof REPORTS.backup[0];
  let selected: Report | null = null;
  let paramValues: Record<string, string | number> = {};
  let result: { report: string; total: number; rows: Record<string, unknown>[] } | null = null;
  let loading = false;
  let error = '';

  function selectReport(r: Report) {
    selected = r;
    result = null;
    error = '';
    paramValues = Object.fromEntries(r.params.map(p => [p.key, p.default]));
  }

  async function generate(fmt: 'json' | 'csv') {
    if (!selected) return;
    loading = true;
    error = '';
    result = null;
    try {
      const qs = new URLSearchParams({ fmt, ...Object.fromEntries(
        Object.entries(paramValues).filter(([,v]) => v !== '').map(([k,v]) => [k, String(v)])
      )}).toString();

      if (fmt === 'csv') {
        const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
        const tok = localStorage.getItem('bp_token');
        const res = await fetch(`${BASE}/api/v1/reports/${selected.id}?${qs}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selected.id}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
        const tok = localStorage.getItem('bp_token');
        const res = await fetch(`${BASE}/api/v1/reports/${selected.id}?${qs}`, {
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(await res.text());
        result = await res.json();
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function statusClass(val: string) {
    if (val === 'success') return 'text-green-600 font-medium';
    if (val === 'failed')  return 'text-red-600 font-medium';
    if (val === 'warning') return 'text-yellow-600 font-medium';
    if (val === 'action_required') return 'text-orange-600 font-medium';
    return '';
  }

  // ── Scheduled Reports state ───────────────────────────────────────────────
  let scheduledReports: ScheduledReport[] = [];
  let reportTargets: ReportTarget[] = [];
  let loadingScheduled = false;
  let schedFilterOrg = '';
  let schedFilterType = '';
  let schedFilterStatus = '';
  let showPanel = false;
  let editingReportId: number | null = null;
  let savingReport = false;
  let runNowToast = '';
  let runNowLoading: Record<number, boolean> = {};
  let runNowError: Record<number, string> = {};
  let deleteConfirmId: number | null = null;
  let targetsLoaded = false;

  // Stats
  let statSentThisWeek = 0;
  let statFailedSends = 0;
  let statNextDelivery: string | null = null;

  // Panel form fields
  let pEnabled = true;
  let pName = '';
  let pType = 'daily_summary';
  let pOrgId: number | null = null;
  let pSubject = '';
  let pRecipients: string[] = [];
  let pRecipientInput = '';
  let pFromAddress = 'BackupPulse';
  let pCustomFrom = '';
  let pTimezone = 'America/New_York';
  let pSchedule = 'weekly';
  let pStartDate = '';
  let pTime = '06:00';
  let pMessage = '';
  let pLogoUrl = '';
  let pLogoPreview = '';
  let panelError = '';

  // Auto-scroll chat to bottom when messages update
  $: if (aiMessages) {
    setTimeout(() => {
      const el = document.getElementById('ai-chat-scroll');
      if (el) el.scrollTop = el.scrollHeight;
    }, 10);
  }

  function handleLogoFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      pLogoPreview = ev.target?.result as string;
      pLogoUrl = pLogoPreview; // store as data URL; swap for upload URL when backend supports it
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    pLogoUrl = '';
    pLogoPreview = '';
  }

  $: filteredReports = scheduledReports.filter((r) => {
    if (schedFilterOrg && String(r.org_id ?? '') !== schedFilterOrg) return false;
    if (schedFilterType && r.report_type !== schedFilterType) return false;
    if (schedFilterStatus === 'enabled' && !r.is_enabled) return false;
    if (schedFilterStatus === 'disabled' && r.is_enabled) return false;
    return true;
  });


  $: deliveryEstimate = (() => {
    if (!pTime) return '';
    const [h, m] = pTime.split(':').map(Number);
    const total = h * 60 + m + 5;
    const eh = Math.floor(total / 60) % 24;
    const em = total % 60;
    return (String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0'));
  })();

  async function loadTargetsOnce() {
    if (targetsLoaded) return;
    try {
      reportTargets = await api.reportTargets();
    } catch (e) {
      console.error(e);
    }
  }

  async function loadScheduled() {
    if (targetsLoaded) return;
    targetsLoaded = true;
    loadingScheduled = true;
    try {
      const [targets, reports, stats] = await Promise.all([
        api.reportTargets(),
        api.scheduledReports(),
        api.reportStats(),
      ]);
      reportTargets = targets;
      scheduledReports = reports;
      statSentThisWeek = stats.sent_this_week;
      statFailedSends = stats.failed_sends;
      statNextDelivery = stats.next_delivery;
    } catch (e) {
      console.error(e);
    } finally {
      loadingScheduled = false;
    }
  }

  async function refreshScheduled() {
    try {
      const [reports, stats] = await Promise.all([
        api.scheduledReports(),
        api.reportStats(),
      ]);
      scheduledReports = reports;
      statSentThisWeek = stats.sent_this_week;
      statFailedSends = stats.failed_sends;
      statNextDelivery = stats.next_delivery;
    } catch (e) {
      console.error(e);
    }
  }

  function openCreatePanel() {
    editingReportId = null;
    pEnabled = true;
    pName = '';
    pType = 'daily_summary';
    pOrgId = null;
    pSubject = '';
    pRecipients = [];
    pRecipientInput = '';
    pFromAddress = 'BackupPulse';
    pCustomFrom = '';
    pTimezone = 'America/New_York';
    pSchedule = 'weekly';
    pStartDate = '';
    pTime = '06:00';
    pMessage = '';
    pLogoUrl = '';
    pLogoPreview = '';
    panelError = '';
    showPanel = true;
  }

  function openEditPanel(r: ScheduledReport) {
    editingReportId = r.id;
    pEnabled = r.is_enabled;
    pName = r.name;
    pType = r.report_type;
    pOrgId = r.org_id;
    pSubject = r.email_subject ?? '';
    pRecipients = [...r.recipients];
    pRecipientInput = '';
    pFromAddress = r.from_address ? 'Custom' : 'BackupPulse';
    pCustomFrom = r.from_address ?? '';
    pTimezone = r.timezone;
    pSchedule = r.schedule;
    pStartDate = r.start_date ?? '';
    pTime = r.processing_time ?? '06:00';
    pMessage = r.custom_message ?? '';
    pLogoUrl = r.logo_url ?? '';
    pLogoPreview = r.logo_url ?? '';
    panelError = '';
    showPanel = true;
  }

  function addRecipient() {
    const val = pRecipientInput.trim().replace(/,$/, '');
    if (!val) return;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(val)) return;
    if (!pRecipients.includes(val)) pRecipients = [...pRecipients, val];
    pRecipientInput = '';
  }

  function handleRecipientKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRecipient();
    }
  }

  function removeRecipient(email: string) {
    pRecipients = pRecipients.filter((r) => r !== email);
  }

  async function saveReport() {
    panelError = '';
    if (!pName.trim()) { panelError = 'Report name is required.'; return; }
    // Flush any email still in the input field (user didn't press Enter)
    addRecipient();
    savingReport = true;
    try {
      const body = {
        name: pName.trim(),
        report_type: pType,
        org_id: pOrgId,
        is_enabled: pEnabled,
        recipients: pRecipients,
        email_subject: pSubject || null,
        from_address: pFromAddress === 'Custom' ? (pCustomFrom || null) : null,
        timezone: pTimezone,
        schedule: pSchedule,
        start_date: pStartDate || null,
        processing_time: pTime || null,
        custom_message: pMessage || null,
        logo_url: pLogoUrl || null,
      };
      if (editingReportId !== null) {
        await api.updateScheduledReport(editingReportId, body);
      } else {
        await api.createScheduledReport(body);
      }
      await refreshScheduled();
      showPanel = false;
    } catch (e: unknown) {
      panelError = e instanceof Error ? e.message : String(e);
    } finally {
      savingReport = false;
    }
  }

  async function toggleReport(r: ScheduledReport) {
    try {
      const res = await api.toggleScheduledReport(r.id);
      scheduledReports = scheduledReports.map((x) =>
        x.id === r.id ? { ...x, is_enabled: res.is_enabled } : x
      );
    } catch (e) {
      console.error(e);
    }
  }

  async function runNow(id: number) {
    runNowLoading = { ...runNowLoading, [id]: true };
    runNowError = { ...runNowError, [id]: '' };
    try {
      await api.runScheduledReportNow(id);
      runNowToast = 'Report sent successfully';
      setTimeout(() => { runNowToast = ''; }, 4000);
    } catch (e: any) {
      const msg = e?.message || 'Failed to send report';
      runNowError = { ...runNowError, [id]: msg };
      setTimeout(() => { runNowError = { ...runNowError, [id]: '' }; }, 8000);
    } finally {
      runNowLoading = { ...runNowLoading, [id]: false };
    }
  }

  async function deleteReport(id: number) {
    try {
      await api.deleteScheduledReport(id);
      scheduledReports = scheduledReports.filter((r) => r.id !== id);
      deleteConfirmId = null;
    } catch (e) {
      console.error(e);
    }
  }

  function formatDT(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function typePill(rt: string): { bg: string; color: string; label: string } {
    switch (rt) {
      case 'daily_summary':     return { bg: '#1e3a4a', color: '#38bdf8', label: 'Daily Summary' };
      case 'weekly_health':     return { bg: '#1a3a2a', color: '#4ade80', label: 'Weekly Health' };
      case 'monthly_executive': return { bg: '#2d2040', color: '#a78bfa', label: 'Monthly Executive' };
      case 'failed_jobs':       return { bg: '#3a1e1e', color: '#f87171', label: 'Failed Jobs' };
      case 'device_status':     return { bg: '#3a2a1a', color: '#fb923c', label: 'Device Status' };
      default:                  return { bg: '#23233a', color: '#9ca3af', label: rt };
    }
  }
</script>

<div class="space-y-6">
  <h1 style="font-size:24px; font-weight:700; color:#ffffff;">Reports</h1>

  <!-- Tabs -->
  <div style="border-bottom:1px solid #374151; display:flex; gap:24px;">
    <button on:click={() => { tab = 'ondemand'; selected = null; result = null; }}
      style="padding-bottom:8px; font-size:14px; font-weight:500; border-bottom:2px solid {tab === 'ondemand' ? '#0094ba' : 'transparent'}; color:{tab === 'ondemand' ? '#00adda' : '#9ca3af'}; background:none; border-top:none; border-left:none; border-right:none; cursor:pointer;">
      On Demand
    </button>
    <button on:click={() => { tab = 'scheduled'; loadScheduled(); }}
      style="padding-bottom:8px; font-size:14px; font-weight:500; border-bottom:2px solid {tab === 'scheduled' ? '#0094ba' : 'transparent'}; color:{tab === 'scheduled' ? '#00adda' : '#9ca3af'}; background:none; border-top:none; border-left:none; border-right:none; cursor:pointer;">
      Scheduled Reports
    </button>
    <button on:click={() => { tab = 'ai'; aiError = ''; loadTargetsOnce(); }}
      style="padding-bottom:8px; font-size:14px; font-weight:500; border-bottom:2px solid {tab === 'ai' ? '#0094ba' : 'transparent'}; color:{tab === 'ai' ? '#00adda' : '#9ca3af'}; background:none; border-top:none; border-left:none; border-right:none; cursor:pointer;">
      AI Reports
    </button>
  </div>

  {#if tab === 'ondemand'}
    <div class="grid grid-cols-3 gap-8">

      <!-- Backup Reports -->
      <div>
        <h2 class="text-base font-bold text-gray-800 mb-3 pb-2 border-b-2 border-brand-600">Backup Reports</h2>
        <div class="space-y-2">
          {#each REPORTS.backup as r}
            <button
              class="block w-full text-left text-sm px-2 py-1.5 rounded transition-colors
                {selected?.id === r.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-brand-600 hover:bg-gray-50'}"
              on:click={() => selectReport(r)}>
              → {r.label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Compliance Reports -->
      <div>
        <h2 class="text-base font-bold text-gray-800 mb-3 pb-2 border-b-2 border-brand-600">Compliance Reports</h2>
        <div class="space-y-2">
          {#each REPORTS.compliance as r}
            <button
              class="block w-full text-left text-sm px-2 py-1.5 rounded transition-colors
                {selected?.id === r.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-brand-600 hover:bg-gray-50'}"
              on:click={() => selectReport(r)}>
              → {r.label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Administrative Reports -->
      <div>
        <h2 class="text-base font-bold text-gray-800 mb-3 pb-2 border-b-2 border-brand-600">Administrative Reports</h2>
        <div class="space-y-2">
          {#each REPORTS.admin as r}
            <button
              class="block w-full text-left text-sm px-2 py-1.5 rounded transition-colors
                {selected?.id === r.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-brand-600 hover:bg-gray-50'}"
              on:click={() => selectReport(r)}>
              → {r.label}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- Generate panel -->
    {#if selected}
      <div class="bg-white rounded-lg shadow p-6 space-y-4 border-t-4 border-brand-600">
        <div>
          <h3 class="text-lg font-semibold text-gray-900">{selected.label}</h3>
          <p class="text-sm text-gray-500 mt-1">{selected.desc}</p>
        </div>

        {#if selected.params.length > 0}
          <div class="flex flex-wrap gap-4">
            {#each selected.params as p}
              <div>
                <label class="block text-xs text-gray-500 mb-1">{p.label}</label>
                {#if p.type === 'select'}
                  <select bind:value={paramValues[p.key]}
                    class="border rounded px-3 py-1.5 text-sm text-gray-700">
                    {#each (p.options ?? []) as opt}
                      <option value={opt}>{opt === '' ? 'All' : opt}</option>
                    {/each}
                  </select>
                {:else}
                  <input type="number" bind:value={paramValues[p.key]} min="1"
                    class="border rounded px-3 py-1.5 text-sm w-24" />
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if error}
          <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">{error}</div>
        {/if}

        <div class="flex gap-3">
          <button class="btn-secondary" on:click={() => generate('json')} disabled={loading}>
            {loading ? 'Generating…' : 'Generate with Defaults'}
          </button>
          <button class="btn-secondary" on:click={() => generate('csv')} disabled={loading}>
            Generate with Filters (CSV)
          </button>
        </div>
      </div>
    {:else}
      <div class="text-center py-12 text-gray-400 text-sm">
        Select a report from the list above to generate it.
      </div>
    {/if}

    <!-- Results table -->
    {#if result}
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <span class="text-sm font-semibold text-gray-700">{result.total} records</span>
          <button class="text-xs text-brand-600 hover:text-brand-800" on:click={() => generate('csv')}>
            ↓ Export CSV
          </button>
        </div>
        {#if result.rows.length === 0}
          <p class="px-5 py-6 text-center text-gray-400 text-sm">No data for the selected period.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 border-b">
                <tr>
                  {#each Object.keys(result.rows[0]) as col}
                    <th class="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase whitespace-nowrap">
                      {col.replace(/_/g, ' ')}
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each result.rows as row}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    {#each Object.values(row) as val}
                      <td class="px-4 py-2 {statusClass(String(val))} whitespace-nowrap">{val ?? '—'}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}

  {:else if tab === 'ai'}
    <!-- ── AI Reports ────────────────────────────────────────────────────── -->
    <div style="display:grid; grid-template-columns:280px 1fr; gap:20px; height:calc(100vh - 220px); min-height:500px;">

      <!-- Left sidebar: context controls + suggested prompts -->
      <div style="display:flex; flex-direction:column; gap:12px; overflow-y:auto;">

        <!-- Context controls -->
        <div style="background:#23233a; border:1px solid #374151; border-radius:10px; padding:16px;">
          <div style="font-size:12px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; margin-bottom:12px;">Data Context</div>

          <div style="margin-bottom:10px;">
            <label style="display:block; font-size:11px; color:#6b7280; margin-bottom:4px;">Period</label>
            <select bind:value={aiDays}
              style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:7px 10px; font-size:13px;">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          <div style="margin-bottom:12px;">
            <label style="display:block; font-size:11px; color:#6b7280; margin-bottom:4px;">
              Scope
            </label>
            <select bind:value={aiOrgId}
              style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:7px 10px; font-size:13px;">
              <option value="">All {$auth?.tenant_type === 'master_msp' ? 'MSPs' : 'Clients'}</option>
              {#each reportTargets as t}
                <option value={String(t.id)}>{t.name}</option>
              {/each}
            </select>
          </div>

          <button
            on:click={downloadAiReport}
            disabled={aiPdfLoading}
            style="width:100%; background:#1e3a4a; color:#38bdf8; border:1px solid #164e63; border-radius:6px; padding:8px 12px; font-size:12px; font-weight:600; cursor:{aiPdfLoading ? 'wait' : 'pointer'}; display:flex; align-items:center; justify-content:center; gap:6px;">
            {#if aiPdfLoading}
              <span style="display:inline-block; width:12px; height:12px; border:2px solid #38bdf8; border-top-color:transparent; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
              Generating…
            {:else}
              ↓ Download PDF Report
            {/if}
          </button>
        </div>

        <!-- Suggested prompts -->
        <div style="background:#23233a; border:1px solid #374151; border-radius:10px; padding:16px; flex:1;">
          <div style="font-size:12px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px;">Suggested Prompts</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            {#each SUGGESTED_PROMPTS as sp}
              <button
                on:click={() => sendAiPrompt(sp)}
                disabled={aiLoading}
                style="text-align:left; background:#1e1e35; border:1px solid #2d2d45; color:#9ca3af; border-radius:6px; padding:8px 10px; font-size:12px; line-height:1.4; cursor:{aiLoading ? 'not-allowed' : 'pointer'}; transition:all 0.15s;"
                on:mouseenter={e => { if (!aiLoading) { const t = e.currentTarget; t.style.borderColor='#0094ba'; t.style.color='#d1d5db'; } }}
                on:mouseleave={e => { const t = e.currentTarget; t.style.borderColor='#2d2d45'; t.style.color='#9ca3af'; }}>
                {sp}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Right: chat area -->
      <div style="display:flex; flex-direction:column; background:#23233a; border:1px solid #374151; border-radius:10px; overflow:hidden;">

        <!-- Messages -->
        <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px;" id="ai-chat-scroll">

          {#if aiMessages.length === 0}
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#6b7280; text-align:center; padding:40px;">
              <div style="font-size:32px; margin-bottom:12px;">💬</div>
              <div style="font-size:16px; font-weight:600; color:#9ca3af; margin-bottom:8px;">Ask anything about your backup operations</div>
              <div style="font-size:13px; line-height:1.6; max-width:400px;">
                I have access to all your backup jobs, device status, client health, SureRestore test results, retention policies, and connector health. Use a suggested prompt or type your own question.
              </div>
            </div>
          {:else}
            {#each aiMessages as msg, i}
              {#if msg.role === 'user'}
                <div style="display:flex; justify-content:flex-end;">
                  <div style="max-width:75%; background:#0f4c75; color:#e0f2fe; border-radius:12px 12px 2px 12px; padding:12px 16px; font-size:14px; line-height:1.5; white-space:pre-wrap;">
                    {msg.text}
                  </div>
                </div>
              {:else}
                <div style="display:flex; gap:10px; align-items:flex-start;">
                  <div style="width:28px; height:28px; border-radius:50%; background:#0f172a; border:1px solid #374151; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; margin-top:2px;">🤖</div>
                  <div style="flex:1; min-width:0;">
                    <div style="background:#1e1e35; border:1px solid #2d2d45; border-radius:2px 12px 12px 12px; padding:14px 16px; font-size:14px; line-height:1.7; color:#d1d5db; white-space:pre-wrap; word-break:break-word;">
                      {#if msg.text}
                        {msg.text}
                      {:else if aiStreaming && i === aiMessages.length - 1}
                        <span style="display:inline-flex; gap:4px; align-items:center;">
                          <span style="width:6px; height:6px; background:#0094ba; border-radius:50%; animation:pulse 1s infinite;"></span>
                          <span style="width:6px; height:6px; background:#0094ba; border-radius:50%; animation:pulse 1s 0.2s infinite;"></span>
                          <span style="width:6px; height:6px; background:#0094ba; border-radius:50%; animation:pulse 1s 0.4s infinite;"></span>
                        </span>
                      {/if}
                    </div>
                    {#if msg.text && !(aiStreaming && i === aiMessages.length - 1)}
                      <div style="display:flex; justify-content:flex-end; margin-top:6px;">
                        <button
                          on:click={() => downloadChatPdf(i, msg)}
                          disabled={!!aiMsgPdfLoading[i]}
                          style="background:#1a3a2a; color:#4ade80; border:1px solid #166534; border-radius:6px; padding:5px 12px; font-size:12px; font-weight:600; cursor:{aiMsgPdfLoading[i] ? 'wait' : 'pointer'}; display:flex; align-items:center; gap:6px;">
                          {#if aiMsgPdfLoading[i]}
                            <span style="display:inline-block; width:11px; height:11px; border:2px solid #4ade80; border-top-color:transparent; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
                            Generating PDF…
                          {:else}
                            ↓ Download as PDF
                          {/if}
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>

        <!-- Error -->
        {#if aiError}
          <div style="margin:0 16px 8px; background:#3a1e1e; border:1px solid #f87171; color:#f87171; border-radius:6px; padding:8px 12px; font-size:12px;">
            {aiError}
          </div>
        {/if}

        <!-- Input -->
        <div style="border-top:1px solid #374151; padding:14px 16px; display:flex; gap:10px; align-items:flex-end;">
          <textarea
            bind:value={aiPrompt}
            on:keydown={handleAiKey}
            placeholder="Ask a question about your backup operations… (Enter to send, Shift+Enter for new line)"
            rows="2"
            disabled={aiLoading}
            style="flex:1; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:8px; padding:10px 14px; font-size:14px; resize:none; outline:none; line-height:1.5; font-family:inherit;"
          ></textarea>
          <button
            on:click={() => sendAiPrompt()}
            disabled={aiLoading || !aiPrompt.trim()}
            style="background:{aiLoading || !aiPrompt.trim() ? '#374151' : '#0094ba'}; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-size:14px; font-weight:600; cursor:{aiLoading || !aiPrompt.trim() ? 'not-allowed' : 'pointer'}; white-space:nowrap; display:flex; align-items:center; gap:8px; height:44px; transition:background 0.15s;">
            {#if aiLoading}
              <span style="display:inline-block; width:14px; height:14px; border:2px solid #9ca3af; border-top-color:#fff; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
            {:else}
              Send
            {/if}
          </button>
        </div>
      </div>
    </div>

  {:else}
    <!-- ── Scheduled Reports ─────────────────────────────────────────────── -->

    <!-- Run-now toast -->
    {#if runNowToast}
      <div style="position:fixed; bottom:24px; right:24px; background:#0094ba; color:#fff; padding:12px 20px; border-radius:8px; font-size:14px; z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.4);">
        {runNowToast}
      </div>
    {/if}

    <!-- Stats row -->
    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px;">
      <div style="background:#23233a; border:1px solid #374151; border-radius:8px; padding:20px;">
        <div style="font-size:12px; color:#9ca3af; margin-bottom:6px;">Total Scheduled</div>
        <div style="font-size:28px; font-weight:700; color:#fff;">{scheduledReports.length}</div>
      </div>
      <div style="background:#23233a; border:1px solid #374151; border-radius:8px; padding:20px;">
        <div style="font-size:12px; color:#9ca3af; margin-bottom:6px;">Sent This Week</div>
        <div style="font-size:28px; font-weight:700; color:#4ade80;">{statSentThisWeek}</div>
      </div>
      <div style="background:#23233a; border:1px solid #374151; border-radius:8px; padding:20px;">
        <div style="font-size:12px; color:#9ca3af; margin-bottom:6px;">Next Delivery</div>
        <div style="font-size:16px; font-weight:600; color:#fff;">{statNextDelivery ? formatDT(statNextDelivery) : '—'}</div>
      </div>
      <div style="background:#23233a; border:1px solid #374151; border-radius:8px; padding:20px;">
        <div style="font-size:12px; color:#9ca3af; margin-bottom:6px;">Failed Sends</div>
        <div style="font-size:28px; font-weight:700; color:{statFailedSends > 0 ? '#f87171' : '#fff'};">{statFailedSends}</div>
      </div>
    </div>

    <!-- Filter bar -->
    <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <select bind:value={schedFilterOrg}
        style="background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
        <option value="">All {$auth?.tenant_type === 'master_msp' ? 'MSPs' : 'Clients'}</option>
        {#each reportTargets as t}
          <option value={String(t.id)}>{t.name}</option>
        {/each}
      </select>

      <select bind:value={schedFilterType}
        style="background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
        <option value="">All Types</option>
        <option value="daily_summary">Daily Summary</option>
        <option value="weekly_health">Weekly Health</option>
        <option value="monthly_executive">Monthly Executive</option>
        <option value="failed_jobs">Failed Jobs</option>
        <option value="device_status">Device Status</option>
      </select>

      <select bind:value={schedFilterStatus}
        style="background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
        <option value="">All Status</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>

      <div style="flex:1;"></div>

      <button on:click={openCreatePanel}
        style="background:#0094ba; color:#fff; border:none; border-radius:6px; padding:8px 16px; font-size:14px; font-weight:600; cursor:pointer;">
        + Schedule Report
      </button>
    </div>

    <!-- Table -->
    <div style="background:#23233a; border:1px solid #374151; border-radius:8px; overflow:hidden;">
      {#if loadingScheduled}
        <div style="padding:48px; text-align:center; color:#9ca3af; font-size:14px;">Loading…</div>
      {:else if filteredReports.length === 0}
        <div style="padding:48px; text-align:center; color:#9ca3af; font-size:14px;">
          No scheduled reports yet. Click '+ Schedule Report' to get started.
        </div>
      {:else}
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="background:#1e1e35; border-bottom:1px solid #374151;">
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Report Name</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Type</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">{$auth?.tenant_type === 'master_msp' ? 'MSP' : 'Client'}</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Schedule</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Next Run</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Recipients</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Status</th>
                <th style="text-align:left; padding:12px 16px; color:#9ca3af; font-weight:600; white-space:nowrap;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredReports as r (r.id)}
                <tr style="border-bottom:1px solid #2d2d45;">
                  <td style="padding:12px 16px; color:#ffffff; font-weight:500;">{r.name}</td>
                  <td style="padding:12px 16px;">
                    {#if true}
                      <span style="background:{typePill(r.report_type).bg}; color:{typePill(r.report_type).color}; padding:3px 10px; border-radius:9999px; font-size:12px; font-weight:500; white-space:nowrap;">
                        {typePill(r.report_type).label}
                      </span>
                    {/if}
                  </td>
                  <td style="padding:12px 16px; color:#d1d5db;">{r.org_name ?? '—'}</td>
                  <td style="padding:12px 16px; color:#d1d5db; text-transform:capitalize;">{r.schedule}</td>
                  <td style="padding:12px 16px;">
                    {#if r.next_run_at && new Date(r.next_run_at) < new Date()}
                      <span style="color:#f87171;">⚠ Overdue</span>
                    {:else}
                      <span style="color:#d1d5db;">{formatDT(r.next_run_at)}</span>
                    {/if}
                  </td>
                  <td style="padding:12px 16px; color:#d1d5db;">{r.recipient_count}</td>
                  <td style="padding:12px 16px;">
                    <!-- Toggle switch -->
                    <button
                      on:click={() => toggleReport(r)}
                      style="width:40px; height:22px; border-radius:11px; border:none; cursor:pointer; position:relative; background:{r.is_enabled ? '#0094ba' : '#374151'}; transition:background 0.2s;"
                      aria-label="Toggle report">
                      <span style="position:absolute; top:3px; left:{r.is_enabled ? '21px' : '3px'}; width:16px; height:16px; border-radius:50%; background:#fff; transition:left 0.2s;"></span>
                    </button>
                  </td>
                  <td style="padding:12px 16px;">
                    {#if deleteConfirmId === r.id}
                      <span style="color:#d1d5db; font-size:12px;">Are you sure?</span>
                      <button on:click={() => deleteReport(r.id)}
                        style="margin-left:6px; background:#f87171; color:#fff; border:none; border-radius:4px; padding:2px 8px; font-size:12px; cursor:pointer;">Yes</button>
                      <button on:click={() => { deleteConfirmId = null; }}
                        style="margin-left:4px; background:#374151; color:#d1d5db; border:none; border-radius:4px; padding:2px 8px; font-size:12px; cursor:pointer;">Cancel</button>
                    {:else}
                      <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                        <div style="display:flex; gap:8px; align-items:center;">
                          <button on:click={() => openEditPanel(r)}
                            style="background:none; border:none; cursor:pointer; color:#9ca3af; font-size:15px; padding:2px 4px;" title="Edit">✏</button>
                          <button on:click={() => runNow(r.id)}
                            disabled={runNowLoading[r.id]}
                            style="background:none; border:none; cursor:{runNowLoading[r.id] ? 'wait' : 'pointer'}; color:{runNowLoading[r.id] ? '#6b7280' : '#9ca3af'}; font-size:15px; padding:2px 4px;" title="Run Now">
                            {runNowLoading[r.id] ? '⏳' : '▶'}
                          </button>
                          <button on:click={() => { deleteConfirmId = r.id; }}
                            style="background:none; border:none; cursor:pointer; color:#f87171; font-size:15px; padding:2px 4px;" title="Delete">🗑</button>
                        </div>
                        {#if runNowError[r.id]}
                          <div style="font-size:11px; color:#f87171; max-width:200px; word-break:break-word;">{runNowError[r.id]}</div>
                        {/if}
                      </div>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Slide-over panel -->
    {#if showPanel}
      <div style="position:fixed; top:0; right:0; height:100%; width:480px; background:#23233a; border-left:1px solid #374151; z-index:50; overflow-y:auto; padding:24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
          <h2 style="font-size:18px; font-weight:700; color:#fff; margin:0;">
            {editingReportId !== null ? 'Edit Scheduled Report' : 'New Scheduled Report'}
          </h2>
          <button on:click={() => { showPanel = false; }}
            style="background:none; border:none; color:#9ca3af; font-size:20px; cursor:pointer; line-height:1;">×</button>
        </div>

        {#if panelError}
          <div style="background:#3a1e1e; border:1px solid #f87171; color:#f87171; border-radius:6px; padding:10px 14px; font-size:13px; margin-bottom:16px;">
            {panelError}
          </div>
        {/if}

        <!-- Enabled toggle -->
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
          <button
            on:click={() => { pEnabled = !pEnabled; }}
            style="width:40px; height:22px; border-radius:11px; border:none; cursor:pointer; position:relative; background:{pEnabled ? '#0094ba' : '#374151'}; flex-shrink:0;"
            aria-label="Report enabled">
            <span style="position:absolute; top:3px; left:{pEnabled ? '21px' : '3px'}; width:16px; height:16px; border-radius:50%; background:#fff; transition:left 0.2s;"></span>
          </button>
          <span style="color:#d1d5db; font-size:14px;">Report Enabled</span>
        </div>

        <!-- Report Name -->
        <div style="margin-bottom:16px;">
          <label for="p-name" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Report Name</label>
          <input id="p-name" type="text" bind:value={pName}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; box-sizing:border-box;" />
        </div>

        <!-- Report Type -->
        <div style="margin-bottom:16px;">
          <label for="p-type" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Report Type</label>
          <select id="p-type" bind:value={pType}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
            <option value="daily_summary">Daily Summary</option>
            <option value="weekly_health">Weekly Backup Health</option>
            <option value="monthly_executive">Monthly Executive Summary</option>
            <option value="failed_jobs">Failed Jobs Report</option>
            <option value="device_status">Device Status Report</option>
          </select>
        </div>

        <!-- Org -->
        <div style="margin-bottom:16px;">
          <label for="p-org" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">
            {$auth?.tenant_type === 'master_msp' ? 'MSP' : 'Client'}
          </label>
          <select id="p-org" bind:value={pOrgId}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
            <option value={null}>Select…</option>
            {#each reportTargets as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        </div>

        <!-- Email Subject -->
        <div style="margin-bottom:16px;">
          <label for="p-subject" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Email Subject</label>
          <input id="p-subject" type="text" bind:value={pSubject}
            placeholder={"Supports {{client_name}} token"}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; box-sizing:border-box;" />
        </div>

        <!-- Recipients tag input -->
        <div style="margin-bottom:16px;">
          <label for="p-recipient-input" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Recipients</label>
          <div style="background:#1e1e35; border:1px solid #374151; border-radius:6px; padding:6px 8px; min-height:42px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
            {#each pRecipients as email}
              <span style="background:#2d2d45; color:#d1d5db; border-radius:9999px; padding:2px 10px; font-size:12px; display:flex; align-items:center; gap:4px;">
                {email}
                <button on:click={() => removeRecipient(email)}
                  style="background:none; border:none; color:#9ca3af; cursor:pointer; font-size:13px; line-height:1; padding:0;">×</button>
              </span>
            {/each}
            <input id="p-recipient-input" type="text" bind:value={pRecipientInput}
              on:keydown={handleRecipientKey}
              placeholder="email@example.com"
              style="background:none; border:none; outline:none; color:#d1d5db; font-size:13px; flex:1; min-width:140px;" />
          </div>
        </div>

        <!-- From Address -->
        <div style="margin-bottom:16px;">
          <label for="p-from" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">From Address</label>
          <select id="p-from" bind:value={pFromAddress}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
            <option value="BackupPulse">BackupPulse</option>
            <option value="Custom">Custom</option>
          </select>
          {#if pFromAddress === 'Custom'}
            <input type="text" bind:value={pCustomFrom} placeholder="noreply@yourcompany.com"
              style="margin-top:8px; width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; box-sizing:border-box;" />
          {/if}
        </div>

        <!-- Timezone -->
        <div style="margin-bottom:16px;">
          <label for="p-tz" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Time Zone</label>
          <select id="p-tz" bind:value={pTimezone}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Europe/Paris">Europe/Paris</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="Australia/Sydney">Australia/Sydney</option>
            <option value="UTC">UTC</option>
          </select>
        </div>

        <!-- Schedule -->
        <div style="margin-bottom:16px;">
          <label for="p-schedule" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Schedule</label>
          <select id="p-schedule" bind:value={pSchedule}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px;">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <!-- Start Date -->
        <div style="margin-bottom:16px;">
          <label for="p-start" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Start Date</label>
          <input id="p-start" type="date" bind:value={pStartDate}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; box-sizing:border-box;" />
        </div>

        <!-- Processing Time -->
        <div style="margin-bottom:16px;">
          <label for="p-time" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Processing Start Time</label>
          <input id="p-time" type="time" bind:value={pTime}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; box-sizing:border-box;" />
          {#if pTime}
            <div style="margin-top:4px; font-size:12px; color:#6b7280;">Estimated delivery by {deliveryEstimate}</div>
          {/if}
        </div>

        <!-- Custom Message -->
        <div style="margin-bottom:16px;">
          <label for="p-msg" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Custom Email Message</label>
          <textarea id="p-msg" bind:value={pMessage} rows="3"
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; resize:vertical; box-sizing:border-box;"></textarea>
        </div>

        <!-- Logo Upload -->
        <div style="margin-bottom:24px;">
          <label for="p-logo" style="display:block; font-size:12px; color:#9ca3af; margin-bottom:6px;">Report Logo <span style="color:#6b7280;">(optional)</span></label>
          {#if pLogoPreview}
            <div style="margin-bottom:8px; position:relative; display:inline-block;">
              <img src={pLogoPreview} alt="Logo preview"
                style="max-height:60px; max-width:200px; border-radius:4px; border:1px solid #374151; object-fit:contain; background:#1e1e35; padding:4px;" />
              <button on:click={removeLogo}
                style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; border-radius:50%; background:#f87171; border:none; color:#fff; font-size:11px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center;">×</button>
            </div>
          {/if}
          <input id="p-logo" type="file" accept="image/*" on:change={handleLogoFile}
            style="width:100%; background:#1e1e35; border:1px solid #374151; color:#9ca3af; border-radius:6px; padding:6px 10px; font-size:13px; box-sizing:border-box; cursor:pointer;" />
          <div style="margin-top:4px; font-size:11px; color:#6b7280;">PNG, JPG or SVG. Appears in the email header.</div>
        </div>

        <!-- Footer -->
        <div style="display:flex; gap:12px;">
          <button on:click={() => { showPanel = false; }}
            style="flex:1; background:#374151; color:#d1d5db; border:none; border-radius:6px; padding:10px; font-size:14px; font-weight:600; cursor:pointer;">
            Cancel
          </button>
          <button on:click={saveReport} disabled={savingReport}
            style="flex:1; background:#0094ba; color:#fff; border:none; border-radius:6px; padding:10px; font-size:14px; font-weight:600; cursor:pointer; opacity:{savingReport ? '0.6' : '1'};">
            {savingReport ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }
</style>
