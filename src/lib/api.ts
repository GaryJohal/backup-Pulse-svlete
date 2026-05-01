/**
 * Thin wrapper around fetch that adds the JWT Bearer header and
 * handles 401 → redirect to /login.
 */
const BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';

function token(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('bp_token') : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tok = token();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    ...(init.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    localStorage.removeItem('bp_token');
    localStorage.removeItem('bp_user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text();
    let message = body || res.statusText;
    try {
      const parsed = JSON.parse(body);
      if (parsed.detail) message = parsed.detail;
      else if (parsed.message) message = parsed.message;
    } catch { /* not JSON, use raw body */ }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (email: string, password: string, tenantSlug: string) =>
    request<{ access_token: string; user: User }>('/api/v1/auth/token', {
      method: 'POST',
      body: new URLSearchParams({ username: email, password, client_id: tenantSlug }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),

  me: () => request<User>('/api/v1/auth/me'),

  // Dashboard
  stats: (params?: { org_id?: number; from?: string; to?: string }) =>
    request<DashboardStats>('/api/v1/dashboard/stats' + toQS(params)),

  orgDetail: (orgId: number, params?: { from?: string; to?: string }) =>
    request<DeviceSummary[]>(`/api/v1/dashboard/org/${orgId}` + toQS(params)),

  mspClients: (orgId: number, params?: { from?: string; to?: string }) =>
    request<OrgSummary[]>(`/api/v1/dashboard/msp/${orgId}` + toQS(params)),

  jobs: (params?: JobsParams) =>
    request<Job[]>('/api/v1/dashboard/jobs' + toQS(params)),

  chat: (messages: {role: string; content: string}[]) =>
    request<{ reply: string }>('/api/v1/dashboard/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),

  storageAlerts: () =>
    request<StorageAlert[]>('/api/v1/dashboard/storage-alerts'),

  recheckJob: (jobId: number) =>
    request<{ new_jobs: number; message: string }>(`/api/v1/dashboard/jobs/${jobId}/recheck`, { method: 'POST' }),

  overrideJobStatus: (jobId: number, status: string) =>
    request<{ ok: boolean; job_id: number; status: string }>(
      `/api/v1/dashboard/jobs/${jobId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    ),

  analyzeJob: (jobId: number) =>
    request<{ ok: boolean; ai_analysis?: Record<string, unknown>; message?: string }>(`/api/v1/dashboard/jobs/${jobId}/analyze`, { method: 'POST' }),

  sync: (days = 30) =>
    request<{ message: string; new_jobs: number }>(`/api/v1/dashboard/sync?days=${days}`, { method: 'POST' }),

  resetAndSync: () =>
    request<{ message: string; new_jobs: number }>('/api/v1/dashboard/reset-and-sync', { method: 'POST' }),

  // Settings — Orgs
  orgs: () => request<Org[]>('/api/v1/settings/orgs'),
  companies: (params?: { type?: string }) =>
    request<{ id: number; name: string; type: string; parent_id: number | null }[]>('/api/v1/manage/companies' + toQS(params as Record<string, unknown>)),
  connectorOrgs: () => request<ConnectorOrg[]>('/api/v1/settings/orgs?for_connector=true'),
  createOrg: (body: OrgCreate) => request<Org>('/api/v1/settings/orgs', { method: 'POST', body: JSON.stringify(body) }),
  updateOrg: (id: number, body: Partial<OrgCreate>) =>
    request<{ ok: boolean }>(`/api/v1/settings/orgs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteOrg: (id: number) => request<{ ok: boolean }>(`/api/v1/settings/orgs/${id}`, { method: 'DELETE' }),

  // Settings — Connectors
  connectors: (params?: { org_id?: number; tool?: string }) =>
    request<Connector[]>('/api/v1/settings/connectors' + toQS(params)),
  createConnector: (body: ConnectorCreate) =>
    request<{ id: number }>('/api/v1/settings/connectors', { method: 'POST', body: JSON.stringify(body) }),
  updateConnector: (id: number, body: Partial<ConnectorCreate>) =>
    request<{ ok: boolean }>(`/api/v1/settings/connectors/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteConnector: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/settings/connectors/${id}`, { method: 'DELETE' }),
  testConnector: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/v1/settings/connectors/${id}/test`, { method: 'POST' }),

  // Settings — Users
  users: () => request<UserRecord[]>('/api/v1/settings/users'),
  createUser: (body: UserCreate) =>
    request<{ id: number }>('/api/v1/settings/users', { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/settings/users/${id}`, { method: 'DELETE' }),

  // Audit
  auditLogs: (params?: { resource_type?: string; action?: string; limit?: number }) =>
    request<AuditEntry[]>('/api/v1/audit/logs' + toQS(params)),

  // Admin — Plans (platform only)
  plans: () => request<Plan[]>('/api/v1/admin/plans'),
  createPlan: (body: PlanCreate) =>
    request<Plan>('/api/v1/admin/plans', { method: 'POST', body: JSON.stringify(body) }),
  updatePlan: (id: number, body: Partial<PlanCreate & { is_active?: boolean }>) =>
    request<Plan>(`/api/v1/admin/plans/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  archivePlan: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/admin/plans/${id}`, { method: 'DELETE' }),
  adminTenants: () => request<AdminTenant[]>('/api/v1/admin/tenants'),
  adminMsps: (masterMspId: number) => request<MspOrg[]>(`/api/v1/admin/tenants/${masterMspId}/msps`),
  assignTenantPlan: (tenantId: number, planId: number) =>
    request<{ ok: boolean; plan_name: string }>(
      `/api/v1/admin/tenants/${tenantId}/plan`,
      { method: 'PUT', body: JSON.stringify({ plan_id: planId }) },
    ),
  setTenantRetention: (tenantId: number, days: number | null) =>
    request<{ ok: boolean; audit_log_retention_days: number | null }>(
      `/api/v1/admin/tenants/${tenantId}/retention`,
      { method: 'PATCH', body: JSON.stringify({ audit_log_retention_days: days }) },
    ),
  getTenantAddons: (tenantId: number) =>
    request<AddonStatus>(`/api/v1/admin/tenants/${tenantId}/addons`),
  updateTenantAddons: (tenantId: number, body: Partial<AddonStatus>) =>
    request<AddonStatus>(
      `/api/v1/admin/tenants/${tenantId}/addons`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  // Tenant provisioning (platform admin)
  tenants: () => request<TenantRecord[]>('/api/v1/manage/tenants'),
  createTenant: (body: TenantCreate) =>
    request<TenantRecord>('/api/v1/manage/tenants', { method: 'POST', body: JSON.stringify(body) }),
  updateTenant: (id: number, body: { name?: string; is_active?: boolean; type?: string }) =>
    request<TenantRecord>(`/api/v1/manage/tenants/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTenant: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/manage/tenants/${id}`, { method: 'DELETE' }),
  tenantUsers: (tenantId: number) =>
    request<TenantUser[]>(`/api/v1/manage/tenants/${tenantId}/users`),
  addTenantUser: (tenantId: number, body: { display_name: string; email: string; password: string; role: string }) =>
    request<TenantUser>(`/api/v1/manage/tenants/${tenantId}/users`, { method: 'POST', body: JSON.stringify(body) }),
  resetUserPassword: (userId: number, password: string) =>
    request<{ ok: boolean }>(`/api/v1/manage/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  deleteTenantUser: (userId: number) =>
    request<{ ok: boolean }>(`/api/v1/manage/users/${userId}`, { method: 'DELETE' }),

  // Problem Management
  flaggedJobs: (params?: { msp_id?: number; client_id?: number; device_id?: number; window?: string }) =>
    request<{ count: number; jobs: FlaggedJobResult[] }>('/api/v1/problem-management/flagged-jobs' + toQS(params as Record<string,unknown>)),

  pmConfig: () =>
    request<Record<string, unknown>>('/api/v1/problem-management/config'),

  savePmConfig: (body: unknown) =>
    request<{ ok: boolean }>('/api/v1/problem-management/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Security Groups
  securityGroups: () => request<SecurityGroup[]>('/api/v1/settings/security-groups'),
  createSecurityGroup: (body: Omit<SecurityGroup, 'id' | 'is_system'>) =>
    request<SecurityGroup>('/api/v1/settings/security-groups', { method: 'POST', body: JSON.stringify(body) }),
  updateSecurityGroup: (id: number, body: Partial<Omit<SecurityGroup, 'id' | 'is_system'>>) =>
    request<SecurityGroup>(`/api/v1/settings/security-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSecurityGroup: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/settings/security-groups/${id}`, { method: 'DELETE' }),
  updateUserRole: (userId: number, role: string) =>
    request<{ ok: boolean }>(`/api/v1/settings/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),

  createTicket: (body: CreateTicketRequest) =>
    request<{ success: boolean; ticket_id: string; ticket_url: string; message: string }>(
      '/api/v1/problem-management/create-ticket',
      { method: 'POST', body: JSON.stringify(body) }
    ),

  clearTickets: () =>
    request<{ ok: boolean; cleared: number }>('/api/v1/problem-management/tickets', { method: 'DELETE' }),

  clearJobTicket: (jobId: number) =>
    request<{ ok: boolean }>(`/api/v1/problem-management/tickets/${jobId}`, { method: 'DELETE' }),

  pmExclusions: () =>
    request<{ id: number; exclusion_type: string; exclusion_id: number; exclusion_name: string | null }[]>('/api/v1/problem-management/exclusions'),
  createPmExclusion: (body: { exclusion_type: string; exclusion_id: number; exclusion_name?: string }) =>
    request<{ id: number }>('/api/v1/problem-management/exclusions', { method: 'POST', body: JSON.stringify(body) }),
  deletePmExclusion: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/problem-management/exclusions/${id}`, { method: 'DELETE' }),

  // Escalation
  escalationPolicy: () =>
    request<Record<string, unknown>>('/api/v1/escalation/policy'),
  saveEscalationPolicy: (body: unknown) =>
    request<Record<string, unknown>>('/api/v1/escalation/policy', { method: 'PUT', body: JSON.stringify(body) }),
  escalationIncidents: (params?: { status?: string }) =>
    request<Record<string, unknown>[]>('/api/v1/escalation/incidents' + toQS(params as Record<string, unknown>)),
  acknowledgeIncident: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/escalation/incidents/${id}/acknowledge`, { method: 'PATCH' }),
  resolveIncident: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/escalation/incidents/${id}/resolve`, { method: 'PATCH' }),

  // Scheduled Reports
  reportStats: () =>
    request<{ total_scheduled: number; sent_this_week: number; failed_sends: number; next_delivery: string | null }>('/api/v1/reports/stats'),

  reportTargets: () =>
    request<ReportTarget[]>('/api/v1/reports/targets'),

  scheduledReports: (params?: { org_id?: number; report_type?: string; is_enabled?: boolean }) =>
    request<ScheduledReport[]>('/api/v1/reports/scheduled' + toQS(params as Record<string, unknown>)),

  createScheduledReport: (body: ScheduledReportCreate) =>
    request<ScheduledReport>('/api/v1/reports/scheduled', { method: 'POST', body: JSON.stringify(body) }),

  updateScheduledReport: (id: number, body: Partial<ScheduledReportCreate>) =>
    request<ScheduledReport>(`/api/v1/reports/scheduled/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteScheduledReport: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/reports/scheduled/${id}`, { method: 'DELETE' }),

  toggleScheduledReport: (id: number) =>
    request<{ ok: boolean; is_enabled: boolean }>(`/api/v1/reports/scheduled/${id}/toggle`, { method: 'PATCH' }),

  runScheduledReportNow: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/v1/reports/scheduled/${id}/run-now`, { method: 'POST' }),

  // Mailbox
  listMailboxes: () =>
    request<MailboxConfig[]>('/api/v1/mailbox/configs'),
  createMailbox: (body: MailboxCreate) =>
    request<MailboxConfig>('/api/v1/mailbox/configs', { method: 'POST', body: JSON.stringify(body) }),
  deleteMailbox: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/mailbox/configs/${id}`, { method: 'DELETE' }),
  testMailbox: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/v1/mailbox/configs/${id}/test`, { method: 'POST' }),

  // Parsing Rules
  listParsingRules: () =>
    request<ParsingRule[]>('/api/v1/mailbox/rules'),
  createParsingRule: (body: ParsingRuleBody) =>
    request<ParsingRule>('/api/v1/mailbox/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateParsingRule: (id: number, body: Partial<ParsingRuleBody>) =>
    request<ParsingRule>(`/api/v1/mailbox/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pollMailboxNow: (id: number) =>
    request<{ ok: boolean; emails_fetched: number; jobs_created: number; message: string }>(
      `/api/v1/mailbox/configs/${id}/poll`, { method: 'POST' }
    ),

  deleteParsingRule: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/mailbox/rules/${id}`, { method: 'DELETE' }),

  // Test Restore
  testRestoreStats: () =>
    request<TestRestoreStats>('/api/v1/test-restore/stats'),
  testRestoreSchedules: () =>
    request<TestRestoreSchedule[]>('/api/v1/test-restore/schedules'),
  testRestoreRuns: (limit = 50) =>
    request<TestRestoreRun[]>(`/api/v1/test-restore/runs?limit=${limit}`),
  testRestoreUpcoming: () =>
    request<UpcomingRunDay[]>('/api/v1/test-restore/upcoming'),
  deviceScreenshots: (scheduleId?: number) =>
    request<DeviceScreenshot[]>('/api/v1/test-restore/screenshots' + (scheduleId ? `?schedule_id=${scheduleId}` : '')),
  createTestRestoreSchedule: (body: TestRestoreScheduleCreate) =>
    request<TestRestoreSchedule>('/api/v1/test-restore/schedules', { method: 'POST', body: JSON.stringify(body) }),
  updateTestRestoreSchedule: (id: number, body: Partial<TestRestoreScheduleCreate>) =>
    request<TestRestoreSchedule>(`/api/v1/test-restore/schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  toggleTestRestoreSchedule: (id: number) =>
    request<{ ok: boolean; is_enabled: boolean }>(`/api/v1/test-restore/schedules/${id}/toggle`, { method: 'PATCH' }),
  deleteTestRestoreSchedule: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/test-restore/schedules/${id}`, { method: 'DELETE' }),
  restoreDestinationOptions: (orgId: number) =>
    request<TestRestoreDestination[]>(`/api/v1/test-restore/destinations?org_id=${orgId}`),

  listProcessedEmails: (params?: { mailbox_id?: number; result?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.mailbox_id) qs.set('mailbox_id', String(params.mailbox_id));
    if (params?.result)     qs.set('result', params.result);
    if (params?.limit)      qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<ProcessedEmail[]>(`/api/v1/mailbox/processed-emails${q ? '?' + q : ''}`);
  },

  // SureRestore
  sureRestoreDashboard: () =>
    request<{ device_statuses: SureRestoreDeviceStatus[] }>('/api/v1/surerestore/dashboard'),
  sureRestoreSchedules: () =>
    request<{ schedules: SureRestoreScheduleItem[] }>('/api/v1/surerestore/schedules'),
  createSureRestoreSchedule: (body: SureRestoreScheduleCreate) =>
    request<SureRestoreScheduleItem>('/api/v1/surerestore/schedules', { method: 'POST', body: JSON.stringify(body) }),
  updateSureRestoreSchedule: (id: number, body: SureRestoreScheduleUpdate) =>
    request<SureRestoreScheduleItem>(`/api/v1/surerestore/schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSureRestoreSchedule: (id: number) =>
    request<void>(`/api/v1/surerestore/schedules/${id}`, { method: 'DELETE' }),
  triggerSureRestoreSchedule: (id: number) =>
    request<{ message: string; schedule_id: number }>(`/api/v1/surerestore/schedules/${id}/run`, { method: 'POST' }),
  sureRestoreRuns: (limit = 100) =>
    request<{ runs: SureRestoreRunItem[] }>(`/api/v1/surerestore/runs?limit=${limit}`),
  sureRestoreRun: (runId: number) =>
    request<SureRestoreRunItem>(`/api/v1/surerestore/runs/${runId}`),
  sureRestoreDevices: () =>
    request<{ devices: SureRestoreDevice[] }>('/api/v1/surerestore/devices'),
  sureRestoreSync: () =>
    request<{ message: string; new_jobs: number; devices_synced: number }>('/api/v1/surerestore/sync', { method: 'POST' }),
  sureRestoreTicketTemplates: () =>
    request<{ templates: SureRestoreTicketTemplate[] }>('/api/v1/surerestore/ticket-templates'),
  createSureRestoreTicketTemplate: (body: Partial<SureRestoreTicketTemplate>) =>
    request<SureRestoreTicketTemplate>('/api/v1/surerestore/ticket-templates', { method: 'POST', body: JSON.stringify(body) }),
  updateSureRestoreTicketTemplate: (id: number, body: Partial<SureRestoreTicketTemplate>) =>
    request<SureRestoreTicketTemplate>(`/api/v1/surerestore/ticket-templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSureRestoreTicketTemplate: (id: number) =>
    request<void>(`/api/v1/surerestore/ticket-templates/${id}`, { method: 'DELETE' }),
  sureRestorePsaOptions: (integration_id?: number) =>
    request<PSAOptions>(`/api/v1/surerestore/psa-options${integration_id ? `?integration_id=${integration_id}` : ''}`),
  sureRestoreRestoreTypes: () =>
    request<{ types: SureRestoreRestoreType[]; phase1_types: string[] }>('/api/v1/surerestore/restore-types'),
};

function toQS(params?: Record<string, unknown> | JobsParams | { from?: string; to?: string }): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: string;
  tenant_id: number;
  org_id: number | null;
  tenant_type: string;
  feature_flags: Record<string, boolean>;
  plan_name: string | null;
  max_integrations: number;
  max_integrations_per_tool: number;
  allowed_tools: string[] | null;
  addons: {
    test_restore_access: boolean;
    test_restore_device_limit: number | null;
  };
}

export interface AddonStatus {
  test_restore_access: boolean;
  test_restore_device_limit: number | null;
  surerestore_file_restore: boolean;
  surerestore_vm_virtualization: boolean;
  surerestore_cloud_bcdr: boolean;
  surerestore_physical_host: boolean;
}

export interface TestRestoreStats {
  total_schedules: number;
  active_schedules: number;
  runs_this_month: number;
  pass_rate: number;
  avg_rto_seconds: number | null;
  devices_covered: number;
  health: TestRestoreHealth[];
}

export interface TestRestoreHealth {
  schedule_id: number;
  schedule_name: string;
  device_name: string;
  org_name: string | null;
  last_status: 'passed' | 'failed' | 'running' | 'never';
  last_run_at: string | null;
  rto_seconds: number | null;
}

export type RestoreType = 'file_restore' | 'vm_virtualization' | 'cloud_bcdr' | 'physical_host';

export interface TestRestoreSchedule {
  id: number;
  name: string;
  org_id: number | null;
  org_name: string | null;
  devices: string[];
  restore_type: RestoreType | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  day_of_week: number | null;
  day_of_month: number | null;
  is_enabled: boolean;
  last_run_at: string | null;
  last_run_status: 'passed' | 'failed' | 'running' | null;
  next_run_at: string | null;
  rto_seconds: number | null;
  created_at: string;
}

export interface TestRestoreScheduleCreate {
  name: string;
  org_id?: number | null;
  devices?: string[];
  restore_type?: RestoreType | null;
  frequency?: 'daily' | 'weekly' | 'monthly';
  time?: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  is_enabled?: boolean;
  destination_config?: Record<string, unknown> | null;
}

export interface TestRestoreRun {
  id: number;
  schedule_id: number;
  schedule_name: string;
  org_name: string | null;
  device_name: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'passed' | 'failed' | 'aborted';
  rto_seconds: number | null;
  error_message: string | null;
  screenshot_url: string | null;
  report_data: Record<string, unknown> | null;
  ticket_id: string | null;
  ticket_url: string | null;
}

export interface DeviceScreenshot {
  run_id: number;
  device_name: string;
  schedule_name: string;
  taken_at: string;
  url: string;
  status: 'passed' | 'failed';
  rto_seconds: number | null;
}

export interface UpcomingRunDay {
  date: string;
  schedules: { id: number; name: string; device_count: number }[];
}

export interface TestRestoreDestination {
  id: number;
  name: string;
  type: string;
  org_id: number;
}

export interface DashboardStats {
  total_jobs: number;
  success: number;
  failed: number;
  action_required: number;
  warning: number;
  by_tool: Record<string, number>;
  trend_7_days: TrendDay[];
  view_level: 'msp' | 'client';
  orgs: OrgSummary[];
}

export interface TrendDay {
  date: string;
  success: number;
  failed: number;
  action_required: number;
  warning: number;
}

export interface OrgSummary {
  org_id: number;
  org_name: string;
  total: number;
  success: number;
  failed: number;
  action_required: number;
  warning: number;
  last_backup: string | null;
}

export interface DeviceSummary {
  device_id: number;
  device_name: string;
  total: number;
  success: number;
  failed: number;
  action_required: number;
  warning: number;
  last_backup: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface Job {
  id: number;
  device_id: number;
  device_name: string | null;
  org_name: string | null;
  tool: string;
  status: string;
  job_name: string | null;
  job_time: string | null;
  end_time: string | null;
  size_bytes: number | null;
  error_message: string | null;
  ai_analysis: AiAnalysis | null;
  ingested_at: string | null;
}

export interface AiAnalysis {
  root_cause: string;
  severity: string;
  steps: string[];
  prevention: string;
}

export interface Org {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
  contact_email: string | null;
  tags: string | null;
  clients: { id: number; name: string; type: string; device_count: number }[];
  device_count: number;
}

export interface ConnectorOrg {
  id: number;
  name: string;
  type: string;
  parent_id: number | null;
}

export interface OrgCreate {
  name: string;
  type?: string;
  parent_id?: number | null;
  contact_email?: string | null;
  tags?: string | null;
}

export interface Connector {
  id: number;
  org_id: number;
  org_name: string | null;
  tool: string;
  is_enabled: boolean;
  api_key: string | null;
  api_secret: string | null;
  base_url: string | null;
  extra_config: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export interface ConnectorCreate {
  org_id: number;
  tool: string;
  api_key?: string;
  api_secret?: string;
  base_url?: string;
  extra_config?: string;
  is_enabled?: boolean;
}

export interface UserRecord {
  id: number;
  email: string;
  display_name: string;
  role: string;
  org_id: number | null;
  last_login_at: string | null;
}

export interface UserCreate {
  email: string;
  display_name: string;
  password: string;
  role?: string;
  org_id?: number | null;
}

export interface AuditEntry {
  id: number;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  changes: string | null;
  impact: string;
  created_at: string;
}

export interface StorageAlert {
  device_id: number;
  device_name: string;
  org_name: string;
  last_error: string | null;
  last_backup: string | null;
  tool: string;
}

export interface JobsParams {
  org_id?: number;
  device_id?: number;
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}

export interface FlaggedJobResult {
  id: number;
  client: string;
  client_id: number;
  device: string;
  device_id: number;
  job_name: string;
  source: string;
  failures_this_window: number;
  consecutive_failures: number;
  failure_pct: number;
  last_failure: string | null;
  first_seen: string | null;
  rule_triggered: 'count' | 'consecutive' | 'pct';
  error_reason: string;
  proposed_solution: string;
  ticket_created: boolean;
  ticket_id: string | null;
}

export interface TenantUser {
  id: number;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

export interface TenantRecord {
  id: number;
  name: string;
  slug: string;
  type: string;
  plan: string | null;
  is_active: boolean;
  created_at: string | null;
  user_count: number;
}

export interface TenantCreate {
  name: string;
  slug: string;
  type: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
}

export interface Plan {
  id: number;
  name: string;
  device_limit: number;
  price_monthly: number | null;
  price_annual: number | null;
  feature_flags: Record<string, boolean>;
  max_integrations: number;
  max_integrations_per_tool: number;
  allowed_tools: string[] | null;
  audit_log_retention_days: number;
  is_active: boolean;
  created_at: string | null;
}

export interface PlanCreate {
  name: string;
  device_limit: number;
  price_monthly?: number | null;
  price_annual?: number | null;
  feature_flags: Record<string, boolean>;
  max_integrations?: number;
  max_integrations_per_tool?: number;
  allowed_tools?: string[] | null;
  audit_log_retention_days?: number;
}

export interface MspOrg {
  id: number;
  name: string;
  client_count: number;
  device_count: number;
  is_active: boolean;
}

export interface AdminTenant {
  id: number;
  name: string;
  slug: string;
  type: string;
  is_active: boolean;
  plan_id: number | null;
  plan_name: string | null;
  device_used: number;
  device_limit: number;
  audit_log_retention_days: number;
  audit_log_retention_override: number | null;
}

export interface SecurityGroup {
  id: number;
  name: string;
  color: string;
  mapped_role: string;
  is_system: boolean;
  can_use_api: boolean;
  permissions: Record<string, boolean>;
}

export interface CreateTicketRequest {
  job_id: number;
  psa_provider?: string;
  board?: string;
  priority?: string;
  ticket_type?: string;
  assign_to?: string;
  sla?: string;
  status_on_create?: string;
  title: string;
  body: string;
}

export interface ScheduledReport {
  id: number;
  tenant_id: number;
  org_id: number | null;
  org_name: string | null;
  name: string;
  report_type: string;
  is_enabled: boolean;
  recipients: string[];
  recipient_count: number;
  email_subject: string | null;
  from_address: string | null;
  timezone: string;
  schedule: string;
  start_date: string | null;
  processing_time: string | null;
  custom_message: string | null;
  logo_url: string | null;
  next_run_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReportTarget {
  id: number;
  name: string;
  type: string;
  device_count: number;
}

export interface ScheduledReportCreate {
  name: string;
  report_type: string;
  org_id?: number | null;
  is_enabled?: boolean;
  recipients?: string[];
  email_subject?: string | null;
  from_address?: string | null;
  timezone?: string;
  schedule?: string;
  start_date?: string | null;
  processing_time?: string | null;
  custom_message?: string | null;
  logo_url?: string | null;
}

export interface MailboxConfig {
  id: number;
  tenant_id: number;
  name: string;
  mailbox_type: 'imap' | 'microsoft365';
  host?: string | null;
  port?: number | null;
  username?: string | null;
  use_ssl?: boolean;
  azure_tenant_id?: string | null;
  m365_client_id?: string | null;
  folder?: string | null;
  is_active: boolean;
  last_polled_at?: string | null;
  created_at: string;
}

export interface MailboxCreate {
  name: string;
  mailbox_type: 'imap' | 'microsoft365';
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  use_ssl?: boolean;
  azure_tenant_id?: string | null;
  m365_client_id?: string | null;
  m365_client_secret?: string | null;
  folder?: string | null;
  is_active?: boolean;
}

export interface ParsingRule {
  id: number;
  tenant_id?: number;
  mailbox_id?: number | null;
  name: string;
  priority: number;
  from_pattern?: string | null;
  subject_pattern?: string | null;
  body_pattern?: string | null;
  match_type: 'contains' | 'regex';
  msp_org_id?: number | null;
  msp_org_name?: string | null;
  org_id?: number | null;
  org_name?: string | null;
  tool?: string | null;
  success_keywords?: string[];
  failed_keywords?: string[];
  warning_keywords?: string[];
  device_name_source?: string | null;
  device_name_pattern?: string | null;
  customer_name_source?: string | null;
  customer_name_pattern?: string | null;
  job_name_source?: string | null;
  job_name_pattern?: string | null;
  status_source?: string | null;
  status_pattern?: string | null;
  error_source?: string | null;
  error_pattern?: string | null;
  start_time_source?: string | null;
  start_time_pattern?: string | null;
  end_time_source?: string | null;
  end_time_pattern?: string | null;
  size_source?: string | null;
  size_pattern?: string | null;
  row_template?: string | null;
  prefer_html?: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ParsingRuleBody {
  mailbox_id?: number | null;
  name: string;
  priority?: number;
  from_pattern?: string | null;
  subject_pattern?: string | null;
  body_pattern?: string | null;
  match_type?: 'contains' | 'regex';
  msp_org_id?: number | null;
  org_id?: number | null;
  tool?: string | null;
  success_keywords?: string[];
  failed_keywords?: string[];
  warning_keywords?: string[];
  device_name_source?: string | null;
  device_name_pattern?: string | null;
  customer_name_source?: string | null;
  customer_name_pattern?: string | null;
  job_name_source?: string | null;
  job_name_pattern?: string | null;
  status_source?: string | null;
  status_pattern?: string | null;
  error_source?: string | null;
  error_pattern?: string | null;
  start_time_source?: string | null;
  start_time_pattern?: string | null;
  end_time_source?: string | null;
  end_time_pattern?: string | null;
  size_source?: string | null;
  size_pattern?: string | null;
  row_template?: string | null;
  prefer_html?: boolean;
  is_active?: boolean;
}

export interface ProcessedEmail {
  id: number;
  mailbox_id?: number | null;
  message_id?: string | null;
  received_at: string;
  from_address?: string | null;
  subject?: string | null;
  rule_id?: number | null;
  rule_name?: string | null;
  extracted_data?: Record<string, unknown> | null;
  result: 'created' | 'skipped' | 'no_match' | 'error';
  jobs_created: number;
  error_detail?: string | null;
  processed_at: string;
}

// ── SureRestore ───────────────────────────────────────────────────────────────

export interface SureRestoreRestoreType {
  key: string;
  label: string;
  description: string;
  phase: number;
  plan_flag: string;
  icon: string;
  color: string;
  executable_phase1: boolean;
  supported_tools_phase1: string[];
  supported_tools_phase2: string[];
  rmm_script: string | null;
}

export interface SureRestoreDevice {
  id: number;
  name: string;
  org_id: number;
  org_name: string | null;
  msp_name: string | null;
  tools: string[];
}

export interface SureRestoreScheduleItem {
  id: number;
  tenant_id: number;
  device_id: number;
  device_name: string | null;
  org_name: string | null;
  msp_name: string | null;
  restore_type: string;
  name: string;
  backup_tool: string;
  is_enabled: boolean;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  quarter_month: number | null;
  run_time: string;
  rpo_threshold_hours: number;
  rto_target_minutes: number;
  storage_warning_pct: number;
  abort_on_storage_low: boolean;
  destination_type: string | null;
  destination_config: Record<string, unknown> | null;
  destination_name: string | null;
  rmm_type: string | null;
  rmm_device_id: string | null;
  file_path_to_test: string | null;
  restore_dest_path: string | null;
  screenshot_enabled: boolean;
  notify_on_failure: string[];
  notify_on_pass: string[];
  psa_ticket_on_failure: boolean;
  psa_advance_ticket: boolean;
  psa_integration_id: number | null;
  psa_template_id: number | null;
  ticket_advance_days: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string | null;
}

export interface SureRestoreScheduleCreate {
  device_id: number;
  restore_type: string;
  backup_tool: string;
  name?: string | null;
  frequency?: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  run_time?: string;
  rpo_threshold_hours?: number;
  rto_target_minutes?: number;
  storage_warning_pct?: number;
  abort_on_storage_low?: boolean;
  destination_type?: string | null;
  destination_config?: Record<string, unknown> | null;
  destination_name?: string | null;
  rmm_type?: string | null;
  rmm_device_id?: string | null;
  file_path_to_test?: string;
  restore_dest_path?: string;
  screenshot_enabled?: boolean;
  notify_on_failure?: string[];
  notify_on_pass?: string[];
  psa_ticket_on_failure?: boolean;
  psa_advance_ticket?: boolean;
  psa_template_id?: number | null;
  ticket_advance_days?: number;
}

export interface SureRestoreScheduleUpdate {
  name?: string | null;
  is_enabled?: boolean;
  frequency?: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  run_time?: string;
  rpo_threshold_hours?: number;
  rto_target_minutes?: number;
  destination_type?: string | null;
  destination_config?: Record<string, unknown> | null;
  destination_name?: string | null;
  rmm_type?: string | null;
  rmm_device_id?: string | null;
  file_path_to_test?: string;
  restore_dest_path?: string;
  screenshot_enabled?: boolean;
  notify_on_failure?: string[];
  notify_on_pass?: string[];
  psa_ticket_on_failure?: boolean;
  psa_advance_ticket?: boolean;
  psa_template_id?: number | null;
  ticket_advance_days?: number;
}

export interface SureRestoreTicketTemplate {
  id: number;
  tenant_id: number;
  name: string;
  restore_type: string | null;
  is_default: boolean;
  subject_template: string;
  body_template: string;
  psa_type: string | null;
  psa_category: string | null;
  psa_priority: string | null;
  psa_agent: string | null;
  psa_client_id: string | null;
  psa_client_mapping: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PSAOptionItem {
  id: string;
  name: string;
}

export interface PSAOptions {
  integration_id: number;
  provider: string;
  types: PSAOptionItem[];
  priorities: PSAOptionItem[];
  agents: PSAOptionItem[];
  categories: PSAOptionItem[];
  clients: PSAOptionItem[];
}

export interface SureRestoreRunStep {
  id: number;
  step_number: number;
  step_name: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  result_detail: Record<string, unknown> | null;
}

export interface SureRestoreRunItem {
  id: number;
  schedule_id: number | null;
  device_id: number;
  backup_tool: string | null;
  restore_type: string;
  triggered_by: string | null;
  execution_method: string | null;
  overall_status: string;
  started_at: string | null;
  finished_at: string | null;
  rto_minutes: number | null;
  rto_target_minutes: number | null;
  rto_met: boolean | null;
  rpo_minutes: number | null;
  rpo_threshold_minutes: number | null;
  rpo_breached: boolean;
  error_message: string | null;
  provider_restore_point_id: string | null;
  restore_point_timestamp: string | null;
  steps?: SureRestoreRunStep[];
}

export interface SureRestoreDeviceStatus {
  id: number;
  device_id: number;
  device_name: string | null;
  org_name: string | null;
  msp_name: string | null;
  backup_tool: string | null;
  provider_device_id: string | null;
  last_snapshot_at: string | null;
  rpo_minutes: number | null;
  rpo_threshold_minutes: number | null;
  rpo_breached: boolean;
  snapshots_last_24h: number | null;
  snapshots_last_7d: number | null;
  auto_verify_status: string | null;
  auto_verify_last_at: string | null;
  auto_verify_boot_seconds: number | null;
  auto_verify_rto_met: boolean | null;
  screenshot_status: string | null;
  screenshot_url: string | null;
  screenshot_taken_at: string | null;
  screenshot_stale: boolean | null;
  schedule_id: number | null;
  schedule_enabled: boolean | null;
  next_run_at: string | null;
  last_run_id: number | null;
  health_status: string | null;
  health_updated_at: string | null;
  synced_at: string | null;
  updated_at: string | null;
}
