<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    licenseStore,
    hasTestRestore,
    testRestoreDeviceLimit,
    testRestoreDevicesUsed,
    isAtTestRestoreLimit,
  } from '$lib/stores/license';
  import { api } from '$lib/api';
  import type {
    SureRestoreScheduleItem,
    SureRestoreRunItem,
    SureRestoreDeviceStatus,
    SureRestoreDevice,
    SureRestoreScheduleCreate,
    SureRestoreScheduleUpdate,
    SureRestoreTicketTemplate,
    PSAOptions,
  } from '$lib/api';

  const RT = [
    { key: 'file_restore',      label: 'File & Folder Restore',  description: 'Validate individual file/folder restores with RTO measurement.',          phase: 1, color: '#0094ba' },
    { key: 'vm_virtualization', label: 'VM Virtualization Test',  description: 'Boot backed-up VM in isolated network, validate services and RTO.',         phase: 1, color: '#7c3aed' },
    { key: 'cloud_bcdr',        label: 'Cloud BCDR Failover',     description: 'Trigger cloud failover and validate DR workload reachability.',              phase: 2, color: '#0369a1' },
    { key: 'physical_host',     label: 'Physical Host Restore',   description: 'Validate bare-metal restore via BMR or dissimilar hardware.',                phase: 2, color: '#9a3412' },
  ];

  const DAYS_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let mounted = false;
  type Tab = 'dashboard' | 'schedules' | 'history' | 'templates';
  let activeTab: Tab = 'dashboard';

  // ── Data ─────────────────────────────────────────────────────────────────────
  let statuses:  SureRestoreDeviceStatus[] = [];
  let schedules: SureRestoreScheduleItem[] = [];
  let runs:      SureRestoreRunItem[]      = [];
  let devices:   SureRestoreDevice[]       = [];
  let loading = true;

  // ── Filters ───────────────────────────────────────────────────────────────────
  let schedFilter: 'all' | 'enabled' | 'disabled' = 'all';
  let schedMspFilter   = '';
  let schedClientFilter = '';
  let histFilter:  'all' | 'passed'  | 'failed'   = 'all';

  // ── Wizard state ─────────────────────────────────────────────────────────────
  let wizardOpen  = false;
  let editingId:  number | null = null;
  let wizStep     = 1;

  // Step 1 – Restore Type
  let wType = '';
  // Step 2 – Device & Tool
  let wDeviceId: number | '' = '';
  let wTool = '';
  let wMspFilter = '';
  let wClientFilter = '';
  // Step 3 – Destination
  let wFilePath    = 'C:/Windows/System32/notepad.exe';
  let wRestoreDest = 'C:/RestoreTest/';
  let wDestType    = '';
  let wDestName    = '';
  // Step 4 – Schedule & Notify
  let wFreq: 'daily' | 'weekly' | 'monthly' = 'monthly';
  let wDow         = 1;
  let wDom         = 1;
  let wRunTime     = '02:00';
  let wRpoHours    = 24;
  let wRtoMins     = 240;
  let wEmailsFail: string[] = [];
  let wEmailsPass: string[] = [];
  let wPsaTicket        = true;
  let wAdvanceTicket    = true;
  let wTemplateId: number | null = null;
  let wAdvanceDays      = 3;
  let wEmailFailInput = '';
  let wEmailPassInput = '';
  let wSaving = false;
  let wError  = '';

  // ── Templates ─────────────────────────────────────────────────────────────────
  let templates: SureRestoreTicketTemplate[] = [];
  let tplModalOpen  = false;
  let tplEditingId: number | null = null;
  let tplName = ''; let tplRestoreType = ''; let tplIsDefault = false;
  let tplSubject = ''; let tplBody = '';
  let tplPsaType = ''; let tplPsaCategory = ''; let tplPsaPriority = '';
  let tplPsaAgent = ''; let tplPsaClientId = ''; let tplClientMapping = '';
  let tplSaving = false; let tplError = '';

  let psaOptions: PSAOptions | null = null;
  let psaOptionsLoading = false;
  let psaOptionsWarn = '';

  async function loadPsaOptions() {
    psaOptionsLoading = true; psaOptionsWarn = '';
    try {
      psaOptions = await api.sureRestorePsaOptions();
    } catch (e: any) {
      psaOptions = null;
      const msg: string = e.message ?? '';
      psaOptionsWarn = msg.toLowerCase().includes('no enabled psa') || msg.toLowerCase().includes('no psa')
        ? 'No PSA integration configured — enter field IDs manually.'
        : `PSA options unavailable: ${msg}`;
    } finally { psaOptionsLoading = false; }
  }

  async function loadTemplates() {
    try {
      const r = await api.sureRestoreTicketTemplates();
      templates = r.templates ?? [];
    } catch { templates = []; }
  }

  function openAddTemplate() {
    tplEditingId = null; tplName = ''; tplRestoreType = ''; tplIsDefault = false;
    tplSubject = 'Scheduled Test Restore: {{restore_type}} — {{device_name}}';
    tplBody = '<p>A test restore is scheduled for <strong>{{device_name}}</strong>.</p><ul><li><strong>Company:</strong> {{company_name}}</li><li><strong>Restore Type:</strong> {{restore_type}}</li><li><strong>Scheduled Date:</strong> {{scheduled_date}}</li></ul>';
    tplPsaType = ''; tplPsaCategory = ''; tplPsaPriority = '';
    tplPsaAgent = ''; tplPsaClientId = ''; tplClientMapping = '';
    tplError = ''; tplModalOpen = true;
    loadPsaOptions();
  }

  function openEditTemplate(t: SureRestoreTicketTemplate) {
    tplEditingId = t.id; tplName = t.name; tplRestoreType = t.restore_type ?? '';
    tplIsDefault = t.is_default; tplSubject = t.subject_template; tplBody = t.body_template;
    tplPsaType = t.psa_type ?? ''; tplPsaCategory = t.psa_category ?? '';
    tplPsaPriority = t.psa_priority ?? ''; tplPsaAgent = t.psa_agent ?? '';
    tplPsaClientId = t.psa_client_id ?? ''; tplClientMapping = t.psa_client_mapping ?? '';
    tplError = ''; tplModalOpen = true;
    loadPsaOptions();
  }

  async function saveTpl() {
    if (!tplName.trim() || !tplSubject.trim() || !tplBody.trim()) {
      tplError = 'Name, Subject and Body are required.'; return;
    }
    tplSaving = true; tplError = '';
    const payload = {
      name: tplName, restore_type: tplRestoreType || null, is_default: tplIsDefault,
      subject_template: tplSubject, body_template: tplBody,
      psa_type: tplPsaType || null, psa_category: tplPsaCategory || null,
      psa_priority: tplPsaPriority || null, psa_agent: tplPsaAgent || null,
      psa_client_id: tplPsaClientId || null,
      psa_client_mapping: tplClientMapping || null,
    };
    try {
      if (tplEditingId !== null) {
        const r = await api.updateSureRestoreTicketTemplate(tplEditingId, payload);
        templates = templates.map(t => t.id === tplEditingId ? r : t);
        toast('Template updated');
      } else {
        const r = await api.createSureRestoreTicketTemplate(payload);
        templates = [...templates, r];
        toast('Template created');
      }
      tplModalOpen = false;
    } catch (e: any) { tplError = e.message ?? 'Save failed'; }
    finally { tplSaving = false; }
  }

  async function deleteTpl(t: SureRestoreTicketTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.deleteSureRestoreTicketTemplate(t.id);
      templates = templates.filter(x => x.id !== t.id);
      toast('Template deleted');
    } catch (e: any) { toast(e.message ?? 'Delete failed', false); }
  }

  async function toggleSchedule(s: SureRestoreScheduleItem) {
    try {
      const updated = await api.updateSureRestoreSchedule(s.id, { is_enabled: !s.is_enabled });
      schedules = schedules.map(x => x.id === s.id ? updated : x);
      testRestoreDevicesUsed.set(schedules.filter(x => x.is_enabled).length);
      toast(updated.is_enabled ? 'Schedule enabled' : 'Schedule paused');
    } catch (e: any) { toast(e.message ?? 'Toggle failed', false); }
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────────
  let lightboxUrl: string | null = null;

  // ── Toasts ────────────────────────────────────────────────────────────────────
  let toasts: { id: number; msg: string; ok: boolean }[] = [];
  let _tid = 0;
  function toast(msg: string, ok = true) {
    const id = ++_tid;
    toasts = [...toasts, { id, msg, ok }];
    setTimeout(() => { toasts = toasts.filter(t => t.id !== id); }, 3500);
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  $: schedMspOptions    = [...new Set(schedules.map(s => s.msp_name ?? s.org_name).filter(Boolean))] as string[];
  $: schedClientOptions = schedMspFilter
    ? [...new Set(schedules.filter(s => (s.msp_name ?? s.org_name) === schedMspFilter).map(s => s.msp_name ? (s.org_name ?? '') : '').filter(Boolean))] as string[]
    : [];
  $: filteredSched = schedules
    .filter(s => schedFilter === 'all' || (schedFilter === 'enabled' ? s.is_enabled : !s.is_enabled))
    .filter(s => !schedMspFilter    || (s.msp_name ?? s.org_name) === schedMspFilter)
    .filter(s => !schedClientFilter || (s.msp_name ? s.org_name === schedClientFilter : true));

  $: filteredRuns =
    histFilter === 'passed' ? runs.filter(r => r.overall_status === 'passed') :
    histFilter === 'failed' ? runs.filter(r => r.overall_status === 'failed') :
    runs;

  $: allTools        = [...new Set(devices.flatMap(d => d.tools))].sort();
  $: wMspOptions     = [...new Set(devices.map(d => d.msp_name ?? d.org_name).filter(Boolean))] as string[];
  $: wClientOptions  = wMspFilter
    ? [...new Set(devices.filter(d => (d.msp_name ?? d.org_name) === wMspFilter).map(d => d.msp_name ? (d.org_name ?? '') : '').filter(Boolean))] as string[]
    : [];
  $: devicesPreFiltered = devices
    .filter(d => !wMspFilter   || (d.msp_name ?? d.org_name) === wMspFilter)
    .filter(d => !wClientFilter || (d.msp_name ? d.org_name === wClientFilter : true));
  $: filteredDevices = wTool ? devicesPreFiltered.filter(d => d.tools.includes(wTool)) : devicesPreFiltered;
  $: if (wTool && wDeviceId && !filteredDevices.find(d => d.id === wDeviceId)) { wDeviceId = ''; }

  $: healthyCnt      = statuses.filter(s => s.health_status === 'healthy').length;
  $: criticalCnt     = statuses.filter(s => s.health_status === 'critical').length;
  $: verifyFailedCnt = filteredHealth.filter(s => s.auto_verify_status === 'failed').length;
  $: rpoBreachCnt    = filteredHealth.filter(s => s.rpo_breached).length;

  // ── Schedule tab stat cards ───────────────────────────────────────────────
  $: activeSchedCnt = schedules.filter(s => s.is_enabled).length;

  $: nextRunSched = (() => {
    const now = new Date();
    return schedules
      .filter(s => s.is_enabled && s.next_run_at != null && new Date(s.next_run_at!) > now)
      .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())[0] ?? null;
  })();

  $: avgRtoTarget = (() => {
    const vals = schedules.filter(s => s.rto_target_minutes != null).map(s => Number(s.rto_target_minutes));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  $: overdueScheds = schedules.filter(s =>
    s.is_enabled && s.next_run_at != null && new Date(s.next_run_at!) < new Date()
  );

  let syncing = false;
  let syncResult = '';
  async function triggerSync() {
    syncing = true;
    syncResult = '';
    try {
      const result = await api.sureRestoreSync();
      syncResult = `${result.devices_synced ?? 0} device${(result.devices_synced ?? 0) !== 1 ? 's' : ''} synced, ${result.new_jobs ?? 0} new job${(result.new_jobs ?? 0) !== 1 ? 's' : ''}`;
      await loadAll();
    } catch (e: any) {
      syncResult = `Sync failed: ${e?.message ?? 'unknown error'}`;
    } finally { syncing = false; }
  }

  $: deviceNameById = Object.fromEntries(
    schedules.map(s => [s.device_id, s.device_name ?? `Device ${s.device_id}`])
  );

  $: if (mounted && typeof window !== 'undefined') {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', activeTab);
    history.replaceState({}, '', u.toString());
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    if (!$hasTestRestore) { goto('/'); return; }
    const t = new URL(window.location.href).searchParams.get('tab') as Tab | null;
    if (t === 'schedules' || t === 'history') activeTab = t;
    mounted = true;
    await loadAll();
  });

  async function loadAll() {
    loading = true;
    try {
      const [db, sc, rv, dv] = await Promise.all([
        api.sureRestoreDashboard().catch(() => ({ device_statuses: [] as SureRestoreDeviceStatus[] })),
        api.sureRestoreSchedules().catch(()  => ({ schedules: []  as SureRestoreScheduleItem[] })),
        api.sureRestoreRuns().catch(()       => ({ runs: []       as SureRestoreRunItem[] })),
        api.sureRestoreDevices().catch(()    => ({ devices: []    as SureRestoreDevice[] })),
      ]);
      statuses  = db.device_statuses;
      deviceShowCount = 10;
      dashFilter = '';
      cardDrill = '';
      schedules = sc.schedules;
      runs      = rv.runs;
      devices   = dv.devices;
      testRestoreDevicesUsed.set(schedules.filter(x => x.is_enabled).length);
      await loadTemplates();
    } finally { loading = false; }
  }

  // ── Wizard open ───────────────────────────────────────────────────────────────
  function openAdd() {
    editingId = null; wizStep = 1;
    wType = ''; wDeviceId = ''; wTool = ''; wMspFilter = ''; wClientFilter = '';
    wFilePath = 'C:/Windows/System32/notepad.exe'; wRestoreDest = 'C:/RestoreTest/';
    wDestType = ''; wDestName = '';
    wFreq = 'monthly'; wDow = 1; wDom = 1; wRunTime = '02:00';
    wRpoHours = 24; wRtoMins = 240;
    wEmailsFail = []; wEmailsPass = []; wPsaTicket = true;
    wAdvanceTicket = true; wTemplateId = null; wAdvanceDays = 3;
    wEmailFailInput = ''; wEmailPassInput = '';
    wError = ''; wizardOpen = true;
  }

  function openEdit(s: SureRestoreScheduleItem) {
    editingId = s.id; wizStep = 1;
    wType      = s.restore_type;
    wDeviceId  = s.device_id;
    wTool      = s.backup_tool;
    wFilePath    = s.file_path_to_test  ?? 'C:/Windows/System32/notepad.exe';
    wRestoreDest = s.restore_dest_path  ?? 'C:/RestoreTest/';
    wDestType    = s.destination_type   ?? '';
    wDestName    = s.destination_name   ?? '';
    wFreq        = (s.frequency as 'daily' | 'weekly' | 'monthly') ?? 'monthly';
    wDow         = s.day_of_week  ?? 1;
    wDom         = s.day_of_month ?? 1;
    wRunTime     = s.run_time     ?? '02:00';
    wRpoHours    = s.rpo_threshold_hours ?? 24;
    wRtoMins     = s.rto_target_minutes  ?? 240;
    wEmailsFail  = [...(s.notify_on_failure ?? [])];
    wEmailsPass  = [...(s.notify_on_pass   ?? [])];
    wPsaTicket      = s.psa_ticket_on_failure ?? true;
    wAdvanceTicket  = s.psa_advance_ticket ?? true;
    wTemplateId     = s.psa_template_id ?? null;
    wAdvanceDays    = s.ticket_advance_days ?? 3;
    wEmailFailInput = ''; wEmailPassInput = '';
    wError = ''; wizardOpen = true;
  }

  function wizNext() {
    if (wizStep === 1 && !wType) { wError = 'Select a restore type.'; return; }
    if (wizStep === 2 && !editingId && (!wDeviceId || !wTool)) { wError = 'Select a device and backup tool.'; return; }
    wError = '';
    if (wizStep < 4) wizStep++;
  }

  function wizBack() { wError = ''; if (wizStep > 1) wizStep--; }

  async function wizSave() {
    wSaving = true; wError = '';
    try {
      if (editingId !== null) {
        const body: SureRestoreScheduleUpdate = {
          frequency:          wFreq,
          day_of_week:        wFreq === 'weekly'  ? wDow : null,
          day_of_month:       wFreq === 'monthly' ? wDom : null,
          run_time:           wRunTime,
          rpo_threshold_hours: wRpoHours,
          rto_target_minutes:  wRtoMins,
          destination_type:   wDestType  || null,
          destination_name:   wDestName  || null,
          file_path_to_test:  wFilePath,
          restore_dest_path:  wRestoreDest,
          notify_on_failure:  wEmailsFail,
          notify_on_pass:     wEmailsPass,
          psa_ticket_on_failure: wPsaTicket,
          psa_advance_ticket: wAdvanceTicket,
          psa_template_id:    wTemplateId,
          ticket_advance_days: wAdvanceDays,
        };
        const updated = await api.updateSureRestoreSchedule(editingId, body);
        schedules = schedules.map(s => s.id === editingId ? updated : s);
        toast('Schedule updated');
      } else {
        const body: SureRestoreScheduleCreate = {
          device_id:           wDeviceId as number,
          restore_type:        wType,
          backup_tool:         wTool,
          frequency:           wFreq,
          day_of_week:         wFreq === 'weekly'  ? wDow : null,
          day_of_month:        wFreq === 'monthly' ? wDom : null,
          run_time:            wRunTime,
          rpo_threshold_hours: wRpoHours,
          rto_target_minutes:  wRtoMins,
          destination_type:    wDestType  || null,
          destination_name:    wDestName  || null,
          file_path_to_test:   wFilePath,
          restore_dest_path:   wRestoreDest,
          screenshot_enabled:  true,
          notify_on_failure:   wEmailsFail,
          notify_on_pass:      wEmailsPass,
          psa_ticket_on_failure: wPsaTicket,
          psa_advance_ticket: wAdvanceTicket,
          psa_template_id:    wTemplateId,
          ticket_advance_days: wAdvanceDays,
        };
        const created = await api.createSureRestoreSchedule(body);
        schedules = [...schedules, created];
        toast('Schedule created');
      }
      testRestoreDevicesUsed.set(schedules.filter(x => x.is_enabled).length);
      wizardOpen = false;
    } catch (e: any) {
      wError = e.message ?? 'Save failed';
    } finally { wSaving = false; }
  }

  async function deleteSchedule(s: SureRestoreScheduleItem) {
    if (!confirm(`Delete "${s.name}"?`)) return;
    try {
      await api.deleteSureRestoreSchedule(s.id);
      schedules = schedules.filter(x => x.id !== s.id);
      testRestoreDevicesUsed.set(schedules.filter(x => x.is_enabled).length);
      toast('Schedule deleted');
    } catch (e: any) { toast(e.message ?? 'Delete failed', false); }
  }

  async function runNow(s: SureRestoreScheduleItem) {
    try {
      await api.triggerSureRestoreSchedule(s.id);
      toast(`Sync triggered for "${s.name}"`);
      setTimeout(loadAll, 3000);
    } catch (e: any) { toast(e.message ?? 'Trigger failed', false); }
  }

  function addFailEmail() {
    const e = wEmailFailInput.trim();
    if (e && !wEmailsFail.includes(e)) wEmailsFail = [...wEmailsFail, e];
    wEmailFailInput = '';
  }
  function addPassEmail() {
    const e = wEmailPassInput.trim();
    if (e && !wEmailsPass.includes(e)) wEmailsPass = [...wEmailsPass, e];
    wEmailPassInput = '';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function fmtDt(dt: string | null): string {
    if (!dt) return '—';
    return new Date(dt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtMins(mins: number | null): string {
    if (mins === null) return '—';
    const m = Math.round(mins);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function fmtRtoStat(mins: number | null): string {
    if (mins === null) return '—';
    const m = Math.round(mins);
    const h = Math.floor(m / 60), r = m % 60;
    return `${h}h ${r}m`;
  }

  function fmtRunTime(t: string): string {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  function fmtNextDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtSecs(secs: number | null): string {
    if (secs === null) return '—';
    return fmtMins(secs / 60);
  }

  function healthColor(h: string | null): string {
    return h === 'healthy' ? '#4ade80' : h === 'critical' ? '#f87171' : 'var(--bp-text-muted)';
  }

  function statusColor(s: string | null): string {
    return s === 'passed' ? '#4ade80' : s === 'failed' ? '#f87171' :
           s === 'running' ? '#60a5fa' : s === 'error' ? '#fb923c' : 'var(--bp-text-muted)';
  }

  function sBadge(st: string | null): string {
    const c = statusColor(st);
    return `background:${c}22;color:${c};padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;`;
  }

  function freqLabel(s: SureRestoreScheduleItem): string {
    if (s.frequency === 'daily')   return `Daily @ ${s.run_time}`;
    if (s.frequency === 'weekly')  return `${DAYS_ABBR[s.day_of_week ?? 0]} @ ${s.run_time}`;
    return `Day ${s.day_of_month} @ ${s.run_time}`;
  }

  function typeLabel(key: string): string { return RT.find(t => t.key === key)?.label ?? key; }
  function typeColor(key: string): string { return RT.find(t => t.key === key)?.color ?? 'var(--bp-text-muted)'; }

  function toolBadge(tool: string | null): string {
    const m: Record<string, string> = {
      datto:   'background:#1e3a4a;color:#38bdf8',
      acronis: 'background:#3a2a1a;color:#fb923c',
      veeam:   'background:#1a3a2a;color:#4ade80',
      cove:    'background:#2d2040;color:#a78bfa',
      n_able:  'background:#1e3040;color:#38bdf8',
      axcient: 'background:#2a1e3a;color:#c084fc',
    };
    return (m[tool ?? ''] ?? 'background:var(--bp-surface);color:var(--bp-text-muted)') +
      ';padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;text-transform:uppercase;';
  }

  function editingSchedule(): SureRestoreScheduleItem | undefined {
    return schedules.find(s => s.id === editingId);
  }

  function setTab(k: string) { activeTab = k as Tab; filterOpen = false; }
  function setSchedFilter(k: string) { schedFilter = k as typeof schedFilter; }
  function setHistFilter(k: string) { histFilter = k as typeof histFilter; }
  function setFreq(f: string) { wFreq = f as 'daily' | 'weekly' | 'monthly'; }

  const healthOrder: Record<string, number> = { critical: 0, unknown: 1, healthy: 2 };
  function sortedStatuses(s: SureRestoreDeviceStatus[]) {
    return [...s].sort((a, b) =>
      (healthOrder[a.health_status ?? 'unknown'] ?? 1) - (healthOrder[b.health_status ?? 'unknown'] ?? 1)
    );
  }

  // ── Dashboard extras ──────────────────────────────────────────────────────
  let deviceShowCount = 10;
  let dashFilter = '';   // '' = All
  let filterOpen = false;
  let cardDrill: '' | 'verify_failed' | 'rpo_breach' | 'failed_30' | 'passed_30' = '';

  $: healthItems = sortedStatuses(statuses);

  // Filter by MSP (master-MSP tenants) or by client org (normal MSP tenants).
  // Auto-detect which mode applies: if any device has an msp_name, use MSP filter.
  $: hasMspData      = healthItems.some(d => d.msp_name);
  $: filterOptions   = hasMspData
    ? [...new Set(healthItems.map(d => d.msp_name).filter(Boolean))] as string[]
    : [...new Set(healthItems.map(d => d.org_name).filter(Boolean))] as string[];
  $: filteredHealth  = dashFilter === ''
    ? healthItems
    : hasMspData
      ? healthItems.filter(d => d.msp_name === dashFilter)
      : healthItems.filter(d => d.org_name === dashFilter);
  $: filteredDeviceIds = new Set(filteredHealth.map(d => d.device_id));

  $: passedLast30 = runs.filter(r => {
    if (r.overall_status !== 'passed') return false;
    if (!r.started_at) return false;
    if (!filteredDeviceIds.has(r.device_id)) return false;
    return Date.now() - new Date(r.started_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  }).length;

  $: failedLast30 = runs.filter(r => {
    if (r.overall_status !== 'failed') return false;
    if (!r.started_at) return false;
    if (!filteredDeviceIds.has(r.device_id)) return false;
    return Date.now() - new Date(r.started_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  }).length;

  $: avgRtoVal = (() => {
    const rtos = runs.filter(r => r.rto_minutes != null && filteredDeviceIds.has(r.device_id)).map(r => Number(r.rto_minutes));
    return rtos.length ? Math.round(rtos.reduce((a, b) => a + b, 0) / rtos.length) : null;
  })();

  $: successRate = (passedLast30 + failedLast30) > 0
    ? Math.round(passedLast30 / (passedLast30 + failedLast30) * 100)
    : null;

  $: needAttentionCnt = schedules.filter(s => s.is_enabled && (s as any).last_run_status === 'failed' && filteredDeviceIds.has(s.device_id)).length;
  $: dashSchedTotal  = schedules.filter(s => filteredDeviceIds.has(s.device_id)).length;
  $: dashSchedActive = schedules.filter(s => s.is_enabled && filteredDeviceIds.has(s.device_id)).length;

  // Device IDs that had a failed/passed run in the last 30 days (for card drill)
  $: failedRunDeviceIds = new Set(runs.filter(r =>
    r.overall_status === 'failed' && r.started_at &&
    filteredDeviceIds.has(r.device_id) &&
    Date.now() - new Date(r.started_at).getTime() < 30 * 24 * 60 * 60 * 1000
  ).map(r => r.device_id));
  $: passedRunDeviceIds = new Set(runs.filter(r =>
    r.overall_status === 'passed' && r.started_at &&
    filteredDeviceIds.has(r.device_id) &&
    Date.now() - new Date(r.started_at).getTime() < 30 * 24 * 60 * 60 * 1000
  ).map(r => r.device_id));

  // Apply card drill on top of the MSP/client filter
  $: drilledHealth =
    cardDrill === 'verify_failed' ? filteredHealth.filter(d => d.auto_verify_status === 'failed') :
    cardDrill === 'rpo_breach'    ? filteredHealth.filter(d => d.rpo_breached) :
    cardDrill === 'failed_30'     ? filteredHealth.filter(d => failedRunDeviceIds.has(d.device_id)) :
    cardDrill === 'passed_30'     ? filteredHealth.filter(d => passedRunDeviceIds.has(d.device_id)) :
    filteredHealth;

  $: visibleDevices = drilledHealth.slice(0, deviceShowCount);

  const drillLabels: Record<string, string> = {
    verify_failed: 'Verify Failed',
    rpo_breach:    'RPO Breach',
    failed_30:     'Failed (30 Days)',
    passed_30:     'Passed (30 Days)',
  };

  function toggleDrill(key: typeof cardDrill) {
    cardDrill = cardDrill === key ? '' : key;
    deviceShowCount = 10;
  }

  function openReport(_device: SureRestoreDeviceStatus): void {
    // TODO: open device restore report detail
  }

  function formatRPO(minutes: number | null): string {
    if (!minutes && minutes !== 0) return '—';
    if (minutes < 60) return Math.round(minutes) + 'm';
    if (minutes < 1440) {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return h + 'h ' + m + 'm';
    }
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + h + 'h';
  }

  function formatVerifyDate(iso: string | null): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · '
      + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function isStale(iso: string | null): boolean {
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() > 48 * 60 * 60 * 1000;
  }

  function rowHover(e: MouseEvent, on: boolean): void {
    const el = e.currentTarget as HTMLElement;
    if (el) el.style.background = on ? 'rgba(255,255,255,0.025)' : 'transparent';
  }

  // ── Export ────────────────────────────────────────────────────────────────
  let exportOpen = false;

  function exportCSV(): void {
    exportOpen = false;
    const headers = ['Device','Client','MSP','Tool','Last Verified','RPO','RTO','Auto-Verify','Result'];
    const rows = filteredHealth.map(d => {
      const rpo = d.rpo_minutes !== null && d.rpo_minutes !== undefined ? Number(d.rpo_minutes) : null;
      const rto = d.auto_verify_boot_seconds ? Math.round(d.auto_verify_boot_seconds / 60) + 'm' : '—';
      const result = d.auto_verify_status === 'passed' && !d.rpo_breached ? 'Verified'
        : d.auto_verify_status === 'failed' ? 'Verify Failed'
        : d.rpo_breached ? 'RPO Breach'
        : d.auto_verify_status === null ? 'No schedule'
        : 'Not configured';
      return [
        d.device_name ?? '',
        d.org_name ?? '',
        d.msp_name ?? '',
        d.backup_tool ?? '',
        formatVerifyDate(d.auto_verify_last_at),
        formatRPO(rpo),
        rto,
        d.auto_verify_status ?? '—',
        result,
      ];
    });
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surerestore-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPDF(): Promise<void> {
    exportOpen = false;
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(16);
    doc.setTextColor(30, 30, 60);
    doc.text('SureRestore — Device Restore Health', 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 140);
    const filterLabel = dashFilter ? `Filter: ${dashFilter}` : 'All devices';
    doc.text(`${filterLabel}  ·  Exported ${new Date().toLocaleString()}`, 14, 22);

    autoTable(doc, {
      startY: 27,
      head: [['Device','Client','MSP','Tool','Last Verified','RPO','RTO','Auto-Verify','Result']],
      body: filteredHealth.map(d => {
        const rpo = d.rpo_minutes !== null && d.rpo_minutes !== undefined ? Number(d.rpo_minutes) : null;
        const result = d.auto_verify_status === 'passed' && !d.rpo_breached ? 'Verified'
          : d.auto_verify_status === 'failed' ? 'Verify Failed'
          : d.rpo_breached ? 'RPO Breach'
          : d.auto_verify_status === null ? 'No schedule'
          : 'Not configured';
        return [
          d.device_name ?? '',
          d.org_name ?? '',
          d.msp_name ?? '',
          d.backup_tool ?? '',
          formatVerifyDate(d.auto_verify_last_at),
          formatRPO(rpo),
          d.auto_verify_boot_seconds ? Math.round(d.auto_verify_boot_seconds / 60) + 'm' : '—',
          d.auto_verify_status ?? '—',
          result,
        ];
      }),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [0, 148, 186], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 246, 250] },
      columnStyles: {
        0: { fontStyle: 'bold' },
        8: { fontStyle: 'bold' },
      },
    });

    const total = filteredHealth.length;
    const passed = filteredHealth.filter(d => d.auto_verify_status === 'passed' && !d.rpo_breached).length;
    const failed = filteredHealth.filter(d => d.auto_verify_status === 'failed').length;
    const finalY: number = (doc as any).lastAutoTable?.finalY ?? 27;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 140);
    doc.text(`Total: ${total}  ·  Verified: ${passed}  ·  Issues: ${failed}`, 14, finalY + 8);

    doc.save(`surerestore-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

</script>

<svelte:window on:keydown={(e) => {
  if (e.key === 'Escape') { wizardOpen = false; lightboxUrl = null; }
}} />

{#if mounted && $hasTestRestore}
<div class="min-h-screen">

  <!-- ── Header ─────────────────────────────────────────────────────────────── -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.5rem;">
    <div>
      <h1 style="font-size:1.5rem;font-weight:700;color:var(--bp-text-bright);">SureRestore</h1>
      <p style="font-size:0.875rem;color:var(--bp-text-muted);margin-top:0.25rem;">
        Automated restore verification with continuous RTO and RPO measurement.
      </p>
    </div>

    {#if $testRestoreDeviceLimit !== null && $testRestoreDeviceLimit !== -1}
      {@const pct = Math.min(1, $testRestoreDevicesUsed / $testRestoreDeviceLimit)}
      {@const barColor = pct >= 0.9 ? '#f87171' : pct >= 0.7 ? '#fb923c' : '#4ade80'}
      <div style="min-width:220px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:0.75rem;color:var(--bp-text-muted);">
          <span>Scheduled devices</span>
          <span style="color:{barColor};font-weight:600;">
            {$testRestoreDevicesUsed} / {$testRestoreDeviceLimit}
            {#if $isAtTestRestoreLimit} 🔒{/if}
          </span>
        </div>
        <div style="height:6px;background:var(--bp-border);border-radius:9999px;overflow:hidden;">
          <div style="height:100%;width:{pct*100}%;background:{barColor};border-radius:9999px;transition:width 0.3s;"></div>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Tab bar ────────────────────────────────────────────────────────────── -->
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--bp-border);margin-bottom:1.5rem;">
    <div style="display:flex;">
      {#each [['dashboard','Dashboard'],['schedules','Schedules'],['history','Run History'],['templates','Ticket Templates']] as [key, label]}
        <button
          on:click={() => setTab(key)}
          style="padding:0.625rem 1rem;font-size:0.875rem;font-weight:500;background:none;border:none;cursor:pointer;
                 border-bottom:2px solid {activeTab === key ? 'var(--bp-primary)' : 'transparent'};
                 color:{activeTab === key ? 'var(--bp-primary)' : 'var(--bp-text-muted)'};margin-bottom:-1px;transition:color 0.15s;">
          {label}
        </button>
      {/each}
    </div>

    {#if activeTab === 'schedules'}
      <button
        on:click={openAdd}
        disabled={$isAtTestRestoreLimit}
        style="background:{$isAtTestRestoreLimit ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 15%, transparent)'};color:{$isAtTestRestoreLimit ? 'var(--bp-text-muted)' : 'var(--bp-primary-dark)'};border:1px solid {$isAtTestRestoreLimit ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 30%, transparent)'};border-radius:0.375rem;
               padding:0.4rem 1rem;font-size:0.875rem;font-weight:500;cursor:{$isAtTestRestoreLimit ? 'not-allowed' : 'pointer'};">
        + Add Schedule
      </button>
    {:else if activeTab === 'templates'}
      <button
        on:click={openAddTemplate}
        style="background:color-mix(in srgb, var(--bp-primary) 15%, transparent);color:var(--bp-primary-dark);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);border-radius:0.375rem;
               padding:0.4rem 1rem;font-size:0.875rem;font-weight:500;cursor:pointer;">
        + Add Template
      </button>
    {/if}
  </div>

  <!-- ══════════════════════════ DASHBOARD TAB ══════════════════════════════ -->
  {#if activeTab === 'dashboard'}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">

      <!-- Filter button + dropdown -->
      <div style="position:relative;">

        {#if filterOpen}
          <!-- Click-outside backdrop -->
          <div
            on:click={() => filterOpen = false}
            style="position:fixed;inset:0;z-index:10;"
          ></div>
        {/if}

        <button
          on:click={() => filterOpen = !filterOpen}
          style="display:inline-flex;align-items:center;gap:7px;
                 background:var(--bp-surface);border:1px solid var(--bp-border);
                 color:{dashFilter ? 'var(--bp-primary)' : 'var(--bp-text)'};
                 border-color:{dashFilter ? 'color-mix(in srgb, var(--bp-primary) 30%, transparent)' : 'var(--bp-border)'};
                 border-radius:8px;padding:6px 14px;font-size:0.875rem;
                 font-weight:500;cursor:pointer;position:relative;z-index:11;
                 transition:border-color 0.15s,color 0.15s;">
          <!-- Funnel icon -->
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3z"
              fill={dashFilter ? 'var(--bp-primary)' : 'currentColor'} opacity="0.9"/>
          </svg>
          Filter
          {#if dashFilter}
            <span style="background:color-mix(in srgb, var(--bp-primary) 15%, transparent);color:var(--bp-primary-dark);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);border-radius:9999px;
                         font-size:10px;font-weight:700;padding:1px 6px;line-height:1.4;">
              1
            </span>
          {/if}
        </button>

        {#if filterOpen && filterOptions.length > 0}
          <div style="position:absolute;top:calc(100% + 6px);left:0;
                      background:var(--bp-surface-2);border:1px solid var(--bp-border);
                      border-radius:10px;padding:6px;min-width:180px;
                      z-index:20;box-shadow:0 8px 24px #00000066;">

            <div style="font-size:10px;
                        color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;
                        padding:6px 10px 4px;">
              {hasMspData ? 'Filter by MSP' : 'Filter by Client'}
            </div>

            <!-- All option -->
            <button
              on:click={() => { dashFilter = ''; deviceShowCount = 10; filterOpen = false; }}
              style="display:flex;align-items:center;justify-content:space-between;
                     width:100%;text-align:left;background:{dashFilter === '' ? 'color-mix(in srgb, var(--bp-primary) 8%, transparent)' : 'transparent'};
                     color:{dashFilter === '' ? 'var(--bp-primary)' : 'var(--bp-text)'};
                     border:none;border-radius:6px;padding:7px 10px;font-size:0.83rem;
                     cursor:pointer;transition:background 0.1s;">
              All
              {#if dashFilter === ''}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="var(--bp-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </button>

            <!-- Each option -->
            {#each filterOptions as opt}
              <button
                on:click={() => { dashFilter = opt; deviceShowCount = 10; filterOpen = false; }}
                style="display:flex;align-items:center;justify-content:space-between;
                       width:100%;text-align:left;background:{dashFilter === opt ? 'color-mix(in srgb, var(--bp-primary) 8%, transparent)' : 'transparent'};
                       color:{dashFilter === opt ? 'var(--bp-primary)' : 'var(--bp-text)'};
                       border:none;border-radius:6px;padding:7px 10px;font-size:0.83rem;
                       cursor:pointer;transition:background 0.1s;">
                {opt}
                {#if dashFilter === opt}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="var(--bp-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </button>
            {/each}

          </div>
        {/if}
      </div>

      <div style="display:flex;align-items:center;gap:8px;">

        <!-- Export dropdown -->
        <div style="position:relative;">
          {#if exportOpen}
            <div
              on:click={() => exportOpen = false}
              role="presentation"
              style="position:fixed;inset:0;z-index:10;"
            ></div>
          {/if}

          <button
            on:click={() => exportOpen = !exportOpen}
            style="display:inline-flex;align-items:center;gap:6px;
                   background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text);
                   border-radius:8px;padding:6px 14px;font-size:0.875rem;
                   font-weight:500;cursor:pointer;position:relative;z-index:11;
                   transition:border-color 0.15s,color 0.15s;">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1v9M4 7l4 4 4-4M2 13h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Export
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="opacity:0.6;">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          {#if exportOpen}
            <div style="position:absolute;top:calc(100% + 6px);right:0;
                        background:var(--bp-surface-2);border:1px solid var(--bp-border);
                        border-radius:10px;padding:6px;min-width:160px;
                        z-index:20;box-shadow:0 8px 24px #00000066;">

              <div style="font-size:10px;
                          color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;
                          padding:6px 10px 4px;">
                Export as
              </div>

              <button
                on:click={exportCSV}
                style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
                       background:transparent;color:var(--bp-text);border:none;border-radius:6px;
                       padding:7px 10px;font-size:0.83rem;cursor:pointer;transition:background 0.1s;"
                on:mouseenter={e => { e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                on:mouseleave={e => { e.currentTarget.style.background='transparent'; }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="#4ade80" stroke-width="1.4"/>
                  <path d="M5 6h6M5 9h4" stroke="#4ade80" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                CSV Spreadsheet
              </button>

              <button
                on:click={exportPDF}
                style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
                       background:transparent;color:var(--bp-text);border:none;border-radius:6px;
                       padding:7px 10px;font-size:0.83rem;cursor:pointer;transition:background 0.1s;"
                on:mouseenter={e => { e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                on:mouseleave={e => { e.currentTarget.style.background='transparent'; }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="1" width="10" height="14" rx="1.5" stroke="#f87171" stroke-width="1.4"/>
                  <path d="M5 5h6M5 8h6M5 11h3" stroke="#f87171" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M9 1v3.5H12" stroke="#f87171" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                PDF Report
              </button>

            </div>
          {/if}
        </div>

        <!-- Sync Now -->
        <div style="display:flex;align-items:center;gap:0.75rem;">
          {#if syncResult}
            <span style="font-size:0.75rem;color:var(--bp-text-muted)">{syncResult}</span>
          {/if}
          <button
            on:click={triggerSync}
            disabled={syncing}
            style="background:{syncing ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 15%, transparent)'};color:{syncing ? 'var(--bp-text-muted)' : 'var(--bp-primary-dark)'};border:1px solid {syncing ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 30%, transparent)'};border-radius:0.375rem;
                   padding:0.4rem 1rem;font-size:0.875rem;font-weight:500;cursor:{syncing ? 'not-allowed' : 'pointer'};">
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>

      </div>
    </div>

    {#if loading}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
        {#each Array(4) as _}
          <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;padding:16px;">
            {#each [60,80,100,60] as w}
              <div style="height:10px;background:var(--bp-border);border-radius:4px;margin-bottom:10px;width:{w}%;animation:shimmer 1.5s ease-in-out infinite;"></div>
            {/each}
          </div>
        {/each}
      </div>

    {:else if statuses.length === 0}
      <div style="text-align:center;padding:4rem 2rem;">
        <div style="font-size:2.5rem;margin-bottom:1rem;">🔍</div>
        <p style="font-size:1rem;font-weight:600;color:var(--bp-text-muted);margin-bottom:0.5rem;">No restore data yet</p>
        <p style="font-size:0.875rem;color:var(--bp-text-muted);">Add a schedule and run a sync to see device health.</p>
        <button
          on:click={() => activeTab = 'schedules'}
          style="margin-top:1.25rem;background:color-mix(in srgb, var(--bp-primary) 15%, transparent);color:var(--bp-primary-dark);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);border-radius:0.375rem;padding:0.5rem 1.25rem;font-size:0.875rem;cursor:pointer;">
          Go to Schedules
        </button>
      </div>

    {:else}
      <!-- Stat cards -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">

        <!-- Total Schedules -->
        <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--bp-primary);border-radius:2px 2px 0 0;"></div>
          <!-- watermark icon -->
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="var(--bp-primary)" stroke-width="1.5"/>
            <path d="M12 7v5l3 3" stroke="var(--bp-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 3h6" stroke="var(--bp-primary)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Total Schedules</span>
          <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{dashSchedTotal}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            <span style="color:var(--bp-primary);font-weight:600;">{dashSchedActive}</span> active · {dashSchedTotal - dashSchedActive} paused
          </span>
        </div>

        <!-- Passed (30 Days) — clickable drill -->
        <button
          on:click={() => passedLast30 > 0 && toggleDrill('passed_30')}
          style="background:var(--bp-surface);border:1px solid {cardDrill === 'passed_30' ? '#4ade80' : 'var(--bp-border)'};border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;text-align:left;width:100%;cursor:{passedLast30 > 0 ? 'pointer' : 'default'};box-shadow:{cardDrill === 'passed_30' ? '0 0 0 2px #4ade8033' : 'none'};transition:border-color 0.15s,box-shadow 0.15s;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#4ade80;border-radius:2px 2px 0 0;"></div>
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <path d="M4 13l5 5L20 7" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">
            Passed (30 Days)
            {#if passedLast30 > 0}<span style="font-size:9px;color:#4ade80;font-weight:400;margin-left:6px;opacity:0.8;">{cardDrill === 'passed_30' ? '▼ active' : '▼ drill'}</span>{/if}
          </span>
          <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{passedLast30}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            {#if successRate !== null}
              <span style="color:#4ade80;font-weight:600;">{successRate}%</span> success rate
            {:else}
              no runs yet
            {/if}
          </span>
        </button>

        <!-- Failed (30 Days) — clickable drill -->
        <button
          on:click={() => failedLast30 > 0 && toggleDrill('failed_30')}
          style="background:var(--bp-surface);border:1px solid {cardDrill === 'failed_30' ? '#f87171' : 'var(--bp-border)'};border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;text-align:left;width:100%;cursor:{failedLast30 > 0 ? 'pointer' : 'default'};box-shadow:{cardDrill === 'failed_30' ? '0 0 0 2px #f8717133' : 'none'};transition:border-color 0.15s,box-shadow 0.15s;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#f87171;border-radius:2px 2px 0 0;"></div>
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="#f87171" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">
            Failed (30 Days)
            {#if failedLast30 > 0}<span style="font-size:9px;color:#f87171;font-weight:400;margin-left:6px;opacity:0.8;">{cardDrill === 'failed_30' ? '▼ active' : '▼ drill'}</span>{/if}
          </span>
          <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{failedLast30}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            {#if needAttentionCnt > 0}
              <span style="color:#f87171;font-weight:600;">{needAttentionCnt}</span> need attention
            {:else}
              all passing
            {/if}
          </span>
        </button>

        <!-- Avg RTO -->
        <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#fb923c;border-radius:2px 2px 0 0;"></div>
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <path d="M13 2L4.5 13.5H12L11 22L19.5 10.5H12L13 2Z" stroke="#fb923c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Avg RTO</span>
          <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{avgRtoVal !== null ? fmtRtoStat(avgRtoVal) : '—'}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            Target: <span style="color:#fb923c;font-weight:600;">{avgRtoTarget !== null ? fmtRtoStat(avgRtoTarget) : '—'}</span>
          </span>
        </div>

        <!-- Verify Failed — clickable drill -->
        <button
          on:click={() => verifyFailedCnt > 0 && toggleDrill('verify_failed')}
          style="background:var(--bp-surface);border:1px solid {cardDrill === 'verify_failed' ? '#f87171' : 'var(--bp-border)'};border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;text-align:left;width:100%;cursor:{verifyFailedCnt > 0 ? 'pointer' : 'default'};box-shadow:{cardDrill === 'verify_failed' ? '0 0 0 2px #f8717133' : 'none'};transition:border-color 0.15s,box-shadow 0.15s;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#f87171;border-radius:2px 2px 0 0;"></div>
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#f87171" stroke-width="1.5"/>
            <path d="M9 9l6 6M15 9l-6 6" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">
            Verify Failed
            {#if verifyFailedCnt > 0}<span style="font-size:9px;color:#f87171;font-weight:400;margin-left:6px;opacity:0.8;">{cardDrill === 'verify_failed' ? '▼ active' : '▼ drill'}</span>{/if}
          </span>
          <span style="font-size:42px;font-weight:700;color:{verifyFailedCnt > 0 ? '#f87171' : 'var(--bp-text-bright)'};letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{verifyFailedCnt}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            {#if verifyFailedCnt > 0}
              <span style="color:#f87171;font-weight:600;">{verifyFailedCnt}</span> device{verifyFailedCnt !== 1 ? 's' : ''} failed auto-verify
            {:else}
              all devices verified
            {/if}
          </span>
        </button>

        <!-- RPO Breach — clickable drill -->
        <button
          on:click={() => rpoBreachCnt > 0 && toggleDrill('rpo_breach')}
          style="background:var(--bp-surface);border:1px solid {cardDrill === 'rpo_breach' ? '#fb923c' : 'var(--bp-border)'};border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;text-align:left;width:100%;cursor:{rpoBreachCnt > 0 ? 'pointer' : 'default'};box-shadow:{cardDrill === 'rpo_breach' ? '0 0 0 2px #fb923c33' : 'none'};transition:border-color 0.15s,box-shadow 0.15s;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#fb923c;border-radius:2px 2px 0 0;"></div>
          <svg style="position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0.07;" width="54" height="54" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4l3 3" stroke="#fb923c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="9" stroke="#fb923c" stroke-width="1.5"/>
            <path d="M12 3v1M12 20v1M3 12h1M20 12h1" stroke="#fb923c" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">
            RPO Breach
            {#if rpoBreachCnt > 0}<span style="font-size:9px;color:#fb923c;font-weight:400;margin-left:6px;opacity:0.8;">{cardDrill === 'rpo_breach' ? '▼ active' : '▼ drill'}</span>{/if}
          </span>
          <span style="font-size:42px;font-weight:700;color:{rpoBreachCnt > 0 ? '#fb923c' : 'var(--bp-text-bright)'};letter-spacing:-2px;line-height:1;margin-bottom:8px;display:block;">{rpoBreachCnt}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
            {#if rpoBreachCnt > 0}
              <span style="color:#fb923c;font-weight:600;">{rpoBreachCnt}</span> device{rpoBreachCnt !== 1 ? 's' : ''} past RPO threshold
            {:else}
              all within RPO target
            {/if}
          </span>
        </button>

      </div>

      <!-- Device restore health section header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--bp-text-bright);">Device restore health</div>
          <div style="font-size:11px;color:var(--bp-text-muted);margin-top:3px;">Auto-verify · RPO from snapshots</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          {#if cardDrill}
            <div style="display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--bp-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--bp-primary) 30%,transparent);border-radius:20px;padding:3px 10px 3px 12px;font-size:11px;color:var(--bp-primary);">
              <span style="font-weight:600;">{drillLabels[cardDrill]}</span>
              <span style="color:var(--bp-text-muted);">· {drilledHealth.length} device{drilledHealth.length !== 1 ? 's' : ''}</span>
              <button
                on:click={() => { cardDrill = ''; deviceShowCount = 10; }}
                style="background:none;border:none;cursor:pointer;color:var(--bp-text-muted);font-size:13px;line-height:1;padding:0 0 0 2px;"
                title="Clear drill filter">✕</button>
            </div>
          {:else}
            <div style="font-size:11px;color:var(--bp-text-muted);">
              {#if dashFilter}
                {filteredHealth.length} of {healthItems.length} devices
              {:else}
                {healthItems.length} devices total
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Table container -->
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:{deviceShowCount >= filteredHealth.length ? '14px' : '14px 14px 0 0'};overflow:hidden;margin-bottom:0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:var(--bp-surface-2);border-bottom:1px solid var(--bp-border);">
              {#each ['Device','Client','MSP','Tool','Last Verified','RPO','RTO','Steps','Result'] as col}
                <th style="padding:12px 20px;text-align:left;font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;white-space:nowrap;">{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each visibleDevices as device, i}
              <tr
                on:click={() => openReport(device)}
                on:keydown={(e) => e.key === 'Enter' && openReport(device)}
                style="border-bottom:{i < visibleDevices.length - 1 ? '1px solid var(--bp-border)' : 'none'};cursor:pointer;background:transparent;transition:background 0.12s;"
                on:mouseenter={e => rowHover(e, true)}
                on:mouseleave={e => rowHover(e, false)}
              >
                <!-- DEVICE -->
                <td style="padding:14px 20px;border-left:2px solid {device.health_status === 'healthy' ? '#4ade80' : device.health_status === 'warning' ? '#fb923c' : device.health_status === 'critical' ? '#f87171' : 'var(--bp-border)'};vertical-align:middle;">
                  <span style="font-size:13px;font-weight:600;color:var(--bp-text-bright);">{device.device_name}</span>
                </td>

                <!-- CLIENT -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  <span style="font-size:13px;color:var(--bp-text);">{device.org_name ?? '—'}</span>
                </td>

                <!-- MSP -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  <span style="font-size:13px;color:var(--bp-text-muted);">{device.msp_name ?? '—'}</span>
                </td>

                <!-- TOOL -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  <span style="display:inline-flex;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:500;text-transform:uppercase;
                    background:{device.backup_tool === 'datto' ? '#1e3a4a' : device.backup_tool === 'veeam' ? '#1a3a2a' : device.backup_tool === 'acronis' ? '#3a2a1a' : device.backup_tool === 'axcient' ? '#2a1e3a' : 'var(--bp-surface)'};
                    color:{device.backup_tool === 'datto' ? '#38bdf8' : device.backup_tool === 'veeam' ? '#4ade80' : device.backup_tool === 'acronis' ? '#fb923c' : device.backup_tool === 'axcient' ? '#c084fc' : 'var(--bp-text-muted)'};">
                    {device.backup_tool ?? 'unknown'}
                  </span>
                </td>

                <!-- LAST VERIFIED -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  {#if device.auto_verify_last_at}
                    <div style="font-size:12px;color:{isStale(device.auto_verify_last_at) ? '#fb923c' : 'var(--bp-text)'};">{formatVerifyDate(device.auto_verify_last_at)}</div>
                    <div style="font-size:9px;color:var(--bp-text-muted);margin-top:2px;">{device.backup_tool ?? ''}</div>
                  {:else}
                    <span style="color:var(--bp-text-muted)">Never</span>
                  {/if}
                </td>

                <!-- RPO -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  {#if device.rpo_minutes !== null && device.rpo_minutes !== undefined}
                    <span style="font-size:12px;color:{device.rpo_breached ? '#f87171' : Number(device.rpo_minutes) > (device.rpo_threshold_minutes ?? 1440) * 0.5 ? '#fb923c' : '#4ade80'};">
                      {device.rpo_breached ? '⚠ ' : ''}{formatRPO(Number(device.rpo_minutes))}{device.rpo_breached ? ' breached' : ''}
                    </span>
                  {:else}
                    <span style="color:var(--bp-text-muted)">—</span>
                  {/if}
                </td>

                <!-- RTO -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  {#if device.auto_verify_boot_seconds}
                    <div>
                      <span style="font-size:12px;color:{device.auto_verify_rto_met ? '#4ade80' : '#f87171'};">
                        {Math.round(device.auto_verify_boot_seconds / 60)}m {device.auto_verify_rto_met ? '✓' : '✗'}
                      </span>
                      <div style="font-size:9px;color:var(--bp-text-muted);margin-top:2px;">auto-verify</div>
                    </div>
                  {:else}
                    <span style="color:var(--bp-text-muted)">—</span>
                  {/if}
                </td>

                <!-- STEPS -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  <div style="display:flex;gap:4px;align-items:center;">
                    <div style="width:9px;height:9px;border-radius:50%;background:{device.rpo_breached ? '#f87171' : '#4ade80'};" title="RPO check"></div>
                    <div style="width:9px;height:9px;border-radius:50%;background:{device.screenshot_status === 'success' ? '#4ade80' : device.screenshot_status === 'failure' ? '#f87171' : device.screenshot_status === 'pending' ? '#38bdf8' : 'var(--bp-border)'};" title="Screenshot"></div>
                    <div style="width:9px;height:9px;border-radius:50%;background:{device.auto_verify_status === 'passed' ? '#4ade80' : device.auto_verify_status === 'failed' ? '#f87171' : 'var(--bp-border)'};" title="Auto-verify"></div>
                  </div>
                </td>

                <!-- RESULT -->
                <td style="padding:14px 20px;vertical-align:middle;">
                  <span style="display:inline-flex;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;
                    background:{device.auto_verify_status === 'passed' && !device.rpo_breached ? '#166534' : device.auto_verify_status === 'failed' ? '#7f1d1d' : device.rpo_breached ? '#78350f' : '#1f2937'};
                    color:{device.auto_verify_status === 'passed' && !device.rpo_breached ? '#4ade80' : device.auto_verify_status === 'failed' ? '#f87171' : device.rpo_breached ? '#fb923c' : 'var(--bp-text-muted)'};">
                    {device.auto_verify_status === 'passed' && !device.rpo_breached ? 'Verified'
                      : device.auto_verify_status === 'failed' ? 'Verify Failed'
                      : device.rpo_breached ? 'RPO Breach'
                      : device.auto_verify_status === null ? 'No schedule'
                      : 'Not configured'}
                  </span>
                </td>

              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Footer: only when > 10 devices in current filter -->
      {#if filteredHealth.length > 10}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--bp-surface-2);border:1px solid var(--bp-border);border-top:none;border-radius:0 0 14px 14px;margin-bottom:20px;">
          <span style="font-size:13px;color:var(--bp-text-muted);">
            Showing {Math.min(deviceShowCount, filteredHealth.length)} of {filteredHealth.length} devices
          </span>
          <div style="display:flex;gap:8px;">
            {#if deviceShowCount < filteredHealth.length}
              <button
                on:click={() => deviceShowCount += 10}
                style="background:transparent;border:1px solid var(--bp-border);color:var(--bp-text);padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">
                Load more
              </button>
            {/if}
            <button
              on:click={() => activeTab = 'schedules'}
              style="background:color-mix(in srgb, var(--bp-primary) 15%, transparent);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);color:var(--bp-primary-dark);padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">
              View all schedules →
            </button>
          </div>
        </div>
      {/if}

    {/if}

  <!-- ══════════════════════════ SCHEDULES TAB ══════════════════════════════ -->
  {:else if activeTab === 'schedules'}

    <!-- Filter bar -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      {#each [['all','All'],['enabled','Enabled'],['disabled','Disabled']] as [k, lbl]}
        <button
          on:click={() => setSchedFilter(k)}
          style="padding:4px 12px;border-radius:9999px;font-size:0.8rem;font-weight:500;cursor:pointer;
                 background:{schedFilter === k ? 'color-mix(in srgb, var(--bp-primary) 12%, transparent)' : 'var(--bp-surface)'};
                 color:{schedFilter === k ? 'var(--bp-primary)' : 'var(--bp-text-muted)'};
                 border:1px solid {schedFilter === k ? 'color-mix(in srgb, var(--bp-primary) 25%, transparent)' : 'var(--bp-border)'};">
          {lbl}
        </button>
      {/each}
      {#if schedMspOptions.length > 0}
        <select bind:value={schedMspFilter} on:change={() => schedClientFilter = ''}
          style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text);
                 border-radius:6px;padding:4px 8px;font-size:0.8rem;cursor:pointer;">
          <option value="">All MSPs</option>
          {#each schedMspOptions as m}
            <option value={m}>{m}</option>
          {/each}
        </select>
        {#if schedMspFilter && schedClientOptions.length > 0}
          <select bind:value={schedClientFilter}
            style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text);
                   border-radius:6px;padding:4px 8px;font-size:0.8rem;cursor:pointer;">
            <option value="">All Clients</option>
            {#each schedClientOptions as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        {/if}
      {/if}
      <span style="font-size:0.8rem;color:var(--bp-text-muted);margin-left:4px;">
        {filteredSched.length} schedule{filteredSched.length !== 1 ? 's' : ''}
      </span>
    </div>

    <!-- ── Schedule stat cards ──────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">

      <!-- Active Schedules -->
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--bp-primary);border-radius:2px 2px 0 0;"></div>
        <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Active Schedules</span>
        <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:6px;display:block;">{activeSchedCnt}</span>
        <span style="font-size:13px;color:var(--bp-text-muted);display:block;">of {schedules.length} total</span>
      </div>

      <!-- Next Run -->
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#a78bfa;border-radius:2px 2px 0 0;"></div>
        <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Next Run</span>
        {#if nextRunSched}
          <span style="font-size:36px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-1px;line-height:1;margin-bottom:6px;display:block;">{fmtNextDate(nextRunSched.next_run_at ?? '')}</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">{fmtRunTime(nextRunSched.run_time)} · {nextRunSched.name}</span>
        {:else}
          <span style="font-size:36px;font-weight:700;color:var(--bp-text-muted);letter-spacing:-1px;line-height:1;margin-bottom:6px;display:block;">—</span>
          <span style="font-size:13px;color:var(--bp-text-muted);display:block;">no upcoming runs</span>
        {/if}
      </div>

      <!-- Avg RTO Target -->
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#4ade80;border-radius:2px 2px 0 0;"></div>
        <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Avg RTO Target</span>
        <span style="font-size:42px;font-weight:700;color:var(--bp-text-bright);letter-spacing:-2px;line-height:1;margin-bottom:6px;display:block;">{fmtRtoStat(avgRtoTarget)}</span>
        <span style="font-size:13px;color:var(--bp-text-muted);display:block;">across all schedules</span>
      </div>

      <!-- Overdue -->
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:14px;padding:20px 22px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#fb923c;border-radius:2px 2px 0 0;"></div>
        <span style="font-size:11px;font-weight:500;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;display:block;">Overdue</span>
        <span style="font-size:42px;font-weight:700;color:{overdueScheds.length > 0 ? '#fb923c' : 'var(--bp-text-bright)'};letter-spacing:-2px;line-height:1;margin-bottom:6px;display:block;">{overdueScheds.length}</span>
        <span style="font-size:13px;color:var(--bp-text-muted);display:block;">
          {#if overdueScheds.length > 0}{overdueScheds[0].name} missed{:else}all on schedule{/if}
        </span>
      </div>

    </div>

    {#if loading}
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;overflow:hidden;">
        {#each Array(4) as _}
          <div style="padding:12px 16px;border-bottom:1px solid var(--bp-border);display:flex;gap:12px;">
            {#each [2,3,1,2,1] as w}
              <div style="flex:{w};height:10px;background:var(--bp-border);border-radius:4px;animation:shimmer 1.5s ease-in-out infinite;"></div>
            {/each}
          </div>
        {/each}
      </div>

    {:else if filteredSched.length === 0}
      <div style="text-align:center;padding:3rem 2rem;">
        <p style="font-size:1rem;font-weight:600;color:var(--bp-text-muted);margin-bottom:0.5rem;">No schedules yet</p>
        <p style="font-size:0.875rem;color:var(--bp-text-muted);">Click <strong style="color:var(--bp-text-bright);">+ Add Schedule</strong> to get started.</p>
      </div>

    {:else}
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;overflow:hidden;">
        <!-- Table header -->
        <div style="display:grid;grid-template-columns:2fr 1.2fr 1.5fr 0.8fr 1.2fr 1.4fr 0.9fr 0.9fr auto;gap:12px;
                    padding:9px 14px;background:var(--bp-surface-2);border-bottom:1px solid var(--bp-border);
                    font-size:0.72rem;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
          <span>Name / Device</span><span>MSP / Client</span><span>Type</span><span>Tool</span>
          <span>Frequency</span><span>Last Run</span><span>Status</span><span>PSA Ticket</span><span></span>
        </div>

        {#each filteredSched as s (s.id)}
          <div style="display:grid;grid-template-columns:2fr 1.2fr 1.5fr 0.8fr 1.2fr 1.4fr 0.9fr 0.9fr auto;gap:12px;
                      padding:11px 14px;border-bottom:1px solid var(--bp-border);align-items:center;font-size:0.84rem;">
            <div>
              <div style="font-weight:500;color:var(--bp-text-bright);">{s.name}</div>
              <div style="font-size:0.75rem;color:var(--bp-text-muted);">{s.device_name ?? `Device ${s.device_id}`}</div>
            </div>
            <div>
              {#if s.msp_name}
                <div style="font-size:0.78rem;color:var(--bp-text-bright);font-weight:500;">{s.msp_name}</div>
                <div style="font-size:0.72rem;color:var(--bp-text-muted);">{s.org_name ?? ''}</div>
              {:else if s.org_name}
                <div style="font-size:0.78rem;color:var(--bp-text-bright);font-weight:500;">{s.org_name}</div>
              {:else}
                <span style="color:var(--bp-text-muted);font-size:0.75rem;">—</span>
              {/if}
            </div>
            <div>
              <span style="background:{typeColor(s.restore_type)}22;color:{typeColor(s.restore_type)};
                           padding:2px 8px;border-radius:9999px;font-size:0.68rem;font-weight:600;">
                {typeLabel(s.restore_type)}
              </span>
            </div>
            <span style="{toolBadge(s.backup_tool)}">{s.backup_tool}</span>
            <span style="color:var(--bp-text);">{freqLabel(s)}</span>
            <span style="color:var(--bp-text-muted);font-size:0.8rem;">{fmtDt(s.last_run_at)}</span>
            <!-- Enable/disable toggle -->
            <button
              title="{s.is_enabled ? 'Pause schedule' : 'Enable schedule'}"
              on:click={() => toggleSchedule(s)}
              style="background:{s.is_enabled ? 'color-mix(in srgb, var(--bp-primary) 8%, transparent)' : 'var(--bp-surface-2)'};
                     color:{s.is_enabled ? 'var(--bp-primary)' : 'var(--bp-text-muted)'};
                     border:1px solid {s.is_enabled ? 'color-mix(in srgb, var(--bp-primary) 25%, transparent)' : 'var(--bp-border)'};
                     border-radius:9999px;padding:2px 10px;font-size:0.7rem;font-weight:600;
                     cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;
                     transition:all 0.15s;">
              {s.is_enabled ? 'Active' : 'Paused'}
            </button>
            <!-- PSA ticket status -->
            <div style="font-size:0.75rem;">
              {#if s.next_run_at}
                {@const advDays = s.ticket_advance_days ?? 3}
                {@const daysUntil = Math.ceil((new Date(s.next_run_at).getTime() - Date.now()) / 86400000)}
                {#if daysUntil <= advDays && daysUntil > 0}
                  <span style="color:#fb923c;">Due in {daysUntil}d</span>
                {:else if daysUntil <= 0}
                  <span style="color:#f87171;">Overdue</span>
                {:else}
                  <span style="color:var(--bp-text-muted);">In {daysUntil}d</span>
                {/if}
              {:else}
                <span style="color:var(--bp-text-muted);">—</span>
              {/if}
            </div>
            <div style="display:flex;gap:5px;">
              <button title="Run now" on:click={() => runNow(s)}
                style="background:none;border:1px solid var(--bp-border);border-radius:5px;color:var(--bp-text-muted);cursor:pointer;padding:3px 7px;font-size:0.75rem;">▶</button>
              <button title="Edit" on:click={() => openEdit(s)}
                style="background:none;border:1px solid var(--bp-border);border-radius:5px;color:var(--bp-text-muted);cursor:pointer;padding:3px 7px;font-size:0.75rem;">✎</button>
              <button title="Delete" on:click={() => deleteSchedule(s)}
                style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#f87171;cursor:pointer;padding:3px 7px;font-size:0.75rem;">✕</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  <!-- ══════════════════════════ HISTORY TAB ════════════════════════════════ -->
  {:else if activeTab === 'history'}

    <!-- Filter bar -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      {#each [['all','All'],['passed','Passed'],['failed','Failed']] as [k, lbl]}
        <button
          on:click={() => setHistFilter(k)}
          style="padding:4px 12px;border-radius:9999px;font-size:0.8rem;font-weight:500;cursor:pointer;
                 background:{histFilter === k ? 'color-mix(in srgb, var(--bp-primary) 12%, transparent)' : 'var(--bp-surface)'};
                 color:{histFilter === k ? 'var(--bp-primary)' : 'var(--bp-text-muted)'};
                 border:1px solid {histFilter === k ? 'color-mix(in srgb, var(--bp-primary) 25%, transparent)' : 'var(--bp-border)'};">
          {lbl}
        </button>
      {/each}
      <span style="font-size:0.8rem;color:var(--bp-text-muted);margin-left:4px;">
        {filteredRuns.length} run{filteredRuns.length !== 1 ? 's' : ''}
      </span>
    </div>

    {#if loading}
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;overflow:hidden;">
        {#each Array(5) as _}
          <div style="padding:12px 16px;border-bottom:1px solid var(--bp-border);display:flex;gap:12px;">
            {#each [2,1.5,1,1.5,1,1,2] as w}
              <div style="flex:{w};height:10px;background:var(--bp-border);border-radius:4px;animation:shimmer 1.5s ease-in-out infinite;"></div>
            {/each}
          </div>
        {/each}
      </div>

    {:else if filteredRuns.length === 0}
      <div style="text-align:center;padding:3rem 2rem;">
        <p style="font-size:1rem;font-weight:600;color:var(--bp-text-muted);">No run history yet</p>
        <p style="font-size:0.875rem;color:var(--bp-text-muted);">Runs appear here after the first scheduled or manual sync.</p>
      </div>

    {:else}
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:1.5fr 1.5fr 0.8fr 1.4fr 0.8fr 0.8fr 2fr;gap:12px;
                    padding:9px 14px;background:var(--bp-surface-2);border-bottom:1px solid var(--bp-border);
                    font-size:0.72rem;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
          <span>Device</span><span>Type</span><span>Tool</span>
          <span>Started</span><span>RTO</span><span>Status</span><span>Notes</span>
        </div>

        {#each filteredRuns as r (r.id)}
          <div style="display:grid;grid-template-columns:1.5fr 1.5fr 0.8fr 1.4fr 0.8fr 0.8fr 2fr;gap:12px;
                      padding:11px 14px;border-bottom:1px solid var(--bp-border);align-items:center;font-size:0.83rem;">
            <div style="color:var(--bp-text-bright);">{deviceNameById[r.device_id] ?? `Device ${r.device_id}`}</div>
            <div>
              <span style="background:{typeColor(r.restore_type)}22;color:{typeColor(r.restore_type)};
                           padding:2px 6px;border-radius:9999px;font-size:0.68rem;font-weight:600;">
                {typeLabel(r.restore_type)}
              </span>
            </div>
            <span style="{toolBadge(r.backup_tool)}">{r.backup_tool ?? '—'}</span>
            <span style="color:var(--bp-text-muted);">{fmtDt(r.started_at)}</span>
            <span style="color:{r.rto_met === false ? '#f87171' : 'var(--bp-text-bright)'};">{fmtMins(r.rto_minutes)}</span>
            <span style="{sBadge(r.overall_status)}">{r.overall_status}</span>
            <span style="color:var(--bp-text-muted);font-size:0.77rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="{r.error_message ?? ''}">
              {#if r.rpo_breached}<span style="color:#f87171;margin-right:4px;">RPO breach</span>{/if}
              {r.error_message ?? ''}
            </span>
          </div>
        {/each}
      </div>
    {/if}

  <!-- ══════════════════════════ TEMPLATES TAB ════════════════════════════ -->
  {:else if activeTab === 'templates'}
    <p style="font-size:0.875rem;color:var(--bp-text-muted);margin-bottom:1rem;">
      Templates define the PSA ticket content for each restore type.
      Variables:
      {#each ['device_name','company_name','restore_type','scheduled_date','backup_tool'] as v}
        <code style="background:var(--bp-surface);padding:1px 6px;border-radius:3px;font-size:0.78rem;margin-right:4px;">{'{{' + v + '}}'}</code>
      {/each}
    </p>

    {#if templates.length === 0}
      <div style="text-align:center;padding:3rem 2rem;">
        <p style="font-size:1rem;font-weight:600;color:var(--bp-text-muted);margin-bottom:0.5rem;">No templates yet</p>
        <p style="font-size:0.875rem;color:var(--bp-text-muted);">Click <strong style="color:var(--bp-text-bright);">+ Add Template</strong> to create your first ticket template.</p>
      </div>
    {:else}
      <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:10px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr 1.2fr auto;gap:12px;
                    padding:9px 14px;background:var(--bp-surface-2);border-bottom:1px solid var(--bp-border);
                    font-size:0.72rem;color:var(--bp-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
          <span>Name</span><span>Restore Type</span><span>PSA Priority</span><span>Subject Preview</span><span></span>
        </div>
        {#each templates as t (t.id)}
          <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr 1.2fr auto;gap:12px;
                      padding:11px 14px;border-bottom:1px solid var(--bp-border);align-items:center;font-size:0.84rem;">
            <div>
              <div style="font-weight:500;color:var(--bp-text-bright);">{t.name}</div>
              {#if t.is_default}
                <span style="background:color-mix(in srgb, var(--bp-primary) 8%, transparent);color:var(--bp-primary-dark);padding:1px 6px;border-radius:9999px;font-size:0.65rem;font-weight:600;">DEFAULT</span>
              {/if}
            </div>
            <span style="color:var(--bp-text);">{t.restore_type ? typeLabel(t.restore_type) : 'All types'}</span>
            <span style="color:var(--bp-text-muted);">{t.psa_priority || '—'}</span>
            <span style="color:var(--bp-text-muted);font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="{t.subject_template}">{t.subject_template}</span>
            <div style="display:flex;gap:5px;">
              <button title="Edit" on:click={() => openEditTemplate(t)}
                style="background:none;border:1px solid var(--bp-border);border-radius:5px;color:var(--bp-text-muted);cursor:pointer;padding:3px 7px;font-size:0.75rem;">✎</button>
              <button title="Delete" on:click={() => deleteTpl(t)}
                style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#f87171;cursor:pointer;padding:3px 7px;font-size:0.75rem;">✕</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  {/if}

  <!-- ══════════════════════ TEMPLATE MODAL ════════════════════════════════ -->
  {#if tplModalOpen}
    <div on:click={() => tplModalOpen = false}
      style="position:fixed;inset:0;background:#000000aa;z-index:40;"></div>
    <div style="position:fixed;top:0;right:0;width:min(600px,100vw);height:100vh;background:var(--bp-surface-2);
                border-left:1px solid var(--bp-border);z-index:50;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--bp-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <h2 style="font-size:1rem;font-weight:700;color:#fff;">{tplEditingId ? 'Edit Template' : 'New Ticket Template'}</h2>
        <button on:click={() => tplModalOpen = false}
          style="background:none;border:none;color:var(--bp-text-muted);font-size:1.2rem;cursor:pointer;padding:4px;line-height:1;">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;">
        {#if tplError}
          <div style="background:#3a1e1e;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;color:#f87171;font-size:0.85rem;">{tplError}</div>
        {/if}

        <!-- Name + Restore Type + Default -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Template Name *</label>
            <input bind:value={tplName} placeholder="e.g. VM Restore Standard"
              style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Restore Type (auto-match)</label>
            <select bind:value={tplRestoreType}
              style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
              <option value="">All types (default fallback)</option>
              {#each RT as rt}
                <option value={rt.key}>{rt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.875rem;color:var(--bp-text);">
          <input type="checkbox" bind:checked={tplIsDefault} style="accent-color:var(--bp-primary-dark);" />
          Use as default when no restore-type match is found
        </label>

        <!-- Subject -->
        <div>
          <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Ticket Subject *</label>
          <input bind:value={tplSubject}
            placeholder={"Scheduled Test Restore: {{restore_type}} — {{device_name}}"}
            style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
        </div>

        <!-- Body (HTML) -->
        <div>
          <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Ticket Body (HTML) *</label>
          <textarea bind:value={tplBody} rows="8"
            style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:8px 10px;font-size:0.8rem;font-family:monospace;resize:vertical;box-sizing:border-box;"></textarea>
          <p style="font-size:0.72rem;color:var(--bp-text-muted);margin-top:4px;">
            Use HTML for formatting. Variables:
            {#each ['device_name','company_name','scheduled_date'] as v}
              <code style="background:var(--bp-surface);padding:1px 5px;border-radius:3px;margin-right:3px;">{'{{' + v + '}}'}</code>
            {/each}
          </p>
        </div>

        <!-- PSA ticket fields -->
        <div style="border-top:1px solid var(--bp-border);padding-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <p style="font-size:0.78rem;color:var(--bp-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin:0;">PSA Ticket Fields</p>
            {#if psaOptionsLoading}
              <span style="font-size:0.72rem;color:var(--bp-text-muted);">Loading PSA options…</span>
            {/if}
          </div>
          {#if psaOptionsWarn}
            <div style="background:#2d2000;border:1px solid #78350f;border-radius:6px;padding:8px 12px;color:#fbbf24;font-size:0.8rem;margin-bottom:12px;">{psaOptionsWarn}</div>
          {/if}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <!-- Ticket Type -->
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Ticket Type</label>
              {#if psaOptions?.types?.length}
                <select bind:value={tplPsaType} style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
                  <option value="">— Select type —</option>
                  {#each psaOptions.types as opt}<option value={opt.id}>{opt.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={tplPsaType} placeholder="Type ID"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
              {/if}
            </div>
            <!-- Category -->
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Category</label>
              {#if psaOptions?.categories?.length}
                <select bind:value={tplPsaCategory} style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
                  <option value="">— Select category —</option>
                  {#each psaOptions.categories as opt}<option value={opt.id}>{opt.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={tplPsaCategory} placeholder="Category ID"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
              {/if}
            </div>
            <!-- Priority -->
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Priority</label>
              {#if psaOptions?.priorities?.length}
                <select bind:value={tplPsaPriority} style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
                  <option value="">— Select priority —</option>
                  {#each psaOptions.priorities as opt}<option value={opt.id}>{opt.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={tplPsaPriority} placeholder="Priority ID"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
              {/if}
            </div>
            <!-- Agent / Team -->
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Agent / Team</label>
              {#if psaOptions?.agents?.length}
                <select bind:value={tplPsaAgent} style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
                  <option value="">— Select agent —</option>
                  {#each psaOptions.agents as opt}<option value={opt.id}>{opt.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={tplPsaAgent} placeholder="Agent ID"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
              {/if}
            </div>
          </div>
          <!-- Client resolution -->
          <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Default PSA Client</label>
              {#if psaOptions?.clients?.length}
                <select bind:value={tplPsaClientId} style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;">
                  <option value="">Auto-resolve by company name</option>
                  {#each psaOptions.clients as opt}<option value={opt.id}>{opt.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={tplPsaClientId} placeholder="Auto-resolve by company name if blank"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;box-sizing:border-box;" />
              {/if}
            </div>
            <div>
              <label style="font-size:0.78rem;color:var(--bp-text-muted);display:block;margin-bottom:4px;">Per-Company Mapping (JSON)</label>
              <input bind:value={tplClientMapping} placeholder={"org_id: psa_client_id"}
                style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:6px;color:var(--bp-text-bright);padding:7px 10px;font-size:0.875rem;font-family:monospace;box-sizing:border-box;" />
              <p style="font-size:0.7rem;color:var(--bp-text-muted);margin-top:3px;">Maps BackupPulse org ID → PSA client ID. Auto-resolve by name is tried first.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:14px 20px;border-top:1px solid var(--bp-border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
        <button on:click={() => tplModalOpen = false}
          style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text);border-radius:6px;padding:8px 18px;font-size:0.875rem;cursor:pointer;">
          Cancel
        </button>
        <button on:click={saveTpl} disabled={tplSaving}
          style="background:{tplSaving ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 15%, transparent)'};border:1px solid {tplSaving ? 'var(--bp-border)' : 'color-mix(in srgb, var(--bp-primary) 30%, transparent)'};color:{tplSaving ? 'var(--bp-text-muted)' : 'var(--bp-primary-dark)'};border-radius:6px;padding:8px 18px;font-size:0.875rem;font-weight:600;cursor:{tplSaving ? 'not-allowed' : 'pointer'};">
          {tplSaving ? 'Saving…' : tplEditingId ? 'Save Changes' : 'Create Template'}
        </button>
      </div>
    </div>
  {/if}

  <!-- ══════════════════════════ WIZARD SLIDE-OVER ══════════════════════════ -->
  {#if wizardOpen}
    <div
      on:click={() => wizardOpen = false}
      style="position:fixed;inset:0;background:#000000aa;z-index:40;"></div>

    <div style="position:fixed;top:0;right:0;width:min(560px,100vw);height:100vh;background:var(--bp-surface-2);
                border-left:1px solid var(--bp-border);z-index:50;display:flex;flex-direction:column;overflow:hidden;">

      <!-- Panel header -->
      <div style="padding:16px 20px;border-bottom:1px solid var(--bp-border);display:flex;justify-content:space-between;align-items:flex-start;flex-shrink:0;">
        <div>
          <h2 style="font-size:1rem;font-weight:700;color:#fff;margin-bottom:8px;">
            {editingId ? 'Edit Schedule' : 'New Schedule'}
          </h2>
          <!-- Step indicator (create only) -->
          {#if !editingId}
            <div style="display:flex;align-items:center;gap:0;">
              {#each [1,2,3,4] as step}
                <div style="display:flex;align-items:center;">
                  <div style="width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;
                              font-size:0.7rem;font-weight:700;
                              background:{step === wizStep ? 'var(--bp-primary)' : step < wizStep ? 'color-mix(in srgb, var(--bp-primary) 20%, transparent)' : 'var(--bp-surface)'};
                              color:{step === wizStep ? '#fff' : step < wizStep ? '#38bdf8' : 'var(--bp-text-muted)'};
                              border:1px solid {step <= wizStep ? 'color-mix(in srgb, var(--bp-primary) 30%, transparent)' : 'var(--bp-border)'};">
                    {step < wizStep ? '✓' : step}
                  </div>
                  {#if step < 4}
                    <div style="width:20px;height:1px;background:{step < wizStep ? 'color-mix(in srgb, var(--bp-primary) 25%, transparent)' : 'var(--bp-border)'};"></div>
                  {/if}
                </div>
              {/each}
              <span style="font-size:0.74rem;color:var(--bp-text-muted);margin-left:10px;">
                {['Restore Type', 'Device & Tool', 'Destination', 'Schedule & Notify'][wizStep - 1]}
              </span>
            </div>
          {:else}
            <span style="font-size:0.78rem;color:var(--bp-text-muted);">
              Step {wizStep} of 4 — {['Restore Type', 'Device & Tool', 'Destination', 'Schedule & Notify'][wizStep - 1]}
            </span>
          {/if}
        </div>
        <button
          on:click={() => wizardOpen = false}
          style="background:none;border:none;color:var(--bp-text-muted);font-size:1.2rem;cursor:pointer;padding:4px;line-height:1;">✕</button>
      </div>

      <!-- Panel body -->
      <div style="flex:1;overflow-y:auto;padding:20px;">

        {#if wError}
          <div style="background:#3a1e1e;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;
                      color:#f87171;font-size:0.85rem;margin-bottom:16px;">{wError}</div>
        {/if}

        <!-- ── STEP 1: Restore Type ── -->
        {#if wizStep === 1}
          <p style="font-size:0.85rem;color:var(--bp-text-muted);margin-bottom:16px;">
            {editingId
              ? 'Restore type cannot be changed after creation.'
              : 'What type of restore verification should this schedule run?'}
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            {#each RT as rt}
              {@const isPhase2   = rt.phase === 2}
              {@const isSelected = wType === rt.key}
              {@const canClick   = !isPhase2 && !editingId}
              <div
                on:click={() => { if (canClick) wType = rt.key; }}
                style="background:{isSelected ? rt.color + '22' : 'var(--bp-surface)'};
                       border:2px solid {isSelected ? rt.color : 'var(--bp-border)'};
                       border-radius:10px;padding:14px;position:relative;
                       cursor:{canClick ? 'pointer' : 'default'};
                       opacity:{isPhase2 ? 0.5 : 1};transition:border-color 0.15s,background 0.15s;">
                {#if isPhase2}
                  <div style="position:absolute;top:8px;right:8px;font-size:0.62rem;
                              background:var(--bp-border);color:var(--bp-text-muted);padding:1px 6px;border-radius:9999px;">
                    Coming soon
                  </div>
                {/if}
                {#if editingId && isSelected}
                  <div style="position:absolute;top:8px;right:8px;font-size:0.62rem;
                              background:{rt.color}33;color:{rt.color};padding:1px 6px;border-radius:9999px;">
                    Current
                  </div>
                {/if}
                <div style="font-weight:600;color:var(--bp-text-bright);margin-bottom:5px;font-size:0.875rem;">{rt.label}</div>
                <div style="font-size:0.75rem;color:var(--bp-text-muted);line-height:1.4;">{rt.description}</div>
              </div>
            {/each}
          </div>

        <!-- ── STEP 2: Device & Tool ── -->
        {:else if wizStep === 2}
          {#if editingId}
            {@const es = editingSchedule()}
            <div style="background:var(--bp-surface-2);border:1px solid var(--bp-border);border-radius:8px;padding:14px;">
              <p style="font-size:0.85rem;color:var(--bp-text-muted);margin-bottom:12px;">
                Device and backup tool are fixed after creation.
              </p>
              <div style="font-size:0.875rem;color:var(--bp-text-bright);">
                <div style="margin-bottom:6px;">
                  <span style="color:var(--bp-text-muted);">Device: </span>
                  <strong>{es?.device_name ?? wDeviceId}</strong>
                </div>
                <div>
                  <span style="color:var(--bp-text-muted);">Tool: </span>
                  <span style="{toolBadge(wTool)}">{wTool}</span>
                </div>
              </div>
            </div>
          {:else}
            <div style="display:flex;flex-direction:column;gap:14px;">
              {#if wMspOptions.length > 0}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                  <div>
                    <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">MSP</label>
                    <select bind:value={wMspFilter} on:change={() => { wClientFilter = ''; wDeviceId = ''; }}
                      style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                             border-radius:6px;padding:8px 10px;font-size:0.875rem;">
                      <option value="">— All MSPs —</option>
                      {#each wMspOptions as m}
                        <option value={m}>{m}</option>
                      {/each}
                    </select>
                  </div>
                  <div>
                    <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Client</label>
                    <select bind:value={wClientFilter} disabled={!wMspFilter || wClientOptions.length === 0}
                      on:change={() => { wDeviceId = ''; }}
                      style="width:100%;background:{wMspFilter && wClientOptions.length > 0 ? 'var(--bp-surface)' : 'var(--bp-surface-2)'};
                             border:1px solid var(--bp-border);
                             color:{wMspFilter && wClientOptions.length > 0 ? 'var(--bp-text-bright)' : '#4b5563'};
                             border-radius:6px;padding:8px 10px;font-size:0.875rem;">
                      <option value="">— All Clients —</option>
                      {#each wClientOptions as c}
                        <option value={c}>{c}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              {/if}
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Backup Tool</label>
                <select bind:value={wTool}
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:8px 10px;font-size:0.875rem;">
                  <option value="">— Select a tool —</option>
                  {#each allTools as tool}
                    <option value={tool}>{tool}</option>
                  {/each}
                </select>
                {#if allTools.length === 0}
                  <p style="font-size:0.75rem;color:#fb923c;margin-top:4px;">
                    No devices found. Ensure backup connectors are configured and enabled.
                  </p>
                {/if}
              </div>
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Device</label>
                <select bind:value={wDeviceId} disabled={!wTool}
                  style="width:100%;background:{wTool ? 'var(--bp-surface)' : 'var(--bp-surface-2)'};
                         border:1px solid var(--bp-border);
                         color:{wTool ? 'var(--bp-text-bright)' : '#4b5563'};
                         border-radius:6px;padding:8px 10px;font-size:0.875rem;">
                  <option value="">— Select a device —</option>
                  {#each filteredDevices as d}
                    <option value={d.id}>{d.name}{d.org_name ? ` — ${d.org_name}` : ''}</option>
                  {/each}
                </select>
                {#if wTool && filteredDevices.length === 0}
                  <p style="font-size:0.75rem;color:#fb923c;margin-top:4px;">
                    No devices found for this tool.
                  </p>
                {/if}
              </div>
            </div>
          {/if}

        <!-- ── STEP 3: Destination ── -->
        {:else if wizStep === 3}
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">File Path to Test</label>
              <input bind:value={wFilePath} placeholder="C:/Windows/System32/notepad.exe"
                style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                       border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
              <p style="font-size:0.72rem;color:var(--bp-text-muted);margin-top:3px;">Path on the source to validate after restore.</p>
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Restore Destination Path</label>
              <input bind:value={wRestoreDest} placeholder="C:/RestoreTest/"
                style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                       border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
              <p style="font-size:0.72rem;color:var(--bp-text-muted);margin-top:3px;">Where files will be restored for validation.</p>
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">
                Destination Type <span style="color:#4b5563;">(optional)</span>
              </label>
              <input bind:value={wDestType} placeholder="e.g. local, network, cloud"
                style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                       border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">
                Destination Name <span style="color:#4b5563;">(optional)</span>
              </label>
              <input bind:value={wDestName} placeholder="Friendly name for this destination"
                style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                       border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
            </div>
          </div>

        <!-- ── STEP 4: Schedule & Notify ── -->
        {:else if wizStep === 4}
          <div style="display:flex;flex-direction:column;gap:16px;">

            <!-- Frequency -->
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:8px;">Frequency</label>
              <div style="display:flex;gap:8px;">
                {#each ['daily','weekly','monthly'] as f}
                  <button
                    on:click={() => setFreq(f)}
                    style="flex:1;padding:7px;border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;
                           background:{wFreq === f ? 'var(--bp-primary)' : 'var(--bp-surface)'};
                           color:{wFreq === f ? '#fff' : 'var(--bp-text-muted)'};
                           border:1px solid {wFreq === f ? 'var(--bp-primary)' : 'var(--bp-border)'};
                           transition:background 0.15s,color 0.15s;">
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                {/each}
              </div>
            </div>

            {#if wFreq === 'weekly'}
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:8px;">Day of Week</label>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  {#each DAYS_ABBR as day, i}
                    <button
                      on:click={() => wDow = i}
                      style="padding:5px 9px;border-radius:6px;font-size:0.78rem;cursor:pointer;
                             background:{wDow === i ? 'color-mix(in srgb, var(--bp-primary) 12%, transparent)' : 'var(--bp-surface)'};
                             color:{wDow === i ? 'var(--bp-primary)' : 'var(--bp-text-muted)'};
                             border:1px solid {wDow === i ? 'var(--bp-primary)' : 'var(--bp-border)'};">
                      {day}
                    </button>
                  {/each}
                </div>
              </div>
            {:else if wFreq === 'monthly'}
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Day of Month</label>
                <select bind:value={wDom}
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:8px 10px;font-size:0.875rem;">
                  {#each Array(28) as _, i}
                    <option value={i + 1}>{i + 1}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Run Time (UTC)</label>
              <input type="time" bind:value={wRunTime}
                style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                       border-radius:6px;padding:8px 10px;font-size:0.875rem;" />
            </div>

            <!-- RTO / RPO targets -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">RTO Target (minutes)</label>
                <input type="number" bind:value={wRtoMins} min="1"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
              </div>
              <div>
                <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">RPO Threshold (hours)</label>
                <input type="number" bind:value={wRpoHours} min="1"
                  style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:8px 10px;font-size:0.875rem;box-sizing:border-box;" />
              </div>
            </div>

            <!-- PSA ticket settings -->
            <div style="background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:8px;padding:14px;">
              <div style="font-size:0.78rem;color:var(--bp-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">PSA Ticket Settings</div>

              <!-- Advance ticket toggle -->
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                <div>
                  <div style="font-size:0.875rem;color:var(--bp-text-bright);font-weight:500;">Advance Ticket</div>
                  <div style="font-size:0.75rem;color:var(--bp-text-muted);margin-top:2px;">Create a PSA ticket {wAdvanceDays} day{wAdvanceDays !== 1 ? 's' : ''} before the scheduled run.</div>
                </div>
                <button on:click={() => wAdvanceTicket = !wAdvanceTicket}
                  style="width:40px;height:22px;border-radius:9999px;border:none;cursor:pointer;
                         background:{wAdvanceTicket ? 'var(--bp-primary)' : 'var(--bp-border)'};position:relative;flex-shrink:0;transition:background 0.2s;">
                  <span style="position:absolute;top:2px;left:{wAdvanceTicket ? '20px' : '2px'};
                               width:18px;height:18px;border-radius:9999px;background:#fff;display:block;transition:left 0.2s;"></span>
                </button>
              </div>

              <!-- Advance ticket options (shown only when enabled) -->
              {#if wAdvanceTicket}
                <div style="border-left:2px solid color-mix(in srgb, var(--bp-primary) 20%, transparent);padding-left:12px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;">
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div>
                      <label style="display:block;font-size:0.75rem;color:var(--bp-text-muted);margin-bottom:4px;">Days in advance</label>
                      <input type="number" bind:value={wAdvanceDays} min="1" max="30"
                        style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);border-radius:6px;padding:6px 10px;font-size:0.875rem;box-sizing:border-box;" />
                    </div>
                    <div>
                      <label style="display:block;font-size:0.75rem;color:var(--bp-text-muted);margin-bottom:4px;">Template</label>
                      <select bind:value={wTemplateId}
                        style="width:100%;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);border-radius:6px;padding:6px 10px;font-size:0.875rem;box-sizing:border-box;">
                        <option value={null}>Auto-match by restore type</option>
                        {#each templates as t}
                          <option value={t.id}>{t.name}{t.restore_type ? ` (${t.restore_type})` : ''}{t.is_default ? ' ★' : ''}</option>
                        {/each}
                      </select>
                    </div>
                  </div>
                  {#if templates.length === 0}
                    <p style="font-size:0.72rem;color:var(--bp-text-muted);margin:0;">No templates yet — go to the Templates tab to create one.</p>
                  {/if}
                </div>
              {/if}

              <!-- Failure ticket toggle -->
              <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--bp-border);padding-top:10px;">
                <div>
                  <div style="font-size:0.875rem;color:var(--bp-text-bright);font-weight:500;">Failure Ticket</div>
                  <div style="font-size:0.75rem;color:var(--bp-text-muted);margin-top:2px;">Open a PSA ticket when this restore fails.</div>
                </div>
                <button on:click={() => wPsaTicket = !wPsaTicket}
                  style="width:40px;height:22px;border-radius:9999px;border:none;cursor:pointer;
                         background:{wPsaTicket ? 'var(--bp-primary)' : 'var(--bp-border)'};position:relative;flex-shrink:0;transition:background 0.2s;">
                  <span style="position:absolute;top:2px;left:{wPsaTicket ? '20px' : '2px'};
                               width:18px;height:18px;border-radius:9999px;background:#fff;display:block;transition:left 0.2s;"></span>
                </button>
              </div>
            </div>

            <!-- Notify on failure -->
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Notify on Failure (emails)</label>
              {#each wEmailsFail as email, i}
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="flex:1;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:5px;
                               padding:5px 10px;font-size:0.8rem;color:var(--bp-text-bright);">{email}</span>
                  <button
                    on:click={() => wEmailsFail = wEmailsFail.filter((_, j) => j !== i)}
                    style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#f87171;cursor:pointer;padding:3px 7px;font-size:0.75rem;">✕</button>
                </div>
              {/each}
              <div style="display:flex;gap:6px;margin-top:4px;">
                <input
                  bind:value={wEmailFailInput}
                  placeholder="email@example.com"
                  on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFailEmail(); } }}
                  style="flex:1;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:7px 10px;font-size:0.8rem;" />
                <button on:click={addFailEmail}
                  style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-muted);
                         border-radius:6px;padding:7px 12px;font-size:0.8rem;cursor:pointer;">Add</button>
              </div>
            </div>

            <!-- Notify on pass -->
            <div>
              <label style="display:block;font-size:0.8rem;color:var(--bp-text-muted);margin-bottom:6px;">Notify on Pass (emails)</label>
              {#each wEmailsPass as email, i}
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="flex:1;background:var(--bp-surface);border:1px solid var(--bp-border);border-radius:5px;
                               padding:5px 10px;font-size:0.8rem;color:var(--bp-text-bright);">{email}</span>
                  <button
                    on:click={() => wEmailsPass = wEmailsPass.filter((_, j) => j !== i)}
                    style="background:none;border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#f87171;cursor:pointer;padding:3px 7px;font-size:0.75rem;">✕</button>
                </div>
              {/each}
              <div style="display:flex;gap:6px;margin-top:4px;">
                <input
                  bind:value={wEmailPassInput}
                  placeholder="email@example.com"
                  on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPassEmail(); } }}
                  style="flex:1;background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);
                         border-radius:6px;padding:7px 10px;font-size:0.8rem;" />
                <button on:click={addPassEmail}
                  style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-muted);
                         border-radius:6px;padding:7px 12px;font-size:0.8rem;cursor:pointer;">Add</button>
              </div>
            </div>

          </div>
        {/if}
      </div>

      <!-- Panel footer -->
      <div style="padding:16px 20px;border-top:1px solid var(--bp-border);display:flex;justify-content:space-between;gap:10px;flex-shrink:0;">
        <button
          on:click={() => wizardOpen = false}
          style="background:none;border:1px solid var(--bp-border);color:var(--bp-text-muted);border-radius:6px;padding:8px 16px;font-size:0.875rem;cursor:pointer;">
          Cancel
        </button>
        <div style="display:flex;gap:8px;">
          {#if wizStep > 1}
            <button on:click={wizBack}
              style="background:var(--bp-surface);border:1px solid var(--bp-border);color:var(--bp-text-bright);border-radius:6px;padding:8px 16px;font-size:0.875rem;cursor:pointer;">
              ← Back
            </button>
          {/if}
          {#if wizStep < 4}
            <button on:click={wizNext}
              style="background:color-mix(in srgb, var(--bp-primary) 15%, transparent);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);color:var(--bp-primary-dark);border-radius:6px;padding:8px 20px;font-size:0.875rem;font-weight:500;cursor:pointer;">
              Next →
            </button>
          {:else}
            <button on:click={wizSave} disabled={wSaving}
              style="background:color-mix(in srgb, var(--bp-primary) 15%, transparent);border:1px solid color-mix(in srgb, var(--bp-primary) 30%, transparent);color:var(--bp-primary-dark);border-radius:6px;
                     padding:8px 20px;font-size:0.875rem;font-weight:500;cursor:{wSaving ? 'wait' : 'pointer'};">
              {wSaving ? 'Saving…' : editingId ? 'Update' : 'Create Schedule'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Screenshot lightbox ──────────────────────────────────────────────── -->
  {#if lightboxUrl}
    <div
      on:click={() => lightboxUrl = null}
      style="position:fixed;inset:0;background:#000000cc;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;">
      <img src={lightboxUrl} alt="Restore screenshot"
        style="max-width:90vw;max-height:85vh;border-radius:8px;border:1px solid var(--bp-border);" />
    </div>
  {/if}

  <!-- ── Toasts ────────────────────────────────────────────────────────────── -->
  <div style="position:fixed;bottom:20px;right:20px;z-index:70;display:flex;flex-direction:column;gap:8px;pointer-events:none;">
    {#each toasts as t (t.id)}
      <div style="background:{t.ok ? '#1a3a2a' : '#3a1e1e'};
                  border:1px solid {t.ok ? '#4ade8044' : '#f8717144'};
                  color:{t.ok ? '#4ade80' : '#f87171'};
                  border-radius:8px;padding:10px 16px;font-size:0.875rem;
                  box-shadow:0 4px 12px #00000066;pointer-events:auto;">
        {t.msg}
      </div>
    {/each}
  </div>

</div>
{/if}

<style>
  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1;   }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }
</style>
