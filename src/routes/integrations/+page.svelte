<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Connector, type ConnectorOrg, type MailboxConfig, type MailboxCreate, type ParsingRule, type ParsingRuleBody, type ProcessedEmail } from '$lib/api';
  import { auth } from '$lib/auth';

  // ── Tool catalogue ────────────────────────────────────────────────────────
  const BACKUP_TOOLS: { id: string; label: string; vendor: string }[] = [
    { id: 'datto',        label: 'Datto BCDR',              vendor: 'Datto / Kaseya' },
    { id: 'acronis',      label: 'Acronis Cyber Cloud',     vendor: 'Acronis' },
    { id: 'axcient',      label: 'Axcient',                 vendor: 'Axcient' },
    { id: 'azure_backup', label: 'Microsoft Azure Backup',  vendor: 'Microsoft' },
    { id: 'aws_backup',   label: 'AWS Backup',              vendor: 'Amazon' },
    { id: 'cove',         label: 'N-able Cove',             vendor: 'N-able' },
    { id: 'veeam',        label: 'Veeam Backup',            vendor: 'Veeam' },
    { id: 'slide',        label: 'Slide',                   vendor: 'Slide' },
    { id: 'storagecraft', label: 'StorageCraft / Arcserve', vendor: 'Arcserve' },
    { id: 'skykick',      label: 'SkyKick',                 vendor: 'SkyKick' },
    { id: 'commvault',    label: 'Commvault / Metallic',    vendor: 'Commvault' },
    { id: 'datto_saas',   label: 'Datto SaaS Protection',  vendor: 'Datto / Kaseya' },
    { id: 'barracuda',    label: 'Barracuda Backup',        vendor: 'Barracuda Networks' },
    { id: 'other',        label: 'Other',                   vendor: '—' },
  ];

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

  type ProviderMeta = { category: string; label: string; description: string; fields: { key: string; label: string; type: string; required: boolean; secret: boolean }[] };
  type Integration = { id: number; provider: string; category: string; display_name: string; is_enabled: boolean; base_url: string | null; client_id: string | null; extra_config: Record<string, string>; last_tested_at: string | null; last_test_status: string };

  // ── Tab / view state ──────────────────────────────────────────────────────
  let tab: 'backup' | 'psa' | 'mailbox' | 'other' = 'backup';
  // Available template variables (shown as hint in rule editor)
  const TEMPLATE_VARS = ['{Device Name}', '{Customer Name}', '{MSP Name}', '{Job Name}', '{Status}', '{Start Time}', '{End Time}', '{Size}', '{Error}'];

  // Backup drilldown
  let selectedTool: string | null = null;
  let toolConnectors: Connector[] = [];
  let toolLoading = false;

  // All connectors (to compute counts per tool)
  let allConnectors: Connector[] = [];
  let connectorOrgs: ConnectorOrg[] = [];
  let loadingBackup = true;

  // PSA / Mailbox / Other
  let providers: Record<string, ProviderMeta> = {};
  let integrations: Integration[] = [];
  let loadingInteg = true;
  let integError = '';

  // Add / edit state (backup connectors)
  let showAddConn = false;
  let newConn = { org_id: 0, tool: '', api_key: '', api_secret: '', base_url: '', is_enabled: true };
  let newAzureTenantId = '';
  let newAzureSubId = '';
  let newCoveIntegVersion = 'standalone';
  let newCoveProfileName = '';
  let addConnError = '';
  let savingConn = false;

  let editingConnId: number | null = null;
  let editConn = { api_key: '', api_secret: '', base_url: '', is_enabled: true, org_id: 0 };
  let editMspId: number | null = null;
  let editAzureTenantId = '';
  let editAzureSubId = '';
  let editCoveIntegVersion = 'standalone';
  let editCoveProfileName = '';
  let editConnError = '';

  let testingConnId: number | null = null;
  let connTestResults: Record<number, { ok: boolean; message: string }> = {};

  // Add / edit state (PSA/mailbox/other integrations)
  let showAddInteg = false;
  let selectedProvider = '';
  let formValues: Record<string, string> = {};
  let saveIntegError = '';
  let savingInteg = false;
  let editingIntegId: number | null = null;
  let editIntegValues: Record<string, string> = {};
  let editIntegError = '';
  let testingId: number | null = null;
  let testResults: Record<number, { status: string; message: string }> = {};

  // ── PSA sub-tab state ─────────────────────────────────────────────────────
  let psaSubTab: 'setup' | 'client_mapping' | 'asset_mapping' = 'setup';

  type PsaClient = { psa_client_id: string; name: string; mapped_org_id: number | null };
  type OrgOption  = { id: number; name: string };
  let psaClients: PsaClient[] = [];
  let psaOrgs: OrgOption[] = [];
  let psaClientsLoading = false;
  let psaClientsError = '';
  let psaClientMappings: Record<string, number | ''> = {};
  let savingMappings = false;
  let mappingsSaved = '';

  // ── Client Mapping — search / filter / pagination ────────────────────────
  let psaSearch = '';
  let psaMappingFilter: 'all' | 'mapped' | 'unmapped' = 'all';
  let psaPage = 1;
  const PSA_PAGE_SIZE = 50;

  $: psaFilteredClients = psaClients.filter(c => {
    if (psaSearch && !c.name.toLowerCase().includes(psaSearch.toLowerCase())) return false;
    if (psaMappingFilter === 'mapped'   && !psaClientMappings[c.psa_client_id]) return false;
    if (psaMappingFilter === 'unmapped' &&  psaClientMappings[c.psa_client_id]) return false;
    return true;
  });
  $: psaTotalPages  = Math.max(1, Math.ceil(psaFilteredClients.length / PSA_PAGE_SIZE));
  $: psaPageClients = psaFilteredClients.slice((psaPage - 1) * PSA_PAGE_SIZE, psaPage * PSA_PAGE_SIZE);
  $: if (psaSearch || psaMappingFilter) psaPage = 1;

  let creatingOrg: Record<string, boolean> = {};

  async function createAndMapOrg(client: PsaClient) {
    creatingOrg = { ...creatingOrg, [client.psa_client_id]: true };
    try {
      const res = await apiFetch('/api/v1/assets/psa-clients/create-org', {
        method: 'POST',
        body: JSON.stringify({ psa_client_id: client.psa_client_id, name: client.name }),
      });
      psaOrgs = [...psaOrgs, { id: res.org_id, name: res.name }];
      psaClientMappings = { ...psaClientMappings, [client.psa_client_id]: res.org_id };
    } catch (e: any) { psaClientsError = e.message ?? 'Failed to create org'; }
    finally { creatingOrg = { ...creatingOrg, [client.psa_client_id]: false }; }
  }

  let psaSyncMsg = '';
  let psaSyncing = false;

  // ── PSA asset manual mapping state ────────────────────────────────────────
  type PsaAsset = {
    source_id: string; name: string; org_name: string;
    psa_client_id: string | null; device_type: string | null; serial: string | null;
    mapped_device_id: number | null; mapped_device_name: string | null;
  };
  type DeviceOption = { id: number; name: string; org_id: number; org_name: string; msp_name: string };

  let psaAssets: PsaAsset[] = [];
  let psaDeviceOptions: DeviceOption[] = [];
  let psaAssetsLoading = false;
  let psaAssetsError = '';
  let psaAssetMappings: Record<string, number | ''> = {};
  let savingAssetMappings = false;
  let assetMappingsSaved = '';
  let creatingDevice: Record<string, boolean> = {};

  let assetSearch = '';
  let assetMappingFilter: 'all' | 'mapped' | 'unmapped' = 'all';
  let assetClientFilter = '';
  let assetPage = 1;
  const ASSET_PAGE_SIZE = 50;

  $: assetClientOptions = [...new Set(psaAssets.map(a => a.org_name).filter(Boolean))].sort();
  $: assetFiltered = psaAssets.filter(a => {
    if (assetSearch && !a.name.toLowerCase().includes(assetSearch.toLowerCase()) &&
        !a.org_name.toLowerCase().includes(assetSearch.toLowerCase())) return false;
    if (assetMappingFilter === 'mapped'   && !psaAssetMappings[a.source_id]) return false;
    if (assetMappingFilter === 'unmapped' &&  psaAssetMappings[a.source_id]) return false;
    if (assetClientFilter && a.org_name !== assetClientFilter) return false;
    return true;
  });
  $: assetTotalPages = Math.max(1, Math.ceil(assetFiltered.length / ASSET_PAGE_SIZE));
  $: assetPageItems  = assetFiltered.slice((assetPage - 1) * ASSET_PAGE_SIZE, assetPage * ASSET_PAGE_SIZE);
  $: if (assetSearch || assetMappingFilter || assetClientFilter) assetPage = 1;

  // Group devices by org for the mapping dropdown
  $: groupedDevices = (() => {
    const map = new Map<string, DeviceOption[]>();
    for (const d of psaDeviceOptions) {
      const key = d.org_name || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  })();

  // ── PSA filter config state (kept for settings panel) ────────────────────
  type AssetTypeOption = { id: string; name: string };
  type ClientTypeOption = { id: string; name: string };
  let filterAssetTypes: AssetTypeOption[] = [];
  let filterClientTypes: ClientTypeOption[] = [];
  let filterSelectedAssetTypeIds: number[] = [];
  let filterClientTypeId: number | null = null;
  let filterOrgSourceMode: 'client' | 'custom_field' = 'client';
  let filterOrgCustomField = '';
  let filterTenantType = '';
  let filterOptionsLoading = false;
  let filterOptionsError = '';
  let filterSaving = false;
  let filterSaved = '';
  let filterIntegId: number | null = null;
  let showFilterSettings = false;

  let psaTabLoaded = false;
  $: if (tab === 'psa' && psaSubTab === 'client_mapping' && !psaClientsLoading && psaClients.length === 0 && !psaClientsError) {
    loadPsaClients();
  }
  $: if (tab === 'psa' && psaSubTab === 'asset_mapping' && !psaAssetsLoading && psaAssets.length === 0 && !psaAssetsError) {
    loadPsaAssets();
  }

  async function loadPsaClients() {
    psaClientsLoading = true; psaClientsError = ''; psaClients = [];
    try {
      const data = await apiFetch('/api/v1/assets/psa-clients');
      if (data.error) { psaClientsError = data.error; return; }
      psaClients = data.psa_clients ?? [];
      psaOrgs    = data.orgs ?? [];
      psaClientMappings = {};
      for (const c of psaClients) {
        psaClientMappings[c.psa_client_id] = c.mapped_org_id ?? '';
      }
    } catch (e: any) { psaClientsError = e.message ?? 'Failed to load PSA clients'; }
    finally { psaClientsLoading = false; }
  }

  async function saveMappings() {
    savingMappings = true; mappingsSaved = '';
    try {
      const body = Object.entries(psaClientMappings)
        .filter(([, orgId]) => orgId !== '')
        .map(([psa_client_id, org_id]) => ({ psa_client_id, org_id: Number(org_id) }));
      const res = await apiFetch('/api/v1/assets/psa-clients/map', { method: 'POST', body: JSON.stringify(body) });
      mappingsSaved = `Saved ${res.saved ?? 0} mapping${res.saved !== 1 ? 's' : ''}`;
      await loadPsaClients();
    } catch (e: any) { psaClientsError = e.message ?? 'Save failed'; }
    finally { savingMappings = false; }
  }

  async function triggerPsaSync() {
    psaSyncing = true; psaSyncMsg = '';
    try {
      const res = await apiFetch('/api/v1/integrations/psa/sync-devices', { method: 'POST' });
      psaSyncMsg = `Sync complete — ${res.created ?? 0} created, ${res.updated ?? 0} updated`;
    } catch (e: any) { psaSyncMsg = e.message ?? 'Sync failed'; }
    finally { psaSyncing = false; }
  }

  async function loadPsaAssets() {
    psaAssetsLoading = true; psaAssetsError = ''; psaAssets = [];
    try {
      const data = await apiFetch('/api/v1/assets/psa-assets');
      if (data.error) { psaAssetsError = data.error; return; }
      psaAssets = data.psa_assets ?? [];
      psaDeviceOptions = data.devices ?? [];
      psaAssetMappings = {};
      for (const a of psaAssets) {
        psaAssetMappings[a.source_id] = a.mapped_device_id ?? '';
      }
    } catch (e: any) { psaAssetsError = e.message ?? 'Failed to load PSA assets'; }
    finally { psaAssetsLoading = false; }
  }

  async function saveAssetMappings() {
    savingAssetMappings = true; assetMappingsSaved = '';
    try {
      const body = Object.entries(psaAssetMappings)
        .filter(([, deviceId]) => deviceId !== '')
        .map(([source_id, device_id]) => ({ source_id, device_id: Number(device_id) }));
      const res = await apiFetch('/api/v1/assets/psa-assets/map', { method: 'POST', body: JSON.stringify(body) });
      assetMappingsSaved = `Saved ${res.saved ?? 0} mapping${res.saved !== 1 ? 's' : ''}`;
      await loadPsaAssets();
    } catch (e: any) { psaAssetsError = e.message ?? 'Save failed'; }
    finally { savingAssetMappings = false; }
  }

  async function createAndMapDevice(asset: PsaAsset, orgId: number) {
    creatingDevice = { ...creatingDevice, [asset.source_id]: true };
    try {
      const res = await apiFetch('/api/v1/assets/psa-assets/create-device', {
        method: 'POST',
        body: JSON.stringify({ source_id: asset.source_id, name: asset.name, org_id: orgId }),
      });
      psaDeviceOptions = [...psaDeviceOptions, { id: res.device_id, name: res.name, org_id: orgId, org_name: asset.org_name, msp_name: '' }];
      psaAssetMappings = { ...psaAssetMappings, [asset.source_id]: res.device_id };
    } catch (e: any) { psaAssetsError = e.message ?? 'Failed to create device'; }
    finally { creatingDevice = { ...creatingDevice, [asset.source_id]: false }; }
  }

  async function loadFilterOptions() {
    filterOptionsLoading = true; filterOptionsError = ''; filterAssetTypes = []; filterClientTypes = [];
    try {
      const res = await apiFetch('/api/v1/integrations/psa/filter-options');
      filterAssetTypes   = res.asset_types ?? [];
      filterClientTypes  = res.client_types ?? [];
      filterIntegId      = res.integration_id ?? null;
      filterTenantType   = res.tenant_type ?? '';
      const cfg = res.current_config ?? {};
      filterClientTypeId        = cfg.client_type_id ?? null;
      filterSelectedAssetTypeIds = cfg.asset_type_ids ?? [];
      filterOrgSourceMode       = cfg.org_source_mode ?? 'client';
      filterOrgCustomField      = cfg.org_custom_field ?? '';
    } catch (e: any) { filterOptionsError = e.message ?? 'Failed to load filter options'; }
    finally { filterOptionsLoading = false; }
  }

  function toggleAssetTypeId(id: number) {
    if (filterSelectedAssetTypeIds.includes(id)) {
      filterSelectedAssetTypeIds = filterSelectedAssetTypeIds.filter((x: number) => x !== id);
    } else {
      filterSelectedAssetTypeIds = [...filterSelectedAssetTypeIds, id];
    }
  }

  async function saveFilterConfig() {
    filterSaving = true; filterSaved = ''; filterOptionsError = '';
    try {
      await apiFetch('/api/v1/integrations/psa/filter-config', {
        method: 'PATCH',
        body: JSON.stringify({
          client_type_id:   filterClientTypeId,
          asset_type_ids:   filterSelectedAssetTypeIds,
          org_source_mode:  filterOrgSourceMode,
          org_custom_field: filterOrgCustomField,
        }),
      });
      filterSaved = 'Settings saved.';
    } catch (e: any) { filterOptionsError = e.message ?? 'Save failed'; }
    finally { filterSaving = false; }
  }

  // ── Mailbox & Rules state ─────────────────────────────────────────────────
  let mailboxSubTab: 'mailboxes' | 'rules' | 'processed' = 'mailboxes';

  let mailboxes: MailboxConfig[] = [];
  let mailboxLoading = false;
  let mailboxLoadErr = '';
  let showMailboxForm = false;
  let mailboxSaving = false;
  let mailboxSaveErr = '';
  let mailboxTestResult: Record<number, string> = {};
  let newMailbox: MailboxCreate = { name: '', mailbox_type: 'imap', host: '', port: 993, username: '', password: '', use_ssl: true, folder: 'INBOX', is_active: true };

  async function loadMailboxes() {
    mailboxLoading = true; mailboxLoadErr = '';
    try { mailboxes = await api.listMailboxes(); }
    catch (e: unknown) { mailboxLoadErr = e instanceof Error ? e.message : 'Failed to load mailboxes'; }
    finally { mailboxLoading = false; }
  }

  async function saveMailbox() {
    mailboxSaving = true; mailboxSaveErr = '';
    try {
      await api.createMailbox(newMailbox);
      showMailboxForm = false;
      newMailbox = { name: '', mailbox_type: 'imap', host: '', port: 993, username: '', password: '', use_ssl: true, folder: 'INBOX', is_active: true };
      await loadMailboxes();
    } catch (e: unknown) { mailboxSaveErr = e instanceof Error ? e.message : 'Failed to save'; }
    finally { mailboxSaving = false; }
  }

  async function deleteMailbox(id: number) {
    if (!confirm('Delete this mailbox?')) return;
    try { await api.deleteMailbox(id); await loadMailboxes(); }
    catch (e: unknown) { mailboxLoadErr = e instanceof Error ? e.message : 'Failed to delete'; }
  }

  async function testMailboxConn(id: number) {
    mailboxTestResult = { ...mailboxTestResult, [id]: 'testing…' };
    try {
      const res = await api.testMailbox(id);
      mailboxTestResult = { ...mailboxTestResult, [id]: res.message || 'OK' };
    } catch (e: unknown) {
      mailboxTestResult = { ...mailboxTestResult, [id]: e instanceof Error ? e.message : 'Failed' };
    }
  }

  let mailboxPollResult: Record<number, string> = {};
  async function pollMailboxNow(id: number) {
    mailboxPollResult = { ...mailboxPollResult, [id]: 'polling…' };
    try {
      const res = await api.pollMailboxNow(id);
      mailboxPollResult = { ...mailboxPollResult, [id]: res.message };
      if (mailboxSubTab === 'processed') loadProcessedEmails();
    } catch (e: unknown) {
      mailboxPollResult = { ...mailboxPollResult, [id]: e instanceof Error ? e.message : 'Failed' };
    }
  }

  // ── Parsing Rules state ───────────────────────────────────────────────────
  let parsingRules: ParsingRule[] = [];
  let rulesLoading = false;
  let rulesLoadErr = '';
  let showRuleForm = false;
  let ruleSaving = false;
  let ruleSaveErr = '';
  let editingRuleId: number | null = null;
  const TOOL_OPTIONS: {value: string; label: string}[] = [
    { value: 'veeam',            label: 'Veeam' },
    { value: 'datto',            label: 'Datto BCDR' },
    { value: 'datto_saas',       label: 'Datto SaaS Protection' },
    { value: 'datto_endpoint',   label: 'Datto Endpoint' },
    { value: 'acronis',          label: 'Acronis' },
    { value: 'aws_backup',       label: 'AWS Backup' },
    { value: 'cove',             label: 'Cove Data Protection' },
    { value: 'slide',            label: 'Slide' },
    { value: 'storagecraft',     label: 'StorageCraft' },
    { value: 'skykick',          label: 'SkyKick' },
    { value: 'commvault',        label: 'Commvault' },
    { value: 'barracuda',        label: 'Barracuda' },
    { value: 'msp360',           label: 'MSP360' },
    { value: 'msp360_cloudberry',label: 'MSP360 (Cloudberry)' },
    { value: 'crashplan',        label: 'CrashPlan' },
    { value: 'other',            label: 'Other' },
  ];

  interface RuleTemplate {
    label: string;
    tool: string;
    description: string;
    from_pattern: string;
    subject_pattern: string;
    body_pattern: string;
    match_type: string;
    device_name_source: string; device_name_pattern: string;
    customer_name_source: string; customer_name_pattern: string;
    job_name_source: string; job_name_pattern: string;
    status_source: string; status_pattern: string;
    error_source: string; error_pattern: string;
    start_time_source: string; start_time_pattern: string;
    end_time_source: string; end_time_pattern: string;
    size_source: string; size_pattern: string;
    row_template: string;
    prefer_html?: boolean;
    success_keywords: string; failed_keywords: string; warning_keywords: string;
  }

  const RULE_TEMPLATES: RuleTemplate[] = [
    {
      label: 'Commvault / Metallic',
      tool: 'commvault',
      description: 'Matches Metallic/Commvault job alert emails. Extracts device, subclient, status and times from the HTML table body.',
      from_pattern: '', subject_pattern: 'Backup job', body_pattern: 'CommCell',
      match_type: 'contains',
      device_name_source: 'body_regex',  device_name_pattern: 'CommCell\\s+([^\\n]+)',
      customer_name_source: 'fixed',     customer_name_pattern: '',
      job_name_source: 'body_regex',     job_name_pattern: 'Job Id\\s+([^\\n]+)',
      status_source: 'body_regex',       status_pattern: 'Status\\s+([^\\n]+)',
      error_source: '',                  error_pattern: '',
      start_time_source: 'body_regex',   start_time_pattern: 'Start Time\\s+([^\\n]+)',
      end_time_source: 'body_regex',     end_time_pattern: 'End Time\\s+([^\\n]+)',
      size_source: 'body_regex',         size_pattern: 'Size\\s+([^\\n]+)',
      row_template: '',
      prefer_html: true,
      success_keywords: 'succeeded,success,completed',
      failed_keywords: 'failed,failure,error',
      warning_keywords: 'warning,partial,skipped',
    },
    {
      label: 'Veeam Backup & Replication',
      tool: 'veeam',
      description: 'Matches Veeam job summary emails. Extracts job name, status, start/end times and transferred data size.',
      from_pattern: '', subject_pattern: '', body_pattern: 'Veeam',
      match_type: 'contains',
      device_name_source: 'body_regex',  device_name_pattern: 'Job name:\\s+([^\\n]+)',
      customer_name_source: 'fixed',     customer_name_pattern: '',
      job_name_source: 'body_regex',     job_name_pattern: 'Job name:\\s+([^\\n]+)',
      status_source: 'body_regex',       status_pattern: 'Status:\\s+([^\\n]+)',
      error_source: 'body_regex',        error_pattern: 'Error:\\s+([^\\n]+)',
      start_time_source: 'body_regex',   start_time_pattern: 'Start time:\\s+([^\\n]+)',
      end_time_source: 'body_regex',     end_time_pattern: 'End time:\\s+([^\\n]+)',
      size_source: 'body_regex',         size_pattern: 'Transferred:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'success,succeeded,completed',
      failed_keywords: 'failed,failure,error',
      warning_keywords: 'warning,warnings,retrying',
    },
    {
      label: 'Veeam — Multi-VM Summary',
      tool: 'veeam',
      description: 'For Veeam emails that list multiple VMs in a table (one device per row). Creates one job per device. Set a fixed org_id or MSP org to auto-resolve customer.',
      from_pattern: '', subject_pattern: '', body_pattern: 'Veeam',
      match_type: 'contains',
      device_name_source: 'body_row',      device_name_pattern: '',
      customer_name_source: 'fixed',       customer_name_pattern: '',
      job_name_source: 'subject_regex',    job_name_pattern: ']\\s+(.+?)\\s*[\\(]',
      status_source: 'keywords',           status_pattern: '',
      error_source: '',                    error_pattern: '',
      start_time_source: '',               start_time_pattern: '',
      end_time_source: '',                 end_time_pattern: '',
      size_source: '',                     size_pattern: '',
      row_template: '{Device Name}\\n{Status}\\n{Start Time}\\n{End Time}\\n{Size}\\n',
      prefer_html: true,
      success_keywords: 'success,succeeded,completed',
      failed_keywords: 'failed,failure,error',
      warning_keywords: 'warning,warnings,retrying',
    },
    {
      label: 'Acronis Cyber Cloud',
      tool: 'acronis',
      description: 'Matches Acronis backup alert emails. Device name and status extracted from subject line.',
      from_pattern: 'acronis', subject_pattern: '', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'body_regex',  device_name_pattern: 'Machine name:\\s+([^\\n]+)',
      customer_name_source: 'fixed',     customer_name_pattern: '',
      job_name_source: 'body_regex',     job_name_pattern: 'Plan name:\\s+([^\\n]+)',
      status_source: 'keywords',         status_pattern: '',
      error_source: 'body_regex',        error_pattern: 'Error message:\\s+([^\\n]+)',
      start_time_source: 'body_regex',   start_time_pattern: 'Start time:\\s+([^\\n]+)',
      end_time_source: 'body_regex',     end_time_pattern: 'Finish time:\\s+([^\\n]+)',
      size_source: 'body_regex',         size_pattern: 'Backed up data:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'succeeded,success,completed successfully',
      failed_keywords: 'failed,error',
      warning_keywords: 'warning,completed with warnings',
    },
    {
      label: 'N-able Cove Data Protection',
      tool: 'cove',
      description: 'Matches Cove (formerly SolarWinds Backup) alert emails.',
      from_pattern: 'cove', subject_pattern: '', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'body_regex',  device_name_pattern: 'Device:\\s+([^\\n]+)',
      customer_name_source: 'body_regex',customer_name_pattern: 'Customer:\\s+([^\\n]+)',
      job_name_source: 'body_regex',     job_name_pattern: 'Backup type:\\s+([^\\n]+)',
      status_source: 'keywords',         status_pattern: '',
      error_source: '',                  error_pattern: '',
      start_time_source: 'body_regex',   start_time_pattern: 'Started:\\s+([^\\n]+)',
      end_time_source: 'body_regex',     end_time_pattern: 'Finished:\\s+([^\\n]+)',
      size_source: 'body_regex',         size_pattern: 'Protected data:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'completed,success,ok',
      failed_keywords: 'failed,error,unsuccessful',
      warning_keywords: 'warning,partial,missed',
    },
    {
      label: 'Datto BCDR',
      tool: 'datto',
      description: 'Matches Datto BCDR backup alert emails.',
      from_pattern: 'datto', subject_pattern: '', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'subject_regex', device_name_pattern: '^([^\\-]+)',
      customer_name_source: 'fixed',       customer_name_pattern: '',
      job_name_source: 'subject_regex',    job_name_pattern: '',
      status_source: 'keywords',           status_pattern: '',
      error_source: '',                    error_pattern: '',
      start_time_source: '',               start_time_pattern: '',
      end_time_source: '',                 end_time_pattern: '',
      size_source: '',                     size_pattern: '',
      row_template: '',
      success_keywords: 'success,completed,passed',
      failed_keywords: 'failed,failure,critical',
      warning_keywords: 'warning,missed,partial',
    },
    {
      label: 'Datto SaaS Protection',
      tool: 'datto_saas',
      description: 'Matches Datto SaaS Protection backup report emails for Microsoft 365, Google Workspace, and Salesforce.',
      from_pattern: 'datto', subject_pattern: 'SaaS Protection', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'body_regex',    device_name_pattern: 'Account:\\s+([^\\n]+)',
      customer_name_source: 'body_regex',  customer_name_pattern: 'Organization:\\s+([^\\n]+)',
      job_name_source: 'body_regex',       job_name_pattern: 'Service:\\s+([^\\n]+)',
      status_source: 'keywords',           status_pattern: '',
      error_source: 'body_regex',          error_pattern: 'Error:\\s+([^\\n]+)',
      start_time_source: 'body_regex',     start_time_pattern: 'Started:\\s+([^\\n]+)',
      end_time_source: 'body_regex',       end_time_pattern: 'Completed:\\s+([^\\n]+)',
      size_source: 'body_regex',           size_pattern: 'Protected data:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'success,completed,protected',
      failed_keywords: 'failed,failure,error,unprotected',
      warning_keywords: 'warning,partial,incomplete',
    },
    {
      label: 'CrashPlan Admin Report',
      tool: 'crashplan',
      description: 'CrashPlan Admin Backup Status Report — multi-device. Each row is one computer. 100% backed up = Success, below 100% = Warning.',
      from_pattern: 'noreply@crashplan.com', subject_pattern: 'CrashPlan Admin Backup Status Report', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'body_row',        device_name_pattern: '',
      customer_name_source: 'body_regex',    customer_name_pattern: 'Reporting period:[^\\n]+\\n\\n?([^\\n]+)',
      job_name_source: 'body_row',           job_name_pattern: '',
      status_source: 'keywords',             status_pattern: '',
      error_source: '',                      error_pattern: '',
      start_time_source: '',                 start_time_pattern: '',
      end_time_source: '',                   end_time_pattern: '',
      size_source: '',                       size_pattern: '',
      row_template: '{Device Name}->{Job Name}',
      prefer_html: false,
      success_keywords: '100.0%',
      failed_keywords: '',
      warning_keywords: '99.9%,99.8%,99%,98%,97%,96%,95%,90%,80%,70%,60%,50%,40%,30%,20%,10%,0%',
    },
    {
      label: 'MSP360 / CloudBerry',
      tool: 'msp360_cloudberry',
      description: 'Matches MSP360 CloudBerry Backup completion emails (HTML-only, one device per email). Extracts computer name, customer, job, start time and data size.',
      from_pattern: 'no-reply@msp360.com', subject_pattern: 'CloudBerry Backup', body_pattern: '',
      match_type: 'contains',
      device_name_source: 'body_regex',    device_name_pattern: 'Computer:\\s+([^\\n]+)',
      customer_name_source: 'body_regex',  customer_name_pattern: 'Dear CloudBerry Backup - ([^,\\n]+)',
      job_name_source: 'body_regex',       job_name_pattern: 'backup plan (.+?) completed',
      status_source: 'keywords',           status_pattern: '',
      error_source: 'body_regex',          error_pattern: 'Information\\n([\\s\\S]+?)(?=\\nNote:|\\nStart date:)',
      start_time_source: 'body_regex',     start_time_pattern: 'Start date:\\s+([^\\n]+)',
      end_time_source: '',                 end_time_pattern: '',
      size_source: 'body_regex',           size_pattern: 'Data scanned:\\s+([^\\n]+)',
      row_template: '',
      prefer_html: false,
      success_keywords: 'completed',
      failed_keywords: 'failed,error',
      warning_keywords: 'warning,skipped,partial',
    },
    {
      label: 'Barracuda Backup',
      tool: 'barracuda',
      description: 'Matches Barracuda MSP / Focus Backup Monitor emails. Extracts device and customer from subject brackets, times and size from body.',
      from_pattern: 'barracudamsp.com', subject_pattern: 'Focus Backup Monitor', body_pattern: '',
      match_type: 'contains',
      // Subject format: Focus Backup Monitor [customer, DEVICE, id] Status "Job Name"
      device_name_source: 'subject_regex',    device_name_pattern: '\\[(?:[^,]+),\\s*([^,\\]]+)',
      customer_name_source: 'subject_regex',  customer_name_pattern: '\\[([^,\\]]+)',
      job_name_source: 'subject_regex',       job_name_pattern: '"([^"]+)"',
      status_source: 'keywords',              status_pattern: '',
      error_source: '',                       error_pattern: '',
      start_time_source: 'body_regex',        start_time_pattern: 'Start Time:\\s+([^\\n]+)',
      end_time_source: 'body_regex',          end_time_pattern: 'End Time:\\s+([^\\n]+)',
      size_source: 'body_regex',              size_pattern: 'Data Sent:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'completed,success,succeeded',
      failed_keywords: 'failed,failure,error',
      warning_keywords: 'warning,partial,missed',
    },
    {
      label: 'StorageCraft / Arcserve',
      tool: 'storagecraft',
      description: 'Matches StorageCraft ShadowProtect or Arcserve UDP email alerts.',
      from_pattern: '', subject_pattern: '', body_pattern: 'ShadowProtect',
      match_type: 'contains',
      device_name_source: 'body_regex',  device_name_pattern: 'Computer:\\s+([^\\n]+)',
      customer_name_source: 'fixed',     customer_name_pattern: '',
      job_name_source: 'body_regex',     job_name_pattern: 'Job:\\s+([^\\n]+)',
      status_source: 'keywords',         status_pattern: '',
      error_source: 'body_regex',        error_pattern: 'Error:\\s+([^\\n]+)',
      start_time_source: 'body_regex',   start_time_pattern: 'Start:\\s+([^\\n]+)',
      end_time_source: 'body_regex',     end_time_pattern: 'End:\\s+([^\\n]+)',
      size_source: 'body_regex',         size_pattern: 'Size:\\s+([^\\n]+)',
      row_template: '',
      success_keywords: 'success,completed,succeeded',
      failed_keywords: 'failed,failure,error',
      warning_keywords: 'warning,partial',
    },
  ];

  let selectedTemplate = '';
  function applyTemplate(tplLabel: string) {
    const tpl = RULE_TEMPLATES.find(t => t.label === tplLabel);
    if (!tpl) return;
    newRule = {
      ...newRule,
      tool: tpl.tool,
      from_pattern: tpl.from_pattern,
      subject_pattern: tpl.subject_pattern,
      body_pattern: tpl.body_pattern,
      match_type: tpl.match_type,
      device_name_source: tpl.device_name_source, device_name_pattern: tpl.device_name_pattern,
      customer_name_source: tpl.customer_name_source, customer_name_pattern: tpl.customer_name_pattern,
      job_name_source: tpl.job_name_source, job_name_pattern: tpl.job_name_pattern,
      status_source: tpl.status_source, status_pattern: tpl.status_pattern,
      error_source: tpl.error_source, error_pattern: tpl.error_pattern,
      start_time_source: tpl.start_time_source, start_time_pattern: tpl.start_time_pattern,
      end_time_source: tpl.end_time_source, end_time_pattern: tpl.end_time_pattern,
      size_source: tpl.size_source, size_pattern: tpl.size_pattern,
      row_template: tpl.row_template,
      prefer_html: tpl.prefer_html ?? false,
    };
    kwSuccess = tpl.success_keywords;
    kwFailed  = tpl.failed_keywords;
    kwWarning = tpl.warning_keywords;
    selectedTemplate = '';
  }

  function _blankRule(): ParsingRuleBody {
    return {
      name: '', priority: 100, match_type: 'contains',
      from_pattern: '', subject_pattern: '', body_pattern: '',
      msp_org_id: null, org_id: null, tool: null,
      success_keywords: [], failed_keywords: [], warning_keywords: [],
      device_name_source: 'subject_regex', device_name_pattern: '',
      customer_name_source: 'fixed', customer_name_pattern: '',
      job_name_source: 'subject_regex', job_name_pattern: '',
      status_source: 'keywords', status_pattern: '',
      error_source: '', error_pattern: '',
      start_time_source: '', start_time_pattern: '',
      end_time_source: '', end_time_pattern: '',
      size_source: '', size_pattern: '',
      row_template: '',
      prefer_html: false,
      is_active: true,
    };
  }
  let newRule: ParsingRuleBody = _blankRule();
  let kwSuccess = '';
  let kwFailed = 'failed,error,unsuccessful';
  let kwWarning = 'warning,missed,partial';

  async function loadParsingRules() {
    rulesLoading = true; rulesLoadErr = '';
    try { parsingRules = await api.listParsingRules(); }
    catch (e: unknown) { rulesLoadErr = e instanceof Error ? e.message : 'Failed to load rules'; }
    finally { rulesLoading = false; }
  }

  async function saveRule() {
    ruleSaving = true; ruleSaveErr = '';
    const payload: ParsingRuleBody = {
      ...newRule,
      success_keywords: kwSuccess.split(',').map(s => s.trim()).filter(Boolean),
      failed_keywords:  kwFailed.split(',').map(s => s.trim()).filter(Boolean),
      warning_keywords: kwWarning.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      if (editingRuleId !== null) await api.updateParsingRule(editingRuleId, payload);
      else await api.createParsingRule(payload);
      showRuleForm = false; editingRuleId = null; selectedTemplate = '';
      newRule = _blankRule(); kwSuccess = ''; kwFailed = 'failed,error,unsuccessful'; kwWarning = 'warning,missed,partial';
      await loadParsingRules();
    } catch (e: unknown) { ruleSaveErr = e instanceof Error ? e.message : 'Failed to save rule'; }
    finally { ruleSaving = false; }
  }

  function startEditRule(r: ParsingRule) {
    editingRuleId = r.id;
    newRule = {
      mailbox_id: r.mailbox_id ?? null,
      name: r.name, priority: r.priority, match_type: r.match_type,
      from_pattern: r.from_pattern ?? '', subject_pattern: r.subject_pattern ?? '', body_pattern: r.body_pattern ?? '',
      msp_org_id: r.msp_org_id ?? null, org_id: r.org_id ?? null, tool: r.tool ?? null,
      success_keywords: r.success_keywords ?? [], failed_keywords: r.failed_keywords ?? [], warning_keywords: r.warning_keywords ?? [],
      device_name_source:    r.device_name_source    ?? 'subject_regex', device_name_pattern:    r.device_name_pattern    ?? '',
      customer_name_source:  r.customer_name_source  ?? 'fixed',         customer_name_pattern:  r.customer_name_pattern  ?? '',
      job_name_source:       r.job_name_source       ?? 'subject_regex', job_name_pattern:       r.job_name_pattern       ?? '',
      status_source:         r.status_source         ?? 'keywords',      status_pattern:         r.status_pattern         ?? '',
      error_source:          r.error_source          ?? '',              error_pattern:          r.error_pattern          ?? '',
      start_time_source:     r.start_time_source     ?? '',              start_time_pattern:     r.start_time_pattern     ?? '',
      end_time_source:       r.end_time_source       ?? '',              end_time_pattern:       r.end_time_pattern       ?? '',
      size_source:           r.size_source           ?? '',              size_pattern:           r.size_pattern           ?? '',
      row_template: r.row_template ?? '',
      prefer_html: r.prefer_html ?? false,
      is_active: r.is_active,
    };
    kwSuccess = (r.success_keywords ?? []).join(', ');
    kwFailed  = (r.failed_keywords  ?? []).join(', ');
    kwWarning = (r.warning_keywords ?? []).join(', ');
    showRuleForm = true;
  }

  async function deleteRule(id: number) {
    if (!confirm('Delete this parsing rule?')) return;
    try { await api.deleteParsingRule(id); await loadParsingRules(); }
    catch (e: unknown) { rulesLoadErr = e instanceof Error ? e.message : 'Failed to delete'; }
  }

  // ── Processed Emails state ───────────────────────────────────────────────
  let processedEmails: ProcessedEmail[] = [];
  let processedLoading = false;
  let processedLoadErr = '';
  let processedFilterResult = '';
  let processedFilterMailbox: number | '' = '';

  async function loadProcessedEmails() {
    processedLoading = true; processedLoadErr = '';
    try {
      processedEmails = await api.listProcessedEmails({
        mailbox_id: processedFilterMailbox || undefined,
        result: processedFilterResult || undefined,
        limit: 200,
      });
    } catch (e: unknown) { processedLoadErr = e instanceof Error ? e.message : 'Failed to load'; }
    finally { processedLoading = false; }
  }

  let mailboxTabLoaded = false;
  $: if (tab === 'mailbox' && !mailboxTabLoaded) {
    mailboxTabLoaded = true;
    loadMailboxes();
    loadParsingRules();
  }
  $: if (mailboxSubTab === 'processed') loadProcessedEmails();

  // ── Load data ─────────────────────────────────────────────────────────────
  async function loadBackup() {
    loadingBackup = true;
    try {
      [allConnectors, connectorOrgs] = await Promise.all([api.connectors(), api.connectorOrgs()]);
    } finally { loadingBackup = false; }
  }

  async function loadInteg() {
    loadingInteg = true; integError = '';
    try {
      [providers, integrations] = await Promise.all([
        apiFetch('/api/v1/integrations/providers'),
        apiFetch('/api/v1/integrations'),
      ]);
    } catch (e: unknown) { integError = e instanceof Error ? e.message : String(e); }
    finally { loadingInteg = false; }
  }

  onMount(() => { loadBackup(); loadInteg(); });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function countForTool(toolId: string) {
    return allConnectors.filter(c => c.tool === toolId).length;
  }

  // Group connectorOrgs for display: top-level orgs first, then their children indented
  $: groupedConnectorOrgs = (() => {
    const topLevel = connectorOrgs.filter(o => o.parent_id === null);
    return topLevel.flatMap(parent => [
      { ...parent, indent: false },
      ...connectorOrgs.filter(o => o.parent_id === parent.id).map(c => ({ ...c, indent: true })),
    ]);
  })();

  // Master MSP: tenant_type determines the mode, not org count.
  // A regular MSP has one root org (themselves) — they should NOT see the MSP selector.
  $: mspOrgs = connectorOrgs.filter(o => o.parent_id === null && o.type === 'msp');
  $: isMasterMsp = $auth?.tenant_type === 'master_msp';

  // Selected MSP filter for the add-connector form
  let selectedMspId: number | null = null;

  // Orgs available in the Organisation dropdown based on MSP selection.
  // Includes the MSP itself (for "pull all clients from this MSP's API") plus its direct children.
  $: filteredConnectorOrgs = (() => {
    if (!isMasterMsp) return connectorOrgs; // regular MSP: show all
    if (selectedMspId) return connectorOrgs.filter(o => o.id === selectedMspId || o.parent_id === selectedMspId);
    return []; // master MSP but no MSP selected yet: show nothing
  })();

  async function openTool(toolId: string) {
    if (isToolBlocked(toolId)) return;
    selectedTool = toolId;
    showAddConn = false;
    editingConnId = null;
    toolLoading = true;
    toolConnectors = await api.connectors({ tool: toolId });
    toolLoading = false;
  }

  function backToList() { selectedTool = null; showAddConn = false; editingConnId = null; }

  // Connector CRUD
  function buildAzureExtraConfig(tenantId: string, subId: string): string {
    return JSON.stringify({ tenant_id: tenantId, subscription_id: subId });
  }

  function parseAzureExtraConfig(extraConfig: string | null): { tenantId: string; subId: string } {
    try {
      const p = JSON.parse(extraConfig ?? '{}');
      return { tenantId: p.tenant_id ?? '', subId: p.subscription_id ?? '' };
    } catch { return { tenantId: '', subId: '' }; }
  }

  function buildCoveExtraConfig(integVersion: string, profileName: string): string {
    return JSON.stringify({ integration_version: integVersion, profile_name: profileName });
  }

  function parseCoveExtraConfig(extraConfig: string | null): { integVersion: string; profileName: string } {
    try {
      const p = JSON.parse(extraConfig ?? '{}');
      return { integVersion: p.integration_version ?? 'standalone', profileName: p.profile_name ?? '' };
    } catch { return { integVersion: 'standalone', profileName: '' }; }
  }

  async function saveAddConn() {
    savingConn = true; addConnError = '';
    try {
      const payload: Parameters<typeof api.createConnector>[0] = { ...newConn, tool: selectedTool! };
      // When no specific sub-org chosen but an MSP is selected, bind the connector to that MSP
      // so API-fetched clients nest correctly under it rather than the master root.
      if (!payload.org_id && selectedMspId) payload.org_id = selectedMspId;
      if (selectedTool === 'azure_backup') {
        payload.extra_config = buildAzureExtraConfig(newAzureTenantId, newAzureSubId);
      } else if (selectedTool === 'cove') {
        payload.extra_config = buildCoveExtraConfig(newCoveIntegVersion, newCoveProfileName);
      }
      await api.createConnector(payload);
      showAddConn = false;
      newConn = { org_id: 0, tool: '', api_key: '', api_secret: '', base_url: '', is_enabled: true };
      newAzureTenantId = ''; newAzureSubId = ''; newCoveIntegVersion = 'standalone'; newCoveProfileName = '';
      selectedMspId = null;
      toolConnectors = await api.connectors({ tool: selectedTool! });
      allConnectors = await api.connectors();
    } catch (e: unknown) { addConnError = e instanceof Error ? e.message : String(e); }
    finally { savingConn = false; }
  }

  function startEditConn(c: Connector) {
    editingConnId = c.id;
    editConn = { api_key: c.api_key ?? '', api_secret: '', base_url: c.base_url ?? '', is_enabled: c.is_enabled, org_id: c.org_id ?? 0 };
    // Derive MSP from the client org's parent_id.
    // If the connector org IS the MSP itself (top-level), editMspId = that org's id.
    const clientOrg = connectorOrgs.find(o => o.id === c.org_id);
    editMspId = clientOrg ? (clientOrg.parent_id ?? (clientOrg.type === 'msp' ? clientOrg.id : null)) : null;
    const azure = parseAzureExtraConfig(c.extra_config);
    editAzureTenantId = azure.tenantId;
    editAzureSubId = azure.subId;
    const cove = parseCoveExtraConfig(c.extra_config);
    editCoveIntegVersion = cove.integVersion;
    editCoveProfileName = cove.profileName;
    editConnError = '';
  }

  async function saveEditConn() {
    if (!editingConnId) return;
    savingConn = true; editConnError = '';
    try {
      const { org_id, ...rest } = editConn;
      const payload: Parameters<typeof api.updateConnector>[1] = { ...rest };
      if (org_id) payload.org_id = org_id;
      if (selectedTool === 'azure_backup') {
        payload.extra_config = buildAzureExtraConfig(editAzureTenantId, editAzureSubId);
      } else if (selectedTool === 'cove') {
        payload.extra_config = buildCoveExtraConfig(editCoveIntegVersion, editCoveProfileName);
      }
      await api.updateConnector(editingConnId, payload);
      editingConnId = null;
      toolConnectors = await api.connectors({ tool: selectedTool! });
    } catch (e: unknown) { editConnError = e instanceof Error ? e.message : String(e); }
    finally { savingConn = false; }
  }

  async function toggleConn(c: Connector) {
    await api.updateConnector(c.id, { is_enabled: !c.is_enabled });
    toolConnectors = await api.connectors({ tool: selectedTool! });
    allConnectors = await api.connectors();
  }

  async function deleteConn(id: number) {
    if (!confirm('Remove this connector? All sync history for this connection will be removed.')) return;
    await api.deleteConnector(id);
    toolConnectors = await api.connectors({ tool: selectedTool! });
    allConnectors = await api.connectors();
  }

  async function testConn(id: number) {
    testingConnId = id;
    connTestResults = { ...connTestResults, [id]: undefined as unknown as { ok: boolean; message: string } };
    try {
      const r = await api.testConnector(id);
      connTestResults = { ...connTestResults, [id]: r };
    } catch (e: unknown) {
      connTestResults = { ...connTestResults, [id]: { ok: false, message: e instanceof Error ? e.message : String(e) } };
    } finally { testingConnId = null; }
  }

  // Integration CRUD (PSA/mailbox/other)
  $: tabIntegrations = integrations.filter(i => i.category === tab);
  $: tabProviders = Object.entries(providers).filter(([, m]) => m.category === tab);

  function startAddInteg(provId: string) {
    selectedProvider = provId; formValues = {}; saveIntegError = ''; showAddInteg = true;
  }

  async function saveAddInteg() {
    const meta = providers[selectedProvider];
    savingInteg = true; saveIntegError = '';
    try {
      const extra: Record<string, string> = {};
      const body: Record<string, unknown> = { provider: selectedProvider, is_enabled: true };
      for (const f of meta.fields) {
        const v = formValues[f.key] ?? '';
        if (f.key === 'base_url') body.base_url = v;
        else if (f.key === 'client_id') body.client_id = v;
        else if (f.key === 'client_secret') body.client_secret = v;
        else if (v) extra[f.key] = v;
      }
      if (Object.keys(extra).length) body.extra_config = extra;
      await apiFetch('/api/v1/integrations', { method: 'POST', body: JSON.stringify(body) });
      showAddInteg = false; selectedProvider = '';
      integrations = await apiFetch('/api/v1/integrations');
    } catch (e: unknown) { saveIntegError = e instanceof Error ? e.message : String(e); }
    finally { savingInteg = false; }
  }

  function startEditInteg(integ: Integration) {
    const meta = providers[integ.provider];
    editingIntegId = integ.id;
    editIntegValues = { base_url: integ.base_url ?? '' };
    for (const f of (meta?.fields ?? [])) {
      if (f.key === 'base_url') editIntegValues.base_url = integ.base_url ?? '';
      else if (f.key === 'client_id') editIntegValues.client_id = integ.client_id ?? '';
      else if (f.key === 'client_secret') editIntegValues.client_secret = '';
      else editIntegValues[f.key] = integ.extra_config?.[f.key] ?? '';
    }
    editIntegError = '';
  }

  async function saveEditInteg() {
    if (!editingIntegId) return;
    const integ = integrations.find(i => i.id === editingIntegId)!;
    const meta = providers[integ.provider];
    savingInteg = true; editIntegError = '';
    try {
      const extra: Record<string, string> = {};
      const body: Record<string, unknown> = {};
      for (const f of (meta?.fields ?? [])) {
        const v = editIntegValues[f.key] ?? '';
        if (f.key === 'base_url') body.base_url = v;
        else if (f.key === 'client_id' && v && v !== '***saved***') body.client_id = v;
        else if (f.key === 'client_secret' && v) body.client_secret = v;
        else if (v) extra[f.key] = v;
      }
      if (Object.keys(extra).length) body.extra_config = extra;
      await apiFetch(`/api/v1/integrations/${editingIntegId}`, { method: 'PUT', body: JSON.stringify(body) });
      editingIntegId = null;
      integrations = await apiFetch('/api/v1/integrations');
    } catch (e: unknown) { editIntegError = e instanceof Error ? e.message : String(e); }
    finally { savingInteg = false; }
  }

  async function toggleInteg(integ: Integration) {
    await apiFetch(`/api/v1/integrations/${integ.id}`, { method: 'PUT', body: JSON.stringify({ is_enabled: !integ.is_enabled }) });
    integrations = await apiFetch('/api/v1/integrations');
  }

  async function deleteInteg(id: number) {
    if (!confirm('Remove this integration?')) return;
    await apiFetch(`/api/v1/integrations/${id}`, { method: 'DELETE' });
    integrations = await apiFetch('/api/v1/integrations');
  }

  async function testInteg(id: number) {
    testingId = id;
    try {
      const r = await apiFetch(`/api/v1/integrations/${id}/test`, { method: 'POST' });
      testResults = { ...testResults, [id]: r };
    } catch (e: unknown) {
      testResults = { ...testResults, [id]: { status: 'error', message: e instanceof Error ? e.message : String(e) } };
    } finally { testingId = null; }
  }

  function statusBadge(status: string) {
    if (status === 'ok')    return 'bg-green-100 text-green-700';
    if (status === 'error') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-500';
  }

  const TABS = [
    { key: 'psa' as const,     label: 'PSA Integration' },
    { key: 'backup' as const,  label: 'Backup Integrations' },
    { key: 'other' as const,   label: 'Other' },
    { key: 'mailbox' as const, label: 'Mailboxes' },
  ];

  // ── Integration limits (from plan via auth store) ─────────────────────────
  // -1 = unlimited, null allowed_tools = all allowed
  $: maxIntegrations        = $auth?.max_integrations ?? -1;
  $: maxIntegPerTool        = $auth?.max_integrations_per_tool ?? -1;
  $: allowedTools           = $auth?.allowed_tools ?? null;        // string[] | null
  $: isMasterOrPlatform     = $auth?.tenant_type === 'master_msp' || $auth?.tenant_type === 'platform';
  $: isMsp                  = $auth?.tenant_type === 'msp';

  // Reactive counts derived from loaded integrations
  $: totalIntegCount        = integrations.length;
  $: countByCategory        = integrations.reduce((acc: Record<string, number>, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1; return acc;
  }, {});
  $: atIntegLimit           = isMsp && maxIntegrations !== -1 && totalIntegCount >= maxIntegrations;

  // Returns true if a provider key is blocked by the plan
  function isProviderBlocked(providerKey: string, category: string): boolean {
    if (isMasterOrPlatform) return false;
    if (allowedTools !== null && !allowedTools.includes(providerKey)) return true;
    if (maxIntegrations !== -1 && totalIntegCount >= maxIntegrations) return true;
    if (maxIntegPerTool !== -1 && (countByCategory[category] ?? 0) >= maxIntegPerTool) return true;
    return false;
  }

  function blockReason(providerKey: string, category: string): string {
    if (isMasterOrPlatform) return '';
    if (allowedTools !== null && !allowedTools.includes(providerKey))
      return 'Not included in your plan';
    if (maxIntegrations !== -1 && totalIntegCount >= maxIntegrations)
      return 'Plan limit reached (' + maxIntegrations + ' total)';
    if (maxIntegPerTool !== -1 && (countByCategory[category] ?? 0) >= maxIntegPerTool)
      return 'Category limit reached (' + maxIntegPerTool + ' per category)';
    return '';
  }

  // Returns true if a backup tool is blocked by allowed_tools
  function isToolBlocked(toolId: string): boolean {
    if (!isMsp || allowedTools === null) return false;
    return !allowedTools.includes(toolId);
  }
</script>

<div class="space-y-0">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold text-gray-900">Integrations</h1>
  </div>

  <!-- Top tabs -->
  <div class="border-b border-gray-300 flex">
    {#each TABS as t}
      <button on:click={() => { tab = t.key; selectedTool = null; showAddConn = false; showAddInteg = false; }}
        class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
          {tab === t.key
            ? 'border-brand-600 text-brand-700 bg-white'
            : 'border-transparent text-gray-500 hover:text-gray-700'}">
        {t.label}
      </button>
    {/each}
  </div>

  <div class="pt-4 space-y-4">

    <!-- ── Integration usage counter (plan enforcement) ── -->
    {#if !isMasterOrPlatform && (maxIntegrations !== -1 || maxIntegPerTool !== -1 || allowedTools !== null)}
      {@const atTotalLimit = maxIntegrations !== -1 && totalIntegCount >= maxIntegrations}
      <div class="flex items-center gap-4 text-xs px-4 py-2.5 rounded-lg"
        style="background: {atTotalLimit ? '#2d1010' : '#1a1a2e'}; border: 1px solid {atTotalLimit ? '#f87171' : '#374151'}; color: #d1d5db;">
        <span style="font-weight: 600; color: {atTotalLimit ? '#f87171' : '#9ca3af'};">
          Plan Limits
        </span>
        {#if maxIntegrations !== -1}
          <span>
            Integrations:
            <span style="font-weight: 600; color: {atTotalLimit ? '#f87171' : '#4ade80'};">
              {totalIntegCount}/{maxIntegrations}
            </span>
          </span>
        {/if}
        {#if maxIntegPerTool !== -1}
          <span style="color: #6b7280;">·</span>
          <span>Max per category: <span style="font-weight: 600; color: #d1d5db;">{maxIntegPerTool}</span></span>
        {/if}
        {#if allowedTools !== null}
          <span style="color: #6b7280;">·</span>
          <span>Allowed providers: <span style="font-weight: 600; color: #c084fc;">{allowedTools.length}</span></span>
        {/if}
        {#if atTotalLimit}
          <span style="color: #f87171; font-weight: 500;">— Upgrade your plan to add more</span>
        {/if}
      </div>
    {/if}

    <!-- ── BACKUP INTEGRATIONS ── -->
    {#if tab === 'backup'}

      {#if selectedTool === null}
        <!-- Tool list -->
        {#if loadingBackup}
          <p class="text-gray-400 text-sm py-8 text-center">Loading…</p>
        {:else}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Backup Tool</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Vendor</th>
                  <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Sources</th>
                  <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th class="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {#each BACKUP_TOOLS as tool}
                  {@const count = countForTool(tool.id)}
                  {@const toolBlocked = isToolBlocked(tool.id)}
                  <tr class="border-b border-gray-100"
                    style="opacity:{toolBlocked ? 0.4 : 1}; cursor:{toolBlocked ? 'not-allowed' : 'pointer'};"
                    title={toolBlocked ? 'Not available on your plan' : undefined}
                    on:click={() => openTool(tool.id)}>
                    <td class="px-5 py-3 font-medium text-gray-800">
                      {tool.label}
                      {#if toolBlocked}
                        <span class="ml-1 text-xs" style="color:#f87171;">— Not on plan</span>
                      {/if}
                    </td>
                    <td class="px-5 py-3 text-gray-500 text-xs">{tool.vendor}</td>
                    <td class="px-5 py-3 text-center">
                      {#if count > 0}
                        <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full" style="background:#ADD8E6; color:#111;">{count}</span>
                      {:else}
                        <span class="text-gray-300 text-xs">—</span>
                      {/if}
                    </td>
                    <td class="px-5 py-3 text-center">
                      {#if toolBlocked}
                        <span class="text-xs px-2 py-0.5 rounded-full" style="background:#fee2e2; color:#ef4444;">Restricted</span>
                      {:else if count > 0}
                        <span class="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">Configured</span>
                      {:else}
                        <span class="bg-gray-100 text-gray-400 text-xs px-2 py-0.5 rounded-full">Not configured</span>
                      {/if}
                    </td>
                    <td class="px-5 py-3 text-right">
                      {#if !toolBlocked}
                        <span class="text-brand-600 text-xs hover:underline">
                          {count > 0 ? 'View →' : 'Configure →'}
                        </span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      {:else}
        <!-- Tool drilldown -->
        {@const toolMeta = BACKUP_TOOLS.find(t => t.id === selectedTool)}

        <!-- Breadcrumb + header -->
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-gray-400 mb-1">
              <button class="hover:text-brand-600" on:click={backToList}>Backups</button>
              <span class="mx-1">/</span>
              <span class="text-gray-600">{toolMeta?.label}</span>
            </div>
            <h2 class="text-lg font-bold text-gray-800">{toolMeta?.label} Integrations</h2>
          </div>
          <button class="btn-secondary" on:click={() => { showAddConn = true; editingConnId = null; }}>
            + Configure new source
          </button>
        </div>

        <!-- Add connector form -->
        {#if showAddConn}
          <div class="bg-white rounded-lg shadow p-5 space-y-3 border-t-4 border-brand-600">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold text-gray-800 text-sm">New {toolMeta?.label} Source</h3>
              <button class="text-gray-400 hover:text-gray-600 text-xl" on:click={() => { showAddConn = false; selectedMspId = null; }}>×</button>
            </div>
            <form class="grid grid-cols-2 gap-3" on:submit|preventDefault={saveAddConn}>
              {#if isMasterMsp}
                <div class="col-span-2">
                  <label class="block text-xs text-gray-500 mb-1">MSP <span class="text-red-500">*</span></label>
                  <select
                    bind:value={selectedMspId}
                    on:change={() => { newConn.org_id = 0; }}
                    required
                    class="w-full border rounded px-2 py-1.5 text-sm {!selectedMspId ? 'text-gray-400' : ''}">
                    <option value={null} disabled selected>— Select MSP —</option>
                    {#each mspOrgs as msp}
                      <option value={msp.id}>{msp.name}</option>
                    {/each}
                  </select>
                </div>
              {/if}
              {#if selectedTool !== 'cove'}
                <div class="col-span-2">
                  <label class="block text-xs text-gray-500 mb-1">Organisation <span class="text-gray-400 text-xs">(optional — defaults to root MSP)</span></label>
                  <select bind:value={newConn.org_id}
                    class="w-full border rounded px-2 py-1.5 text-sm {!newConn.org_id ? 'text-gray-400' : ''}"
                    disabled={isMasterMsp && !selectedMspId}>
                    <option value={0}>— Auto (root MSP) —</option>
                    {#each filteredConnectorOrgs as org}
                      <option value={org.id}>{org.name}{isMasterMsp && org.id === selectedMspId ? ' (MSP — all clients)' : ''}</option>
                    {/each}
                  </select>
                </div>
              {/if}
              {#if selectedTool !== 'cove'}
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Profile Name</label>
                  <input type="text" placeholder="e.g. {toolMeta?.label} — Main"
                    class="w-full border rounded px-2 py-1.5 text-sm text-gray-400" disabled
                    value="Auto-generated from org name" />
                </div>
              {/if}

              {#if selectedTool === 'azure_backup'}
                <!-- Azure-specific fields -->
                <div>
                  <label for="az-tenant" class="block text-xs text-gray-500 mb-1">Tenant ID (Directory ID) <span class="text-red-500">*</span></label>
                  <input id="az-tenant" type="text" bind:value={newAzureTenantId} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label for="az-sub" class="block text-xs text-gray-500 mb-1">Subscription ID <span class="text-red-500">*</span></label>
                  <input id="az-sub" type="text" bind:value={newAzureSubId} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label for="az-appid" class="block text-xs text-gray-500 mb-1">Application ID (Client ID) <span class="text-red-500">*</span></label>
                  <input id="az-appid" type="text" bind:value={newConn.api_key} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label for="az-secret" class="block text-xs text-gray-500 mb-1">Application Key (Client Secret) <span class="text-red-500">*</span></label>
                  <input id="az-secret" type="password" bind:value={newConn.api_secret} required
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              {:else if selectedTool === 'cove'}
                <!-- Cove-specific fields -->
                <div class="col-span-2">
                  <label for="cove-profile" class="block text-xs text-gray-500 mb-1">Profile Name</label>
                  <input id="cove-profile" type="text" bind:value={newCoveProfileName}
                    placeholder="e.g. Cove Backup" class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label for="cove-username" class="block text-xs text-gray-500 mb-1">User Name (Partner Email) <span class="text-red-500">*</span></label>
                  <input id="cove-username" type="text" bind:value={newConn.api_key} required
                    placeholder="partner@example.com" class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label for="cove-apikey" class="block text-xs text-gray-500 mb-1">API Key <span class="text-red-500">*</span></label>
                  <input id="cove-apikey" type="password" bind:value={newConn.api_secret} required
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div class="col-span-2">
                  <label for="cove-integ-ver" class="block text-xs text-gray-500 mb-1">Integration Version</label>
                  <select id="cove-integ-ver" bind:value={newCoveIntegVersion}
                    class="w-full border rounded px-2 py-1.5 text-sm bg-white">
                    <option value="standalone">Stand Alone</option>
                    <option value="ncentral">N-central</option>
                  </select>
                </div>
              {:else if selectedTool === 'slide'}
                <!-- Slide-specific fields -->
                <div class="col-span-2">
                  <label for="slide-privkey" class="block text-xs text-gray-500 mb-1">Private Key <span class="text-red-500">*</span></label>
                  <input id="slide-privkey" type="password" bind:value={newConn.api_key} required
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              {:else}
                <!-- Generic fields for all other tools -->
                <div class={selectedTool === 'axcient' ? 'col-span-2' : ''}>
                  <label for="new-api-key" class="block text-xs text-gray-500 mb-1">API Key <span class="text-red-500">*</span></label>
                  <input id="new-api-key" type="text" bind:value={newConn.api_key} required
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                {#if selectedTool !== 'axcient'}
                <div>
                  <label for="new-api-secret" class="block text-xs text-gray-500 mb-1">API Secret</label>
                  <input id="new-api-secret" type="password" bind:value={newConn.api_secret}
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                {/if}
                <div class="col-span-2">
                  <label for="new-base-url" class="block text-xs text-gray-500 mb-1">Base URL</label>
                  <input id="new-base-url" type="text" bind:value={newConn.base_url} placeholder="https://api.example.com"
                    class="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
              {/if}
              {#if addConnError}
                <div class="col-span-2 bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{addConnError}</div>
              {/if}
              <div class="col-span-2 flex gap-2 justify-end">
                <button type="button" class="btn-secondary" on:click={() => { showAddConn = false; selectedMspId = null; }}>Cancel</button>
                <button type="submit" class="btn-secondary" disabled={savingConn}>
                  {savingConn ? 'Saving…' : 'Save Source'}
                </button>
              </div>
            </form>
          </div>
        {/if}

        <!-- Connectors table -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Profile / Organisation</th>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Base URL</th>
                <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Last Sync</th>
                <th class="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Enabled</th>
                <th class="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#if toolLoading}
                <tr><td colspan="5" class="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
              {:else if toolConnectors.length === 0}
                <tr>
                  <td colspan="5" class="px-5 py-10 text-center">
                    <p class="text-gray-400 text-sm mb-3">No sources configured for {toolMeta?.label} yet.</p>
                    <button class="btn-secondary text-xs" on:click={() => showAddConn = true}>+ Configure new source</button>
                  </td>
                </tr>
              {:else}
                {#each toolConnectors as c}
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-5 py-3 font-medium text-gray-800">
                      {c.org_name ?? `Org #${c.org_id}`}
                      <div class="text-xs text-gray-400 font-normal">{c.tool.toUpperCase()} connector</div>
                    </td>
                    <td class="px-5 py-3 text-gray-500 text-xs max-w-[200px] truncate">{c.base_url ?? '—'}</td>
                    <td class="px-5 py-3 text-gray-400 text-xs">
                      {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'Never'}
                      {#if c.last_sync_status}
                        <span class="ml-1 {c.last_sync_status === 'ok' ? 'text-green-600' : 'text-red-600'}">
                          ({c.last_sync_status})
                        </span>
                      {/if}
                    </td>
                    <td class="px-5 py-3 text-center">
                      <button
                        class="inline-flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors
                          {c.is_enabled ? 'border-green-500 text-green-500' : 'border-gray-300 text-gray-300'}"
                        title={c.is_enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                        on:click={() => toggleConn(c)}>
                        {#if c.is_enabled}✓{/if}
                      </button>
                    </td>
                    <td class="px-5 py-3 text-right">
                      <div class="flex items-center justify-end gap-3">
                        <button class="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
                          title="Test connection"
                          disabled={testingConnId === c.id}
                          on:click={() => testConn(c.id)}>
                          {testingConnId === c.id ? 'Testing…' : 'Test'}
                        </button>
                        <button class="text-blue-500 hover:text-blue-700" title="Edit"
                          on:click={() => startEditConn(c)}>✎</button>
                        <button class="text-red-400 hover:text-red-600" title="Delete"
                          on:click={() => deleteConn(c.id)}>✕</button>
                      </div>
                    </td>
                  </tr>

                  <!-- Inline test result row -->
                  {#if connTestResults[c.id]}
                    <tr class="border-b border-gray-100">
                      <td colspan="5" class="px-5 py-2 text-xs {connTestResults[c.id].ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}">
                        {connTestResults[c.id].ok ? '✓' : '✗'} {connTestResults[c.id].message}
                      </td>
                    </tr>
                  {/if}

                  <!-- Inline edit row -->
                  {#if editingConnId === c.id}
                    <tr class="bg-blue-50 border-b border-blue-100">
                      <td colspan="5" class="px-5 py-3">
                        <form class="flex flex-wrap gap-3 items-end" on:submit|preventDefault={saveEditConn}>
                          {#if isMasterMsp}
                          <div>
                            <label for="emsp-{c.id}" class="block text-xs text-gray-500 mb-1">MSP <span class="text-red-500">*</span></label>
                            <select id="emsp-{c.id}" bind:value={editMspId}
                              on:change={() => { editConn.org_id = 0; }}
                              class="border rounded px-2 py-1 text-sm bg-white w-52">
                              <option value={null}>— select MSP —</option>
                              {#each mspOrgs as msp}
                                <option value={msp.id}>{msp.name}</option>
                              {/each}
                            </select>
                          </div>
                          {/if}
                          <div>
                            <label for="eorg-{c.id}" class="block text-xs text-gray-500 mb-1">Client / Organisation</label>
                            <select id="eorg-{c.id}" bind:value={editConn.org_id}
                              class="border rounded px-2 py-1 text-sm bg-white w-52"
                              disabled={isMasterMsp && !editMspId}>
                              <option value={0}>— select client —</option>
                              {#each connectorOrgs.filter(o => !isMasterMsp || (editMspId ? (o.id === editMspId || o.parent_id === editMspId) : false)) as o}
                                <option value={o.id}>{o.name}{isMasterMsp && o.id === editMspId ? ' (MSP — all clients)' : ''}</option>
                              {/each}
                            </select>
                          </div>
                          {#if selectedTool === 'azure_backup'}
                            <div>
                              <label for="eaz-tenant-{c.id}" class="block text-xs text-gray-500 mb-1">Tenant ID</label>
                              <input id="eaz-tenant-{c.id}" type="text" bind:value={editAzureTenantId}
                                placeholder="Directory ID" class="border rounded px-2 py-1 text-sm w-52" />
                            </div>
                            <div>
                              <label for="eaz-sub-{c.id}" class="block text-xs text-gray-500 mb-1">Subscription ID</label>
                              <input id="eaz-sub-{c.id}" type="text" bind:value={editAzureSubId}
                                class="border rounded px-2 py-1 text-sm w-52" />
                            </div>
                            <div>
                              <label for="eaz-appid-{c.id}" class="block text-xs text-gray-500 mb-1">Application ID</label>
                              <input id="eaz-appid-{c.id}" type="text" bind:value={editConn.api_key}
                                placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-44" />
                            </div>
                            <div>
                              <label for="eaz-secret-{c.id}" class="block text-xs text-gray-500 mb-1">Application Key</label>
                              <input id="eaz-secret-{c.id}" type="password" bind:value={editConn.api_secret}
                                placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-44" />
                            </div>
                          {:else if selectedTool === 'cove'}
                            <div>
                              <label for="ecove-profile-{c.id}" class="block text-xs text-gray-500 mb-1">Profile Name</label>
                              <input id="ecove-profile-{c.id}" type="text" bind:value={editCoveProfileName}
                                placeholder="e.g. Cove Backup" class="border rounded px-2 py-1 text-sm w-52" />
                            </div>
                            <div>
                              <label for="ecove-user-{c.id}" class="block text-xs text-gray-500 mb-1">User Name</label>
                              <input id="ecove-user-{c.id}" type="text" bind:value={editConn.api_key}
                                placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-52" />
                            </div>
                            <div>
                              <label for="ecove-key-{c.id}" class="block text-xs text-gray-500 mb-1">API Key</label>
                              <input id="ecove-key-{c.id}" type="password" bind:value={editConn.api_secret}
                                placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-44" />
                            </div>
                            <div>
                              <label for="ecove-ver-{c.id}" class="block text-xs text-gray-500 mb-1">Integration Version</label>
                              <select id="ecove-ver-{c.id}" bind:value={editCoveIntegVersion}
                                class="border rounded px-2 py-1 text-sm bg-white w-36">
                                <option value="standalone">Stand Alone</option>
                                <option value="ncentral">N-central</option>
                              </select>
                            </div>
                          {:else if selectedTool === 'slide'}
                            <div>
                              <label for="eslide-key-{c.id}" class="block text-xs text-gray-500 mb-1">Private Key</label>
                              <input id="eslide-key-{c.id}" type="password" bind:value={editConn.api_key}
                                placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-60" />
                            </div>
                          {:else}
                          <div>
                            <label for="eapikey-{c.id}" class="block text-xs text-gray-500 mb-1">API Key</label>
                            <input id="eapikey-{c.id}" type="text" bind:value={editConn.api_key}
                              placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-44" />
                          </div>
                          {#if selectedTool !== 'axcient'}
                          <div>
                            <label for="eapisec-{c.id}" class="block text-xs text-gray-500 mb-1">API Secret</label>
                            <input id="eapisec-{c.id}" type="password" bind:value={editConn.api_secret}
                              placeholder="leave blank to keep" class="border rounded px-2 py-1 text-sm w-44" />
                          </div>
                          {/if}
                          <div>
                            <label for="ebaseurl-{c.id}" class="block text-xs text-gray-500 mb-1">Base URL</label>
                            <input id="ebaseurl-{c.id}" type="text" bind:value={editConn.base_url}
                              class="border rounded px-2 py-1 text-sm w-56" />
                          </div>
                          {/if}
                          <div class="flex items-center gap-1 pb-1">
                            <input id="ec-{c.id}" type="checkbox" bind:checked={editConn.is_enabled} class="rounded" />
                            <label for="ec-{c.id}" class="text-xs text-gray-600">Enabled</label>
                          </div>
                          {#if editConnError}
                            <div class="w-full bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{editConnError}</div>
                          {/if}
                          <div class="flex gap-2 pb-1">
                            <button type="submit" class="btn-secondary text-xs py-1" disabled={savingConn}>Save</button>
                            <button type="button" class="btn-secondary text-xs py-1" on:click={() => editingConnId = null}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  {/if}
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- ── PSA INTEGRATION ── -->
    {:else if tab === 'psa'}
      <!-- PSA sub-tab bar -->
      <div class="flex gap-1 border-b border-gray-200 mb-4">
        <button on:click={() => psaSubTab = 'setup'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {psaSubTab === 'setup' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Setup
        </button>
        <button on:click={() => psaSubTab = 'client_mapping'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {psaSubTab === 'client_mapping' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Client Mapping
        </button>
        <button on:click={() => psaSubTab = 'asset_mapping'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {psaSubTab === 'asset_mapping' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Asset Sync
        </button>
      </div>

      <!-- ── Setup sub-tab ── -->
      {#if psaSubTab === 'setup'}
        {#if loadingInteg}
          <p class="text-gray-400 text-sm py-8 text-center">Loading…</p>
        {:else}
          {#if integError}
            <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm mb-4">{integError}</div>
          {/if}

          {@const psaInteg = integrations.find(i => i.category === 'psa')}

          {#if psaInteg}
            <!-- ── Connected PSA card ── -->
            {@const meta = providers[psaInteg.provider]}
            {@const testRes = testResults[psaInteg.id]}
            <div class="bg-white rounded-lg shadow border border-gray-100 max-w-2xl">
              <div class="flex items-center gap-4 px-5 py-4">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-gray-800">{psaInteg.display_name}</span>
                    <span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Connected</span>
                    <span class="text-xs text-gray-400 capitalize">{psaInteg.provider.replace('_', ' ')}</span>
                  </div>
                  <div class="text-xs text-gray-500 mt-0.5">{psaInteg.base_url ?? '—'}</div>
                </div>
                <div class="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                  <span class="text-xs px-2 py-0.5 rounded-full {statusBadge(psaInteg.last_test_status)} capitalize">
                    {psaInteg.last_test_status}
                  </span>
                  <button class="text-xs text-blue-500 hover:text-blue-700"
                    on:click={() => testInteg(psaInteg.id)} disabled={testingId === psaInteg.id}>
                    {testingId === psaInteg.id ? 'Testing…' : 'Test Connection'}
                  </button>
                  <button class="text-xs text-gray-600 hover:text-gray-800"
                    on:click={() => startEditInteg(psaInteg)}>Edit</button>
                  <button class="text-xs text-red-500 hover:text-red-700"
                    on:click={() => deleteInteg(psaInteg.id)}>Remove</button>
                </div>
              </div>

              {#if testRes}
                <div class="border-t px-5 py-2 text-xs {testRes.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}">
                  {testRes.status === 'ok' ? '✓' : '✗'} {testRes.message}
                </div>
              {/if}

              {#if editingIntegId === psaInteg.id}
                <div class="border-t px-5 py-4 bg-blue-50">
                  <h3 class="text-sm font-semibold text-gray-700 mb-3">Edit {meta?.label ?? psaInteg.display_name}</h3>
                  <form class="grid grid-cols-2 gap-3" on:submit|preventDefault={saveEditInteg}>
                    {#each (meta?.fields ?? []) as f}
                      <div class="{f.key === 'base_url' ? 'col-span-2' : ''}">
                        <label class="block text-xs text-gray-500 mb-1">{f.label}</label>
                        {#if f.type === 'password'}
                          <input type="password" bind:value={editIntegValues[f.key]}
                            placeholder="leave blank to keep existing"
                            class="w-full border rounded px-2 py-1.5 text-sm bg-white" />
                        {:else}
                          <input type="text" bind:value={editIntegValues[f.key]}
                            class="w-full border rounded px-2 py-1.5 text-sm bg-white" />
                        {/if}
                      </div>
                    {/each}
                    {#if editIntegError}
                      <div class="col-span-2 bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{editIntegError}</div>
                    {/if}
                    <div class="col-span-2 flex gap-2 justify-end pt-1">
                      <button type="button" class="btn-secondary" on:click={() => editingIntegId = null}>Cancel</button>
                      <button type="submit" class="btn-secondary" disabled={savingInteg}>{savingInteg ? 'Saving…' : 'Save Changes'}</button>
                    </div>
                  </form>
                </div>
              {/if}
            </div>

            <p class="text-xs text-gray-400 mt-3">
              PSA connected. Use <strong>Client Mapping</strong> to link PSA clients to BackupPulse orgs, then <strong>Asset Sync</strong> to pull devices.
            </p>

          {:else}
            <!-- ── No PSA — setup wizard ── -->
            <div class="bg-white rounded-lg shadow p-6 space-y-5 max-w-2xl">
              <div>
                <h2 class="text-base font-semibold text-gray-800">Connect your PSA</h2>
                <p class="text-sm text-gray-500 mt-1">Select your PSA platform. Only one PSA can be active per tenant.</p>
              </div>

              <div class="max-w-xs">
                <label for="psa-type" class="block text-xs font-medium text-gray-600 mb-1">PSA Type</label>
                <select id="psa-type" bind:value={selectedProvider}
                  on:change={() => { formValues = {}; saveIntegError = ''; }}
                  class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
                  <option value="">— Select PSA type —</option>
                  {#each tabProviders as [provId, meta]}
                    {@const blocked = isProviderBlocked(provId, 'psa')}
                    <option value={provId} disabled={blocked}>{meta.label}{blocked ? ' (plan restriction)' : ''}</option>
                  {/each}
                </select>
              </div>

              {#if selectedProvider && isProviderBlocked(selectedProvider, 'psa')}
                <div class="max-w-2xl bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">
                  {blockReason(selectedProvider, 'psa')}. Please upgrade your plan.
                </div>
              {/if}

              {#if selectedProvider && providers[selectedProvider] && !isProviderBlocked(selectedProvider, 'psa')}
                {@const meta = providers[selectedProvider]}
                <form class="grid grid-cols-2 gap-4 border-t pt-5" on:submit|preventDefault={saveAddInteg}>
                  <div class="col-span-2">
                    <p class="text-xs text-gray-400">{meta.description}</p>
                  </div>
                  {#each meta.fields as f}
                    <div class="{f.key === 'base_url' || meta.fields.length === 1 ? 'col-span-2' : ''}">
                      <label class="block text-xs text-gray-600 font-medium mb-1">
                        {f.label}{#if f.required}<span class="text-red-500 ml-0.5">*</span>{/if}
                      </label>
                      {#if f.type === 'password'}
                        <input type="password" bind:value={formValues[f.key]} required={f.required}
                          class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                      {:else}
                        <input type="text" bind:value={formValues[f.key]} required={f.required}
                          placeholder={f.type === 'url' ? 'https://' : ''}
                          class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                      {/if}
                    </div>
                  {/each}
                  {#if saveIntegError}
                    <div class="col-span-2 bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{saveIntegError}</div>
                  {/if}
                  <div class="col-span-2 flex gap-2 justify-end pt-1">
                    <button type="button" class="btn-secondary"
                      on:click={() => { selectedProvider = ''; formValues = {}; }}>Cancel</button>
                    <button type="submit" class="btn-secondary" disabled={savingInteg}>
                      {savingInteg ? 'Connecting…' : 'Connect PSA'}
                    </button>
                  </div>
                </form>
              {/if}
            </div>
          {/if}
        {/if}

      <!-- ── Client Mapping sub-tab ── -->
      {:else if psaSubTab === 'client_mapping'}
        <div class="max-w-4xl space-y-4">
          <div class="bg-white rounded-lg shadow border border-gray-100">
            <div class="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 class="text-base font-semibold text-gray-900">PSA Client → Org Mapping</h2>
                <p class="text-xs text-gray-500 mt-0.5">
                  Link each PSA client to a BackupPulse organisation. Use <strong>Create</strong> to add a new org on the fly.
                </p>
              </div>
              <button class="btn-secondary text-sm" on:click={loadPsaClients} disabled={psaClientsLoading}>
                {psaClientsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {#if psaClientsError}
              <div class="px-5 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">{psaClientsError}</div>
            {/if}
            {#if mappingsSaved}
              <div class="px-5 py-3 bg-green-50 border-b border-green-200 text-green-700 text-sm">{mappingsSaved}</div>
            {/if}

            {#if psaClientsLoading}
              <div class="px-5 py-8 text-center text-gray-400 text-sm">Loading PSA clients…</div>
            {:else if psaClients.length === 0 && !psaClientsError}
              <div class="px-5 py-8 text-center text-gray-400 text-sm">
                No PSA clients found. Make sure your PSA integration is connected and tested in the <button class="text-blue-500 underline" on:click={() => psaSubTab = 'setup'}>Setup tab</button>.
              </div>
            {:else}
              <!-- Search + filter bar -->
              <div class="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
                <div class="relative flex-1 min-w-48">
                  <svg class="absolute left-2.5 top-2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z"/>
                  </svg>
                  <input type="text" bind:value={psaSearch} placeholder="Search companies…"
                    class="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <select bind:value={psaMappingFilter}
                  class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                  <option value="all">All ({psaClients.length})</option>
                  <option value="mapped">Mapped ({psaClients.filter(c => psaClientMappings[c.psa_client_id]).length})</option>
                  <option value="unmapped">Unmapped ({psaClients.filter(c => !psaClientMappings[c.psa_client_id]).length})</option>
                </select>
                <span class="text-xs text-gray-400 ml-auto">
                  Showing {psaFilteredClients.length} of {psaClients.length}
                </span>
              </div>

              <table class="min-w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th class="px-4 py-3 text-left font-medium">PSA Client</th>
                    <th class="px-4 py-3 text-left font-medium">BackupPulse Org</th>
                    <th class="px-4 py-3 text-left font-medium w-28">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  {#each psaPageClients as client (client.psa_client_id)}
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-2.5 font-medium text-gray-800">{client.name}</td>
                      <td class="px-4 py-2.5">
                        <select bind:value={psaClientMappings[client.psa_client_id]}
                          class="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-full max-w-xs">
                          <option value="">— Not mapped —</option>
                          {#each psaOrgs as org}
                            <option value={org.id}>{org.name}</option>
                          {/each}
                        </select>
                      </td>
                      <td class="px-4 py-2.5">
                        {#if psaClientMappings[client.psa_client_id]}
                          <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Mapped</span>
                        {:else}
                          <div class="flex items-center gap-1.5">
                            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Unmapped</span>
                            <button
                              class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                              on:click={() => createAndMapOrg(client)}
                              disabled={creatingOrg[client.psa_client_id]}>
                              {creatingOrg[client.psa_client_id] ? '…' : 'Create'}
                            </button>
                          </div>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>

              <!-- Pagination + save row -->
              <div class="px-5 py-3 border-t flex items-center justify-between gap-4">
                <div class="flex items-center gap-2">
                  <button class="btn-secondary text-xs px-2 py-1" on:click={() => psaPage--} disabled={psaPage <= 1}>‹ Prev</button>
                  <span class="text-xs text-gray-500">Page {psaPage} of {psaTotalPages}</span>
                  <button class="btn-secondary text-xs px-2 py-1" on:click={() => psaPage++} disabled={psaPage >= psaTotalPages}>Next ›</button>
                </div>
                <button class="btn-secondary" on:click={saveMappings} disabled={savingMappings}>
                  {savingMappings ? 'Saving…' : 'Save Mappings'}
                </button>
              </div>
            {/if}
          </div>
        </div>

      <!-- ── Asset Mapping sub-tab ── -->
      {:else if psaSubTab === 'asset_mapping'}
        <div class="space-y-4">

          <!-- Header row -->
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-base font-semibold text-gray-900">PSA Asset Mapping</h2>
              <p class="text-xs text-gray-500 mt-0.5">
                Map PSA assets to BackupPulse devices. Changes take effect immediately when you save.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-secondary text-sm" on:click={loadPsaAssets} disabled={psaAssetsLoading}>
                {psaAssetsLoading ? 'Loading…' : 'Refresh'}
              </button>
              <!-- Filter settings toggle -->
              <button
                class="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                on:click={() => { showFilterSettings = !showFilterSettings; if (showFilterSettings && filterAssetTypes.length === 0) loadFilterOptions(); }}>
                Filter Settings {showFilterSettings ? '▲' : '▼'}
              </button>
            </div>
          </div>

          {#if psaAssetsError}
            <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{psaAssetsError}</div>
          {/if}
          {#if assetMappingsSaved}
            <div class="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm">{assetMappingsSaved}</div>
          {/if}

          <!-- Collapsible filter settings -->
          {#if showFilterSettings}
            <div class="bg-white rounded-lg shadow border border-gray-100">
              <div class="px-5 py-3 border-b flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">Filter Settings</h3>
                {#if filterOptionsError}
                  <span class="text-xs text-red-600">{filterOptionsError}</span>
                {/if}
                {#if filterSaved}
                  <span class="text-xs text-green-600">{filterSaved}</span>
                {/if}
              </div>
              {#if filterOptionsLoading}
                <div class="px-5 py-6 text-center text-gray-400 text-sm">Loading options…</div>
              {:else}
                <div class="px-5 py-4 space-y-4">
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-semibold text-gray-700 mb-1">Client Type</label>
                      {#if filterClientTypes.length > 0}
                        <select bind:value={filterClientTypeId} class="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white w-full">
                          {#each filterClientTypes as ct}<option value={parseInt(ct.id)}>{ct.name}</option>{/each}
                        </select>
                      {:else}
                        <input type="number" bind:value={filterClientTypeId} min="1"
                          class="border border-gray-300 rounded px-3 py-1.5 text-sm w-full" placeholder="Type ID (e.g. 1)" />
                      {/if}
                    </div>
                    {#if filterTenantType === 'master_msp'}
                      <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">Org Mapping Mode</label>
                        <select bind:value={filterOrgSourceMode} class="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white w-full">
                          <option value="client">PSA Client (standard)</option>
                          <option value="custom_field">Custom Field</option>
                        </select>
                        {#if filterOrgSourceMode === 'custom_field'}
                          <input type="text" bind:value={filterOrgCustomField} placeholder="Field name e.g. MSP-Client"
                            class="mt-1 border border-gray-300 rounded px-3 py-1.5 text-sm w-full" />
                        {/if}
                      </div>
                    {/if}
                  </div>
                  {#if filterAssetTypes.length > 0}
                    <div>
                      <label class="block text-xs font-semibold text-gray-700 mb-1">Asset Types</label>
                      <div class="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto border border-gray-100 rounded p-2">
                        {#each filterAssetTypes as at}
                          {@const atId = parseInt(at.id)}
                          <label class="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                            <input type="checkbox" checked={filterSelectedAssetTypeIds.includes(atId)}
                              on:change={() => toggleAssetTypeId(atId)} class="rounded border-gray-300" />
                            {at.name}
                          </label>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <div class="flex justify-end">
                    <button class="btn-secondary text-xs" on:click={saveFilterConfig} disabled={filterSaving}>
                      {filterSaving ? 'Saving…' : 'Save Filter Settings'}
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Search / filter bar -->
          <div class="flex flex-wrap items-center gap-2">
            <input type="text" bind:value={assetSearch} placeholder="Search assets or clients…"
              class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300" />

            <select bind:value={assetClientFilter}
              class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="">All clients / orgs</option>
              {#each assetClientOptions as name}
                <option value={name}>{name}</option>
              {/each}
            </select>

            {#each (['all', 'mapped', 'unmapped'] as const) as f}
              <button
                class="px-3 py-1.5 text-xs rounded-full border transition-colors
                  {assetMappingFilter === f ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}"
                on:click={() => assetMappingFilter = f}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            {/each}

            <span class="ml-auto text-xs text-gray-400">
              {assetFiltered.length} of {psaAssets.length} asset{psaAssets.length !== 1 ? 's' : ''}
            </span>
          </div>

          <!-- Mapping table -->
          <div class="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
            {#if psaAssetsLoading}
              <div class="py-16 text-center text-gray-400 text-sm">Loading PSA assets…</div>
            {:else if psaAssets.length === 0 && !psaAssetsError}
              <div class="py-16 text-center text-gray-400 text-sm">No assets returned from PSA. Check your integration and filter settings.</div>
            {:else}
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                    <th class="px-4 py-3 text-left font-medium">PSA Asset</th>
                    <th class="px-4 py-3 text-left font-medium">Type</th>
                    <th class="px-4 py-3 text-left font-medium">Client / Org</th>
                    <th class="px-4 py-3 text-left font-medium">BackupPulse Device</th>
                    <th class="px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {#each assetPageItems as asset (asset.source_id)}
                    {@const mapped = !!psaAssetMappings[asset.source_id]}
                    <tr class="hover:bg-gray-50 transition-colors">
                      <!-- PSA Asset name -->
                      <td class="px-4 py-3">
                        <p class="font-medium text-gray-900">{asset.name}</p>
                        {#if asset.serial}
                          <p class="text-xs text-gray-400">S/N: {asset.serial}</p>
                        {/if}
                      </td>

                      <!-- Device type -->
                      <td class="px-4 py-3 text-gray-600 text-xs">{asset.device_type ?? '—'}</td>

                      <!-- Client / Org -->
                      <td class="px-4 py-3 text-gray-700 text-xs">{asset.org_name || '—'}</td>

                      <!-- BackupPulse Device dropdown -->
                      <td class="px-4 py-3">
                        <div class="flex items-center gap-2">
                          <select
                            bind:value={psaAssetMappings[asset.source_id]}
                            class="border border-gray-300 rounded px-2 py-1 text-sm bg-white flex-1 min-w-0 max-w-xs">
                            <option value="">— Select device —</option>
                            {#each groupedDevices as [orgName, devs]}
                              <optgroup label={orgName}>
                                {#each devs as d}
                                  <option value={d.id}>{d.name}</option>
                                {/each}
                              </optgroup>
                            {/each}
                          </select>
                          {#if !mapped}
                            {@const matchedOrg = psaDeviceOptions.find(d => d.org_name === asset.org_name)}
                            <button
                              class="shrink-0 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300 disabled:opacity-50"
                              disabled={!!creatingDevice[asset.source_id] || !asset.org_name}
                              title={asset.org_name ? 'Create new device in this org' : 'No org matched — map client first'}
                              on:click={async () => {
                                const orgRow = psaDeviceOptions.find(d => d.org_name === asset.org_name);
                                if (!orgRow) {
                                  psaAssetsError = `No BackupPulse org found for "${asset.org_name}". Map this client in the Client Mapping tab first.`;
                                  return;
                                }
                                await createAndMapDevice(asset, orgRow.org_id);
                              }}>
                              {creatingDevice[asset.source_id] ? '…' : 'Create'}
                            </button>
                          {/if}
                        </div>
                      </td>

                      <!-- Status pill -->
                      <td class="px-4 py-3 text-center">
                        {#if mapped}
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Mapped</span>
                        {:else}
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Unmapped</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>

              <!-- Pagination + Save -->
              <div class="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                <div class="flex items-center gap-2">
                  <button class="btn-secondary text-xs py-1 px-3" on:click={() => assetPage--} disabled={assetPage === 1}>← Prev</button>
                  <span class="text-xs text-gray-500">Page {assetPage} of {assetTotalPages}</span>
                  <button class="btn-secondary text-xs py-1 px-3" on:click={() => assetPage++} disabled={assetPage === assetTotalPages}>Next →</button>
                </div>
                <button class="btn-secondary" on:click={saveAssetMappings} disabled={savingAssetMappings}>
                  {savingAssetMappings ? 'Saving…' : 'Save Mappings'}
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

    <!-- ══════════════════════════════ MAILBOX TAB ══════════════════════════ -->
    {:else if tab === 'mailbox'}
      <!-- Sub-tab bar -->
      <div class="flex gap-1 border-b border-gray-200 mb-4">
        <button on:click={() => mailboxSubTab = 'mailboxes'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {mailboxSubTab === 'mailboxes' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Inbound Mailboxes
        </button>
        <button on:click={() => mailboxSubTab = 'rules'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {mailboxSubTab === 'rules' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Email Rules
        </button>
        <button on:click={() => mailboxSubTab = 'processed'}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
            {mailboxSubTab === 'processed' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}">
          Processed Emails
        </button>
      </div>

      <!-- ── Inbound Mailboxes ── -->
      {#if mailboxSubTab === 'mailboxes'}
        <div class="max-w-4xl space-y-4">
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 class="text-base font-semibold text-gray-900">Inbound Mailboxes</h2>
                <p class="text-xs text-gray-500 mt-0.5">Connect mailboxes to receive backup notification emails. Polled every 15 minutes.</p>
              </div>
              <button class="btn-secondary text-sm" on:click={() => { showMailboxForm = !showMailboxForm; newMailbox = { name: '', mailbox_type: 'imap', host: '', port: 993, username: '', password: '', use_ssl: true, folder: 'INBOX', is_active: true }; mailboxSaveErr = ''; }}>
                {showMailboxForm ? 'Cancel' : '+ Add Mailbox'}
              </button>
            </div>

            {#if showMailboxForm}
              <form class="px-5 py-5 bg-blue-50 border-b space-y-4" on:submit|preventDefault={saveMailbox}>
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Display Name <span class="text-red-500">*</span></label>
                    <input bind:value={newMailbox.name} required placeholder="e.g. Backup Notifications" class="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Mailbox Type</label>
                    <select bind:value={newMailbox.mailbox_type} class="w-full border rounded px-2 py-1.5 text-sm">
                      <option value="imap">IMAP</option>
                      <option value="microsoft365">Microsoft 365</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Folder</label>
                    <input bind:value={newMailbox.folder} placeholder="INBOX" class="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                </div>

                {#if newMailbox.mailbox_type === 'imap'}
                  <div class="grid grid-cols-4 gap-3">
                    <div class="col-span-2">
                      <label class="block text-xs text-gray-500 mb-1">IMAP Host <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.host} required placeholder="mail.example.com" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Port</label>
                      <input bind:value={newMailbox.port} type="number" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div class="flex items-end pb-1.5">
                      <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                        <input type="checkbox" bind:checked={newMailbox.use_ssl} class="rounded" />
                        Use SSL
                      </label>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Username / Email <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.username} required placeholder="backups@example.com" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Password <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.password} type="password" required placeholder="App password or IMAP password" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                {:else}
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Azure Tenant ID <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.azure_tenant_id} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">App Client ID <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.m365_client_id} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Client Secret <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.m365_client_secret} type="password" required placeholder="App secret value" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div class="col-span-3">
                      <label class="block text-xs text-gray-500 mb-1">Mailbox Address (UPN) <span class="text-red-500">*</span></label>
                      <input bind:value={newMailbox.username} required placeholder="backups@yourdomain.com" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                {/if}

                {#if mailboxSaveErr}
                  <p class="text-xs text-red-600">{mailboxSaveErr}</p>
                {/if}
                <div class="flex gap-2">
                  <button type="submit" disabled={mailboxSaving} class="btn-secondary text-xs">{mailboxSaving ? 'Saving…' : 'Add Mailbox'}</button>
                  <button type="button" class="btn-secondary text-xs" on:click={() => showMailboxForm = false}>Cancel</button>
                </div>
              </form>
            {/if}

            {#if mailboxLoadErr}<p class="px-5 py-3 text-sm text-red-600">{mailboxLoadErr}</p>{/if}

            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Connection</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Polled</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {#if mailboxLoading}
                  <tr><td colspan="6" class="px-5 py-6 text-center text-gray-400">Loading…</td></tr>
                {:else if mailboxes.length === 0}
                  <tr><td colspan="6" class="px-5 py-6 text-center text-gray-400">No mailboxes configured yet.</td></tr>
                {:else}
                  {#each mailboxes as mb}
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                      <td class="px-4 py-3 font-medium text-gray-800">{mb.name}</td>
                      <td class="px-4 py-3">
                        {#if mb.mailbox_type === 'microsoft365'}
                          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">M365</span>
                        {:else}
                          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">IMAP</span>
                        {/if}
                      </td>
                      <td class="px-4 py-3 text-xs text-gray-500 font-mono">
                        {mb.mailbox_type === 'microsoft365'
                          ? (mb.username ?? '') + ' · ' + (mb.m365_client_id?.substring(0,8) ?? '') + '…'
                          : (mb.host ?? '') + ':' + (mb.port ?? '') + ' (' + (mb.username ?? '') + ')'}
                      </td>
                      <td class="px-4 py-3 text-xs text-gray-400">{mb.last_polled_at ? new Date(mb.last_polled_at).toLocaleString() : 'Never'}</td>
                      <td class="px-4 py-3 text-xs">
                        {#if mb.is_active}
                          <span class="px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
                        {:else}
                          <span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                        {/if}
                        {#if mailboxTestResult[mb.id]}
                          <span class="ml-2 {mailboxTestResult[mb.id] === 'testing…' ? 'text-gray-400' : mailboxTestResult[mb.id].startsWith('OK') || mailboxTestResult[mb.id].toLowerCase().includes('success') ? 'text-green-600' : 'text-red-500'}">
                            {mailboxTestResult[mb.id]}
                          </span>
                        {/if}
                      </td>
                      <td class="px-4 py-3 text-right whitespace-nowrap space-x-3">
                        <button class="text-blue-500 hover:text-blue-700 text-xs" on:click={() => testMailboxConn(mb.id)}>Test</button>
                        <button class="text-green-600 hover:text-green-800 text-xs font-medium" on:click={() => pollMailboxNow(mb.id)}>
                          {mailboxPollResult[mb.id] === 'polling…' ? 'Polling…' : 'Poll Now'}
                        </button>
                        <button class="text-red-500 hover:text-red-700 text-xs" on:click={() => deleteMailbox(mb.id)}>Delete</button>
                      </td>
                    </tr>
                    {#if mailboxPollResult[mb.id] && mailboxPollResult[mb.id] !== 'polling…'}
                      <tr class="bg-green-50 border-b border-gray-100">
                        <td colspan="5" class="px-4 py-1.5 text-xs text-green-700">{mailboxPollResult[mb.id]}</td>
                      </tr>
                    {/if}
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
          <div class="bg-blue-50 border border-blue-100 rounded-lg px-5 py-3 text-sm text-blue-800">
            <strong>How it works:</strong> BackupPulse polls each active mailbox every 15 minutes and matches emails against your
            <button class="underline cursor-pointer" on:click={() => mailboxSubTab = 'rules'}>Email Rules</button>
            to create backup jobs automatically.
          </div>
        </div>

      <!-- ── Email Rules ── -->
      {:else if mailboxSubTab === 'rules'}
        <div class="max-w-5xl space-y-4">
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 class="text-base font-semibold text-gray-900">Email Parsing Rules</h2>
                <p class="text-xs text-gray-500 mt-0.5">Priority-ordered rules that match incoming emails and extract backup job data using template variables. First match wins.</p>
              </div>
              <button class="btn-secondary text-sm" on:click={() => { showRuleForm = !showRuleForm; editingRuleId = null; newRule = _blankRule(); kwSuccess=''; kwFailed='failed,error,unsuccessful'; kwWarning='warning,missed,partial'; selectedTemplate=''; }}>
                {showRuleForm && editingRuleId === null ? 'Cancel' : '+ Add Rule'}
              </button>
            </div>

            {#if showRuleForm}
              <form class="px-5 py-5 bg-blue-50 border-b space-y-5" on:submit|preventDefault={saveRule}>

                <!-- Template picker -->
                <div class="bg-white border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3">
                  <span class="text-sm font-medium text-gray-700 shrink-0">Start from a template:</span>
                  <select bind:value={selectedTemplate} on:change={() => applyTemplate(selectedTemplate)}
                    class="border rounded px-2 py-1.5 text-sm bg-white flex-1 max-w-xs">
                    <option value="">— choose a tool —</option>
                    {#each RULE_TEMPLATES as tpl}
                      <option value={tpl.label}>{tpl.label}</option>
                    {/each}
                  </select>
                  <span class="text-xs text-gray-400 italic">
                    {#each RULE_TEMPLATES as tpl}
                      {#if tpl.label === selectedTemplate}{tpl.description}{/if}
                    {/each}
                    {#if !selectedTemplate}Select a template to pre-fill all extraction patterns — you can still customise everything afterwards.{/if}
                  </span>
                </div>

                <!-- Row 1: Name / Priority / Mailbox -->
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Rule Name <span class="text-red-500">*</span></label>
                    <input bind:value={newRule.name} required placeholder="e.g. Veeam — multi-device" class="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Priority (lower = first)</label>
                    <input bind:value={newRule.priority} type="number" min="1" max="9999" class="w-full border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">Mailbox (optional)</label>
                    <select bind:value={newRule.mailbox_id} class="w-full border rounded px-2 py-1.5 text-sm">
                      <option value={null}>All mailboxes</option>
                      {#each mailboxes as mb}
                        <option value={mb.id}>{mb.name}</option>
                      {/each}
                    </select>
                  </div>
                </div>

                <!-- Row 2: Match conditions -->
                <div>
                  <p class="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Match Conditions</p>
                  <div class="grid grid-cols-4 gap-3">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Match Type</label>
                      <select bind:value={newRule.match_type} class="w-full border rounded px-2 py-1.5 text-sm">
                        <option value="contains">Contains</option>
                        <option value="regex">Regex</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">From Pattern</label>
                      <input bind:value={newRule.from_pattern} placeholder="e.g. noreply@veeam.com" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Subject Pattern</label>
                      <input bind:value={newRule.subject_pattern} placeholder="e.g. Backup Job" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Body Pattern</label>
                      <input bind:value={newRule.body_pattern} placeholder="e.g. Details:" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                </div>

                <!-- Row 3: Tool + MSP + Customer org -->
                <div>
                  <p class="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Assignment</p>
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Backup Tool</label>
                      <select bind:value={newRule.tool} class="w-full border rounded px-2 py-1.5 text-sm">
                        <option value={null}>Unknown / auto</option>
                        {#each TOOL_OPTIONS as t}
                          <option value={t.value}>{t.label}</option>
                        {/each}
                      </select>
                    </div>
                    {#if isMasterMsp}
                      <div>
                        <label class="block text-xs text-gray-500 mb-1">MSP (fixed)</label>
                        <select bind:value={newRule.msp_org_id} class="w-full border rounded px-2 py-1.5 text-sm">
                          <option value={null}>— extract from email —</option>
                          {#each mspOrgs as m}
                            <option value={m.id}>{m.name}</option>
                          {/each}
                        </select>
                      </div>
                    {/if}
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Customer Org (fixed)</label>
                      <select bind:value={newRule.org_id} class="w-full border rounded px-2 py-1.5 text-sm">
                        <option value={null}>— extract from email —</option>
                        {#each connectorOrgs.filter(o => !isMasterMsp || !newRule.msp_org_id || o.id === newRule.msp_org_id || o.parent_id === newRule.msp_org_id) as o}
                          <option value={o.id}>{o.name}{isMasterMsp && o.id === newRule.msp_org_id ? ' (MSP level)' : ''}</option>
                        {/each}
                      </select>
                    </div>
                  </div>
                </div>

                <!-- Template variables hint -->
                <div class="bg-white border border-blue-200 rounded px-3 py-2 text-xs text-blue-700">
                  <span class="font-semibold">Available template variables:</span>
                  {TEMPLATE_VARS.join('  ')}
                  <span class="text-blue-500 ml-2">— use in Pattern fields below instead of a regex</span>
                </div>

                <!-- Row 4: Extraction fields table -->
                <div>
                  <p class="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Field Extraction</p>
                  <div class="bg-white border rounded overflow-hidden">
                    <table class="w-full text-xs">
                      <thead class="bg-gray-50 border-b">
                        <tr>
                          <th class="text-left px-3 py-2 font-semibold text-gray-500 w-32">Field</th>
                          <th class="text-left px-3 py-2 font-semibold text-gray-500 w-40">Source</th>
                          <th class="text-left px-3 py-2 font-semibold text-gray-500">Pattern / Value</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100">
                        <!-- Device Name -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Device Name</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.device_name_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                              <option value="fixed">Fixed value</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            <input bind:value={newRule.device_name_pattern} placeholder={'e.g. Backup for {Device Name} — or regex'} class="w-full border rounded px-2 py-1 text-xs" />
                          </td>
                        </tr>
                        <!-- Customer Name -->
                        {#if !newRule.org_id}
                          <tr>
                            <td class="px-3 py-2 font-medium text-gray-700">Customer Name</td>
                            <td class="px-3 py-2">
                              <select bind:value={newRule.customer_name_source} class="w-full border rounded px-2 py-1 text-xs">
                                <option value="subject_regex">Subject</option>
                                <option value="body_regex">Body</option>
                                <option value="fixed">Fixed value</option>
                              </select>
                            </td>
                            <td class="px-3 py-2">
                              <input bind:value={newRule.customer_name_pattern} placeholder={'{Customer Name} or regex group 1'} class="w-full border rounded px-2 py-1 text-xs" />
                            </td>
                          </tr>
                        {/if}
                        <!-- Job Name -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Job Name</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.job_name_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                              <option value="fixed">Fixed value</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            <input bind:value={newRule.job_name_pattern} placeholder={'{Job Name} or regex'} class="w-full border rounded px-2 py-1 text-xs" />
                          </td>
                        </tr>
                        <!-- Status -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Status</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.status_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="keywords">Keywords (below)</option>
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            {#if newRule.status_source !== 'keywords'}
                              <input bind:value={newRule.status_pattern} placeholder={'{Status} or regex — matched against keywords'} class="w-full border rounded px-2 py-1 text-xs" />
                            {:else}
                              <span class="text-gray-400 italic">Uses success / failed / warning keywords</span>
                            {/if}
                          </td>
                        </tr>
                        <!-- Error -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Error</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.error_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="">Auto (body on failure)</option>
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            {#if newRule.error_source}
                              <input bind:value={newRule.error_pattern} placeholder={'{Error} or regex'} class="w-full border rounded px-2 py-1 text-xs" />
                            {:else}
                              <span class="text-gray-400 italic">First 500 chars of body when job is failed/warning</span>
                            {/if}
                          </td>
                        </tr>
                        <!-- Start Time -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Start Time</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.start_time_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="">Auto (email received time)</option>
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            {#if newRule.start_time_source}
                              <input bind:value={newRule.start_time_pattern} placeholder={'{Start Time} or regex — parses common date formats'} class="w-full border rounded px-2 py-1 text-xs" />
                            {:else}
                              <span class="text-gray-400 italic">Email received timestamp</span>
                            {/if}
                          </td>
                        </tr>
                        <!-- End Time -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">End Time</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.end_time_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="">Skip</option>
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            {#if newRule.end_time_source}
                              <input bind:value={newRule.end_time_pattern} placeholder={'{End Time} or regex'} class="w-full border rounded px-2 py-1 text-xs" />
                            {:else}
                              <span class="text-gray-400 italic">Not extracted</span>
                            {/if}
                          </td>
                        </tr>
                        <!-- Backup Size -->
                        <tr>
                          <td class="px-3 py-2 font-medium text-gray-700">Backup Size</td>
                          <td class="px-3 py-2">
                            <select bind:value={newRule.size_source} class="w-full border rounded px-2 py-1 text-xs">
                              <option value="">Skip</option>
                              <option value="subject_regex">Subject</option>
                              <option value="body_regex">Body</option>
                            </select>
                          </td>
                          <td class="px-3 py-2">
                            {#if newRule.size_source}
                              <input bind:value={newRule.size_pattern} placeholder={'{Size} or regex — auto-parses KB/MB/GB/TB'} class="w-full border rounded px-2 py-1 text-xs" />
                            {:else}
                              <span class="text-gray-400 italic">Not extracted</span>
                            {/if}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Row 5: Status keywords (when status_source === keywords) -->
                {#if newRule.status_source === 'keywords'}
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Success Keywords <span class="text-gray-400">(comma-separated)</span></label>
                      <input bind:value={kwSuccess} placeholder="success,completed,ok" class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Failed Keywords</label>
                      <input bind:value={kwFailed} class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Warning Keywords</label>
                      <input bind:value={kwWarning} class="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                {/if}

                <!-- Row 6: Row template (multi-device emails) -->
                <div>
                  <label class="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                    Row Template
                    <span class="normal-case font-normal text-gray-400 ml-1">— for emails listing multiple devices in a table (e.g. Veeam). Leave blank for single-device emails.</span>
                  </label>
                  <input bind:value={newRule.row_template} placeholder={'e.g.  {Device Name}   {Status}   {Start Time}   {End Time}   {Size}'} class="w-full border rounded px-2 py-1.5 text-sm font-mono" />
                  <label class="flex items-center gap-2 mt-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" bind:checked={newRule.prefer_html} class="w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
                    Use HTML body (required for Veeam, Infrascale table emails)
                  </label>
                </div>

                {#if ruleSaveErr}<p class="text-xs text-red-600">{ruleSaveErr}</p>{/if}
                <div class="flex gap-2">
                  <button type="submit" disabled={ruleSaving} class="btn-secondary text-xs">
                    {ruleSaving ? 'Saving…' : editingRuleId !== null ? 'Update Rule' : 'Add Rule'}
                  </button>
                  <button type="button" class="btn-secondary text-xs" on:click={() => { showRuleForm = false; editingRuleId = null; }}>Cancel</button>
                </div>
              </form>
            {/if}

            {#if rulesLoadErr}<p class="px-5 py-3 text-sm text-red-600">{rulesLoadErr}</p>{/if}

            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-10">Pri</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Matches</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Tool</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {#if rulesLoading}
                  <tr><td colspan="6" class="px-5 py-6 text-center text-gray-400">Loading…</td></tr>
                {:else if parsingRules.length === 0}
                  <tr><td colspan="6" class="px-5 py-6 text-center text-gray-400">No rules yet. Add one to start classifying emails.</td></tr>
                {:else}
                  {#each parsingRules as r}
                    <tr class="border-b border-gray-100 hover:bg-gray-50">
                      <td class="px-4 py-3 text-gray-500 text-xs">{r.priority}</td>
                      <td class="px-4 py-3 font-medium text-gray-800">
                        {r.name}
                        {#if r.row_template}<span class="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">multi</span>{/if}
                        {#if !r.is_active}<span class="ml-1 text-xs text-gray-400">(off)</span>{/if}
                      </td>
                      <td class="px-4 py-3 text-xs text-gray-500 font-mono max-w-xs truncate">
                        {[r.from_pattern, r.subject_pattern, r.body_pattern].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td class="px-4 py-3 text-xs">
                        {#if r.tool}
                          <span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{r.tool}</span>
                        {:else}
                          <span class="text-gray-400">auto</span>
                        {/if}
                      </td>
                      <td class="px-4 py-3 text-xs text-gray-500">
                        {r.org_name ?? (r.customer_name_source && r.customer_name_source !== 'fixed' ? 'extracted' : '—')}
                      </td>
                      <td class="px-4 py-3 text-right whitespace-nowrap">
                        <button class="text-blue-500 hover:text-blue-700 text-xs mr-3" on:click={() => startEditRule(r)}>Edit</button>
                        <button class="text-red-500 hover:text-red-700 text-xs" on:click={() => deleteRule(r.id)}>Delete</button>
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>

      <!-- ── Processed Emails ── -->
      {:else if mailboxSubTab === 'processed'}
        <div class="max-w-5xl space-y-4">
          <!-- Filters -->
          <div class="bg-white rounded-lg shadow px-4 py-3 flex gap-3 flex-wrap items-end">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Mailbox</label>
              <select bind:value={processedFilterMailbox} class="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[140px]">
                <option value="">All</option>
                {#each mailboxes as mb}
                  <option value={mb.id}>{mb.name}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Result</label>
              <select bind:value={processedFilterResult} class="border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">All</option>
                <option value="created">Created</option>
                <option value="skipped">Skipped</option>
                <option value="no_match">No Match</option>
                <option value="error">Error</option>
              </select>
            </div>
            <button class="btn-secondary text-sm" on:click={loadProcessedEmails}>Refresh</button>
          </div>

          <div class="bg-white rounded-lg shadow overflow-hidden">
            {#if processedLoadErr}
              <p class="px-5 py-3 text-sm text-red-600">{processedLoadErr}</p>
            {/if}
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Received</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">From</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Subject</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rule</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Result</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {#if processedLoading}
                  <tr><td colspan="6" class="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
                {:else if processedEmails.length === 0}
                  <tr><td colspan="6" class="px-5 py-8 text-center text-gray-400">No processed emails yet. Emails are processed when the mailbox is polled.</td></tr>
                {:else}
                  {#each processedEmails as pe}
                    <tr class="border-b border-gray-100 hover:bg-gray-50 align-top">
                      <td class="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {pe.received_at ? new Date(pe.received_at).toLocaleString() : '—'}
                      </td>
                      <td class="px-4 py-2.5 text-xs text-gray-600 max-w-[140px] truncate" title={pe.from_address ?? ''}>
                        {pe.from_address ?? '—'}
                      </td>
                      <td class="px-4 py-2.5 text-xs text-gray-700 max-w-[200px] truncate" title={pe.subject ?? ''}>
                        {pe.subject ?? '—'}
                      </td>
                      <td class="px-4 py-2.5 text-xs text-gray-500">
                        {#if pe.rule_name}{pe.rule_name}{:else}<span class="italic text-gray-400">no match</span>{/if}
                      </td>
                      <td class="px-4 py-2.5 text-xs">
                        {#if pe.result === 'created'}
                          <span class="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">created</span>
                        {:else if pe.result === 'error'}
                          <span class="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={pe.error_detail ?? ''}>error</span>
                        {:else if pe.result === 'no_match'}
                          <span class="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" title={pe.error_detail ?? ''}>no match</span>
                        {:else}
                          <span class="px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">{pe.result}</span>
                        {/if}
                      </td>
                      <td class="px-4 py-2.5 text-xs text-gray-500 text-center">{pe.jobs_created || '—'}</td>
                    </tr>
                    {#if pe.error_detail && (pe.result === 'no_match' || pe.result === 'skipped' || pe.result === 'error')}
                      <tr class="border-b border-gray-100 {pe.result === 'error' ? 'bg-red-50' : 'bg-amber-50'}">
                        <td colspan="6" class="px-6 pb-2.5 pt-1.5">
                          <p class="text-xs font-semibold {pe.result === 'error' ? 'text-red-700' : 'text-amber-700'} mb-1">
                            {pe.result === 'no_match' ? 'Why no match?' : pe.result === 'skipped' ? 'Why skipped?' : 'Error detail'}
                          </p>
                          <pre class="text-xs {pe.result === 'error' ? 'text-red-800' : 'text-amber-800'} whitespace-pre-wrap font-mono">{pe.error_detail}</pre>
                        </td>
                      </tr>
                    {/if}
                    {#if pe.extracted_data && Object.keys(pe.extracted_data).length > 0}
                      <tr class="border-b border-gray-100 bg-gray-50">
                        <td colspan="6" class="px-6 pb-2 pt-1.5">
                          <p class="text-xs font-semibold text-gray-500 mb-1">Extracted fields</p>
                          <div class="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
                            {#each Object.entries(pe.extracted_data) as [k, v]}
                              {@const display = (typeof v === 'object' && v !== null) ? JSON.stringify(v, null, 2) : String(v)}
                              <div class="flex gap-2 {(typeof v === 'object' && v !== null) ? 'col-span-2' : ''}">
                                <span class="text-gray-400 w-28 shrink-0">{k}</span>
                                {#if typeof v === 'object' && v !== null}
                                  <pre class="text-gray-700 text-xs whitespace-pre-wrap break-all">{display}</pre>
                                {:else}
                                  <span class="{display.startsWith('(no match') ? 'text-red-500 italic' : 'text-gray-700'}">{display}</span>
                                {/if}
                              </div>
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
      {/if}

    <!-- ── MAILBOX / OTHER (generic) ── -->
    {:else}
      {#if loadingInteg}
        <p class="text-gray-400 text-sm py-8 text-center">Loading…</p>
      {:else}
        {#if integError}
          <div class="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">{integError}</div>
        {/if}

        <div>
          <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Available Providers</h2>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {#each tabProviders as [provId, meta]}
              {@const already = integrations.some(i => i.provider === provId)}
              {@const blocked = !already && isProviderBlocked(provId, meta.category)}
              {@const reason  = blocked ? blockReason(provId, meta.category) : ''}
              <div class="bg-white rounded-lg border p-4 flex flex-col gap-2 shadow-sm"
                style="border-color: {blocked ? '#f8717133' : '#e5e7eb'}; opacity: {blocked ? 0.85 : 1};">
                <div class="flex items-start justify-between gap-2">
                  <span class="font-semibold text-gray-800 text-sm">{meta.label}</span>
                  {#if already}
                    <span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">Connected</span>
                  {:else if blocked}
                    <span class="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full whitespace-nowrap">Restricted</span>
                  {/if}
                </div>
                <p class="text-xs text-gray-500 flex-1">{meta.description}</p>
                {#if blocked}
                  <p class="text-xs text-red-400 mt-1">{reason}</p>
                {/if}
                <button class="btn-secondary text-xs py-1.5 mt-1"
                  on:click={() => startAddInteg(provId)} disabled={already || blocked}
                  title={blocked ? reason : undefined}>
                  {already ? 'Already added' : blocked ? 'Not available' : '+ Connect'}
                </button>
              </div>
            {/each}
          </div>
        </div>

        {#if showAddInteg && selectedProvider && providers[selectedProvider]}
          {@const meta = providers[selectedProvider]}
          <div class="bg-white rounded-lg shadow p-5 space-y-4 border-t-4 border-brand-600">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold text-gray-800">Connect {meta.label}</h3>
              <button class="text-gray-400 hover:text-gray-600 text-xl" on:click={() => showAddInteg = false}>×</button>
            </div>
            <form class="grid grid-cols-2 gap-3" on:submit|preventDefault={saveAddInteg}>
              {#each meta.fields as f}
                <div class="{f.key === 'base_url' || meta.fields.length === 1 ? 'col-span-2' : ''}">
                  <label class="block text-xs text-gray-500 mb-1">
                    {f.label}{#if f.required}<span class="text-red-500 ml-0.5">*</span>{/if}
                  </label>
                  {#if f.type === 'password'}
                    <input type="password" bind:value={formValues[f.key]} required={f.required}
                      class="w-full border rounded px-2 py-1.5 text-sm" />
                  {:else}
                    <input type="text" bind:value={formValues[f.key]} required={f.required}
                      placeholder={f.type === 'url' ? 'https://' : ''}
                      class="w-full border rounded px-2 py-1.5 text-sm" />
                  {/if}
                </div>
              {/each}
              {#if saveIntegError}
                <div class="col-span-2 bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{saveIntegError}</div>
              {/if}
              <div class="col-span-2 flex gap-2 justify-end pt-1">
                <button type="button" class="btn-secondary" on:click={() => showAddInteg = false}>Cancel</button>
                <button type="submit" class="btn-secondary" disabled={savingInteg}>{savingInteg ? 'Saving…' : 'Save Integration'}</button>
              </div>
            </form>
          </div>
        {/if}

        {#if tabIntegrations.length > 0}
          <div>
            <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Connected</h2>
            <div class="space-y-3">
              {#each tabIntegrations as integ}
                {@const meta = providers[integ.provider]}
                {@const testRes = testResults[integ.id]}
                <div class="bg-white rounded-lg shadow border border-gray-100">
                  <div class="flex items-center gap-4 px-5 py-3">
                    <div class="flex-1 min-w-0">
                      <span class="font-semibold text-gray-800 text-sm">{integ.display_name}</span>
                      <div class="text-xs text-gray-500 mt-0.5">{integ.base_url ?? '—'}</div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-xs px-2 py-0.5 rounded-full {statusBadge(integ.last_test_status)} capitalize">
                        {integ.last_test_status}
                      </span>
                      <button class="text-xs text-blue-500 hover:text-blue-700"
                        on:click={() => testInteg(integ.id)} disabled={testingId === integ.id}>
                        {testingId === integ.id ? 'Testing…' : 'Test'}
                      </button>
                      <button class="text-xs text-gray-500 hover:text-gray-700"
                        on:click={() => startEditInteg(integ)}>Edit</button>
                      <button class="text-xs text-red-500 hover:text-red-700"
                        on:click={() => deleteInteg(integ.id)}>Remove</button>
                    </div>
                  </div>
                  {#if testRes}
                    <div class="border-t px-5 py-2 text-xs {testRes.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}">
                      {testRes.status === 'ok' ? '✓' : '✗'} {testRes.message}
                    </div>
                  {/if}
                  {#if editingIntegId === integ.id}
                    <div class="border-t px-5 py-4 bg-blue-50">
                      <form class="grid grid-cols-2 gap-3" on:submit|preventDefault={saveEditInteg}>
                        {#each (meta?.fields ?? []) as f}
                          <div class="{f.key === 'base_url' ? 'col-span-2' : ''}">
                            <label class="block text-xs text-gray-500 mb-1">{f.label}</label>
                            {#if f.type === 'password'}
                              <input type="password" bind:value={editIntegValues[f.key]}
                                placeholder="leave blank to keep existing"
                                class="w-full border rounded px-2 py-1.5 text-sm bg-white" />
                            {:else}
                              <input type="text" bind:value={editIntegValues[f.key]}
                                class="w-full border rounded px-2 py-1.5 text-sm bg-white" />
                            {/if}
                          </div>
                        {/each}
                        {#if editIntegError}
                          <div class="col-span-2 bg-red-50 border border-red-300 text-red-700 rounded p-2 text-xs">{editIntegError}</div>
                        {/if}
                        <div class="col-span-2 flex gap-2 justify-end pt-1">
                          <button type="button" class="btn-secondary" on:click={() => editingIntegId = null}>Cancel</button>
                          <button type="submit" class="btn-secondary" disabled={savingInteg}>{savingInteg ? 'Saving…' : 'Save Changes'}</button>
                        </div>
                      </form>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {:else if !showAddInteg}
          <div class="text-center py-10 text-gray-400 text-sm">
            No integrations connected yet. Click "+ Connect" above to get started.
          </div>
        {/if}
      {/if}

    {/if}
  </div>
</div>
