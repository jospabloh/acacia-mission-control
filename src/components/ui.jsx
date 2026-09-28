// Piezas compartidas del panel. Existen para que cada página deje de inventar
// su propio botón, su propio modal y su propia línea de "listo/error": una
// consola de operación se lee mejor cuando el mismo gesto se ve igual en todas
// las pantallas, y cuando cada acción destructiva se presenta de la misma forma.
//
// Reglas que sostienen esto:
//   · el foco de teclado SIEMPRE se ve (un operador navega con Tab a media
//     madrugada);
//   · los verbos no cambian de nombre entre el botón y el aviso de resultado
//     ("Dar de baja" → "Licencia dada de baja");
//   · nada destructivo se dispara sin decir antes qué va a pasar exactamente.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-paper-card'

const BUTTON_VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-deep shadow-sm',
  secondary: 'border border-hair bg-paper-card text-ink hover:bg-paper-subtle',
  ghost: 'text-ink-soft hover:bg-paper-subtle hover:text-ink',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  'danger-soft': 'border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40',
  positive: 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40',
  warn: 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40',
}
const BUTTON_SIZES = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
}

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${focus} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
}

const BADGE_TONES = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/25',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-500/25',
  warn: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/30',
  bad: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/25',
  critical: 'bg-red-100 text-red-900 ring-red-700/25 dark:bg-red-900/50 dark:text-red-200 dark:ring-red-500/35',
  neutral: 'bg-paper-subtle text-ink-mute ring-ink/5',
}

