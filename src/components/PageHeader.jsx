import { Link } from 'react-router-dom'
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

// `to` makes the card a link to a dedicated detail view; omit for a plain,
// non-interactive stat (no `to` → no hover/cursor affordance).
export function StatCard({ label, value, hint, accent = false, to }) {
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={`mt-2 font-display text-3xl font-semibold ${accent ? 'text-brand' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </>
  )
  if (!to) return <div className="rounded-xl border border-hair bg-paper-card p-5">{body}</div>
  return (
    <Link to={to} className="block rounded-xl border border-hair bg-paper-card p-5 transition hover:border-brand/40 hover:shadow-card">
      {body}
    </Link>
  )
}

// Designed empty state (replaces the old dashed "coming soon" box).
export function EmptyState({ icon = 'bolt', title, children }) {
  return (
    <div className="rounded-2xl border border-hair bg-paper-card px-8 py-12 text-center">
      <div className="mx-auto h-12 w-12 grid place-items-center rounded-xl bg-brand/10 text-brand">
        <Icon name={icon} size={22} />
      </div>
      <h2 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{children}</p>
    </div>
  )
}
