import { fmtDuration, slaProgress } from '../lib/ticketCatalog.js'

// Heat bar for a ticket's resolve SLA: fills and heats from green through amber
// to red as the deadline approaches; full red once overdue. Renders nothing when
// the ticket has no running clock (closed, or no due time).
//
// The gradient is declared once across the full track. The fill's width is the
// share used, and background-size is stretched by the inverse of that share, so
// a 20% fill shows only the first fifth of the gradient (still green) instead of
// squeezing the whole green→red rainbow into a narrow strip.
export function SlaHeatBar({ row, now = Date.now(), className = '', showLabel = false }) {
  const p = slaProgress(row, now)
  if (!p) return null
  const pct = Math.max(p.used * 100, 2)
  const label = p.overdue ? `SLA vencido ${fmtDuration(p.remainingMs)}` : `SLA: quedan ${fmtDuration(p.remainingMs)}`
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={label}>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.used * 100)}
        className="relative block h-1.5 w-full min-w-[3rem] overflow-hidden rounded-full bg-ink/10"
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${p.overdue ? 'bg-red-500' : 'bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500'}`}
          style={{ width: `${pct}%`, backgroundSize: p.overdue ? undefined : `${10000 / pct}% 100%` }}
        />
      </span>
      {showLabel && (
        <span className={`shrink-0 whitespace-nowrap text-[10px] font-medium ${p.overdue ? 'text-red-700 dark:text-red-300' : 'text-ink-mute'}`}>{label}</span>
      )}
    </span>
  )
}
