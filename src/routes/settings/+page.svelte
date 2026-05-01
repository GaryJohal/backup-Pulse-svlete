<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import { api } from '$lib/api';
  import { THEMES } from '$lib/themes';
  import { FEATURES } from '$lib/config/features';

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
  type ApiKeyRecord  = { id: number; name: string; key_prefix: string; key_suffix: string; created_at: string; last_used_at: string | null };
  type TenantCfg     = { company_name: string | null; timezone: string; time_format: string; date_format: string; logo_url: string | null; primary_color: string; portal_name: string | null; email_tags: string; theme: string };
  type SmtpRecord    = { id: number; config_type: string; from_name: string; from_email: string; smtp_host: string | null; smtp_port: number; username: string | null; use_tls: boolean; azure_tenant_id: string | null; m365_client_id: string | null; is_active: boolean; is_verified: boolean; is_default: boolean };
  type EmailTag      = { pattern: string; status: string; description: string };
  type UserRecord    = { id: number; email: string; display_name: string; role: string; org_id: number | null; last_login_at: string | null };
  type OrgOption     = { id: number; name: string; type: string };

  // ── Tab state ─────────────────────────────────────────────────────────────
  type TabKey = 'api-keys' | 'branding' | 'tenant' | 'smtp' | 'billing' | 'invoices' | 'users' | 'security';
  let tab: TabKey = 'api-keys';
  let tabError = '';
  const tabLoaded = new Set<TabKey>();

  // ── Security Groups ───────────────────────────────────────────────────────
  type SgRecord = { id: number; name: string; color: string; mapped_role: string; is_system: boolean; can_use_api: boolean; permissions: Record<string, boolean> };
  const PERM_KEYS = ['dashboard', 'clients', 'problem_management', 'integrations', 'audit_log', 'settings', 'user_management', 'api_keys', 'billing'];
  const PERM_LABELS: Record<string, string> = {
    dashboard:          'Dashboard & Jobs',
    clients:            'Manage Clients',
    problem_management: 'Problem Mgmt',
    integrations:       'Integrations',
    audit_log:          'Audit Log',
    settings:           'Settings',
    user_management:    'User Mgmt',
    api_keys:           'API Keys',
    billing:            'Billing / Plan',
  };

  let securityGroups: SgRecord[] = [];
  let sgLoading = false;
  let editingGroupId: number | null = null;
  let editGroupForm: SgRecord | null = null;
  let showAddGroup = false;
  let newGroupForm = { name: '', color: '#6b7280', mapped_role: 'msp_admin', can_use_api: false, permissions: {} as Record<string, boolean> };
  let userRoleChanges: Record<number, string> = {};
  let rolesSaving: Record<number, boolean> = {};

  let sgError = '';
  async function loadSecurityGroups() {
    sgLoading = true;
    sgError = '';
    try {
      securityGroups = await apiFetch('/api/v1/settings/security-groups');
    } catch (e: unknown) {
      sgError = e instanceof Error ? e.message : 'Failed to load security groups';
    } finally {
      sgLoading = false;
    }
  }

  function startEditGroup(g: SgRecord) {
    editingGroupId = g.id;
    editGroupForm = { ...g, permissions: { ...g.permissions } };
  }

  function cancelEditGroup() {
    editingGroupId = null;
    editGroupForm = null;
  }

  async function saveGroup() {
    if (!editGroupForm) return;
    await apiFetch('/api/v1/settings/security-groups/' + editGroupForm.id, {
      method: 'PUT',
      body: JSON.stringify({
        name:        editGroupForm.name,
        color:       editGroupForm.color,
        mapped_role: editGroupForm.mapped_role,
        can_use_api: editGroupForm.can_use_api,
        permissions: editGroupForm.permissions,
      }),
    });
    editingGroupId = null;
    editGroupForm = null;
    await loadSecurityGroups();
  }

  async function deleteGroup(id: number) {
    if (!confirm('Delete this security group?')) return;
    await apiFetch('/api/v1/settings/security-groups/' + id, { method: 'DELETE' });
    await loadSecurityGroups();
  }

  function initNewGroupForm() {
    newGroupForm = {
      name: '', color: '#6b7280', mapped_role: 'msp_admin', can_use_api: false,
      permissions: Object.fromEntries(PERM_KEYS.map(k => [k, false])),
    };
    showAddGroup = true;
  }

  async function saveNewGroup() {
    if (!newGroupForm.name.trim()) return;
    await apiFetch('/api/v1/settings/security-groups', {
      method: 'POST',
      body: JSON.stringify(newGroupForm),
    });
    showAddGroup = false;
    await loadSecurityGroups();
  }

  function setUserRoleChange(userId: number, role: string) {
    userRoleChanges = { ...userRoleChanges, [userId]: role };
  }

  async function applyUserRole(userId: number) {
    const role = userRoleChanges[userId];
    if (!role) return;
    rolesSaving = { ...rolesSaving, [userId]: true };
    try {
      await apiFetch('/api/v1/settings/users/' + userId + '/role', {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      const { [userId]: _, ...rest } = userRoleChanges;
      userRoleChanges = rest;
      await loadUsers();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      const { [userId]: _, ...rest } = rolesSaving;
      rolesSaving = rest;
    }
  }

  // ── Billing ───────────────────────────────────────────────────────────────
  let billingPlanName: string | null = null;
  let billingFlags: Record<string, boolean> = {};

  // ── API Keys ──────────────────────────────────────────────────────────────
  let apiKeys: ApiKeyRecord[] = [];
  let keysLoading = false;
  let showNewKeyForm = false;
  let newKeyName = '';
  let generatedKey: string | null = null;
  let keySaving = false;

  async function revokeApiKeyFromSecurity(id: number, name: string) {
    if (!confirm('Revoke key "' + name + '"?')) return;
    await apiFetch('/api/v1/settings/api-keys/' + id, { method: 'DELETE' });
    await loadApiKeys();
  }

  async function loadApiKeys() {
    keysLoading = true;
    apiKeys = await apiFetch('/api/v1/settings/api-keys');
    keysLoading = false;
  }

  async function generateKey() {
    if (!newKeyName.trim()) return;
    keySaving = true;
    const result = await apiFetch('/api/v1/settings/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: newKeyName }),
    });
    generatedKey = result.key;
    showNewKeyForm = false;
    newKeyName = '';
    await loadApiKeys();
    keySaving = false;
  }

  async function revokeKey(id: number) {
    if (!confirm('Revoke this API key? Apps using it will lose access immediately.')) return;
    await apiFetch(`/api/v1/settings/api-keys/${id}`, { method: 'DELETE' });
    await loadApiKeys();
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function maskKey(prefix: string, suffix: string) {
    return `${prefix}${'*'.repeat(11)}${suffix}`;
  }

  // ── Tenant / Branding Settings ─────────────────────────────────────────────
  let tenantCfg: TenantCfg = { company_name: '', timezone: 'America/New_York', time_format: 'h:mm tt', date_format: 'MM/dd/yyyy', logo_url: '', primary_color: '#1d4ed8', portal_name: '', email_tags: '[]', theme: 'navy' };
  let tenantLoading = false;
  let tenantSaving = false;
  let tenantSaved = false;

  const timezones = [
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Phoenix','America/Anchorage','Pacific/Honolulu',
    'Europe/London','Europe/Paris','Europe/Berlin','Europe/Amsterdam',
    'Asia/Tokyo','Asia/Singapore','Asia/Dubai','Australia/Sydney',
  ];
  const timeFormats = [
    { value: 'h:mm tt', label: 'h:mm tt  (5:01 PM)' },
    { value: 'HH:mm',   label: 'HH:mm    (17:01)' },
  ];
  const dateFormats = [
    { value: 'MM/dd/yyyy', label: 'MM/dd/yyyy  (02/05/2022)' },
    { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy  (05/02/2022)' },
    { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd  (2022-02-05)' },
  ];

  async function loadTenantSettings() {
    tenantLoading = true;
    tenantCfg = await apiFetch('/api/v1/settings/tenant');
    // Apply loaded theme immediately
    applyTheme(tenantCfg.theme ?? 'navy');
    tenantLoading = false;
  }

  async function saveTenantSettings() {
    tenantSaving = true;
    await apiFetch('/api/v1/settings/tenant', { method: 'PUT', body: JSON.stringify(tenantCfg) });
    tenantSaving = false;
    tenantSaved = true;
    // Apply theme live without page reload
    applyTheme(tenantCfg.theme ?? 'navy');
    setTimeout(() => (tenantSaved = false), 2000);
  }

  function applyTheme(key: string) {
    const t = THEMES[key] ?? THEMES.navy;
    const root = document.documentElement;
    root.style.setProperty('--bp-bg',             t.bg);
    root.style.setProperty('--bp-surface',        t.surface);
    root.style.setProperty('--bp-surface-2',      t.surface2);
    root.style.setProperty('--bp-text',           t.text);
    root.style.setProperty('--bp-text-bright',    t.textBright);
    root.style.setProperty('--bp-text-muted',     t.textMuted);
    root.style.setProperty('--bp-border',         t.border);
    root.style.setProperty('--bp-sidebar',        t.sidebar);
    root.style.setProperty('--bp-sidebar-border', t.sidebarBorder);
    root.style.setProperty('--bp-sidebar-text',   t.sidebarText);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  let tags: EmailTag[] = [];
  let tagsSaving = false;
  let showAddTag = false;
  let newTag: EmailTag = { pattern: '', status: 'success', description: '' };
  const tagStatuses = [
    { value: 'success', label: 'Success' },
    { value: 'failed',  label: 'Failed' },
    { value: 'warning', label: 'Warning' },
    { value: 'unknown', label: 'Unknown' },
  ];
  const statusColors: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    failed:  'bg-red-100 text-red-700',
    warning: 'bg-amber-100 text-amber-700',
    unknown: 'bg-gray-100 text-gray-600',
  };

  function parseTags() {
    try { tags = JSON.parse(tenantCfg.email_tags || '[]'); } catch { tags = []; }
  }

  async function commitTags() {
    tagsSaving = true;
    await apiFetch('/api/v1/settings/tenant', { method: 'PUT', body: JSON.stringify({ email_tags: JSON.stringify(tags) }) });
    tagsSaving = false;
  }

  async function addTag() {
    if (!newTag.pattern.trim()) return;
    tags = [...tags, { ...newTag }];
    await commitTags();
    newTag = { pattern: '', status: 'success', description: '' };
    showAddTag = false;
  }

  async function removeTag(i: number) {
    if (!confirm('Remove this tag?')) return;
    tags = tags.filter((_, idx) => idx !== i);
    await commitTags();
  }


  // ── SMTP ──────────────────────────────────────────────────────────────────
  let smtpConfigs: SmtpRecord[] = [];
  let smtpLoading = false;
  let smtpLoadErr = '';
  let showSmtpForm = false;
  let smtpSaving = false;
  let smtpSaveErr = '';
  let smtpTestResult: Record<number, string> = {};
  let alertSmtpId: number | '' = '';
  let alertSmtpSaving = false;
  let alertSmtpMsg = '';
  let newSmtp = { config_type: 'smtp', from_name: '', from_email: '', smtp_host: '', smtp_port: 587, username: '', password: '', use_tls: true, azure_tenant_id: '', m365_client_id: '', m365_client_secret: '', is_default: false };
  let editingSmtpId: number | null = null;

  async function loadSmtp() {
    smtpLoading = true;
    smtpLoadErr = '';
    try {
      smtpConfigs = await apiFetch('/api/v1/settings/smtp');
      const defaultCfg = smtpConfigs.find(c => c.is_default);
      if (defaultCfg) alertSmtpId = defaultCfg.id;
    } catch (e: unknown) {
      smtpLoadErr = e instanceof Error ? e.message : 'Failed to load SMTP configs';
    } finally {
      smtpLoading = false;
    }
  }

  async function saveAlertSmtp() {
    if (!alertSmtpId) return;
    alertSmtpSaving = true;
    alertSmtpMsg = '';
    try {
      await apiFetch(`/api/v1/settings/smtp/${alertSmtpId}/set-default`, { method: 'PATCH' });
      alertSmtpMsg = 'Saved';
      await loadSmtp();
    } catch (e: unknown) {
      alertSmtpMsg = e instanceof Error ? e.message : 'Failed to save';
    } finally {
      alertSmtpSaving = false;
    }
  }

  function startEditSmtp(cfg: SmtpRecord) {
    editingSmtpId = cfg.id;
    newSmtp = {
      config_type: cfg.config_type, from_name: cfg.from_name, from_email: cfg.from_email,
      smtp_host: cfg.smtp_host ?? '', smtp_port: cfg.smtp_port, username: cfg.username ?? '',
      password: '', use_tls: cfg.use_tls,
      azure_tenant_id: cfg.azure_tenant_id ?? '', m365_client_id: cfg.m365_client_id ?? '',
      m365_client_secret: '', is_default: cfg.is_default,
    };
    showSmtpForm = true;
    smtpSaveErr = '';
  }

  async function saveSmtp() {
    smtpSaving = true;
    smtpSaveErr = '';
    try {
      if (editingSmtpId) {
        await apiFetch(`/api/v1/settings/smtp/${editingSmtpId}`, { method: 'PATCH', body: JSON.stringify(newSmtp) });
      } else {
        await apiFetch('/api/v1/settings/smtp', { method: 'POST', body: JSON.stringify(newSmtp) });
      }
      showSmtpForm = false;
      editingSmtpId = null;
      newSmtp = { config_type: 'smtp', from_name: '', from_email: '', smtp_host: '', smtp_port: 587, username: '', password: '', use_tls: true, azure_tenant_id: '', m365_client_id: '', m365_client_secret: '', is_default: false };
      await loadSmtp();
    } catch (e: unknown) {
      smtpSaveErr = e instanceof Error ? e.message : 'Failed to save';
    } finally {
      smtpSaving = false;
    }
  }

  async function deleteSmtp(id: number) {
    if (!confirm('Delete this email configuration?')) return;
    try {
      await apiFetch(`/api/v1/settings/smtp/${id}`, { method: 'DELETE' });
      await loadSmtp();
    } catch (e: unknown) {
      smtpLoadErr = e instanceof Error ? e.message : 'Failed to delete';
    }
  }

  async function toggleSmtpActive(id: number) {
    try {
      await apiFetch(`/api/v1/settings/smtp/${id}/toggle-active`, { method: 'PATCH' });
      await loadSmtp();
    } catch (e: unknown) {
      smtpLoadErr = e instanceof Error ? e.message : 'Failed to update';
    }
  }

  async function testSmtp(id: number) {
    smtpTestResult = { ...smtpTestResult, [id]: 'testing…' };
    try {
      await apiFetch(`/api/v1/settings/smtp/${id}/test`, { method: 'POST' });
      smtpTestResult = { ...smtpTestResult, [id]: 'ok' };
      await loadSmtp();
    } catch (e: unknown) {
      smtpTestResult = { ...smtpTestResult, [id]: e instanceof Error ? e.message : 'error' };
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  let users: UserRecord[] = [];
  let usersLoading = false;
  let allOrgs: OrgOption[] = [];
  let showTeamForm = false;
  let showClientForm = false;
  let userError = '';
  let newTeamUser = { email: '', display_name: '', password: '', role: 'msp_admin' };
  let newClientUser = { email: '', display_name: '', password: '', org_id: null as number | null };

  $: teamUsers   = users.filter(u => ['super_admin','tenant_admin','msp_admin'].includes(u.role) || (u.role === 'viewer' && u.org_id === null));
  $: clientUsers = users.filter(u => u.role === 'viewer' && u.org_id !== null);

  const roleLabels: Record<string, string> = {
    super_admin:  'Super Admin',
    tenant_admin: 'Tenant Admin',
    msp_admin:    'MSP Admin',
    viewer:       'Viewer',
  };

  async function loadUsers() {
    usersLoading = true;
    [users, allOrgs] = await Promise.all([
      apiFetch('/api/v1/settings/users'),
      apiFetch('/api/v1/manage/companies'),
    ]);
    usersLoading = false;
  }

  async function saveTeamUser() {
    userError = '';
    try {
      await apiFetch('/api/v1/settings/users', { method: 'POST', body: JSON.stringify({ ...newTeamUser, org_id: null }) });
      showTeamForm = false;
      newTeamUser = { email: '', display_name: '', password: '', role: 'msp_admin' };
      await loadUsers();
    } catch (e: unknown) { userError = e instanceof Error ? e.message : String(e); }
  }

  async function saveClientUser() {
    userError = '';
    if (!newClientUser.org_id) { userError = 'Please select a client organisation.'; return; }
    try {
      await apiFetch('/api/v1/settings/users', { method: 'POST', body: JSON.stringify({ ...newClientUser, role: 'viewer' }) });
      showClientForm = false;
      newClientUser = { email: '', display_name: '', password: '', org_id: null };
      await loadUsers();
    } catch (e: unknown) { userError = e instanceof Error ? e.message : String(e); }
  }

  // ── User edit ────────────────────────────────────────────────────────────
  let editingUserId: number | null = null;
  let editUserForm: { display_name: string; email: string; role: string; new_password: string } | null = null;
  let userEditSaving = false;
  let userEditError = '';

  function startEditUser(u: UserRecord) {
    editingUserId = u.id;
    editUserForm = { display_name: u.display_name, email: u.email, role: u.role, new_password: '' };
    userEditError = '';
  }

  function cancelEditUser() {
    editingUserId = null;
    editUserForm = null;
    userEditError = '';
  }

  async function saveEditUser() {
    if (!editUserForm || editingUserId === null) return;
    userEditSaving = true;
    userEditError = '';
    try {
      const payload: Record<string, string> = {
        display_name: editUserForm.display_name,
        email: editUserForm.email,
        role: editUserForm.role,
      };
      if (editUserForm.new_password) payload.new_password = editUserForm.new_password;
      await apiFetch('/api/v1/settings/users/' + editingUserId, { method: 'PUT', body: JSON.stringify(payload) });
      editingUserId = null;
      editUserForm = null;
      await loadUsers();
    } catch (e: unknown) {
      userEditError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      userEditSaving = false;
    }
  }

  async function deactivateUser(id: number, name: string) {
    if (!confirm('Deactivate ' + name + '?')) return;
    await apiFetch('/api/v1/settings/users/' + id, { method: 'DELETE' });
    await loadUsers();
  }

  // ── Tab loading ───────────────────────────────────────────────────────────
  async function setTab(t: string) {
    tab = t as TabKey;
    tabError = '';
    // Always refresh billing data directly so plan_name is current
    if (t === 'billing') {
      try {
        const fresh = await api.me();
        auth.updateUser(fresh);
        billingPlanName = fresh.plan_name;
        billingFlags = fresh.feature_flags ?? {};
      } catch { /* ignore */ }
      return;
    }
    if (tabLoaded.has(t as TabKey)) return;
    tabLoaded.add(t as TabKey);
    try {
      if (t === 'api-keys') { await loadApiKeys(); }
      else if (t === 'branding' || t === 'tenant') { await loadTenantSettings(); }
      else if (t === 'smtp') { await loadSmtp(); }
      else if (t === 'users') { await loadUsers(); }
      else if (t === 'security') { await Promise.allSettled([loadUsers(), loadSecurityGroups()]); }
    } catch (e: unknown) {
      tabError = e instanceof Error ? e.message : String(e);
    }
  }

  const ALL_SETTING_TABS = [
    { key: 'api-keys',  label: 'API Keys',          featureKey: 'api_access' },
    { key: 'branding',  label: 'Branding',           featureKey: 'white_label' },
    { key: 'tenant',    label: 'Tenant',              featureKey: null },
    { key: 'smtp',      label: 'SMTP',                featureKey: null },
    { key: 'billing',   label: 'Billing',             featureKey: null },
    { key: 'invoices',  label: 'Invoices',            featureKey: null },
    { key: 'users',     label: 'User Management',     featureKey: null },
    { key: 'security',  label: 'Security Roles',      featureKey: null },
  ];

  function settingFeatureEnabled(key: string | null): boolean {
    if (!key || !$auth) return true;
    const flags = $auth.feature_flags ?? {};
    if (Object.keys(flags).length === 0) return true;
    if (!(key in flags)) return true;
    return flags[key] === true;
  }

  $: visibleSettingTabs = ALL_SETTING_TABS.filter(t => settingFeatureEnabled(t.featureKey));

  onMount(async () => {
    // Refresh auth so plan_name + feature_flags are current before rendering
    try {
      const fresh = await api.me();
      auth.updateUser(fresh);
      billingPlanName = fresh.plan_name;
      billingFlags = fresh.feature_flags ?? {};
    } catch { /* ignore */ }
    // Start on first visible tab (api-keys may be gated off)
    const first = ALL_SETTING_TABS.find(t => settingFeatureEnabled(t.featureKey));
    setTab(first?.key ?? 'tenant');
  });
</script>

<div class="space-y-6">
  <h1 class="text-2xl font-bold text-gray-900">Settings</h1>

  {#if tabError}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{tabError}</div>
  {/if}

  <!-- Tab bar -->
  <div class="border-b border-gray-200 flex gap-1 flex-wrap">
    {#each visibleSettingTabs as item}
      <button
        on:click={() => setTab(item.key)}
        class="px-4 pb-2 pt-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
          {tab === item.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}"
      >{item.label}</button>
    {/each}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════ API KEYS -->
  {#if tab === 'api-keys'}
    <div class="space-y-6 max-w-3xl">
      <!-- Generated key banner (show once) -->
      {#if generatedKey}
        <div class="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <p class="text-sm font-semibold text-amber-800 mb-2">Copy your API key now — it will not be shown again.</p>
          <div class="flex items-center gap-3">
            <code class="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono break-all">{generatedKey}</code>
            <button on:click={() => copyText(generatedKey ?? '')} class="btn-secondary text-xs whitespace-nowrap">Copy</button>
            <button on:click={() => generatedKey = null} class="text-amber-500 hover:text-amber-700 text-lg leading-none">&times;</button>
          </div>
        </div>
      {/if}

      <div class="bg-white rounded-lg shadow p-6 space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-gray-900">BackupPulse API</h2>
            <p class="text-xs text-brand-600 mt-0.5">
              <a href="https://docs.backuppulse.io/api" target="_blank" class="hover:underline">API Documentation ↗</a>
            </p>
          </div>
          <button class="btn-secondary text-sm" on:click={() => showNewKeyForm = !showNewKeyForm}>+ Generate Key</button>
        </div>

        {#if showNewKeyForm}
          <form class="flex gap-3 items-end p-4 bg-gray-50 rounded-lg border" on:submit|preventDefault={generateKey}>
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">Key Name / Description</label>
              <input bind:value={newKeyName} required placeholder="e.g. Production Integration"
                class="w-full border rounded px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" disabled={keySaving} class="btn-secondary text-sm">
              {keySaving ? 'Generating…' : 'Generate'}
            </button>
            <button type="button" class="btn-secondary text-sm" on:click={() => showNewKeyForm = false}>Cancel</button>
          </form>
        {/if}

        {#if keysLoading}
          <p class="text-sm text-gray-400">Loading…</p>
        {:else if apiKeys.length === 0}
          <p class="text-sm text-gray-400 italic">No API keys yet. Generate one above.</p>
        {:else}
          <div class="space-y-3">
            {#each apiKeys as k}
              <div class="flex items-center justify-between border rounded-lg px-4 py-3 bg-gray-50">
                <div class="space-y-0.5">
                  <p class="text-xs text-gray-500 font-medium">{k.name}</p>
                  <div class="flex items-center gap-2">
                    <code class="text-sm font-mono text-gray-800">{maskKey(k.key_prefix, k.key_suffix)}</code>
                    <button on:click={() => copyText(maskKey(k.key_prefix, k.key_suffix))} title="Copy masked key"
                      class="text-gray-400 hover:text-gray-600">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                      </svg>
                    </button>
                  </div>
                  <p class="text-xs text-gray-400">
                    Created {new Date(k.created_at).toLocaleDateString()}
                    {#if k.last_used_at} · Last used {new Date(k.last_used_at).toLocaleDateString()}{/if}
                  </p>
                </div>
                <button on:click={() => revokeKey(k.id)} class="text-xs text-red-500 hover:text-red-700 font-medium">Revoke</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════════ BRANDING -->
  {:else if tab === 'branding'}
    <div class="max-w-3xl space-y-6">
      {#if tenantLoading}
        <p class="text-sm text-gray-400">Loading…</p>
      {:else}
        <!-- ── Portal identity ─────────────────────────────────────── -->
        <div class="bg-white rounded-lg shadow p-6 space-y-5">
          <h2 class="text-base font-semibold text-gray-900">White-Label Branding</h2>
          <p class="text-sm text-gray-500">Customise how BackupPulse appears to your MSP and client users.</p>

          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Portal Name</label>
              <input bind:value={tenantCfg.portal_name} placeholder="e.g. IT By Design Backup Portal"
                class="w-full border rounded px-3 py-2 text-sm" />
              <p class="text-xs text-gray-400 mt-1">Shown in the browser title and header.</p>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Primary Colour</label>
              <div class="flex items-center gap-2">
                <input type="color" bind:value={tenantCfg.primary_color} class="h-9 w-14 rounded border cursor-pointer" />
                <input bind:value={tenantCfg.primary_color} placeholder="#1d4ed8"
                  class="flex-1 border rounded px-3 py-2 text-sm font-mono" />
              </div>
              <p class="text-xs text-gray-400 mt-1">Used for buttons, active states and highlights.</p>
            </div>
            <div class="col-span-2">
              <label class="block text-xs font-medium text-gray-600 mb-1">Logo URL</label>
              <input bind:value={tenantCfg.logo_url} type="url" placeholder="https://cdn.yourcompany.com/logo.png"
                class="w-full border rounded px-3 py-2 text-sm" />
              <p class="text-xs text-gray-400 mt-1">Publicly accessible PNG or SVG. Recommended: 200×50 px.</p>
            </div>
            {#if tenantCfg.logo_url}
              <div class="col-span-2">
                <p class="text-xs text-gray-500 mb-2">Preview:</p>
                <div class="border rounded p-4 bg-gray-50 inline-block">
                  <img src={tenantCfg.logo_url} alt="Logo preview" class="max-h-12 max-w-48 object-contain" />
                </div>
                <button on:click={() => tenantCfg.logo_url = ''} class="ml-3 text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            {/if}
          </div>
        </div>

        <!-- ── Theme picker ────────────────────────────────────────── -->
        <div class="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <h2 class="text-base font-semibold text-gray-900">UI Theme</h2>
            <p class="text-sm text-gray-500 mt-1">Choose a dark theme for the portal. Changes apply immediately after saving.</p>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {#each Object.entries(THEMES) as [key, t]}
              {@const selected = tenantCfg.theme === key}
              <button
                type="button"
                on:click={() => tenantCfg.theme = key}
                class="relative rounded-lg p-3 text-left transition-all border-2 focus:outline-none"
                style="
                  background-color: {t.surface};
                  border-color: {selected ? 'var(--bp-primary)' : t.border};
                  box-shadow: {selected ? '0 0 0 1px var(--bp-primary)' : 'none'};
                "
              >
                <!-- Mini preview -->
                <div class="flex gap-1 mb-2">
                  <div class="w-5 h-8 rounded-sm flex-shrink-0" style="background-color:{t.sidebar}"></div>
                  <div class="flex-1 rounded-sm flex flex-col gap-1 p-1" style="background-color:{t.bg}">
                    <div class="h-1.5 rounded-sm w-full" style="background-color:{t.surface2}"></div>
                    <div class="h-1.5 rounded-sm w-3/4" style="background-color:{t.surface2}"></div>
                  </div>
                </div>
                <!-- Colour dots -->
                <div class="flex gap-1 mb-2">
                  <div class="w-3 h-3 rounded-full border" style="background:{t.bg};    border-color:{t.border}" title="Background"></div>
                  <div class="w-3 h-3 rounded-full border" style="background:{t.surface};border-color:{t.border}" title="Surface"></div>
                  <div class="w-3 h-3 rounded-full border" style="background:{t.text};  border-color:{t.border}" title="Text"></div>
                  <div class="w-3 h-3 rounded-full border" style="background:{t.sidebar};border-color:{t.border}" title="Sidebar"></div>
                </div>
                <p class="text-xs font-medium" style="color:{t.text}">{t.name}</p>
                {#if selected}
                  <div class="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style="background-color:var(--bp-primary)">✓</div>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="flex gap-3">
          <button on:click={saveTenantSettings} disabled={tenantSaving} class="btn-secondary">
            {tenantSaving ? 'Saving…' : tenantSaved ? '✓ Saved' : 'Save Branding'}
          </button>
        </div>
      {/if}
    </div>

  <!-- ════════════════════════════════════════════════════════════════ TENANT -->
  {:else if tab === 'tenant'}
    <div class="max-w-4xl space-y-6">
      {#if tenantLoading}
        <p class="text-sm text-gray-400">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-6">
          <!-- Left: Custom Logo -->
          <div class="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 class="text-base font-semibold text-gray-900">Custom Logo</h2>
            {#if tenantCfg.logo_url}
              <div class="border rounded p-4 bg-gray-50 flex items-center justify-center min-h-20">
                <img src={tenantCfg.logo_url} alt="Company logo" class="max-h-16 max-w-full object-contain" />
              </div>
              <div class="flex gap-2">
                <button class="btn-secondary text-sm" on:click={() => { tenantCfg.logo_url = ''; saveTenantSettings(); }}>Delete</button>
              </div>
            {:else}
              <div class="border-2 border-dashed border-gray-200 rounded p-6 text-center text-gray-400 text-sm">
                No logo set.<br/>Set a Logo URL in the Branding tab.
              </div>
            {/if}
          </div>

          <!-- Right: Basic Settings -->
          <div class="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 class="text-base font-semibold text-gray-900">Basic Settings</h2>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Select time zone</label>
              <select bind:value={tenantCfg.timezone} class="w-full border rounded px-3 py-2 text-sm">
                {#each timezones as tz}
                  <option value={tz}>{tz.replace('_', ' ')}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Select time format</label>
              <select bind:value={tenantCfg.time_format} class="w-full border rounded px-3 py-2 text-sm">
                {#each timeFormats as f}
                  <option value={f.value}>{f.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Select date format</label>
              <select bind:value={tenantCfg.date_format} class="w-full border rounded px-3 py-2 text-sm">
                {#each dateFormats as f}
                  <option value={f.value}>{f.label}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>

        <!-- Company Name -->
        <div class="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <h2 class="text-base font-semibold text-gray-900">Company Name</h2>
            <p class="text-sm text-gray-500 mt-1">How we will refer to your company when providing support.</p>
          </div>
          <div class="max-w-sm">
            <label class="block text-xs text-gray-500 mb-1">Company Name</label>
            <input bind:value={tenantCfg.company_name} placeholder="e.g. IT By Design"
              class="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <button on:click={saveTenantSettings} disabled={tenantSaving}
            class="bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-5 py-2 rounded transition-colors disabled:opacity-60">
            {tenantSaving ? 'Saving…' : tenantSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      {/if}
    </div>

  <!-- ══════════════════════════════════════════════════════════════════ SMTP -->
  {:else if tab === 'smtp'}
    <div class="max-w-4xl space-y-6">
      <!-- Custom Email Settings -->
      <div class="bg-white rounded-lg shadow overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b">
          <h2 class="text-base font-semibold text-gray-900">Custom Email Settings</h2>
          <button class="btn-secondary text-sm" on:click={() => { editingSmtpId = null; newSmtp = { config_type: 'smtp', from_name: '', from_email: '', smtp_host: '', smtp_port: 587, username: '', password: '', use_tls: true, azure_tenant_id: '', m365_client_id: '', m365_client_secret: '', is_default: false }; showSmtpForm = !showSmtpForm; smtpSaving = false; smtpSaveErr = ''; }}>Configure New Email</button>
        </div>

        {#if showSmtpForm}
          <form class="px-5 py-4 bg-blue-50 border-b grid grid-cols-2 gap-4" on:submit|preventDefault={saveSmtp}>
            <!-- Type selector -->
            <div class="col-span-2">
              <label class="block text-xs text-gray-500 mb-2">Connection Type</label>
              <div class="flex gap-3">
                <label class="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded border {newSmtp.config_type === 'smtp' ? 'bg-white border-blue-400 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-600'}">
                  <input type="radio" bind:group={newSmtp.config_type} value="smtp" class="accent-blue-600" />
                  SMTP Server
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded border {newSmtp.config_type === 'microsoft365' ? 'bg-white border-blue-400 text-blue-700 font-medium' : 'bg-white border-gray-200 text-gray-600'}">
                  <input type="radio" bind:group={newSmtp.config_type} value="microsoft365" class="accent-blue-600" />
                  Microsoft 365 (Graph API)
                </label>
              </div>
            </div>
            <!-- Common fields -->
            <div>
              <label class="block text-xs text-gray-500 mb-1">From Name <span class="text-red-500">*</span></label>
              <input bind:value={newSmtp.from_name} required placeholder="BackupPulse Alerts"
                class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">From Email <span class="text-red-500">*</span></label>
              <input bind:value={newSmtp.from_email} type="email" required placeholder="alerts@yourcompany.com"
                class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <!-- SMTP-specific fields -->
            {#if newSmtp.config_type === 'smtp'}
              <div>
                <label class="block text-xs text-gray-500 mb-1">SMTP Host <span class="text-red-500">*</span></label>
                <input bind:value={newSmtp.smtp_host} required placeholder="smtp.office365.com"
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Port</label>
                <input bind:value={newSmtp.smtp_port} type="number" min="1" max="65535"
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Username</label>
                <input bind:value={newSmtp.username} placeholder="alerts@yourcompany.com"
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Password</label>
                <input bind:value={newSmtp.password} type="password"
                  class="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div class="col-span-2">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" bind:checked={newSmtp.use_tls} class="rounded" />
                  Use TLS / STARTTLS
                </label>
              </div>
            {/if}
            <!-- Microsoft 365-specific fields -->
            {#if newSmtp.config_type === 'microsoft365'}
              <div>
                <label class="block text-xs text-gray-500 mb-1">Azure Tenant ID <span class="text-red-500">*</span></label>
                <input bind:value={newSmtp.azure_tenant_id} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  class="w-full border rounded px-2 py-1.5 text-sm font-mono" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">App (Client) ID <span class="text-red-500">*</span></label>
                <input bind:value={newSmtp.m365_client_id} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  class="w-full border rounded px-2 py-1.5 text-sm font-mono" />
              </div>
              <div class="col-span-2">
                <label class="block text-xs text-gray-500 mb-1">Client Secret <span class="text-red-500">*</span></label>
                <input bind:value={newSmtp.m365_client_secret} type="password" required placeholder="Azure app client secret"
                  class="w-full border rounded px-2 py-1.5 text-sm" />
                <p class="text-xs text-gray-400 mt-1">Requires <code>Mail.Send</code> application permission on the Azure app registration.</p>
              </div>
            {/if}
            <!-- Default checkbox -->
            <div class="col-span-2">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" bind:checked={newSmtp.is_default} class="rounded" />
                Set as default (used for reports and alert notifications)
              </label>
            </div>
            {#if smtpSaveErr}
              <div class="col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {smtpSaveErr}
              </div>
            {/if}
            <div class="col-span-2 flex gap-2">
              <button type="submit" disabled={smtpSaving} class="btn-secondary text-sm">
                {smtpSaving ? 'Saving…' : editingSmtpId ? 'Update' : 'Save'}
              </button>
              <button type="button" class="btn-secondary text-sm" on:click={() => { showSmtpForm = false; editingSmtpId = null; smtpSaveErr = ''; }}>Cancel</button>
            </div>
          </form>
        {/if}

        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">From</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Server</th>
              <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase text-center">Enabled</th>
              <th class="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#if smtpLoading}
              <tr><td colspan="6" class="px-5 py-6 text-center text-gray-400">Loading…</td></tr>
            {:else if smtpConfigs.length === 0}
              <tr><td colspan="6" class="px-5 py-8 text-center text-gray-400">No Items</td></tr>
            {:else}
              {#each smtpConfigs as cfg}
                <tr class="border-b border-gray-100 {cfg.is_active ? '' : 'opacity-50'}">
                  <td class="px-5 py-3 font-medium text-gray-900">
                    {cfg.from_name}
                    {#if cfg.is_default}
                      <span class="ml-1 text-xs bg-brand-700 text-white px-1.5 py-0.5 rounded">default</span>
                    {/if}
                    {#if cfg.config_type === 'microsoft365'}
                      <span class="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">M365</span>
                    {/if}
                  </td>
                  <td class="px-5 py-3 text-gray-600">{cfg.from_email}</td>
                  <td class="px-5 py-3 text-gray-500 text-xs">
                    {#if cfg.config_type === 'microsoft365'}
                      <span class="text-blue-600">Graph API · {cfg.m365_client_id?.slice(0,8)}…</span>
                    {:else}
                      {cfg.smtp_host}:{cfg.smtp_port}
                    {/if}
                  </td>
                  <td class="px-5 py-3 text-center">
                    {#if smtpTestResult[cfg.id] === 'testing…'}
                      <span class="text-xs text-gray-400">Testing…</span>
                    {:else if smtpTestResult[cfg.id] === 'ok' || cfg.is_verified}
                      <span class="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Verified</span>
                    {:else if smtpTestResult[cfg.id]}
                      <span class="text-xs text-red-600 max-w-xs truncate block" title={smtpTestResult[cfg.id]}>Failed</span>
                    {:else}
                      <span class="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Not tested</span>
                    {/if}
                  </td>
                  <td class="px-5 py-3 text-center">
                    <input type="checkbox" checked={cfg.is_active}
                      on:change={() => toggleSmtpActive(cfg.id)}
                      class="w-4 h-4 accent-brand-600 cursor-pointer" />
                  </td>
                  <td class="px-5 py-3 text-center">
                    <div class="flex justify-center gap-3">
                      <button class="text-xs text-blue-600 hover:text-blue-800" on:click={() => testSmtp(cfg.id)}>Test</button>
                      <button class="text-xs text-gray-500 hover:text-gray-800" on:click={() => startEditSmtp(cfg)}>Edit</button>
                      <button class="text-xs text-red-500 hover:text-red-700" on:click={() => deleteSmtp(cfg.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      <!-- Alert on Failure Email -->
      <div class="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 class="text-base font-semibold text-gray-900">Alert On Failure Email</h2>
        <p class="text-sm text-gray-500">Select which email configuration to use when sending backup failure alerts.</p>
        <div class="max-w-sm">
          <label class="block text-xs text-gray-500 mb-1">Select email alert</label>
          <select bind:value={alertSmtpId} class="w-full border rounded px-3 py-2 text-sm">
            <option value="">— Select email alert —</option>
            {#each smtpConfigs as cfg}
              <option value={cfg.id}>{cfg.from_name} &lt;{cfg.from_email}&gt;</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-3">
          <button
            on:click={saveAlertSmtp}
            disabled={alertSmtpSaving || !alertSmtpId}
            class="bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-5 py-2 rounded transition-colors disabled:opacity-50"
          >
            {alertSmtpSaving ? 'Saving…' : 'Save'}
          </button>
          {#if alertSmtpMsg}
            <span class="text-sm {alertSmtpMsg === 'Saved' ? 'text-green-600' : 'text-red-600'}">
              {alertSmtpMsg}
            </span>
          {/if}
        </div>
      </div>
    </div>

  <!-- ════════════════════════════════════════════════════════════ BILLING -->
  {:else if tab === 'billing'}
    <div class="max-w-2xl space-y-5">
      <!-- Plan name header -->
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-start justify-between mb-5">
          <div>
            <h2 class="text-base font-semibold text-gray-900">Subscription Plan</h2>
            {#if billingPlanName}
              <p class="text-sm text-gray-500 mt-1">
                You are subscribed to the
                <span class="font-semibold text-brand-700">{billingPlanName}</span> plan.
              </p>
            {:else}
              <p class="text-sm text-gray-400 mt-1 italic">
                No plan assigned. Contact your platform administrator.
              </p>
            {/if}
          </div>
          {#if billingPlanName}
            <span class="text-xs px-3 py-1 rounded-full font-semibold" style="background:#ADD8E6; color:#111;">
              {billingPlanName}
            </span>
          {/if}
        </div>

        <!-- Feature list -->
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Features</p>
        <div class="divide-y divide-gray-100">
          {#each FEATURES as f}
            {@const included = billingFlags[f.key] !== false}
            <div class="flex items-center justify-between py-3">
              <span class="text-sm text-gray-700">{f.label}</span>
              {#if included}
                <span class="flex items-center gap-1.5 text-xs font-medium text-green-600">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  </svg>
                  Included
                </span>
              {:else}
                <span class="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  Not included
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
        <p class="text-sm text-blue-700">
          Need to upgrade or change your plan? <a href="mailto:support@backuppulse.io" class="font-semibold underline hover:text-blue-900">Contact Our Support</a>.
        </p>
      </div>
    </div>

  <!-- ════════════════════════════════════════════════════════════ INVOICES -->
  {:else if tab === 'invoices'}
    <div class="bg-white rounded-lg shadow p-8 text-center max-w-lg mx-auto mt-8">
      <h2 class="text-lg font-semibold text-gray-700 mb-2">Invoices</h2>
      <p class="text-gray-400 text-sm">Invoice history and downloads coming soon.</p>
    </div>

  <!-- ════════════════════════════════════════════════ USER MANAGEMENT -->
  {:else if tab === 'users'}
    {#if usersLoading}
      <p class="text-sm text-gray-400">Loading…</p>
    {:else}
      {#if userError}
        <div class="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{userError}</div>
      {/if}

      <!-- Section 1: BackupPulse Team -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-gray-900">BackupPulse Technical Team</h2>
            <p class="text-xs text-gray-500 mt-0.5">MSP admins and technicians who manage all client backups.</p>
          </div>
          <button class="btn-secondary text-sm" on:click={() => { showTeamForm = !showTeamForm; showClientForm = false; }}>+ Add Team Member</button>
        </div>

        {#if showTeamForm}
          <form class="bg-blue-50 border border-blue-100 rounded-lg p-4 grid grid-cols-2 gap-3" on:submit|preventDefault={saveTeamUser}>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Email <span class="text-red-500">*</span></label>
              <input bind:value={newTeamUser.email} type="email" required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Display Name <span class="text-red-500">*</span></label>
              <input bind:value={newTeamUser.display_name} required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Password <span class="text-red-500">*</span></label>
              <input bind:value={newTeamUser.password} type="password" required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Role</label>
              <select bind:value={newTeamUser.role} class="w-full border rounded px-2 py-1.5 text-sm">
                <option value="msp_admin">MSP Admin — sees all clients</option>
                <option value="tenant_admin">Tenant Admin — full access</option>
                <option value="viewer">Viewer — read-only, all clients</option>
              </select>
            </div>
            <div class="col-span-2 flex gap-2">
              <button type="submit" class="btn-secondary text-sm">Add User</button>
              <button type="button" class="btn-secondary text-sm" on:click={() => showTeamForm = false}>Cancel</button>
            </div>
          </form>
        {/if}

        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Login</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {#if teamUsers.length === 0}
                <tr><td colspan="5" class="px-4 py-6 text-center text-gray-400">No team members.</td></tr>
              {:else}
                {#each teamUsers as u}
                  {#if editingUserId === u.id && editUserForm}
                    <tr class="border-b border-blue-100 bg-blue-50">
                      <td colspan="5" class="px-4 py-4">
                        {#if userEditError}
                          <p class="text-xs text-red-600 mb-2">{userEditError}</p>
                        {/if}
                        <div class="grid grid-cols-2 gap-3">
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Display Name</label>
                            <input bind:value={editUserForm.display_name} class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Email</label>
                            <input bind:value={editUserForm.email} type="email" class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Role</label>
                            <select bind:value={editUserForm.role} class="w-full border rounded px-2 py-1.5 text-sm">
                              <option value="tenant_admin">Tenant Admin</option>
                              <option value="msp_admin">MSP Admin</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">New Password <span class="text-gray-400">(leave blank to keep current)</span></label>
                            <input bind:value={editUserForm.new_password} type="password" placeholder="Leave blank to keep current" class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div class="col-span-2 flex gap-2">
                            <button class="btn-secondary text-sm" on:click={saveEditUser} disabled={userEditSaving}>{userEditSaving ? 'Saving…' : 'Save'}</button>
                            <button class="btn-secondary text-sm" on:click={cancelEditUser}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  {:else}
                    <tr class="border-b border-gray-100">
                      <td class="px-4 py-3 font-medium text-gray-900">{u.display_name}</td>
                      <td class="px-4 py-3 text-gray-600">{u.email}</td>
                      <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded-full text-xs font-medium" style="background:#ADD8E6; color:#111;">
                          {roleLabels[u.role] ?? u.role}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-gray-400 text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td>
                      <td class="px-4 py-3 text-right">
                        <button class="text-blue-500 hover:text-blue-700 text-xs mr-3" on:click={() => startEditUser(u)}>Edit</button>
                        <button class="text-red-500 hover:text-red-700 text-xs" on:click={() => deactivateUser(u.id, u.display_name)}>Deactivate</button>
                      </td>
                    </tr>
                  {/if}
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 2: Client Portal Users -->
      <div class="space-y-3 mt-8">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-gray-900">Client Portal Users</h2>
            <p class="text-xs text-gray-500 mt-0.5">End-client logins — each user sees only their own organisation's backup status.</p>
          </div>
          <button class="btn-secondary text-sm" on:click={() => { showClientForm = !showClientForm; showTeamForm = false; }}>+ Add Client User</button>
        </div>

        {#if showClientForm}
          <form class="bg-blue-50 border border-blue-100 rounded-lg p-4 grid grid-cols-2 gap-3" on:submit|preventDefault={saveClientUser}>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Email <span class="text-red-500">*</span></label>
              <input bind:value={newClientUser.email} type="email" required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Display Name <span class="text-red-500">*</span></label>
              <input bind:value={newClientUser.display_name} required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Password <span class="text-red-500">*</span></label>
              <input bind:value={newClientUser.password} type="password" required class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Client Organisation <span class="text-red-500">*</span></label>
              <select bind:value={newClientUser.org_id} class="w-full border rounded px-2 py-1.5 text-sm {!newClientUser.org_id ? 'text-gray-400' : ''}">
                <option value={null} disabled selected>— Select Organisation —</option>
                {#each allOrgs as org}
                  <option value={org.id}>{org.name}</option>
                {/each}
              </select>
            </div>
            <div class="col-span-2 text-xs text-gray-500 bg-white border rounded p-2">
              Client users are automatically assigned the <strong>Viewer</strong> role and can only see backup status for their assigned organisation.
            </div>
            <div class="col-span-2 flex gap-2">
              <button type="submit" class="btn-secondary text-sm">Add Client User</button>
              <button type="button" class="btn-secondary text-sm" on:click={() => showClientForm = false}>Cancel</button>
            </div>
          </form>
        {/if}

        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Organisation</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Login</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {#if clientUsers.length === 0}
                <tr><td colspan="5" class="px-4 py-6 text-center text-gray-400">No client portal users.</td></tr>
              {:else}
                {#each clientUsers as u}
                  {#if editingUserId === u.id && editUserForm}
                    <tr class="border-b border-blue-100 bg-blue-50">
                      <td colspan="5" class="px-4 py-4">
                        {#if userEditError}
                          <p class="text-xs text-red-600 mb-2">{userEditError}</p>
                        {/if}
                        <div class="grid grid-cols-2 gap-3">
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Display Name</label>
                            <input bind:value={editUserForm.display_name} class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">Email</label>
                            <input bind:value={editUserForm.email} type="email" class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label class="block text-xs text-gray-500 mb-1">New Password <span class="text-gray-400">(leave blank to keep current)</span></label>
                            <input bind:value={editUserForm.new_password} type="password" placeholder="Leave blank to keep current" class="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div class="col-span-2 flex gap-2">
                            <button class="btn-secondary text-sm" on:click={saveEditUser} disabled={userEditSaving}>{userEditSaving ? 'Saving…' : 'Save'}</button>
                            <button class="btn-secondary text-sm" on:click={cancelEditUser}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  {:else}
                    {@const org = allOrgs.find(o => o.id === u.org_id)}
                    <tr class="border-b border-gray-100">
                      <td class="px-4 py-3 font-medium text-gray-900">{u.display_name}</td>
                      <td class="px-4 py-3 text-gray-600">{u.email}</td>
                      <td class="px-4 py-3 text-gray-500">{org?.name ?? 'Org #' + u.org_id}</td>
                      <td class="px-4 py-3 text-gray-400 text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td>
                      <td class="px-4 py-3 text-right">
                        <button class="text-blue-500 hover:text-blue-700 text-xs mr-3" on:click={() => startEditUser(u)}>Edit</button>
                        <button class="text-red-500 hover:text-red-700 text-xs" on:click={() => deactivateUser(u.id, u.display_name)}>Deactivate</button>
                      </td>
                    </tr>
                  {/if}
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

  <!-- ── SECURITY TAB ── -->
  {:else if tab === 'security'}
    <div style="color: #d1d5db;" class="space-y-8">

      <!-- ── Security Groups ── -->
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
          <div>
            <h2 style="font-size:1rem; font-weight:700; color:#ffffff;">Security Groups</h2>
            <p style="font-size:0.8125rem; color:#9ca3af; margin-top:0.25rem;">
              Define groups with specific permissions. Built-in groups can be edited but not deleted.
            </p>
          </div>
          {#if !showAddGroup}
            <button
              style="background:#0094ba; color:#fff; border:none; border-radius:0.375rem; padding:0.4rem 0.875rem; font-size:0.8125rem; cursor:pointer; white-space:nowrap;"
              on:click={initNewGroupForm}>+ Add Group</button>
          {/if}
        </div>

        {#if sgError}
          <p style="color:#f87171; font-size:0.8125rem; margin-bottom:0.75rem;">
            Could not load security groups — restart the server and refresh. ({sgError})
          </p>
        {/if}

        {#if sgLoading}
          <p style="color:#9ca3af; font-size:0.875rem;">Loading groups…</p>
        {:else}
          <div style="display:flex; flex-direction:column; gap:0.625rem;">
            {#each securityGroups as g}
              {#if editingGroupId === g.id && editGroupForm}
                <!-- ── Edit mode ── -->
                <div style="background:#23233a; border:1px solid #0094ba55; border-radius:0.75rem; padding:1.25rem;">
                  <div style="display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:0.75rem; align-items:end; margin-bottom:1rem;">
                    <div>
                      <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Group name</p>
                      <input type="text" bind:value={editGroupForm.name}
                        style="width:100%; background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.625rem; color:#fff; font-size:0.8125rem; box-sizing:border-box;" />
                    </div>
                    <div>
                      <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Maps to role</p>
                      <select bind:value={editGroupForm.mapped_role}
                        style="width:100%; background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.625rem; color:#fff; font-size:0.8125rem; box-sizing:border-box;">
                        <option value="tenant_admin">Tenant Admin</option>
                        <option value="msp_admin">MSP Admin</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    <div>
                      <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Badge colour</p>
                      <div style="display:flex; align-items:center; gap:0.5rem;">
                        <input type="color" bind:value={editGroupForm.color}
                          style="width:2rem; height:2rem; border:none; border-radius:0.25rem; cursor:pointer; background:none;" />
                        <span style="font-size:0.75rem; color:#9ca3af;">{editGroupForm.color}</span>
                      </div>
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                      <button style="background:#0094ba; color:#fff; border:none; border-radius:0.375rem; padding:0.375rem 0.875rem; font-size:0.8125rem; cursor:pointer;"
                        on:click={saveGroup}>Save</button>
                      <button style="background:#374151; color:#d1d5db; border:none; border-radius:0.375rem; padding:0.375rem 0.75rem; font-size:0.8125rem; cursor:pointer;"
                        on:click={cancelEditGroup}>Cancel</button>
                    </div>
                  </div>
                  <!-- Permissions grid -->
                  <div style="border-top:1px solid #374151; padding-top:0.875rem;">
                    <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.625rem;">Permissions</p>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.5rem; margin-bottom:0.75rem;">
                      {#each PERM_KEYS as k}
                        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.8125rem; color:#d1d5db;">
                          <input type="checkbox" bind:checked={editGroupForm.permissions[k]}
                            style="width:1rem; height:1rem; accent-color:#0094ba; cursor:pointer;" />
                          {PERM_LABELS[k]}
                        </label>
                      {/each}
                    </div>
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.8125rem; color:#d1d5db;">
                      <input type="checkbox" bind:checked={editGroupForm.can_use_api}
                        style="width:1rem; height:1rem; accent-color:#0094ba; cursor:pointer;" />
                      Can authenticate via API Key
                    </label>
                  </div>
                </div>
              {:else}
                <!-- ── View mode ── -->
                <div style="background:#23233a; border:1px solid #374151; border-radius:0.75rem; padding:0.75rem 1rem; display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                  <span style="display:inline-block; font-size:0.6875rem; font-weight:700; border-radius:9999px; padding:2px 10px; white-space:nowrap; flex-shrink:0;
                               background:#ADD8E6; color:#111; border:1px solid #ADD8E6;">
                    {g.name}
                  </span>
                  <span style="font-size:0.75rem; color:#9ca3af; flex-shrink:0;">→ {roleLabels[g.mapped_role] ?? g.mapped_role}</span>
                  <div style="flex:1; display:flex; flex-wrap:wrap; gap:0.3rem; min-width:0;">
                    {#each PERM_KEYS as k}
                      <span style="font-size:0.6875rem; padding:1px 6px; border-radius:9999px; white-space:nowrap;
                                   background:{g.permissions[k] ? '#0f3a2f' : '#1a1a2e'};
                                   color:{g.permissions[k] ? '#4ade80' : '#4b5563'};
                                   border:1px solid {g.permissions[k] ? '#4ade8033' : '#2a2a42'};">
                        {PERM_LABELS[k]}
                      </span>
                    {/each}
                    {#if g.can_use_api}
                      <span style="font-size:0.6875rem; padding:1px 6px; border-radius:9999px; background:#1a2a3a; color:#0094ba; border:1px solid #0094ba44; white-space:nowrap;">
                        API Access
                      </span>
                    {/if}
                  </div>
                  <div style="flex-shrink:0; display:flex; gap:0.375rem;">
                    <button style="font-size:0.75rem; color:#9ca3af; background:none; border:1px solid #374151; border-radius:0.25rem; padding:0.2rem 0.5rem; cursor:pointer;"
                      on:click={() => startEditGroup(g)}>Edit</button>
                    {#if !g.is_system}
                      <button style="font-size:0.75rem; color:#f87171; background:none; border:1px solid #f8717133; border-radius:0.25rem; padding:0.2rem 0.5rem; cursor:pointer;"
                        on:click={() => deleteGroup(g.id)}>Delete</button>
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}
          </div>

          <!-- Add new group form -->
          {#if showAddGroup}
            <div style="margin-top:0.75rem; background:#1e2d3a; border:1px solid #0094ba55; border-radius:0.75rem; padding:1.25rem;">
              <h3 style="font-size:0.875rem; font-weight:600; color:#0094ba; margin-bottom:1rem;">New Security Group</h3>
              <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:0.75rem; margin-bottom:1rem;">
                <div>
                  <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Group name *</p>
                  <input type="text" bind:value={newGroupForm.name} placeholder="e.g. L1 Technician"
                    style="width:100%; background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.625rem; color:#fff; font-size:0.8125rem; box-sizing:border-box;" />
                </div>
                <div>
                  <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Maps to role</p>
                  <select bind:value={newGroupForm.mapped_role}
                    style="width:100%; background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem; padding:0.375rem 0.625rem; color:#fff; font-size:0.8125rem; box-sizing:border-box;">
                    <option value="tenant_admin">Tenant Admin</option>
                    <option value="msp_admin">MSP Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Colour</p>
                  <input type="color" bind:value={newGroupForm.color}
                    style="width:2.5rem; height:2.25rem; border:none; border-radius:0.25rem; cursor:pointer; background:none;" />
                </div>
              </div>
              <div style="border-top:1px solid #374151; padding-top:0.875rem; margin-bottom:1rem;">
                <p style="font-size:0.75rem; color:#9ca3af; margin-bottom:0.625rem;">Permissions</p>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.5rem; margin-bottom:0.625rem;">
                  {#each PERM_KEYS as k}
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.8125rem; color:#d1d5db;">
                      <input type="checkbox" bind:checked={newGroupForm.permissions[k]}
                        style="width:1rem; height:1rem; accent-color:#0094ba; cursor:pointer;" />
                      {PERM_LABELS[k]}
                    </label>
                  {/each}
                </div>
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.8125rem; color:#d1d5db;">
                  <input type="checkbox" bind:checked={newGroupForm.can_use_api}
                    style="width:1rem; height:1rem; accent-color:#0094ba; cursor:pointer;" />
                  Can authenticate via API Key
                </label>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button
                  style="background:#0094ba; color:#fff; border:none; border-radius:0.375rem; padding:0.4rem 0.875rem; font-size:0.8125rem; cursor:pointer; opacity:{newGroupForm.name.trim() ? 1 : 0.5};"
                  disabled={!newGroupForm.name.trim()}
                  on:click={saveNewGroup}>Save Group</button>
                <button style="background:#374151; color:#d1d5db; border:none; border-radius:0.375rem; padding:0.4rem 0.875rem; font-size:0.8125rem; cursor:pointer;"
                  on:click={() => showAddGroup = false}>Cancel</button>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- ── Users & Access ── -->
      <div>
        <h2 style="font-size:1rem; font-weight:700; color:#ffffff; margin-bottom:0.25rem;">Users &amp; Access</h2>
        <p style="font-size:0.8125rem; color:#9ca3af; margin-bottom:1rem;">
          Assign or change each user's security group. Changes take effect on their next login.
        </p>

        {#if usersLoading}
          <p style="color:#9ca3af; font-size:0.875rem;">Loading users…</p>
        {:else}
          <div style="background:#23233a; border:1px solid #374151; border-radius:0.75rem; overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; font-size:0.8125rem;">
              <thead>
                <tr style="border-bottom:1px solid #374151;">
                  <th style="text-align:left; padding:0.625rem 0.875rem; color:#9ca3af; font-weight:500;">Name</th>
                  <th style="text-align:left; padding:0.625rem 0.875rem; color:#9ca3af; font-weight:500;">Email</th>
                  <th style="text-align:left; padding:0.625rem 0.875rem; color:#9ca3af; font-weight:500;">Security Group</th>
                  <th style="text-align:left; padding:0.625rem 0.875rem; color:#9ca3af; font-weight:500;">Scope</th>
                  <th style="text-align:left; padding:0.625rem 0.875rem; color:#9ca3af; font-weight:500;">Last Login</th>
                  <th style="padding:0.625rem 0.875rem;"></th>
                </tr>
              </thead>
              <tbody>
                {#each users as u}
                  {@const org = allOrgs.find(o => o.id === u.org_id)}
                  {@const pendingRole = userRoleChanges[u.id] ?? u.role}
                  {@const matchedGroup = securityGroups.find(g => g.mapped_role === pendingRole)}
                  <tr style="border-bottom:1px solid #2a2a42;">
                    <td style="padding:0.625rem 0.875rem; color:#ffffff; font-weight:500;">{u.display_name}</td>
                    <td style="padding:0.625rem 0.875rem; color:#9ca3af;">{u.email}</td>
                    <td style="padding:0.625rem 0.875rem;">
                      <select
                        value={pendingRole}
                        on:change={(e) => setUserRoleChange(u.id, e.currentTarget.value)}
                        style="background:#1a1a2e; border:1px solid #374151; border-radius:0.375rem; padding:0.25rem 0.5rem; color:{matchedGroup?.color ?? '#9ca3af'}; font-size:0.75rem; cursor:pointer;">
                        {#each securityGroups as g}
                          <option value={g.mapped_role} selected={g.mapped_role === pendingRole}>{g.name}</option>
                        {/each}
                      </select>
                    </td>
                    <td style="padding:0.625rem 0.875rem; color:#9ca3af; font-size:0.75rem;">
                      {org ? org.name : 'All clients'}
                    </td>
                    <td style="padding:0.625rem 0.875rem; color:#6b7280; font-size:0.75rem;">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                    </td>
                    <td style="padding:0.625rem 0.875rem; text-align:right;">
                      {#if (userRoleChanges[u.id] ?? u.role) !== u.role}
                        <button
                          style="background:#0094ba; color:#fff; border:none; border-radius:0.375rem; padding:0.25rem 0.625rem; font-size:0.75rem; cursor:pointer; opacity:{rolesSaving[u.id] ? 0.6 : 1};"
                          disabled={!!rolesSaving[u.id]}
                          on:click={() => applyUserRole(u.id)}
                        >{rolesSaving[u.id] ? '…' : 'Apply'}</button>
                      {/if}
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
