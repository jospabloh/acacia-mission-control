import { Icon } from './icons.jsx'

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

export function StatCard({ label, value, hint, accent = false }) {
  return (
    <div className="rounded-xl border border-hair bg-paper-card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={`mt-2 font-display text-3xl font-semibold ${accent ? 'text-brand' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  )
}

// Designed empty state (replaces the old dashed "coming soon" box).
export function EmptyState({ icon = 'bolt', title, children, phase }) {
  return (
    <div className="rounded-2xl border border-hair bg-paper-card px-8 py-12 text-center">
      <div className="mx-auto h-12 w-12 grid place-items-center rounded-xl bg-brand/10 text-brand">
        <Icon name={icon} size={22} />
      </div>
      <h2 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{children}</p>
      {phase && (
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-paper-subtle px-3 py-1 text-[11px] font-medium text-ink-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Llega en Fase {phase}
        </span>
      )}
    </div>
  )
}