export function Badge({ tone = 'neutral', children, title, className = '' }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

// Buscador. Un solo campo que filtra por lo que el operador tiene en la cabeza
// (el nombre del negocio), no por la llave con la que está guardado.
export function SearchInput({ value, onChange, placeholder = 'Buscar…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <Icon name="search" size={15} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-9 w-full rounded-lg border border-hair bg-paper-card pl-9 pr-8 text-sm text-ink placeholder:text-ink-faint ${focus}`}
      />
      {value && (
        <button onClick={() => onChange('')} title="Limpiar" className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink ${focus}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  )
}

// Filtro por chips: cada opción trae su cuenta, así el filtro también sirve de
// resumen — cuántas hay vencidas se lee sin aplicar el filtro.
export function FilterChips({ options, value, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${focus} ${
              active ? 'border-brand bg-brand text-white' : 'border-hair bg-paper-card text-ink-soft hover:border-brand/40 hover:text-ink'
            } ${o.count === 0 && !active ? 'opacity-45' : ''}`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`tabular-nums ${active ? 'text-white/75' : 'text-ink-faint'}`}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wide text-ink-mute">
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-faint">{hint}</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

export function TextInput({ className = '', ...props }) {
  return <input className={`h-9 w-full rounded-lg border border-hair bg-paper-card px-3 text-sm text-ink placeholder:text-ink-faint ${focus} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`h-9 w-full rounded-lg border border-hair bg-paper-card px-2.5 text-sm text-ink ${focus} ${className}`} {...props}>
      {children}
    </select>
  )
}

// Interruptor con etiqueta. Se usa para estados que se guardan solos
// (cobro automático), nunca para algo que necesite confirmación.
export function Toggle({ checked, onChange, label, title, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} title={title} disabled={disabled}
      onClick={onChange}
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-45 ${focus} ${
        checked ? 'border-brand/40 bg-brand/10 text-brand' : 'border-hair text-ink-mute hover:bg-paper-subtle'
      }`}
    >
      <span className={`relative h-3 w-5 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-ink-faint'}`}>
        <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${checked ? 'left-2.5' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

// Menú de acciones de un renglón. Existe para que la tabla no sea una pared de
// ocho botones por licencia: se ve la acción principal y el resto se pide.
// Cierra con Escape o al hacer clic fuera. `items`: { label, onClick, tone,
// hint, disabled, title, separator }.
export function ActionMenu({ items, label = 'Acciones', align = 'right' }) {
  const box = useRef(null)
  const pop = useRef(null)
  const [open, setOpen] = useState(false)
  // Hacia arriba cuando abajo no cabe: el menú del último renglón de una tabla
  // larga queda contra el borde de la ventana y se lee cortado.
  const [up, setUp] = useState(false)

  useLayoutEffect(() => {
    if (!open) { setUp(false); return }
    // `offsetHeight`, no `getBoundingClientRect`: el menú entra con la
    // animación `pop`, que arranca en scale(0.985), y un rect medido a mitad de
    // ella miente sobre el alto real. El 4 es el `mt-1`/`mb-1` del hueco.
    const h = pop.current?.offsetHeight
    const btn = box.current?.getBoundingClientRect()
    if (!h || !btn) return
    setUp(btn.bottom + 4 + h > window.innerHeight - 8 && btn.top > h + 8)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])

  const usable = items.filter(Boolean)
  if (usable.length === 0) return null

  return (
    <div ref={box} className="relative">
      <button
        type="button" title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-hair text-ink-mute transition-colors hover:bg-paper-subtle hover:text-ink ${focus} ${open ? 'bg-paper-subtle text-ink' : ''}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </button>
      {open && (
        <div ref={pop} role="menu" className={`pop absolute z-40 w-60 overflow-hidden rounded-xl border border-hair bg-paper-card py-1 shadow-card ${align === 'right' ? 'right-0' : 'left-0'} ${up ? 'bottom-full mb-1' : 'mt-1'}`}>
          {usable.map((it, i) => it.separator ? (
            <div key={`sep-${i}`} className="my-1 border-t border-hair" />
          ) : (
            <button
              key={it.label} role="menuitem" disabled={it.disabled} title={it.title}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`block w-full px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focus} ${
                it.tone === 'danger' ? 'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40' : 'text-ink hover:bg-paper-subtle'
              }`}
            >
              {it.label}
              {it.hint && <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Modal. Cierra con Escape y con clic fuera (nunca mientras algo está en vuelo),
// y enfoca su primer control al abrir para que se pueda operar sin mouse.
export function Modal({ open, onClose, title, subtitle, tone = 'neutral', children, footer, busy }) {
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const first = panel.current?.querySelector('input, select, textarea, button')
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, busy])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-[2px]" onClick={() => !busy && onClose()}>
      <div
        ref={panel} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`rise w-full max-w-md rounded-2xl border bg-paper-card p-6 shadow-card ${tone === 'danger' ? 'border-red-200 dark:border-red-900' : 'border-hair'}`}
      >
        <h3 className={`font-display text-lg font-semibold ${tone === 'danger' ? 'text-red-800 dark:text-red-300' : 'text-ink'}`}>{title}</h3>
        {subtitle && <div className="mt-1 text-sm text-ink-soft">{subtitle}</div>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

// Aviso de consecuencia dentro de un modal: qué va a pasar exactamente, en una
// caja que se distingue del resto del texto.
export function Callout({ tone = 'neutral', children }) {
  const cls = {
    neutral: 'bg-paper-subtle text-ink-soft',
    ok: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    warn: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    danger: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
  }[tone]
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>
}

// Avisos de resultado. Se apilan abajo a la derecha y se van solos; los errores
// se quedan hasta que se cierran, porque un error que desaparece solo es un
// error que nadie leyó.
export function ToastStack({ toasts, onDismiss }) {
  // bottom-left, not bottom-right: the corner theme switcher (ThemeSwitcher.jsx)
  // is pinned bottom-right in every app of the portfolio, and a stack of toasts
  // sharing that corner sits on top of it (z-[60] over the switcher's z-50) for
  // as long as an error toast is up — which per this file's own rule can be
  // indefinitely. Toasts are this app's own file, so they're the one that moves.
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id} role="status"
          className={`rise pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-card ${
            t.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200'
          }`}
        >
          <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${t.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {t.ok ? '✓' : '!'}
          </span>
          <p className="min-w-0 flex-1 text-sm">{t.msg}</p>
          <button onClick={() => onDismiss(t.id)} title="Cerrar" className={`rounded p-0.5 opacity-50 hover:opacity-100 ${focus}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  )
}
