<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto, afterNavigate } from '$app/navigation';
  import { isLoggedIn, auth } from '$lib/auth';
  import { api } from '$lib/api';
  import { hasTestRestore } from '$lib/stores/license';
  import { onMount } from 'svelte';
  import { THEMES } from '$lib/themes';

  const BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
  const tok = () => localStorage.getItem('bp_token') ?? '';

  // ── Branding state ────────────────────────────────────────────────────────────
  let portalName   = 'BackupPulse';
  let logoUrl      = '';
  let primaryColor = '#00adda';
  let primaryDark  = '#0094ba';
  let activeTheme = THEMES.navy;

  /** Derive a hover-state shade by darkening a hex color by `amount` (0–1). */
  function darken(hex: string, amount = 0.15): string {
    if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#0094ba';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const d = (n: number) =>
      Math.max(0, Math.floor(n * (1 - amount))).toString(16).padStart(2, '0');
    return `#${d(r)}${d(g)}${d(b)}`;
  }

  /** Apply a theme object to :root CSS variables. */
  function applyTheme(t: typeof activeTheme) {
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
    activeTheme = t;
  }

  async function loadBranding() {
    try {
      const res = await fetch(`${BASE}/api/v1/settings/tenant`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      if (!res.ok) return;
      const s = await res.json();
      if (s.portal_name)   portalName = s.portal_name;
      if (s.logo_url)      logoUrl    = s.logo_url;
      if (s.primary_color) {
        primaryColor = s.primary_color;
        primaryDark  = darken(s.primary_color);
      }
      // Apply theme preset
      const theme = THEMES[s.theme as string] ?? THEMES.navy;
      applyTheme(theme);
    } catch {
      // branding failure is non-critical — defaults remain
    }
  }

  const publicRoutes = ['/login'];

  onMount(async () => {
    if (!$isLoggedIn && !publicRoutes.includes($page.url.pathname)) {
      goto('/login');
      return;
    }
    if ($isLoggedIn) {
      await loadBranding();
    }
  });

  // Refresh user data on every navigation so plan_name + feature_flags are always current
  afterNavigate(async () => {
    if ($isLoggedIn) {
      try {
        const fresh = await api.me();
        auth.updateUser(fresh);
      } catch { /* non-critical */ }
    }
  });

  const NAV_ICONS: Record<string, string> = {
    dashboard:    `<rect x="3" y="3" width="7" height="7" rx="1" stroke-width="1.5"/><rect x="14" y="3" width="7" height="7" rx="1" stroke-width="1.5"/><rect x="3" y="14" width="7" height="7" rx="1" stroke-width="1.5"/><rect x="14" y="14" width="7" height="7" rx="1" stroke-width="1.5"/>`,
    jobs:         `<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-width="1.5" stroke-linecap="round"/>`,
    reports:      `<path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="1.5" stroke-linecap="round"/>`,
    manage:       `<path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" stroke-width="1.5" stroke-linecap="round"/>`,
    integrations: `<path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" stroke-width="1.5" stroke-linecap="round"/>`,
    testRestore:  `<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-width="1.5" stroke-linecap="round"/>`,
    settings:     `<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke-width="1.5"/>`,
    audit:        `<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke-width="1.5" stroke-linecap="round"/>`,
    planManager:  `<path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" stroke-width="1.5" stroke-linecap="round"/>`,
    assets:       `<path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" stroke-width="1.5" stroke-linecap="round"/>`,
  };

  const ALL_NAV = [
    { href: '/',             label: 'Dashboard',    section: 'Main',  icon: NAV_ICONS.dashboard,    roles: ['super_admin', 'tenant_admin', 'msp_admin', 'viewer'], platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/jobs',         label: 'Jobs',         section: 'Main',  icon: NAV_ICONS.jobs,         roles: ['super_admin', 'tenant_admin', 'msp_admin', 'viewer'], platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/assets',       label: 'Assets',       section: 'Main',  icon: NAV_ICONS.assets,       roles: ['super_admin', 'tenant_admin', 'msp_admin', 'viewer'], platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/reports',      label: 'Reports',      section: 'Main',  icon: NAV_ICONS.reports,      roles: ['super_admin', 'tenant_admin', 'msp_admin', 'viewer'], platformOnly: false, featureKey: 'reports', addonKey: null },
    { href: '/manage',       label: 'Manage',       section: 'Main',  icon: NAV_ICONS.manage,       roles: ['super_admin', 'tenant_admin', 'msp_admin'],           platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/integrations', label: 'Integrations', section: 'Tools', icon: NAV_ICONS.integrations, roles: ['super_admin', 'tenant_admin', 'msp_admin'],           platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/test-restore', label: 'Test Restore', section: 'Tools', icon: NAV_ICONS.testRestore,  roles: ['super_admin', 'tenant_admin', 'msp_admin', 'viewer'], platformOnly: false, featureKey: null,      addonKey: 'test_restore' },
    { href: '/settings',     label: 'Settings',     section: 'Admin', icon: NAV_ICONS.settings,     roles: ['super_admin', 'tenant_admin', 'msp_admin'],           platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/audit',        label: 'Audit',        section: 'Admin', icon: NAV_ICONS.audit,        roles: ['super_admin', 'tenant_admin'],                        platformOnly: false, featureKey: null,      addonKey: null },
    { href: '/admin/plans',  label: 'Plan Manager', section: 'Admin', icon: NAV_ICONS.planManager,  roles: ['super_admin'],                                        platformOnly: true,  featureKey: null,      addonKey: null },
  ];

  /** Returns false if the tenant has a plan with this feature explicitly set to false. */
  function featureEnabled(key: string | null): boolean {
    if (!key || !$auth) return true;
    const flags = $auth.feature_flags ?? {};
    // Empty flags → no plan assigned → all features on
    if (Object.keys(flags).length === 0) return true;
    // Key not present in flags → treat as enabled
    if (!(key in flags)) return true;
    return flags[key] === true;
  }

  $: navItems = ALL_NAV.filter(item => {
    if (!$auth) return false;
    if ($auth.tenant_type === 'platform') {
      return item.platformOnly || item.href === '/manage';
    }
    if (item.platformOnly) return false;
    if (!item.roles.includes($auth.role)) return false;
    if (!featureEnabled(item.featureKey)) return false;
    if (item.addonKey === 'test_restore' && !$hasTestRestore) return false;
    return true;
  });

  let userMenuOpen = false;

  function logout() {
    auth.logout();
    goto('/login');
  }

  $: isActive = (href: string) =>
    $page.url.pathname === href ||
    (href !== '/' && $page.url.pathname.startsWith(href));
</script>

{#if $isLoggedIn}
  <div
    class="h-screen flex overflow-hidden"
    style="--bp-primary: {primaryColor}; --bp-primary-dark: {primaryDark};"
  >
    <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
    <aside class="w-56 flex flex-col shrink-0"
      style="background-color: var(--bp-sidebar); border-right: 1px solid var(--bp-sidebar-border);">

      <!-- Logo / portal name -->
      <div style="border-bottom: 1px solid var(--bp-sidebar-border);">
        {#if logoUrl}
          <div class="px-4 py-3 flex items-center" style="min-height: 56px;">
            <img src={logoUrl} alt={portalName} class="max-h-9 max-w-full object-contain" />
          </div>
        {:else}
          <div class="px-5 py-4 text-sm font-bold uppercase tracking-widest truncate"
            style="color: var(--bp-primary); letter-spacing: 0.12em;">
            {portalName}
          </div>
        {/if}
      </div>

      <!-- Nav links -->
      <nav class="flex-1 py-3 overflow-y-auto">
        {#each ['Main', 'Tools', 'Admin'] as section}
          {@const sectionItems = navItems.filter(i => i.section === section)}
          {#if sectionItems.length > 0}
            <div style="padding: 10px 16px 4px; font-size: 9px; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; color: var(--bp-text-muted); opacity: 0.6;">
              {section}
            </div>
            {#each sectionItems as item}
              <a
                href={item.href}
                class="flex items-center gap-2 py-2 text-sm font-medium transition-colors"
                style="
                  padding-left: 12px;
                  padding-right: 10px;
                  color: {isActive(item.href) ? '#ffffff' : activeTheme.sidebarText};
                  border-left: 2px solid {isActive(item.href) ? 'var(--bp-primary)' : 'transparent'};
                  background-color: {isActive(item.href) ? 'color-mix(in srgb, var(--bp-primary) 18%, transparent)' : 'transparent'};
                "
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style="flex-shrink:0; opacity:{isActive(item.href) ? '1' : '0.55'}">
                  {@html item.icon}
                </svg>
                {item.label}
              </a>
            {/each}
          {/if}
        {/each}
      </nav>

      <!-- User info + sign out -->
      <div style="border-top: 1px solid var(--bp-sidebar-border); padding: 12px 14px; position: relative;">
        <!-- Clickable user row -->
        <button
          on:click={() => userMenuOpen = !userMenuOpen}
          style="width:100%; display:flex; align-items:center; gap:10px; background:none; border:none; cursor:pointer; padding:0; text-align:left;"
        >
          <div style="
            width:34px; height:34px; border-radius:50%; flex-shrink:0;
            background: color-mix(in srgb, var(--bp-primary) 25%, transparent);
            border: 1px solid color-mix(in srgb, var(--bp-primary) 40%, transparent);
            display:flex; align-items:center; justify-content:center;
            font-size:12px; font-weight:700; letter-spacing:0.03em;
            color: var(--bp-primary);
          ">
            {($auth?.display_name ?? '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase()}
          </div>
          <div style="min-width:0; flex:1;">
            <div style="font-size:12px; font-weight:600; color:var(--bp-text-bright); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              {$auth?.display_name ?? ''}
            </div>
            <div style="font-size:10px; color:var(--bp-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:capitalize;">
              {($auth?.role ?? '').replace('_', ' ')}
            </div>
          </div>
          <!-- Chevron -->
          <svg width="12" height="12" fill="none" stroke="var(--bp-text-muted)" viewBox="0 0 24 24" style="flex-shrink:0; transition:transform 0.15s; transform:{userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)'}">
            <path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Dropdown menu -->
        {#if userMenuOpen}
          <div style="
            position:absolute; bottom:calc(100% + 4px); left:10px; right:10px;
            background: var(--bp-surface); border:1px solid var(--bp-border);
            border-radius:6px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.25);
          ">
            <button on:click={logout}
              style="width:100%; text-align:left; font-size:12px; color:var(--bp-text-muted); background:none; border:none; cursor:pointer; padding:9px 12px; transition:background 0.1s, color 0.1s; display:flex; align-items:center; gap:8px;"
              on:mouseenter={(e) => { e.currentTarget.style.background = 'var(--bp-surface-2)'; e.currentTarget.style.color = 'var(--bp-text-bright)'; }}
              on:mouseleave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--bp-text-muted)'; }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Sign out
            </button>
          </div>
        {/if}
      </div>
    </aside>

    <!-- ── Main content ──────────────────────────────────────────────────── -->
    <main class="flex-1 overflow-auto p-6" style="background-color: var(--bp-bg);">
      <slot />
    </main>
  </div>

{:else}
  <slot />
{/if}
