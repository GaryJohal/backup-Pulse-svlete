export interface Theme {
  name: string;
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  textBright: string;   /* headings / strong text */
  textMuted: string;    /* secondary / placeholder text */
  border: string;
  sidebar: string;
  sidebarBorder: string;
  sidebarText: string;  /* nav link text (on top of sidebar bg) */
}

export const THEMES: Record<string, Theme> = {
  light: {
    name: 'Light',
    bg: '#f0f4f8',       surface: '#ffffff',  surface2: '#e8edf2',
    text: '#374151',     textBright: '#111827', textMuted: '#6b7280',
    border: '#d1d5db',
    sidebar: '#174366',  sidebarBorder: '#0f2d47', sidebarText: '#b3e9f6',
  },
  navy: {
    name: 'Dark Navy',
    bg: '#1e222c',       surface: '#252b38',  surface2: '#1a1f2b',
    text: '#b3e9f6',     textBright: '#f0f0f0', textMuted: '#8b98a8',
    border: '#3a4255',
    sidebar: '#174366',  sidebarBorder: '#0f2d47', sidebarText: '#b3e9f6',
  },
  charcoal: {
    name: 'Dark Charcoal',
    bg: '#1c1c1c',       surface: '#2d2d2d',  surface2: '#242424',
    text: '#e5e5e5',     textBright: '#f5f5f5', textMuted: '#9a9a9a',
    border: '#3d3d3d',
    sidebar: '#1a1a1a',  sidebarBorder: '#111111', sidebarText: '#e5e5e5',
  },
  slate: {
    name: 'Midnight Slate',
    bg: '#0f1117',       surface: '#1a1d27',  surface2: '#141720',
    text: '#e2e8f0',     textBright: '#f8fafc', textMuted: '#94a3b8',
    border: '#2d3348',
    sidebar: '#0d1424',  sidebarBorder: '#0a0f1a', sidebarText: '#e2e8f0',
  },
  carbon: {
    name: 'Carbon',
    bg: '#111111',       surface: '#1e1e1e',  surface2: '#171717',
    text: '#f0f0f0',     textBright: '#ffffff', textMuted: '#888888',
    border: '#2d2d2d',
    sidebar: '#0a0a0a',  sidebarBorder: '#1a1a1a', sidebarText: '#f0f0f0',
  },
  forest: {
    name: 'Dark Forest',
    bg: '#0f1a14',       surface: '#192a20',  surface2: '#122018',
    text: '#c6f0d4',     textBright: '#ecfdf5', textMuted: '#7aad8a',
    border: '#2a4a35',
    sidebar: '#0d1f14',  sidebarBorder: '#091510', sidebarText: '#c6f0d4',
  },
  backuppulse: {
    name: 'BackupPulse Classic',
    bg: '#f0f2f5',       surface: '#ffffff',  surface2: '#f5f5f5',
    text: '#333333',     textBright: '#1a1a2e', textMuted: '#333333',
    border: '#9ca3af',
    sidebar: '#16213e',  sidebarBorder: '#0f172a', sidebarText: '#b3c5e0',
  },
};
