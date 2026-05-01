<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import { api, type TenantRecord, type TenantCreate, type TenantUser, type Plan, type AdminTenant } from '$lib/api';

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

  // ── Types ─────────────────────────────────────────────────────────────────
  type Company = {
    id: number; name: string; type: string; parent_id: number | null; parent_name: string | null;
    contact_email: string | null; tags: string | null; created_at: string | null;
    device_count: number; connector_count: number;
    clients: { id: number; name: string; type: string; device_count: number; connector_count: number }[];
  };
  type Device = {
    id: number; name: string; org_id: number; org_name: string; parent_org: string | null;
    is_active: boolean; description: string | null; created_at: string | null;
    last_backup: string | null; last_status: string | null;
    retire_reason: string | null; retired_at: string | null;
  };
  type Overview = {
    companies: { msp: number; client: number; total: number };
    devices: { active: number; retired: number; limit: number };
    connectors: { active: number };
    jobs_24h: Record<string, number>;
  };
  type Schedule = {
    id: number; org_name: string; tool: string; is_enabled: boolean;
    last_sync_at: string | null; last_sync_status: string; schedule: string;
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  let tab: 'tenants' | 'plans' | 'overview' | 'companies' | 'devices' | 'retired' | 'schedules' | 'problem_management' | 'escalation' = 'overview';

  // ── Data ──────────────────────────────────────────────────────────────────
  let overview: Overview | null = null;
  let companies: Company[] = [];
  let devices: Device[] = [];
  let retiredDevices: Device[] = [];
  let schedules: Schedule[] = [];
  let loading = true;
  let error = '';

  // Company form
  let showAddCompany = false;
  let editingCompanyId: number | null = null;
  let newCompany = { name: '', type: 'client', parent_id: null as number | null, contact_email: '' };
  let editCompany = { name: '', contact_email: '', parent_id: null as number | null, type: '' };
  let companyError = '';
  let savingCompany = false;
  let movingCompanyId: number | null = null;

  // ── Load ──────────────────────────────────────────────────────────────────
  async function loadAll() {
    loading = true; error = '';
    try {
      [overview, companies, devices, retiredDevices, schedules] = await Promise.all([
        apiFetch('/api/v1/manage/overview'),
        apiFetch('/api/v1/manage/companies'),
        apiFetch('/api/v1/manage/devices?retired=false'),
        apiFetch('/api/v1/manage/devices?retired=true'),
        apiFetch('/api/v1/manage/schedules'),
      ]);
    } catch (e: unknown) { error = e instanceof Error ? e.message : String(e); }
    finally { loading = false; }
  }

  onMount(async () => {
    if ($auth?.tenant_type === 'platform') {
      tab = 'tenants';
      await loadTenants();
    } else {
      await loadAll();
    }
  });

  // ── Company CRUD ──────────────────────────────────────────────────────────
  async function saveAddCompany() {
    savingCompany = true; companyError = '';
    try {
      await apiFetch('/api/v1/manage/companies', {
        method: 'POST',
        body: JSON.stringify({ ...newCompany, parent_id: newCompany.parent_id || null }),
      });
      showAddCompany = false;
      newCompany = { name: '', type: 'client', parent_id: null, contact_email: '' };
      companies = await apiFetch('/api/v1/manage/companies');
      overview = await apiFetch('/api/v1/manage/overview');
    } catch (e: unknown) { companyError = e instanceof Error ? e.message : String(e); }
    finally { savingCompany = false; }
  }

  function startEditCompany(c: Company) {
    editingCompanyId = c.id;
    editCompany = { name: c.name, contact_email: c.contact_email ?? '', parent_id: c.parent_id, type: c.type };
    companyError = '';
  }

  async function saveEditCompany() {
    if (!editingCompanyId) return;
    savingCompany = true; companyError = '';
    try {
      const payload: Record<string, unknown> = { name: editCompany.name, contact_email: editCompany.contact_email };
      if (editCompany.parent_id) payload.parent_id = editCompany.parent_id;
      else payload.clear_parent = true;
      await apiFetch(`/api/v1/manage/companies/${editingCompanyId}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      editingCompanyId = null;
      companies = await apiFetch('/api/v1/manage/companies');
    } catch (e: unknown) { companyError = e instanceof Error ? e.message : String(e); }
    finally { savingCompany = false; }
  }

  async function deleteCompany(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This will remove all linked devices and backup jobs.`)) return;
    try {
      await apiFetch(`/api/v1/manage/companies/${id}`, { method: 'DELETE' });
      companies = await apiFetch('/api/v1/manage/companies');
      overview = await apiFetch('/api/v1/manage/overview');
    } catch (e: unknown) {
      alert(`Could not delete "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function moveUnderMsp(companyId: number, mspId: number) {
    try {
      await apiFetch(`/api/v1/manage/companies/${companyId}`, {
        method: 'PUT',
        body: JSON.stringify({ parent_id: mspId }),
      });
      companies = await apiFetch('/api/v1/manage/companies');
    } catch (e: unknown) {
      alert(`Could not move company: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  $: topLevelMsps = companies.filter(c => c.parent_id === null && c.type === 'msp');
  $: orphanedCompanies = companies.filter(c => c.parent_id === null && c.type !== 'msp');

  function handleClickAway(e: MouseEvent) {
    if (movingCompanyId !== null) movingCompanyId = null;
  }

  // ── Retire modal ──────────────────────────────────────────────────────────
  let retireModalDeviceId: number | null = null;
  let retireReason = '';
  let retiring = false;

  function openRetireModal(id: number) {
    retireModalDeviceId = id;
    retireReason = '';
  }

  async function confirmRetire() {
    if (!retireModalDeviceId) return;
    retiring = true;
    try {
      await apiFetch(`/api/v1/manage/devices/${retireModalDeviceId}/retire`, {
        method: 'PUT',
        body: JSON.stringify({ reason: retireReason || null }),
      });
      retireModalDeviceId = null;
      retireReason = '';
      [devices, retiredDevices] = await Promise.all([
        apiFetch('/api/v1/manage/devices?retired=false'),
        apiFetch('/api/v1/manage/devices?retired=true'),
      ]);
      overview = await apiFetch('/api/v1/manage/overview');
    } finally {
      retiring = false;
    }
  }

  // ── Device actions ────────────────────────────────────────────────────────
  async function retireDevice(id: number) {
    openRetireModal(id);
  }

  async function reactivateDevice(id: number) {
    await apiFetch(`/api/v1/manage/devices/${id}/reactivate`, { method: 'PUT' });
    [devices, retiredDevices] = await Promise.all([
      apiFetch('/api/v1/manage/devices?retired=false'),
      apiFetch('/api/v1/manage/devices?retired=true'),
    ]);
    overview = await apiFetch('/api/v1/manage/overview');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function statusClass(s: string | null) {
    if (!s) return 'bg-gray-100 text-gray-500';
    if (s === 'success')  return 'bg-green-100 text-green-700';
    if (s === 'failed')   return 'bg-red-100 text-red-700';
    if (s === 'warning')  return 'bg-yellow-100 text-yellow-700';
    if (s === 'ok')       return 'bg-green-100 text-green-700';
    if (s === 'error')    return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-500';
  }

  $: msps = companies.filter(c => c.type === 'msp');

  // For MSP tenants the parent is always their own root org — auto-set it when the form opens
  $: if (showAddCompany && $auth?.tenant_type === 'msp' && msps.length > 0 && newCompany.parent_id == null) {
    newCompany.parent_id = msps[0].id;
  }

  let expandedMspId: number | null = null;
  function toggleExpand(id: number) {
    expandedMspId = expandedMspId === id ? null : id;
  }

  // ── Tenant provisioning (platform admin only) ─────────────────────────────
  let tenants: TenantRecord[] = [];
  let tenantsLoading = false;
  let showAddTenant = false;
  let newTenant: TenantCreate = { name: '', slug: '', type: 'master_msp', admin_name: '', admin_email: '', admin_password: '' };
  let tenantError = '';
  let savingTenant = false;

  async function loadTenants() {
    tenantsLoading = true;
    try { tenants = await api.tenants(); }
    catch { /* non-platform users can't call this */ }
    finally { tenantsLoading = false; }
  }

  async function saveAddTenant() {
    savingTenant = true; tenantError = '';
    try {
      const t = await api.createTenant(newTenant);
      tenants = [...tenants, t];
      showAddTenant = false;
      newTenant = { name: '', slug: '', type: 'master_msp', admin_name: '', admin_email: '', admin_password: '' };
    } catch (e: unknown) { tenantError = e instanceof Error ? e.message : String(e); }
    finally { savingTenant = false; }
  }

  async function toggleTenantActive(t: TenantRecord) {
    try {
      const updated = await api.updateTenant(t.id, { is_active: !t.is_active });
      tenants = tenants.map(x => x.id === t.id ? updated : x);
    } catch { /* ignore */ }
  }

  async function deleteTenant(t: TenantRecord) {
    if (!confirm(`Delete tenant "${t.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteTenant(t.id);
      tenants = tenants.filter(x => x.id !== t.id);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Delete failed'); }
  }

  // Auto-generate slug from name
  function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
  $: if (newTenant.name && !showAddTenant) { /* reset */ }

  $: isPlatform = $auth?.tenant_type === 'platform';

  // ── Tenant expand (Edit / Users) ──────────────────────────────────────────
  let expandedTenantId: number | null = null;
  let expandedView: 'edit' | 'users' | null = null;

  // Edit tenant state
  let editTenantForm = { name: '', type: 'master_msp', is_active: true };
  let editTenantSaving = false;
  let editTenantError = '';

  // Users panel state
  let tenantUsersMap: Record<number, TenantUser[]> = {};
  let usersLoading: Record<number, boolean> = {};
  let newUserForm = { display_name: '', email: '', password: '', role: 'tenant_admin' };
  let newUserSaving = false;
  let newUserError = '';
  let resetPwdUserId: number | null = null;
  let resetPwdValue = '';
  let resetPwdSaving = false;
  let resetPwdError = '';

  // ── Plans tab (platform admin) ────────────────────────────────────────────
  let plansList: Plan[] = [];
  let adminTenantsList: AdminTenant[] = [];
  let plansLoading = false;
  let planAssignErr: Record<number, string> = {};
  let planAssignSuccess: Record<number, string> = {};
  let planAssigning: Record<number, boolean> = {};

  async function loadPlanAssignment() {
    if (plansList.length > 0 && adminTenantsList.length > 0) return;
    plansLoading = true;
    try {
      [plansList, adminTenantsList] = await Promise.all([api.plans(), api.adminTenants()]);
    } catch { /* ignore */ }
    finally { plansLoading = false; }
  }

  async function assignPlanFromManage(tenantId: number, planIdStr: string) {
    if (!planIdStr) return;
    const planId = parseInt(planIdStr, 10);
    planAssigning = { ...planAssigning, [tenantId]: true };
    planAssignErr = { ...planAssignErr, [tenantId]: '' };
    planAssignSuccess = { ...planAssignSuccess, [tenantId]: '' };
    try {
      const res = await api.assignTenantPlan(tenantId, planId);
      adminTenantsList = adminTenantsList.map(t =>
        t.id === tenantId
          ? { ...t, plan_id: planId, plan_name: res.plan_name,
              device_limit: plansList.find(p => p.id === planId)?.device_limit ?? t.device_limit }
          : t
      );
      planAssignSuccess = { ...planAssignSuccess, [tenantId]: 'Assigned' };
    } catch (e: unknown) {
      planAssignErr = { ...planAssignErr, [tenantId]: e instanceof Error ? e.message : 'Error' };
    } finally {
      planAssigning = { ...planAssigning, [tenantId]: false };
    }
  }

  function planDeviceLimitLabel(limit: number): string {
    return limit === -1 ? 'Unlimited' : String(limit);
  }

  function planUsageColor(used: number, limit: number): string {
    if (limit === -1) return '#16a34a';
    const pct = used / limit;
    if (pct >= 0.85) return '#dc2626';
    if (pct >= 0.75) return '#d97706';
    return '#16a34a';
  }

  $: activePlansList = plansList.filter(p => p.is_active);

  function toggleTenantExpand(tid: number, view: 'edit' | 'users', t?: TenantRecord) {
    if (expandedTenantId === tid && expandedView === view) {
      expandedTenantId = null; expandedView = null; return;
    }
    expandedTenantId = tid; expandedView = view;
    if (view === 'edit' && t) {
      editTenantForm = { name: t.name, type: t.type, is_active: t.is_active };
      editTenantError = '';
    }
    if (view === 'users' && !tenantUsersMap[tid]) loadTenantUsers(tid);
    resetPwdUserId = null; resetPwdValue = ''; newUserError = '';
  }

  async function loadTenantUsers(tid: number) {
    usersLoading = { ...usersLoading, [tid]: true };
    try { tenantUsersMap = { ...tenantUsersMap, [tid]: await api.tenantUsers(tid) }; }
    catch { /* ignore */ }
    finally { usersLoading = { ...usersLoading, [tid]: false }; }
  }

  async function saveEditTenant() {
    if (!expandedTenantId) return;
    editTenantSaving = true; editTenantError = '';
    try {
      const updated = await api.updateTenant(expandedTenantId, editTenantForm);
      tenants = tenants.map(t => t.id === expandedTenantId ? updated : t);
      expandedTenantId = null; expandedView = null;
    } catch (e: unknown) { editTenantError = e instanceof Error ? e.message : String(e); }
    finally { editTenantSaving = false; }
  }

  async function addTenantUser() {
    if (!expandedTenantId) return;
    newUserSaving = true; newUserError = '';
    try {
      const u = await api.addTenantUser(expandedTenantId, newUserForm);
      tenantUsersMap = { ...tenantUsersMap, [expandedTenantId]: [...(tenantUsersMap[expandedTenantId] ?? []), u] };
      tenants = tenants.map(t => t.id === expandedTenantId ? { ...t, user_count: t.user_count + 1 } : t);
      newUserForm = { display_name: '', email: '', password: '', role: 'tenant_admin' };
    } catch (e: unknown) { newUserError = e instanceof Error ? e.message : String(e); }
    finally { newUserSaving = false; }
  }

  async function resetPassword() {
    if (!resetPwdUserId || !resetPwdValue.trim()) return;
    resetPwdSaving = true; resetPwdError = '';
    try {
      await api.resetUserPassword(resetPwdUserId, resetPwdValue);
      resetPwdUserId = null; resetPwdValue = '';
    } catch (e: unknown) { resetPwdError = e instanceof Error ? e.message : String(e); }
    finally { resetPwdSaving = false; }
  }

  async function deleteTenantUser(tid: number, uid: number) {
    if (!confirm('Delete this user?')) return;
    try {
      await api.deleteTenantUser(uid);
      tenantUsersMap = { ...tenantUsersMap, [tid]: tenantUsersMap[tid].filter(u => u.id !== uid) };
      tenants = tenants.map(t => t.id === tid ? { ...t, user_count: t.user_count - 1 } : t);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Delete failed'); }
  }

  const TABS = [
    { key: 'overview'  as const, label: 'Overview' },
    { key: 'companies' as const, label: 'Companies' },
    { key: 'devices'   as const, label: 'Backup Plans' },
    { key: 'retired'   as const, label: 'Retired Backups' },
    { key: 'schedules' as const, label: 'Schedules' },
  ];

  // ── Problem Management ────────────────────────────────────────────────────
  let pmTab: 'overview' | 'config' = 'overview';
  let pmJobs: any[] = [];
  let pmLoading = false;
  let pmSaving = false;
  let pmError = '';
  let pmFilterWindow = 'weekly';
  let pmFilterMspId: number | '' = '';
  let pmFilterClientId: number | '' = '';
  let pmCfg = {
    failure_count_threshold: 3, consecutive_threshold: 2, failure_pct_threshold: 50,
    time_window: 'weekly', auto_create_ticket: true, dedupe_tickets: true,
    auto_resolve: false, append_notes: true,
    psa_board: 'Service Desk – Tier 2', psa_priority: 'Medium',
    psa_ticket_type: 'Problem', psa_assign_to: 'Unassigned',
    psa_sla: 'Standard SLA – 4 hr', psa_status_on_create: 'New',
    title_template: '[Backup Problem] {client} — {device} · {job} · {failure_count} failures',
    body_template: 'Backup problem detected by BackupPulse.\n\nClient:               {client}\nDevice:               {device}\nJob:                  {job}\nSource:               {source}\nFailures in {window}: {failure_count}\nConsecutive failures: {consecutive_count}\nLast failure:         {last_seen}\nFirst detected:       {first_seen}\n\nERROR\n{error_reason}\n\nPROPOSED SOLUTION\n{proposed_solution}\n\n---\nAuto-generated by BackupPulse.',
    email_alert: true, email_address: '', teams_alert: false, webhook_url: '',
  };

  let pmExclusions: {id: number; exclusion_type: string; exclusion_id: number; exclusion_name: string | null}[] = [];
  let pmDevices: {id: number; name: string; org_name: string}[] = [];
  let newExclType = 'client';
  let newExclId: number | '' = '';
  let pmExclSaving = false;

  async function loadPM() {
    pmLoading = true; pmError = '';
    try {
      let qs = '?window=' + encodeURIComponent(pmFilterWindow);
      if (pmFilterClientId) qs += '&client_id=' + pmFilterClientId;
      else if (pmFilterMspId) qs += '&msp_id=' + pmFilterMspId;
      if (!companies.length) companies = await apiFetch('/api/v1/manage/companies');
      const [res, cfg, excls, devs] = await Promise.all([
        apiFetch('/api/v1/problem-management/flagged-jobs' + qs),
        apiFetch('/api/v1/problem-management/config'),
        apiFetch('/api/v1/problem-management/exclusions'),
        apiFetch('/api/v1/manage/devices?retired=false'),
      ]);
      pmJobs = res.jobs ?? [];
      pmCfg = { ...pmCfg, ...cfg };
      pmExclusions = excls ?? [];
      pmDevices = devs ?? [];
    } catch (e: unknown) { pmError = e instanceof Error ? e.message : String(e); }
    finally { pmLoading = false; }
  }

  let pmTicketing: Record<number, boolean> = {};

  function resolvePmTemplate(tpl: string, j: any): string {
    return tpl
      .replace(/\{client\}/g,            j.client               ?? '')
      .replace(/\{device\}/g,            j.device               ?? '')
      .replace(/\{job\}/g,               j.job_name             ?? '')
      .replace(/\{source\}/g,            j.source               ?? '')
      .replace(/\{window\}/g,            pmCfg.time_window      ?? '')
      .replace(/\{failure_count\}/g,     String(j.failures_this_window ?? 0))
      .replace(/\{consecutive_count\}/g, String(j.consecutive_failures ?? 0))
      .replace(/\{last_seen\}/g,         j.last_failure ? new Date(j.last_failure).toLocaleString() : '')
      .replace(/\{first_seen\}/g,        j.first_seen   ? new Date(j.first_seen).toLocaleString()   : '')
      .replace(/\{error_reason\}/g,      j.error_reason      ?? '')
      .replace(/\{proposed_solution\}/g, j.proposed_solution ?? '');
  }

  async function createPmTicket(j: any) {
    pmTicketing = { ...pmTicketing, [j.id]: true };
    pmError = '';
    try {
      const title = resolvePmTemplate(pmCfg.title_template, j);
      const body  = resolvePmTemplate(pmCfg.body_template,  j);
      const res = await apiFetch('/api/v1/problem-management/create-ticket', {
        method: 'POST',
        body: JSON.stringify({
          job_id:           j.id,
          title,
          body,
          board:            pmCfg.psa_board,
          priority:         pmCfg.psa_priority,
          ticket_type:      pmCfg.psa_ticket_type,
          assign_to:        pmCfg.psa_assign_to,
          sla:              pmCfg.psa_sla,
          status_on_create: pmCfg.psa_status_on_create,
        }),
      });
      pmJobs = pmJobs.map((jj: any) =>
        jj.id === j.id ? { ...jj, ticket_created: true, ticket_id: res.ticket_id } : jj
      );
    } catch (e: unknown) { pmError = e instanceof Error ? e.message : String(e); }
    finally { pmTicketing = { ...pmTicketing, [j.id]: false }; }
  }

  async function addPmExclusion() {
    if (!newExclId) return;
    pmExclSaving = true;
    try {
      const allEntities = newExclType === 'device' ? pmDevices : companies;
      const entity = allEntities.find((e: any) => e.id === newExclId);
      await apiFetch('/api/v1/problem-management/exclusions', {
        method: 'POST',
        body: JSON.stringify({ exclusion_type: newExclType, exclusion_id: newExclId, exclusion_name: entity?.name || null }),
      });
      const [excls, res] = await Promise.all([
        apiFetch('/api/v1/problem-management/exclusions'),
        apiFetch('/api/v1/problem-management/flagged-jobs?window=' + encodeURIComponent(pmFilterWindow)),
      ]);
      pmExclusions = excls ?? [];
      pmJobs = res.jobs ?? [];
      newExclId = '';
    } catch (e: unknown) { pmError = e instanceof Error ? e.message : String(e); }
    finally { pmExclSaving = false; }
  }

  async function removePmExclusion(id: number) {
    try {
      await apiFetch(`/api/v1/problem-management/exclusions/${id}`, { method: 'DELETE' });
      pmExclusions = pmExclusions.filter(e => e.id !== id);
      const res = await apiFetch('/api/v1/problem-management/flagged-jobs?window=' + encodeURIComponent(pmFilterWindow));
      pmJobs = res.jobs ?? [];
    } catch (e: unknown) { pmError = e instanceof Error ? e.message : String(e); }
  }

  $: pmAllClients = companies.flatMap((c: any) => c.clients ?? []);
  $: newExclOptions = newExclType === 'msp'
    ? pmMsps
    : newExclType === 'client'
      ? pmAllClients
      : pmDevices;

  $: canExclMsp = $auth?.tenant_type === 'master_msp';

  async function savePmConfig() {
    pmSaving = true; pmError = '';
    try {
      await apiFetch('/api/v1/problem-management/config', {
        method: 'POST', body: JSON.stringify(pmCfg),
      });
    } catch (e: unknown) { pmError = e instanceof Error ? e.message : String(e); }
    finally { pmSaving = false; }
  }

  $: pmMsps = companies.filter(c => c.type === 'msp');
  $: pmClients = pmFilterMspId
    ? companies.filter(c => c.parent_id === pmFilterMspId)
    : companies.filter(c => c.type === 'client');
  $: pmUniqueDevices = new Set(pmJobs.map((j: any) => j.device_id)).size;
  $: pmWithTickets = pmJobs.filter((j: any) => j.ticket_created).length;

  // ── Escalation Management ─────────────────────────────────────────────────
  let escLoading = false;
  let escSaving = false;
  let escError = '';
  let escIncidents: any[] = [];
  let escPol = {
    is_enabled: false,
    l1_psa_enabled: true,
    l1_teams_enabled: false,
    l1_teams_webhook_url: '',
    l2_enabled: false,
    l2_delay_hours: 24,
    l2_min_failures: 1,
    l2_emails_str: '',
    l2_teams_enabled: false,
    l2_teams_webhook_url: '',
    l3_enabled: false,
    l3_delay_hours: 48,
    l3_min_failures: 3,
    l3_emails_str: '',
    l3_teams_enabled: false,
    l3_teams_webhook_url: '',
    l3_reassign_enabled: false,
    l3_agent_id: '',
  };

  async function loadEscalation() {
    escLoading = true; escError = '';
    try {
      const [pol, incs] = await Promise.all([
        apiFetch('/api/v1/escalation/policy'),
        apiFetch('/api/v1/escalation/incidents'),
      ]);
      escIncidents = incs ?? [];
      escPol = {
        is_enabled: pol.is_enabled ?? false,
        l1_psa_enabled: pol.l1_psa_enabled ?? true,
        l1_teams_enabled: pol.l1_teams_enabled ?? false,
        l1_teams_webhook_url: pol.l1_teams_webhook_url ?? '',
        l2_enabled: pol.l2_enabled ?? false,
        l2_delay_hours: pol.l2_delay_hours ?? 24,
        l2_min_failures: pol.l2_min_failures ?? 1,
        l2_emails_str: (pol.l2_emails ?? []).join(', '),
        l2_teams_enabled: pol.l2_teams_enabled ?? false,
        l2_teams_webhook_url: pol.l2_teams_webhook_url ?? '',
        l3_enabled: pol.l3_enabled ?? false,
        l3_delay_hours: pol.l3_delay_hours ?? 48,
        l3_min_failures: pol.l3_min_failures ?? 3,
        l3_emails_str: (pol.l3_emails ?? []).join(', '),
        l3_teams_enabled: pol.l3_teams_enabled ?? false,
        l3_teams_webhook_url: pol.l3_teams_webhook_url ?? '',
        l3_reassign_enabled: pol.l3_reassign_enabled ?? false,
        l3_agent_id: pol.l3_agent_id ?? '',
      };
    } catch (e: unknown) { escError = e instanceof Error ? e.message : String(e); }
    finally { escLoading = false; }
  }

  async function saveEscPolicy() {
    escSaving = true; escError = '';
    try {
      await apiFetch('/api/v1/escalation/policy', {
        method: 'PUT',
        body: JSON.stringify({
          is_enabled: escPol.is_enabled,
          l1_psa_enabled: escPol.l1_psa_enabled,
          l1_teams_enabled: escPol.l1_teams_enabled,
          l1_teams_webhook_url: escPol.l1_teams_webhook_url || null,
          l2_enabled: escPol.l2_enabled,
          l2_delay_hours: escPol.l2_delay_hours,
          l2_min_failures: escPol.l2_min_failures,
          l2_emails: escPol.l2_emails_str.split(',').map((s: string) => s.trim()).filter(Boolean),
          l2_teams_enabled: escPol.l2_teams_enabled,
          l2_teams_webhook_url: escPol.l2_teams_webhook_url || null,
          l3_enabled: escPol.l3_enabled,
          l3_delay_hours: escPol.l3_delay_hours,
          l3_min_failures: escPol.l3_min_failures,
          l3_emails: escPol.l3_emails_str.split(',').map((s: string) => s.trim()).filter(Boolean),
          l3_teams_enabled: escPol.l3_teams_enabled,
          l3_teams_webhook_url: escPol.l3_teams_webhook_url || null,
          l3_reassign_enabled: escPol.l3_reassign_enabled,
          l3_agent_id: escPol.l3_agent_id || null,
        }),
      });
      await loadEscalation();
    } catch (e: unknown) { escError = e instanceof Error ? e.message : String(e); }
    finally { escSaving = false; }
  }

  async function acknowledgeIncident(id: number) {
    try {
      await apiFetch(`/api/v1/escalation/incidents/${id}/acknowledge`, { method: 'PATCH' });
      escIncidents = escIncidents.map(i => i.id === id ? { ...i, status: 'acknowledged' } : i);
    } catch { /* ignore */ }
  }

  async function resolveIncident(id: number) {
    try {
      await apiFetch(`/api/v1/escalation/incidents/${id}/resolve`, { method: 'PATCH' });
      escIncidents = escIncidents.map(i => i.id === id ? { ...i, status: 'resolved' } : i);
    } catch { /* ignore */ }
  }
</script>

<div class="space-y-0">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold text-gray-900">Manage</h1>
    <button class="btn-secondary text-xs" on:click={loadAll}>Refresh</button>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm mb-4">{error}</div>
  {/if}

  <!-- Tabs matching screenshot style -->
  <div class="border-b border-gray-300 flex gap-0">
    {#if isPlatform}
      <!-- Platform admin: Tenants + Plans tabs -->
      <button on:click={() => tab = 'tenants'}
        class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
          {tab === 'tenants'
            ? 'border-brand-600 text-brand-700 bg-white'
            : 'border-transparent text-gray-500 hover:text-gray-700'}">
        Tenants
      </button>
      <button on:click={() => { tab = 'plans'; loadPlanAssignment(); }}
        class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
          {tab === 'plans'
            ? 'border-brand-600 text-brand-700 bg-white'
            : 'border-transparent text-gray-500 hover:text-gray-700'}">
        Plans
      </button>
    {:else}
      <!-- MSP / Master MSP: operational tabs -->
      {#each TABS as t}
        <button on:click={() => tab = t.key}
          class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
            {tab === t.key
              ? 'border-brand-600 text-brand-700 bg-white'
              : 'border-transparent text-gray-500 hover:text-gray-700'}">
          {t.label}
        </button>
      {/each}
      <button on:click={() => { tab = 'problem_management'; loadPM(); }}
        class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
          {tab === 'problem_management'
            ? 'border-brand-600 text-brand-700 bg-white'
            : 'border-transparent text-gray-500 hover:text-gray-700'}">
        Problem Management
      </button>
      <button on:click={() => { tab = 'escalation'; loadEscalation(); }}
        class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
          {tab === 'escalation'
            ? 'border-brand-600 text-brand-700 bg-white'
            : 'border-transparent text-gray-500 hover:text-gray-700'}">
        Escalation Workflow
      </button>
    {/if}
  </div>

  <div class="pt-5 space-y-5">
    {#if loading}
      <p class="text-center text-gray-400 py-12">Loading…</p>

    <!-- ── TENANTS (platform admin only) ── -->
    {:else if tab === 'tenants'}
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-700">Tenants</h2>
        <button class="btn-secondary text-sm" on:click={() => { showAddTenant = !showAddTenant; }}>
          + Provision Tenant
        </button>
      </div>

      {#if showAddTenant}
        <form class="bg-white rounded-lg shadow p-5 space-y-3 border-t-4 border-brand-600"
          on:submit|preventDefault={saveAddTenant}>
          <h3 class="font-semibold text-gray-800 text-sm">New Tenant</h3>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Company Name *</label>
              <input bind:value={newTenant.name} required type="text"
                on:input={() => { if (!newTenant.slug) newTenant.slug = slugify(newTenant.name); }}
                class="w-full border rounded px-2 py-1.5 text-sm" placeholder="e.g. Acme IT" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Slug (login identifier) *</label>
              <input bind:value={newTenant.slug} required type="text"
                class="w-full border rounded px-2 py-1.5 text-sm font-mono" placeholder="e.g. acmeit" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Type *</label>
              <select bind:value={newTenant.type} class="w-full border rounded px-2 py-1.5 text-sm">
                <option value="master_msp">Master MSP</option>
                <option value="msp">MSP</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Admin Name *</label>
              <input bind:value={newTenant.admin_name} required type="text"
                class="w-full border rounded px-2 py-1.5 text-sm" placeholder="e.g. John Smith" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Admin Email *</label>
              <input bind:value={newTenant.admin_email} required type="email"
                class="w-full border rounded px-2 py-1.5 text-sm" placeholder="admin@company.com" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Admin Password *</label>
              <input bind:value={newTenant.admin_password} required type="password"
                class="w-full border rounded px-2 py-1.5 text-sm" placeholder="Temporary password" />
            </div>
          </div>
          {#if tenantError}
            <div class="bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{tenantError}</div>
          {/if}
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-secondary" on:click={() => showAddTenant = false}>Cancel</button>
            <button type="submit" class="btn-secondary" disabled={savingTenant}>
              {savingTenant ? 'Creating…' : 'Create Tenant'}
            </button>
          </div>
        </form>
      {/if}

      <div class="bg-white rounded-lg shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Slug</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Users</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#if tenantsLoading}
              <tr><td colspan="6" class="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
            {:else if tenants.length === 0}
              <tr><td colspan="6" class="px-5 py-10 text-center text-gray-400">No tenants yet.</td></tr>
            {:else}
              {#each tenants as t}
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                  <td class="px-5 py-3 font-semibold text-gray-800">{t.name}</td>
                  <td class="px-5 py-3 font-mono text-xs text-gray-500">{t.slug}</td>
                  <td class="px-5 py-3">
                    <span class="text-xs px-2 py-0.5 rounded-full capitalize
                      {t.type === 'master_msp' ? 'bg-green-100 text-green-700' :
                       t.type === 'msp'        ? 'bg-blue-100 text-blue-700' :
                                                 'bg-purple-100 text-purple-700'}">
                      {t.type === 'master_msp' ? 'Master MSP' : t.type === 'msp' ? 'MSP' : t.type}
                    </span>
                  </td>
                  <td class="px-5 py-3 text-center text-gray-600">{t.user_count}</td>
                  <td class="px-5 py-3 text-center">
                    <button on:click={() => toggleTenantActive(t)}
                      class="text-xs px-2 py-0.5 rounded-full {t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">
                      {t.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td class="px-5 py-3 text-right space-x-3">
                    <button class="text-xs text-blue-500 hover:text-blue-700"
                      on:click={() => toggleTenantExpand(t.id, 'edit', t)}>
                      {expandedTenantId === t.id && expandedView === 'edit' ? 'Close' : 'Edit'}
                    </button>
                    <button class="text-xs text-indigo-500 hover:text-indigo-700"
                      on:click={() => toggleTenantExpand(t.id, 'users')}>
                      {expandedTenantId === t.id && expandedView === 'users' ? 'Close' : 'Users'}
                    </button>
                    <button class="text-xs text-red-400 hover:text-red-600"
                      on:click={() => deleteTenant(t)}>Delete</button>
                  </td>
                </tr>

                <!-- ── Inline Edit panel ── -->
                {#if expandedTenantId === t.id && expandedView === 'edit'}
                  <tr>
                    <td colspan="6" class="px-5 py-4 bg-blue-50 border-b border-blue-100">
                      <form class="flex flex-wrap gap-3 items-end" on:submit|preventDefault={saveEditTenant}>
                        <div>
                          <label class="block text-xs text-gray-500 mb-1">Tenant Name</label>
                          <input bind:value={editTenantForm.name} required type="text"
                            class="border rounded px-2 py-1.5 text-sm w-52" />
                        </div>
                        <div>
                          <label class="block text-xs text-gray-500 mb-1">Type</label>
                          <select bind:value={editTenantForm.type} class="border rounded px-2 py-1.5 text-sm">
                            <option value="master_msp">Master MSP</option>
                            <option value="msp">MSP</option>
                          </select>
                        </div>
                        <div class="flex items-center gap-2 pb-1">
                          <input type="checkbox" bind:checked={editTenantForm.is_active} id="edit-active-{t.id}" />
                          <label for="edit-active-{t.id}" class="text-xs text-gray-600">Active</label>
                        </div>
                        {#if editTenantError}
                          <p class="w-full text-xs text-red-600">{editTenantError}</p>
                        {/if}
                        <div class="flex gap-2">
                          <button type="submit" class="btn-secondary text-xs" disabled={editTenantSaving}>
                            {editTenantSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" class="text-xs text-gray-500 hover:text-gray-700"
                            on:click={() => { expandedTenantId = null; expandedView = null; }}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                {/if}

                <!-- ── Users panel ── -->
                {#if expandedTenantId === t.id && expandedView === 'users'}
                  <tr>
                    <td colspan="6" class="px-5 py-4 bg-gray-50 border-b border-gray-200">
                      <p class="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">
                        Users — {t.name}
                      </p>

                      {#if usersLoading[t.id]}
                        <p class="text-xs text-gray-400">Loading…</p>
                      {:else}
                        <table class="w-full text-xs mb-4">
                          <thead>
                            <tr class="border-b border-gray-200">
                              <th class="text-left py-1.5 pr-4 text-gray-500 font-medium">Name</th>
                              <th class="text-left py-1.5 pr-4 text-gray-500 font-medium">Email</th>
                              <th class="text-left py-1.5 pr-4 text-gray-500 font-medium">Role</th>
                              <th class="text-left py-1.5 pr-4 text-gray-500 font-medium">Last Login</th>
                              <th class="text-right py-1.5 text-gray-500 font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each (tenantUsersMap[t.id] ?? []) as u (u.id)}
                              <tr class="border-b border-gray-100">
                                <td class="py-1.5 pr-4 font-medium text-gray-800">{u.display_name}</td>
                                <td class="py-1.5 pr-4 text-gray-600">{u.email}</td>
                                <td class="py-1.5 pr-4 capitalize text-gray-600">{u.role.replace('_', ' ')}</td>
                                <td class="py-1.5 pr-4 text-gray-400">
                                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                                </td>
                                <td class="py-1.5 text-right space-x-3">
                                  <button class="text-blue-500 hover:text-blue-700"
                                    on:click={() => { resetPwdUserId = u.id; resetPwdValue = ''; resetPwdError = ''; }}>
                                    Reset pwd
                                  </button>
                                  <button class="text-red-400 hover:text-red-600"
                                    on:click={() => deleteTenantUser(t.id, u.id)}>
                                    Delete
                                  </button>
                                </td>
                              </tr>
                              <!-- Inline reset password row -->
                              {#if resetPwdUserId === u.id}
                                <tr>
                                  <td colspan="5" class="py-2 pl-2">
                                    <form class="flex gap-2 items-center" on:submit|preventDefault={resetPassword}>
                                      <input type="password" bind:value={resetPwdValue}
                                        placeholder="New password (min 6 chars)"
                                        class="border rounded px-2 py-1 text-xs w-56" />
                                      <button type="submit" class="btn-secondary text-xs py-1"
                                        disabled={resetPwdSaving}>
                                        {resetPwdSaving ? 'Saving…' : 'Set Password'}
                                      </button>
                                      <button type="button" class="text-xs text-gray-400"
                                        on:click={() => { resetPwdUserId = null; resetPwdError = ''; }}>
                                        Cancel
                                      </button>
                                      {#if resetPwdError}
                                        <span class="text-red-500 text-xs">{resetPwdError}</span>
                                      {/if}
                                    </form>
                                  </td>
                                </tr>
                              {/if}
                            {/each}
                            {#if (tenantUsersMap[t.id] ?? []).length === 0}
                              <tr><td colspan="5" class="py-3 text-gray-400 text-center">No users yet.</td></tr>
                            {/if}
                          </tbody>
                        </table>

                        <!-- Add user form -->
                        <p class="text-xs font-semibold text-gray-600 mb-2">Add User</p>
                        <form class="flex flex-wrap gap-2 items-end" on:submit|preventDefault={addTenantUser}>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Name</label>
                            <input bind:value={newUserForm.display_name} required type="text"
                              class="border rounded px-2 py-1 text-xs w-36" placeholder="Full name" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Email</label>
                            <input bind:value={newUserForm.email} required type="email"
                              class="border rounded px-2 py-1 text-xs w-44" placeholder="user@company.com" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Password</label>
                            <input bind:value={newUserForm.password} required type="password"
                              class="border rounded px-2 py-1 text-xs w-36" placeholder="Temp password" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Role</label>
                            <select bind:value={newUserForm.role} class="border rounded px-2 py-1 text-xs">
                              <option value="super_admin">Super Admin</option>
                              <option value="tenant_admin">Tenant Admin</option>
                              <option value="msp_admin">MSP Admin</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </div>
                          {#if newUserError}
                            <p class="w-full text-xs text-red-600">{newUserError}</p>
                          {/if}
                          <button type="submit" class="btn-secondary text-xs py-1" disabled={newUserSaving}>
                            {newUserSaving ? 'Adding…' : '+ Add User'}
                          </button>
                        </form>
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

    <!-- ── PLANS (platform admin) ── -->
    {:else if tab === 'plans'}
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-base font-semibold text-gray-700">Plan Assignment</h2>
      </div>

      {#if plansLoading}
        <p class="text-center text-gray-400 py-12">Loading…</p>
      {:else}
        <div class="bg-white rounded-lg shadow overflow-hidden">
          {#if adminTenantsList.length === 0}
            <p class="px-5 py-10 text-center text-gray-400 text-sm">No tenants provisioned yet.</p>
          {:else}
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Devices</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Current Plan</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Assign Plan</th>
                </tr>
              </thead>
              <tbody>
                {#each adminTenantsList as t (t.id)}
                  {@const uc = planUsageColor(t.device_used, t.device_limit)}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-5 py-3 font-semibold text-gray-800">
                      {t.name}
                      {#if !t.is_active}
                        <span class="text-xs text-gray-400 ml-1">(inactive)</span>
                      {/if}
                    </td>
                    <td class="px-5 py-3">
                      <span class="text-xs px-2 py-0.5 rounded-full
                        {t.type === 'master_msp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">
                        {t.type === 'master_msp' ? 'Master MSP' : 'MSP'}
                      </span>
                    </td>
                    <td class="px-5 py-3">
                      <span style="color: {uc}; font-weight: 600;">{t.device_used}</span>
                      <span class="text-gray-400"> / {planDeviceLimitLabel(t.device_limit)}</span>
                    </td>
                    <td class="px-5 py-3 text-gray-600">
                      {#if t.plan_name}
                        <span class="text-xs px-2 py-0.5 rounded-full bg-brand-700 text-white font-medium">
                          {t.plan_name}
                        </span>
                      {:else}
                        <span class="text-xs text-gray-400 italic">No plan</span>
                      {/if}
                    </td>
                    <td class="px-5 py-3">
                      <div class="flex items-center gap-2">
                        <select
                          value={t.plan_id != null ? String(t.plan_id) : ''}
                          on:change={e => assignPlanFromManage(t.id, e.currentTarget.value)}
                          disabled={planAssigning[t.id]}
                          class="border rounded px-2 py-1.5 text-xs text-gray-700 bg-white"
                        >
                          <option value="">— No plan —</option>
                          {#each activePlansList as p (p.id)}
                            {#if p.name.toLowerCase() !== 'custom' || t.plan_name?.toLowerCase() === 'custom'}
                              <option value={String(p.id)}>{p.name}</option>
                            {/if}
                          {/each}
                        </select>
                        {#if planAssigning[t.id]}
                          <span class="text-xs text-gray-400">Saving…</span>
                        {:else if planAssignSuccess[t.id]}
                          <span class="text-xs text-green-600 font-medium">✓</span>
                        {/if}
                      </div>
                      {#if planAssignErr[t.id]}
                        <p class="text-xs text-red-500 mt-1">{planAssignErr[t.id]}</p>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <!-- Plan legend -->
        {#if activePlansList.length > 0}
          <div class="mt-4 flex flex-wrap gap-3">
            {#each activePlansList as p (p.id)}
              {#if p.name.toLowerCase() !== 'custom'}
                <div class="bg-white rounded-lg border px-4 py-3 text-sm">
                  <span class="font-semibold text-gray-800">{p.name}</span>
                  <span class="text-gray-400 mx-2">·</span>
                  <span class="text-gray-500">{planDeviceLimitLabel(p.device_limit)} devices</span>
                  {#if p.price_monthly != null}
                    <span class="text-gray-400 mx-2">·</span>
                    <span class="text-gray-500">${p.price_monthly}/mo</span>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}

    <!-- ── OVERVIEW ── -->
    {:else if tab === 'overview'}
      <!-- Action buttons row (Datto style) -->
      <div class="flex gap-3">
        <button class="btn-secondary" on:click={() => { tab = 'companies'; showAddCompany = true; }}>+ Add Company</button>
        <button class="btn-secondary" on:click={() => tab = 'devices'}>Backup Plans</button>
        <button class="btn-secondary" on:click={() => tab = 'retired'}>Retired Backups</button>
        <button class="btn-secondary" on:click={() => tab = 'schedules'}>Schedules</button>
      </div>

      {#if overview}
        <!-- Summary cards -->
        {@const devUsed  = overview.devices.active}
        {@const devLimit = overview.devices.limit}
        {@const devPct   = devLimit > 0 ? (devUsed / devLimit) * 100 : 0}
        {@const devColor = devLimit === -1 ? '#16a34a'
                         : devPct >= 85    ? '#dc2626'
                         : devPct >= 75    ? '#d97706'
                                           : '#16a34a'}
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div class="stat-card">
            <span class="text-xs font-semibold text-gray-500 uppercase">MSP Companies</span>
            <span class="text-3xl font-bold text-brand-700">{overview.companies.msp}</span>
          </div>
          <div class="stat-card">
            <span class="text-xs font-semibold text-gray-500 uppercase">Client Companies</span>
            <span class="text-3xl font-bold text-brand-700">{overview.companies.client}</span>
          </div>
          <div class="stat-card">
            <span class="text-xs font-semibold text-gray-500 uppercase">Active Devices</span>
            <span class="text-3xl font-bold text-green-600">{overview.devices.active}</span>
          </div>
          <div class="stat-card">
            <span class="text-xs font-semibold text-gray-500 uppercase">Retired Devices</span>
            <span class="text-3xl font-bold text-gray-400">{overview.devices.retired}</span>
          </div>
          <div class="stat-card">
            <span class="text-xs font-semibold text-gray-500 uppercase">Device Enrollment</span>
            <span class="text-3xl font-bold" style="color: {devColor};">
              {devUsed}<span class="text-lg font-normal text-gray-400"> / {devLimit === -1 ? '∞' : devLimit}</span>
            </span>
            {#if devLimit > 0}
              <div class="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                <div class="h-1.5 rounded-full transition-all"
                  style="width: {Math.min(devPct, 100)}%; background-color: {devColor};">
                </div>
              </div>
              <span class="text-xs mt-1" style="color: {devColor};">{Math.round(devPct)}% used</span>
            {:else}
              <span class="text-xs text-gray-400 mt-1">Unlimited</span>
            {/if}
          </div>
        </div>

        <!-- Management Overview table (Datto style) -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 font-semibold text-gray-700 text-sm">Management Overview</div>
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500">Category</th>
                <th class="text-right px-5 py-3 text-xs font-semibold text-gray-500">Quantity</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-gray-100">
                <td class="px-5 py-2.5 text-gray-700">Active Devices</td>
                <td class="px-5 py-2.5 text-right font-semibold text-gray-800">{overview.devices.active}</td>
              </tr>
              <tr class="border-b border-gray-100">
                <td class="px-5 py-2.5 text-gray-700">Retired Devices</td>
                <td class="px-5 py-2.5 text-right font-semibold text-gray-400">{overview.devices.retired}</td>
              </tr>
              <tr class="border-b border-gray-100">
                <td class="px-5 py-2.5 text-gray-700">Active Connectors</td>
                <td class="px-5 py-2.5 text-right font-semibold text-brand-600">{overview.connectors.active}</td>
              </tr>
              <tr class="border-b border-gray-100">
                <td class="px-5 py-2.5 text-gray-700">Total Companies</td>
                <td class="px-5 py-2.5 text-right font-semibold text-gray-800">{overview.companies.total}</td>
              </tr>
              {#each Object.entries(overview.jobs_24h) as [status, count]}
                <tr class="border-b border-gray-100">
                  <td class="px-5 py-2.5 text-gray-700 capitalize">Jobs (last 24h) — {status}</td>
                  <td class="px-5 py-2.5 text-right">
                    <span class="text-xs px-2 py-0.5 rounded-full font-semibold {statusClass(status)}">{count}</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- ── COMPANIES ── -->
    {:else if tab === 'companies'}
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-700">Companies</h2>
        <button class="btn-secondary text-sm" on:click={() => { showAddCompany = !showAddCompany; editingCompanyId = null; }}>
          + Add Company
        </button>
      </div>

      {#if showAddCompany}
        <form class="bg-white rounded-lg shadow p-5 space-y-3 border-t-4 border-brand-600"
          on:submit|preventDefault={saveAddCompany}>
          <h3 class="font-semibold text-gray-800 text-sm">New Company</h3>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Company Name *</label>
              <input bind:value={newCompany.name} required type="text"
                class="w-full border rounded px-2 py-1.5 text-sm" placeholder="e.g. Neurospine Medical" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Type</label>
              <select bind:value={newCompany.type}
                on:change={() => { if (newCompany.type === 'msp') newCompany.parent_id = null; }}
                class="w-full border rounded px-2 py-1.5 text-sm">
                <option value="client">Customer</option>
                {#if $auth?.role !== 'msp_admin' && $auth?.tenant_type !== 'msp'}
                  <option value="msp">MSP</option>
                {/if}
              </select>
            </div>
            {#if newCompany.type === 'client' && $auth?.tenant_type !== 'msp'}
              <div class="col-span-2">
                <label class="block text-xs text-gray-500 mb-1">Parent MSP *</label>
                <select bind:value={newCompany.parent_id} required
                  class="w-full border rounded px-2 py-1.5 text-sm {!newCompany.parent_id ? 'text-gray-400' : ''}">
                  <option value={null} disabled selected>— Select MSP —</option>
                  {#each msps as msp}
                    <option value={msp.id}>{msp.name}</option>
                  {/each}
                </select>
                {#if msps.length === 0}
                  <p class="text-xs text-amber-600 mt-1">No MSPs found — add an MSP first.</p>
                {/if}
              </div>
            {/if}
            <div>
              <label class="block text-xs text-gray-500 mb-1">Contact Email</label>
              <input bind:value={newCompany.contact_email} type="email"
                class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          {#if companyError}
            <div class="bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{companyError}</div>
          {/if}
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-secondary" on:click={() => showAddCompany = false}>Cancel</button>
            <button type="submit" class="btn-secondary" disabled={savingCompany || (newCompany.type === 'client' && $auth?.tenant_type !== 'msp' && !newCompany.parent_id)}>
              {savingCompany ? 'Saving…' : 'Save Company'}
            </button>
          </div>
        </form>
      {/if}

      {#if orphanedCompanies.length > 0}
        <div class="mb-3 flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
          <span class="text-lg leading-none mt-0.5">⚠</span>
          <div>
            <strong>{orphanedCompanies.length} company{orphanedCompanies.length > 1 ? 'ies' : ''} not nested under an MSP:</strong>
            {orphanedCompanies.map(c => c.name).join(', ')}.
            Use the <strong>Move</strong> button to place them under the correct MSP, or <strong>Delete</strong> to remove them.
          </div>
        </div>
      {/if}

      <!-- Companies table — MSPs with expandable clients -->
      <div class="bg-white rounded-lg shadow overflow-hidden" on:click={handleClickAway}>
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Company</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Clients</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Devices</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Connectors</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Contact</th>
              <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#if companies.length === 0}
              <tr><td colspan="7" class="px-5 py-10 text-center text-gray-400">No companies yet.</td></tr>
            {:else}
              {#each companies as c}
                <!-- Company row — MSPs are expandable; orphaned clients show a warning -->
                <tr class="border-b border-gray-100 {c.type !== 'msp' ? 'bg-orange-50' : 'bg-gray-50'} cursor-pointer select-none hover:bg-gray-100"
                  on:click={() => c.type === 'msp' && toggleExpand(c.id)}>
                  <td class="px-5 py-3 font-semibold text-gray-800 flex items-center gap-2">
                    {#if c.type === 'msp'}
                      <span class="text-gray-400 text-xs transition-transform {expandedMspId === c.id ? 'rotate-90' : ''}">▶</span>
                    {:else}
                      <span title="This company is not nested under any MSP — use Move to fix it" class="text-orange-500 text-xs">⚠</span>
                    {/if}
                    {c.name}
                  </td>
                  <td class="px-5 py-3">
                    <span class="text-xs px-2 py-0.5 rounded-full {c.type === 'msp' ? 'bg-brand-700 text-white' : 'bg-orange-100 text-orange-700'} capitalize">{c.type}</span>
                  </td>
                  <td class="px-5 py-3 text-center text-gray-600">{c.clients.length}</td>
                  <td class="px-5 py-3 text-center text-gray-600">{c.device_count}</td>
                  <td class="px-5 py-3 text-center text-gray-600">{c.connector_count}</td>
                  <td class="px-5 py-3 text-gray-500 text-xs">{c.contact_email ?? '—'}</td>
                  <td class="px-5 py-3 text-right" on:click|stopPropagation>
                    <div class="flex items-center justify-end gap-3">
                      {#if c.type !== 'msp' && topLevelMsps.length > 0}
                        <div class="relative">
                          <button class="text-xs text-orange-500 hover:text-orange-700 font-medium"
                            on:click={() => movingCompanyId = movingCompanyId === c.id ? null : c.id}>
                            Move ▾
                          </button>
                          {#if movingCompanyId === c.id}
                            <div class="absolute right-0 top-5 z-20 bg-white border border-gray-200 rounded shadow-lg min-w-[180px] py-1">
                              <div class="px-3 py-1 text-xs text-gray-400 border-b">Move under MSP:</div>
                              {#each topLevelMsps as msp}
                                <button class="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 text-gray-700"
                                  on:click={() => { moveUnderMsp(c.id, msp.id); movingCompanyId = null; }}>
                                  {msp.name}
                                </button>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}
                      <button class="text-xs text-blue-500 hover:text-blue-700" on:click={() => startEditCompany(c)}>Edit</button>
                      <button class="text-xs text-red-400 hover:text-red-600" on:click={() => deleteCompany(c.id, c.name)}>Delete</button>
                    </div>
                  </td>
                </tr>

                <!-- Inline edit -->
                {#if editingCompanyId === c.id}
                  <tr class="bg-blue-50 border-b border-blue-100">
                    <td colspan="7" class="px-5 py-3">
                      <form class="flex flex-wrap gap-3 items-end" on:submit|preventDefault={saveEditCompany}>
                        <div>
                          <label class="block text-xs text-gray-500 mb-1">Name</label>
                          <input type="text" bind:value={editCompany.name} required
                            class="border rounded px-2 py-1 text-sm w-48" />
                        </div>
                        <div>
                          <label class="block text-xs text-gray-500 mb-1">Contact Email</label>
                          <input type="email" bind:value={editCompany.contact_email}
                            class="border rounded px-2 py-1 text-sm w-48" />
                        </div>
                        <div>
                          <label for="edit-parent-{c.id}" class="block text-xs text-gray-500 mb-1">Parent MSP</label>
                          <select id="edit-parent-{c.id}" bind:value={editCompany.parent_id}
                            class="border rounded px-2 py-1 text-sm bg-white w-48">
                            <option value={null}>— none (top-level MSP) —</option>
                            {#each companies.filter(m => m.parent_id === null && m.id !== editingCompanyId) as msp}
                              <option value={msp.id}>{msp.name}</option>
                            {/each}
                          </select>
                        </div>
                        {#if companyError}
                          <div class="w-full bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{companyError}</div>
                        {/if}
                        <div class="flex gap-2 pb-1">
                          <button type="submit" class="btn-secondary text-xs py-1" disabled={savingCompany}>Save</button>
                          <button type="button" class="btn-secondary text-xs py-1" on:click={() => editingCompanyId = null}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                {/if}

                <!-- Client sub-rows — only shown when MSP is expanded -->
                {#if expandedMspId === c.id}
                  {#each c.clients as client}
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                      <td class="px-5 py-2.5 pl-10 text-gray-700">↳ {client.name}</td>
                      <td class="px-5 py-2.5">
                        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">{client.type}</span>
                      </td>
                      <td class="px-5 py-2.5 text-center text-gray-400 text-xs">—</td>
                      <td class="px-5 py-2.5 text-center text-gray-600 text-xs">{client.device_count}</td>
                      <td class="px-5 py-2.5 text-center text-gray-600 text-xs">{client.connector_count}</td>
                      <td class="px-5 py-2.5 text-gray-400 text-xs">—</td>
                      <td class="px-5 py-2.5 text-right" on:click|stopPropagation>
                        <div class="flex items-center justify-end gap-3">
                          {#if topLevelMsps.filter(m => m.id !== c.id).length > 0}
                            <div class="relative">
                              <button class="text-xs text-blue-500 hover:text-blue-700"
                                on:click={() => movingCompanyId = movingCompanyId === client.id ? null : client.id}>
                                Move ▾
                              </button>
                              {#if movingCompanyId === client.id}
                                <div class="absolute right-0 top-5 z-20 bg-white border border-gray-200 rounded shadow-lg min-w-[180px] py-1">
                                  <div class="px-3 py-1 text-xs text-gray-400 border-b">Move to MSP:</div>
                                  {#each topLevelMsps.filter(m => m.id !== c.id) as msp}
                                    <button class="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-gray-700"
                                      on:click={() => { moveUnderMsp(client.id, msp.id); movingCompanyId = null; }}>
                                      {msp.name}
                                    </button>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          {/if}
                          <button class="text-xs text-red-400 hover:text-red-600" on:click={() => deleteCompany(client.id, client.name)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                {/if}
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

    <!-- ── BACKUP PLANS (Active Devices) ── -->
    {:else if tab === 'devices'}
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-700">Active Backup Plans <span class="text-gray-400 text-sm font-normal">({devices.length} devices)</span></h2>
      </div>
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Device</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Company</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">MSP</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Last Backup</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#if devices.length === 0}
              <tr><td colspan="6" class="px-5 py-10 text-center text-gray-400">No active devices. Run a sync to populate devices.</td></tr>
            {:else}
              {#each devices as d}
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                  <td class="px-5 py-2.5 font-medium text-gray-800">{d.name}</td>
                  <td class="px-5 py-2.5 text-gray-600">{d.org_name}</td>
                  <td class="px-5 py-2.5 text-gray-400 text-xs">{d.parent_org ?? '—'}</td>
                  <td class="px-5 py-2.5 text-gray-500 text-xs">
                    {d.last_backup ? new Date(d.last_backup).toLocaleString() : 'Never'}
                  </td>
                  <td class="px-5 py-2.5">
                    {#if d.last_status}
                      <span class="text-xs px-2 py-0.5 rounded-full capitalize {statusClass(d.last_status)}">{d.last_status}</span>
                    {:else}
                      <span class="text-xs text-gray-400">—</span>
                    {/if}
                  </td>
                  <td class="px-5 py-2.5 text-right">
                    <button class="text-xs text-amber-500 hover:text-amber-700" on:click={() => retireDevice(d.id)}>Retire</button>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

    <!-- ── RETIRED BACKUPS ── -->
    {:else if tab === 'retired'}
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-700">Retired Backups <span class="text-gray-400 text-sm font-normal">({retiredDevices.length} devices)</span></h2>
      </div>
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Device</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Company</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Retired On</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Reason</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Last Status</th>
              <th class="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#if retiredDevices.length === 0}
              <tr><td colspan="6" class="px-5 py-10 text-center text-gray-400">No retired devices.</td></tr>
            {:else}
              {#each retiredDevices as d}
                <tr class="border-b border-gray-100 hover:bg-gray-50 opacity-70">
                  <td class="px-5 py-2.5 text-gray-600 line-through">{d.name}</td>
                  <td class="px-5 py-2.5 text-gray-500">{d.org_name}</td>
                  <td class="px-5 py-2.5 text-gray-400 text-xs">
                    {d.retired_at ? new Date(d.retired_at).toLocaleString() : '—'}
                  </td>
                  <td class="px-5 py-2.5 text-gray-500 text-xs max-w-[220px]">
                    {#if d.retire_reason}
                      <span title={d.retire_reason} class="truncate block">{d.retire_reason}</span>
                    {:else}
                      <span class="text-gray-300">No reason given</span>
                    {/if}
                  </td>
                  <td class="px-5 py-2.5">
                    {#if d.last_status}
                      <span class="text-xs px-2 py-0.5 rounded-full capitalize {statusClass(d.last_status)}">{d.last_status}</span>
                    {:else}
                      <span class="text-xs text-gray-400">—</span>
                    {/if}
                  </td>
                  <td class="px-5 py-2.5 text-right">
                    <button class="text-xs text-green-500 hover:text-green-700" on:click={() => reactivateDevice(d.id)}>Reactivate</button>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

    <!-- ── SCHEDULES ── -->
    {:else if tab === 'schedules'}
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-700">Sync Schedules</h2>
        <p class="text-xs text-gray-400">Automatic sync runs every 15 minutes in production. Use Dashboard → Sync for manual triggers.</p>
      </div>
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Organisation</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tool</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Last Sync</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {#if schedules.length === 0}
              <tr><td colspan="6" class="px-5 py-10 text-center text-gray-400">No connectors configured. Add connectors under Integrations.</td></tr>
            {:else}
              {#each schedules as s}
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                  <td class="px-5 py-2.5 font-medium text-gray-800">{s.org_name}</td>
                  <td class="px-5 py-2.5 text-gray-500 uppercase text-xs">{s.tool}</td>
                  <td class="px-5 py-2.5 text-gray-500 text-xs">{s.schedule}</td>
                  <td class="px-5 py-2.5 text-gray-400 text-xs">
                    {s.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : 'Never'}
                  </td>
                  <td class="px-5 py-2.5 text-center">
                    <span class="text-xs px-2 py-0.5 rounded-full capitalize {statusClass(s.last_sync_status)}">{s.last_sync_status}</span>
                  </td>
                  <td class="px-5 py-2.5 text-center">
                    <span class="text-xs px-2 py-0.5 rounded-full {s.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">
                      {s.is_enabled ? 'Active' : 'Paused'}
                    </span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

    <!-- ── PROBLEM MANAGEMENT ── -->
    {:else if tab === 'problem_management'}
      <!-- Sub-tabs -->
      <div class="border-b border-gray-200 flex gap-0 -mt-2 mb-5">
        <button on:click={() => pmTab = 'overview'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {pmTab === 'overview' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Overview
        </button>
        <button on:click={() => { pmTab = 'config'; }}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {pmTab === 'config' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Configuration
        </button>
      </div>

      {#if pmLoading}
        <p class="text-center text-gray-400 py-12">Loading…</p>
      {:else if pmError}
        <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">{pmError}</div>
      {:else if pmTab === 'overview'}
        <!-- Stat cards -->
        <div class="grid grid-cols-3 gap-4 mb-5">
          <div class="bg-white rounded-lg shadow p-4">
            <p class="text-xs text-gray-500 uppercase font-semibold tracking-wide">Flagged Jobs</p>
            <p class="text-3xl font-bold text-orange-600 mt-1">{pmJobs.length}</p>
            <p class="text-xs text-gray-400 mt-1">Above threshold this period</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4">
            <p class="text-xs text-gray-500 uppercase font-semibold tracking-wide">Unique Devices</p>
            <p class="text-3xl font-bold text-gray-800 mt-1">{pmUniqueDevices}</p>
            <p class="text-xs text-gray-400 mt-1">Affected backup plans</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4">
            <p class="text-xs text-gray-500 uppercase font-semibold tracking-wide">Problem Tickets</p>
            <p class="text-3xl font-bold text-gray-800 mt-1">{pmWithTickets}</p>
            <p class="text-xs text-gray-400 mt-1">PSA tickets created</p>
          </div>
        </div>

        <!-- Filter bar -->
        <div class="flex flex-wrap gap-3 mb-4 items-center">
          <select bind:value={pmFilterWindow} on:change={loadPM}
            class="border rounded px-2 py-1.5 text-sm">
            <option value="weekly">This week</option>
            <option value="monthly">This month</option>
            <option value="rolling_7">Rolling 7 days</option>
            <option value="rolling_30">Rolling 30 days</option>
          </select>
          <select bind:value={pmFilterMspId} on:change={() => { pmFilterClientId = ''; loadPM(); }}
            class="border rounded px-2 py-1.5 text-sm">
            <option value="">All MSPs</option>
            {#each pmMsps as m}
              <option value={m.id}>{m.name}</option>
            {/each}
          </select>
          <select bind:value={pmFilterClientId} on:change={loadPM}
            class="border rounded px-2 py-1.5 text-sm">
            <option value="">All Customers</option>
            {#each pmClients as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          <button class="btn-secondary text-xs" on:click={loadPM}>Refresh</button>
        </div>

        <!-- Problems table -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Device</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Job</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Failures</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Consec.</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Fail%</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Failure</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rule</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {#if pmJobs.length === 0}
                <tr><td colspan="9" class="px-4 py-10 text-center text-gray-400">No flagged jobs for this period. Adjust thresholds in Configuration.</td></tr>
              {:else}
                {#each pmJobs as j}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-4 py-2.5 font-medium text-gray-800">{j.client}</td>
                    <td class="px-4 py-2.5 text-gray-600">{j.device}</td>
                    <td class="px-4 py-2.5 text-gray-500 text-xs max-w-[140px] truncate" title={j.job_name}>{j.job_name || '—'}</td>
                    <td class="px-4 py-2.5 text-center font-bold text-red-600">{j.failures_this_window}</td>
                    <td class="px-4 py-2.5 text-center text-gray-600">{j.consecutive_failures}</td>
                    <td class="px-4 py-2.5 text-center text-gray-600">{j.failure_pct}%</td>
                    <td class="px-4 py-2.5 text-gray-400 text-xs">
                      {j.last_failure ? new Date(j.last_failure).toLocaleString() : '—'}
                    </td>
                    <td class="px-4 py-2.5">
                      <span class="text-xs px-2 py-0.5 rounded-full capitalize
                        {j.rule_triggered === 'count' ? 'bg-red-100 text-red-700' :
                         j.rule_triggered === 'consecutive' ? 'bg-orange-100 text-orange-700' :
                         'bg-yellow-100 text-yellow-700'}">
                        {j.rule_triggered}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-center">
                      {#if j.ticket_created}
                        <span class="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">#{j.ticket_id}</span>
                      {:else}
                        <button
                          on:click={() => createPmTicket(j)}
                          disabled={pmTicketing[j.id]}
                          class="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                          {pmTicketing[j.id] ? 'Creating…' : 'Create Ticket'}
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      {:else}
        <!-- Configuration -->
        <div class="space-y-5">
          <!-- Step 1 -->
          <div class="bg-white rounded-lg shadow p-5">
            <h3 class="font-semibold text-gray-800 mb-1">Step 1 — Detection Thresholds</h3>
            <p class="text-xs text-gray-400 mb-4">A job group is flagged when ANY of these conditions are met within the time window.</p>
            <div class="grid grid-cols-3 gap-4">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Failure count ≥</label>
                <input type="number" min="1" bind:value={pmCfg.failure_count_threshold}
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Consecutive failures ≥</label>
                <input type="number" min="1" bind:value={pmCfg.consecutive_threshold}
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Failure rate ≥ %</label>
                <input type="number" min="1" max="100" bind:value={pmCfg.failure_pct_threshold}
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="bg-white rounded-lg shadow p-5">
            <h3 class="font-semibold text-gray-800 mb-1">Step 2 — Scope & Time Window</h3>
            <p class="text-xs text-gray-400 mb-4">Define the default time window for detecting problems.</p>
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Time Window</label>
                <select bind:value={pmCfg.time_window} class="w-full border rounded px-2 py-1.5 text-sm">
                  <option value="weekly">This week (Mon–now)</option>
                  <option value="monthly">This month</option>
                  <option value="rolling_7">Rolling 7 days</option>
                  <option value="rolling_30">Rolling 30 days</option>
                </select>
              </div>
            </div>
            <div class="flex flex-wrap gap-5">
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={pmCfg.auto_create_ticket} class="rounded" />
                Auto-create PSA ticket on trigger
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={pmCfg.dedupe_tickets} class="rounded" />
                Deduplicate tickets
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={pmCfg.auto_resolve} class="rounded" />
                Auto-resolve on clean run
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={pmCfg.append_notes} class="rounded" />
                Append notes on re-trigger
              </label>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="bg-white rounded-lg shadow p-5">
            <h3 class="font-semibold text-gray-800 mb-1">Step 3 — PSA Ticket Defaults</h3>
            <p class="text-xs text-gray-400 mb-4">Default values used when auto-creating tickets via Problem Management.</p>
            <div class="grid grid-cols-3 gap-4">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Board / Queue</label>
                <input type="text" bind:value={pmCfg.psa_board} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Priority</label>
                <input type="text" bind:value={pmCfg.psa_priority} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Ticket Type</label>
                <input type="text" bind:value={pmCfg.psa_ticket_type} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Assign To</label>
                <input type="text" bind:value={pmCfg.psa_assign_to} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">SLA</label>
                <input type="text" bind:value={pmCfg.psa_sla} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Status on Create</label>
                <input type="text" bind:value={pmCfg.psa_status_on_create} class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div class="mt-4">
              <label class="block text-xs text-gray-500 mb-1">Title Template</label>
              <input type="text" bind:value={pmCfg.title_template}
                class="w-full border rounded px-2 py-1.5 text-sm font-mono" />
              <p class="text-xs text-gray-400 mt-1">Variables: {'{client}'} {'{device}'} {'{job}'} {'{source}'} {'{window}'} {'{failure_count}'} {'{consecutive_count}'} {'{last_seen}'} {'{first_seen}'}</p>
            </div>
            <div class="mt-4">
              <label class="block text-xs text-gray-500 mb-1">Body Template</label>
              <textarea bind:value={pmCfg.body_template} rows="8"
                class="w-full border rounded px-2 py-1.5 text-sm font-mono resize-y"
                placeholder="Ticket body — use variables below"></textarea>
              <p class="text-xs text-gray-400 mt-1">Variables: {'{client}'} {'{device}'} {'{job}'} {'{source}'} {'{window}'} {'{failure_count}'} {'{consecutive_count}'} {'{last_seen}'} {'{first_seen}'} {'{error_reason}'} {'{proposed_solution}'}</p>
            </div>
          </div>

          <!-- Step 4 -->
          <div class="bg-white rounded-lg shadow p-5">
            <h3 class="font-semibold text-gray-800 mb-1">Step 4 — Notifications</h3>
            <p class="text-xs text-gray-400 mb-4">Additional alerts sent alongside PSA ticket creation.</p>
            <div class="space-y-4">
              <div class="flex items-start gap-4">
                <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1 w-36 shrink-0">
                  <input type="checkbox" bind:checked={pmCfg.email_alert} class="rounded" />
                  Email alert
                </label>
                {#if pmCfg.email_alert}
                  <input type="email" bind:value={pmCfg.email_address}
                    class="border rounded px-2 py-1.5 text-sm flex-1" placeholder="alerts@company.com" />
                {/if}
              </div>
              <div class="flex items-start gap-4">
                <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1 w-36 shrink-0">
                  <input type="checkbox" bind:checked={pmCfg.teams_alert} class="rounded" />
                  Teams webhook
                </label>
                {#if pmCfg.teams_alert}
                  <input type="url" bind:value={pmCfg.webhook_url}
                    class="border rounded px-2 py-1.5 text-sm flex-1"
                    placeholder="https://outlook.office.com/webhook/..." />
                {/if}
              </div>
            </div>
          </div>

          <!-- Exclusions -->
          <div class="bg-white rounded-lg shadow p-5">
            <h3 class="font-semibold text-gray-800 mb-1">Exclusions</h3>
            <p class="text-xs text-gray-400 mb-4">
              Excluded entries are completely ignored by Problem Management detection and stat counts.
              {#if canExclMsp}MSP exclusions suppress all customers and devices under that MSP.{/if}
            </p>

            <!-- Add exclusion form -->
            <div class="flex gap-3 items-end mb-4 flex-wrap">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Exclude by</label>
                <select bind:value={newExclType} on:change={() => newExclId = ''}
                  class="border rounded px-2 py-1.5 text-sm">
                  {#if canExclMsp}
                    <option value="msp">MSP</option>
                  {/if}
                  <option value="client">Customer</option>
                  <option value="device">Device</option>
                </select>
              </div>
              <div class="flex-1 min-w-[200px]">
                <label class="block text-xs text-gray-500 mb-1">Select entity</label>
                <select bind:value={newExclId} class="w-full border rounded px-2 py-1.5 text-sm">
                  <option value="">— select —</option>
                  {#each newExclOptions as opt}
                    <option value={opt.id}>
                      {opt.name}{newExclType === 'device' ? ' — ' + opt.org_name : ''}
                    </option>
                  {/each}
                </select>
              </div>
              <button class="btn-secondary text-xs" on:click={addPmExclusion}
                disabled={!newExclId || pmExclSaving}>
                {pmExclSaving ? 'Adding…' : '+ Add Exclusion'}
              </button>
            </div>

            <!-- Existing exclusions -->
            {#if pmExclusions.length === 0}
              <p class="text-xs text-gray-400 italic">No exclusions — all active entities are included in detection.</p>
            {:else}
              <div class="space-y-2">
                {#each pmExclusions as excl}
                  <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div class="flex items-center gap-2">
                      <span class="text-xs px-2 py-0.5 rounded-full font-medium capitalize
                        {excl.exclusion_type === 'msp' ? 'bg-blue-100 text-blue-700' :
                         excl.exclusion_type === 'client' ? 'bg-purple-100 text-purple-700' :
                         'bg-gray-200 text-gray-600'}">
                        {excl.exclusion_type}
                      </span>
                      <span class="text-sm text-gray-700">{excl.exclusion_name || ('ID ' + excl.exclusion_id)}</span>
                    </div>
                    <button class="text-xs text-red-400 hover:text-red-600"
                      on:click={() => removePmExclusion(excl.id)}>Remove</button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          {#if pmError}
            <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">{pmError}</div>
          {/if}
          <div class="flex justify-end">
            <button class="btn-secondary" on:click={savePmConfig} disabled={pmSaving}>
              {pmSaving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        </div>
      {/if}

    <!-- ── ESCALATION MANAGEMENT ── -->
    {:else if tab === 'escalation'}
      {#if escLoading}
        <p class="text-center text-gray-400 py-12">Loading…</p>
      {:else}
        <!-- Info banner -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 flex gap-3">
          <svg class="w-5 h-5 text-blue-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div>
            <p class="text-sm font-medium text-blue-800">Automatic Escalation</p>
            <p class="text-xs text-blue-600 mt-0.5">
              When a backup plan has 2+ consecutive failures, an incident is created and escalated automatically.
              L1 triggers immediately (PSA ticket + Teams alert), L2 escalates to your manager after a delay,
              and L3 escalates to your SDM if failures continue unresolved.
            </p>
          </div>
        </div>

        {#if escError}
          <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm mb-4">{escError}</div>
        {/if}

        <!-- Enable toggle -->
        <div class="bg-white rounded-lg shadow p-4 mb-4 flex items-center justify-between">
          <div>
            <p class="font-medium text-gray-800 text-sm">Escalation Engine</p>
            <p class="text-xs text-gray-500 mt-0.5">Enable automatic escalation for backup failures</p>
          </div>
          <label class="flex items-center gap-3 cursor-pointer">
            <span class="text-sm text-gray-500">{escPol.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <div class="relative w-10 h-5">
              <input type="checkbox" class="sr-only" bind:checked={escPol.is_enabled} />
              <div class="w-10 h-5 rounded-full transition-colors {escPol.is_enabled ? 'bg-green-500' : 'bg-gray-300'}"></div>
              <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                {escPol.is_enabled ? 'translate-x-5' : 'translate-x-0'}"></div>
            </div>
          </label>
        </div>

        <!-- L1 -->
        <div class="bg-white rounded-lg shadow p-5 mb-4">
          <div class="flex items-center gap-3 mb-4">
            <span class="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-semibold">L1 — Immediate</span>
            <p class="text-sm text-gray-500">Triggers as soon as a failure streak is detected (2+ consecutive failures)</p>
          </div>
          <div class="space-y-3">
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" bind:checked={escPol.l1_psa_enabled} class="rounded" />
              Create PSA ticket automatically
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" bind:checked={escPol.l1_teams_enabled} class="rounded" />
              Send Teams notification
            </label>
            {#if escPol.l1_teams_enabled}
              <div class="pl-6">
                <label class="block text-xs text-gray-500 mb-1">Teams Webhook URL</label>
                <input type="url" bind:value={escPol.l1_teams_webhook_url}
                  class="w-full border rounded px-2 py-1.5 text-sm"
                  placeholder="https://outlook.office.com/webhook/..." />
              </div>
            {/if}
          </div>
        </div>

        <!-- L2 -->
        <div class="bg-white rounded-lg shadow p-5 mb-4">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-xs px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold">L2 — Manager</span>
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" bind:checked={escPol.l2_enabled} class="rounded" />
              Enable L2 escalation
            </label>
          </div>
          {#if escPol.l2_enabled}
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Delay after L1 (hours)</label>
                  <input type="number" min="1" bind:value={escPol.l2_delay_hours}
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Min consecutive failures</label>
                  <input type="number" min="1" bind:value={escPol.l2_min_failures}
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Manager emails (comma-separated)</label>
                <input type="text" bind:value={escPol.l2_emails_str}
                  class="w-full border rounded px-2 py-1.5 text-sm"
                  placeholder="manager@company.com, lead@company.com" />
              </div>
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={escPol.l2_teams_enabled} class="rounded" />
                Send Teams notification
              </label>
              {#if escPol.l2_teams_enabled}
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Teams Webhook URL</label>
                  <input type="url" bind:value={escPol.l2_teams_webhook_url}
                    class="w-full border rounded px-2 py-1.5 text-sm"
                    placeholder="https://outlook.office.com/webhook/..." />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- L3 -->
        <div class="bg-white rounded-lg shadow p-5 mb-5">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-xs px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 font-semibold">L3 — SDM</span>
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" bind:checked={escPol.l3_enabled} class="rounded" />
              Enable L3 escalation
            </label>
          </div>
          {#if escPol.l3_enabled}
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Delay after L2 (hours)</label>
                  <input type="number" min="1" bind:value={escPol.l3_delay_hours}
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Min consecutive failures</label>
                  <input type="number" min="1" bind:value={escPol.l3_min_failures}
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">SDM emails (comma-separated)</label>
                <input type="text" bind:value={escPol.l3_emails_str}
                  class="w-full border rounded px-2 py-1.5 text-sm" placeholder="sdm@company.com" />
              </div>
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={escPol.l3_teams_enabled} class="rounded" />
                Send Teams notification
              </label>
              {#if escPol.l3_teams_enabled}
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Teams Webhook URL</label>
                  <input type="url" bind:value={escPol.l3_teams_webhook_url}
                    class="w-full border rounded px-2 py-1.5 text-sm"
                    placeholder="https://outlook.office.com/webhook/..." />
                </div>
              {/if}
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" bind:checked={escPol.l3_reassign_enabled} class="rounded" />
                Reassign ticket to SDM agent
              </label>
              {#if escPol.l3_reassign_enabled}
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Agent ID (from PSA)</label>
                  <input type="text" bind:value={escPol.l3_agent_id}
                    class="w-full border rounded px-2 py-1.5 text-sm" placeholder="e.g. 42" />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Active incidents table -->
        {#if escIncidents.length > 0}
          <div class="bg-white rounded-lg shadow overflow-hidden mb-5">
            <div class="px-5 py-3 border-b border-gray-100">
              <h3 class="font-medium text-gray-800 text-sm">Active Incidents ({escIncidents.length})</h3>
            </div>
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Device</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Level</th>
                  <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Failures</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Failed</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each escIncidents as inc}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-4 py-2.5 font-medium text-gray-800">{inc.device_name || '—'}</td>
                    <td class="px-4 py-2.5 text-gray-600">{inc.org_name || '—'}</td>
                    <td class="px-4 py-2.5 text-center">
                      <span class="text-xs px-2 py-0.5 rounded-full
                        {inc.current_level === 3 ? 'bg-purple-100 text-purple-700' :
                         inc.current_level === 2 ? 'bg-orange-100 text-orange-700' :
                         inc.current_level === 1 ? 'bg-red-100 text-red-700' :
                         'bg-gray-100 text-gray-500'}">
                        {inc.current_level === 0 ? 'Pending' : 'L' + inc.current_level}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-center font-bold text-red-600">{inc.failed_job_count}</td>
                    <td class="px-4 py-2.5 text-gray-400 text-xs">
                      {inc.last_failed_at ? new Date(inc.last_failed_at).toLocaleString() : '—'}
                    </td>
                    <td class="px-4 py-2.5">
                      <span class="text-xs px-2 py-0.5 rounded-full capitalize
                        {inc.status === 'active' ? 'bg-red-100 text-red-700' :
                         inc.status === 'acknowledged' ? 'bg-yellow-100 text-yellow-700' :
                         'bg-green-100 text-green-700'}">
                        {inc.status}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-right space-x-2">
                      {#if inc.status === 'active'}
                        <button class="text-xs text-yellow-600 hover:text-yellow-800"
                          on:click={() => acknowledgeIncident(inc.id)}>Ack</button>
                      {/if}
                      {#if inc.status !== 'resolved'}
                        <button class="text-xs text-green-600 hover:text-green-800"
                          on:click={() => resolveIncident(inc.id)}>Resolve</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <div class="flex justify-end">
          <button class="btn-secondary" on:click={saveEscPolicy} disabled={escSaving}>
            {escSaving ? 'Saving…' : 'Save Escalation Policy'}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- ── Retire modal ──────────────────────────────────────────────────────── -->
{#if retireModalDeviceId !== null}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" on:click|self={() => retireModalDeviceId = null}>
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
      <h2 class="text-base font-semibold text-gray-800">Retire Backup Plan</h2>
      <p class="text-sm text-gray-500">This device will be moved to Retired Backups. Optionally add a reason for your records.</p>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Reason <span class="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          rows="3"
          placeholder="e.g. Device decommissioned, replaced by new hardware..."
          bind:value={retireReason}
        ></textarea>
      </div>
      <div class="flex justify-end gap-3 pt-1">
        <button
          class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
          on:click={() => retireModalDeviceId = null}
          disabled={retiring}
        >Cancel</button>
        <button
          class="px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50"
          on:click={confirmRetire}
          disabled={retiring}
        >{retiring ? 'Retiring…' : 'Retire'}</button>
      </div>
    </div>
  </div>
{/if}
