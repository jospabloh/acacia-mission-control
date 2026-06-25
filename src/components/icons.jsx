// Minimal stroke icon set (Lucide-ish), no dependency. `currentColor` so the
// caller controls color; 1.8 stroke reads well at 18–20px.
const PATHS = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 13h8v8H3z',
  license: 'M3 5h18v14H3zM7 10h6M7 14h10',
  revenue: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  crm: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 21v-2a4 4 0 0 0-3-3.87',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  support: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  announce: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM15.5 8.5a5 5 0 0 1 0 7',
  health: 'M3 12h4l2 7 4-14 2 7h6',
  control: 'M4 6h11M19 6h1M4 12h1M9 12h11M4 18h7M15 18h5M15 4v4M5 10v4M11 16v4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1L15 3H9l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4Z',
  app: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  external: 'M15 3h6v6M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
}

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
