import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

/**
 * ACACIA portfolio app shell — shared, byte-identical across every app in the
 * portfolio (module 29). Change it in `jospabloh/acacia-app-standard` first and
 * copy it out, so an operator who runs two ACACIA apps finds the account, the
 * feedback entry and the collapse control in the same place in both.
 *
 * Shape, and the one job each region has:
 *   - top bar, left:  the app's mark and name — "where am I".
 *   - top bar, right: the context the data belongs to (tenant/workspace) and
 *                     the avatar — "who am I, and for whom". The avatar opens
 *                     the account menu; it is the only way to sign out.
 *   - sidebar:        a small uppercase heading, then the sections. Icon +
 *                     label, one active pill derived from the route.
 *   - sidebar foot:   "Enviar sugerencia" (module 8), a rule, "Contraer menú".
 *                     Pinned: the list above scrolls, these never do.
 *
 * The theme is NOT here. It stays the corner control of module 12, bottom-right,
 * which is why everything this shell pins sits on the left.
 *
 * Module 23 holds by construction: the active item comes from NavLink on every
 * render (aria-current="page"), every piece below is declared at module scope
 * so the <nav> never remounts on navigation. On a phone the sections live in a
 * native modal <dialog> that stays mounted while closed, and it opens with the
 * active item in view.
 *
 * Colours are the app's own shadcn-style tokens (bg-card, border-border,
 * text-muted-foreground, bg-accent, bg-primary…), same as ThemeSwitcher.jsx.
 */

// Collapsed is a preference, like the theme: localStorage, one key for the
// whole portfolio. Module 23's sessionStorage rule is for transient nav state
// (an expanded group, a scroll position) — this outlives the tab on purpose.
const COLLAPSED_KEY = 'acacia-shell-collapsed';

// The nav's scroll offset IS that transient state: sessionStorage, restored
// before paint so a reload never shows the list snapping back to the top.
const NAV_SCROLL_KEY = 'acacia-shell-nav-scroll';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the control still works for this visit.
  }
}

function initialsOf(user) {
  const source = (user?.name || user?.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 1);
  return letters.toUpperCase();
}

const svgProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function FeedbackGlyph() {
  return (
    <svg {...svgProps}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M12 8.5v4" />
      <path d="M12 15.5h.01" />
    </svg>
  );
}

function CollapseGlyph({ collapsed }) {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d={collapsed ? 'm13 10 2 2-2 2' : 'm15 10-2 2 2 2'} />
    </svg>
  );
}

function MenuGlyph() {
  return (
    <svg {...svgProps}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg {...svgProps}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

const iconButtonClass = [
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground',
  'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
].join(' ');

const rowBase = [
  'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm',
  'min-h-[40px] transition-colors motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
].join(' ');

const rowIdle = 'text-foreground/80 hover:bg-accent hover:text-foreground';
const rowActive = 'bg-accent font-medium text-foreground';

function RowLabel({ collapsed, children }) {
  return <span className={collapsed ? 'truncate md:sr-only' : 'truncate'}>{children}</span>;
}

function NavItem({ item, collapsed, onNavigate }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          [rowBase, isActive ? rowActive : rowIdle, collapsed ? 'md:justify-center md:px-0' : ''].join(' ')
        }
      >
        {({ isActive }) => (
          <>
            {Icon ? (
              <Icon
                className={['h-5 w-5 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground'].join(' ')}
                aria-hidden="true"
              />
            ) : null}
            <RowLabel collapsed={collapsed}>{item.label}</RowLabel>
          </>
        )}
      </NavLink>
    </li>
  );
}

function FooterAction({ action, collapsed, icon, label, onNavigate }) {
  const className = [rowBase, rowIdle, collapsed ? 'md:justify-center md:px-0' : ''].join(' ');
  const title = collapsed ? label : undefined;
  if (action?.to) {
    return (
      <Link to={action.to} onClick={onNavigate} title={title} className={className}>
        {icon}
        <RowLabel collapsed={collapsed}>{label}</RowLabel>
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        action?.onSelect?.();
      }}
      title={title}
      className={className}
    >
      {icon}
      <RowLabel collapsed={collapsed}>{label}</RowLabel>
    </button>
  );
}

// One body, two homes: the desktop <aside> and the phone <dialog>. Declared
// at module scope so neither remounts on navigation (module 23).
function SidebarBody({ sectionLabel, nav, feedback, collapsed, onToggleCollapsed, onNavigate, navRef, onNavScroll }) {
  return (
    <>
      {sectionLabel ? (
        <p
          className={[
            'px-4 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
            collapsed ? 'md:sr-only' : '',
          ].join(' ')}
        >
          {sectionLabel}
        </p>
      ) : (
        <div className="pt-3" />
      )}

      <nav
        ref={navRef}
        aria-label={sectionLabel || 'Principal'}
        onScroll={onNavScroll}
        className={[
          'min-h-0 flex-1 overflow-y-auto px-2 pb-3',
          // A 64px rail can't spare a scrollbar's width without pushing the
          // icons off-centre; it still scrolls by wheel, touch and keyboard.
          collapsed ? '[scrollbar-width:none]' : '[scrollbar-width:thin]',
        ].join(' ')}
      >
        <ul className="space-y-0.5">
          {nav.map((item) => (
            <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      <div className="space-y-0.5 px-2 pb-3">
        {feedback ? (
          <FooterAction
            action={feedback}
            collapsed={collapsed}
            onNavigate={onNavigate}
            label={feedback.label || 'Enviar sugerencia'}
            icon={<span className="shrink-0 text-muted-foreground"><FeedbackGlyph /></span>}
          />
        ) : null}
        {/* Collapsing only means something on desktop; the phone drawer is
            already the small form, so it gets no toggle. */}
        {onToggleCollapsed ? (
          <>
            <div className="my-2 border-t border-border" />
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-pressed={collapsed}
              title={collapsed ? 'Expandir menú' : undefined}
              className={[rowBase, rowIdle, collapsed ? 'md:justify-center md:px-0' : ''].join(' ')}
            >
              <span className="shrink-0 text-muted-foreground">
                <CollapseGlyph collapsed={collapsed} />
              </span>
              <RowLabel collapsed={collapsed}>{collapsed ? 'Expandir menú' : 'Contraer menú'}</RowLabel>
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

function AccountMenu({ user, items, onSignOut }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const itemClass = [
    'flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-foreground/90',
    'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ].join(' ');

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Cuenta de ${user?.name || user?.email || 'usuario'}`}
        className={[
          'flex h-9 w-9 items-center justify-center overflow-hidden rounded-full',
          'bg-primary text-sm font-semibold text-primary-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        ].join(' ')}
      >
        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(user)}
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-3 pb-2 pt-1.5">
            {user?.name ? <p className="truncate text-sm font-medium">{user.name}</p> : null}
            {user?.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
            {user?.role || user?.context ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {[user.role, user.context].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          <div className="my-1 border-t border-border" />
          <ul>
            {items.map((item) => (
              <li key={item.label}>
                {item.to ? (
                  <Link to={item.to} onClick={close} className={itemClass}>
                    {item.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                    className={itemClass}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {onSignOut ? (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  close();
                  onSignOut();
                }}
                className={itemClass}
              >
                Cerrar sesión
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {{name: string, logo?: string, homeTo?: string}} props.app
 * @param {string}   [props.sectionLabel]  sidebar heading, e.g. the tenant kind ("PANEL", "MI NEGOCIO")
 * @param {Array<{to: string, label: string, icon: Function, end?: boolean}>} props.nav  icon is required:
 *   the collapsed rail shows only icons (module 29: sections are icon + label)
 * @param {{to?: string, onSelect?: Function, label?: string}} [props.feedback]  module 8 entry point
 * @param {React.ReactNode} [props.context]  top-right, before the avatar: tenant name or switcher
 * @param {{name?: string, email?: string, role?: string, context?: string, avatarUrl?: string}} props.user
 * @param {Array<{label: string, to?: string, onSelect?: Function}>} [props.accountItems]  Cuenta, Acerca de…
 * @param {Function} [props.onSignOut]
 */
export default function AppShell({
  app,
  sectionLabel,
  nav,
  feedback,
  context,
  user,
  accountItems = [],
  onSignOut,
  children,
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navRef = useRef(null);
  const drawerRef = useRef(null);
  const drawerNavRef = useRef(null);
  const drawerId = useId();
  const location = useLocation();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  }, []);

  // Module 23: restore the desktop nav's scroll offset before the first paint.
  useLayoutEffect(() => {
    try {
      const saved = Number(window.sessionStorage.getItem(NAV_SCROLL_KEY));
      if (saved > 0 && navRef.current) navRef.current.scrollTop = saved;
    } catch {
      // Blocked storage: start at the top.
    }
  }, []);

  const saveNavScroll = useCallback((event) => {
    try {
      window.sessionStorage.setItem(NAV_SCROLL_KEY, String(event.currentTarget.scrollTop));
    } catch {
      // Blocked storage: the position just isn't kept across a reload.
    }
  }, []);

  // The phone drawer is a native modal <dialog>. showModal() makes the rest of
  // the page inert — including anything mounted later, like a toast — Escape
  // closes it, and close() hands focus back to whatever opened it. None of
  // that is reimplemented here; the dialog is the source of truth and the
  // state only mirrors it for aria-expanded.
  const openDrawer = useCallback(() => {
    const dialog = drawerRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setDrawerOpen(true);
    // Start where the user is (module 23); with nothing active, the dialog's
    // own first focusable (the close button) keeps the focus.
    const active = drawerNavRef.current?.querySelector('[aria-current="page"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
      active.focus({ preventScroll: true });
    }
  }, []);

  // Synchronous on purpose: a feedback callback runs right after this, and the
  // focus it moves into its own dialog must not be taken back afterwards.
  const closeDrawer = useCallback(() => {
    if (drawerRef.current?.open) drawerRef.current.close();
  }, []);

  // Any route change closes it, back/forward and query-only moves included.
  useEffect(() => {
    closeDrawer();
  }, [location.key, closeDrawer]);

  // A phone rotating into the desktop layout has no drawer to show.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const onChange = (event) => {
      if (event.matches) closeDrawer();
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [closeDrawer]);

  return (
    <div data-app-shell="" className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-border bg-card px-3 md:px-4">
        <button
          type="button"
          onClick={openDrawer}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          aria-label="Abrir menú"
          className={iconButtonClass + ' md:hidden'}
        >
          <MenuGlyph />
        </button>

        <Link
          to={app.homeTo || '/'}
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {app.logo ? <img src={app.logo} alt="" className="h-7 w-7 shrink-0 rounded-md object-contain" /> : null}
          <span className="truncate text-base font-semibold tracking-tight">{app.name}</span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* Shown at every width: it may be the tenant switcher, and a phone user
              needs it as much as anyone. Narrow screens get a truncated slot. */}
          {context ? (
            <div className="min-w-0 max-w-[40vw] truncate text-sm text-foreground/80 sm:max-w-xs">{context}</div>
          ) : null}
          <AccountMenu user={user} items={accountItems} onSignOut={onSignOut} />
        </div>
      </header>

      <div className="flex">
        <aside
          data-app-shell-sidebar=""
          className={[
            'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-border bg-card md:flex',
            'transition-[width] duration-200 motion-reduce:transition-none',
            collapsed ? 'w-16' : 'w-60',
          ].join(' ')}
        >
          <SidebarBody
            sectionLabel={sectionLabel}
            nav={nav}
            feedback={feedback}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            navRef={navRef}
            onNavScroll={saveNavScroll}
          />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>

      {/* A click on the ::backdrop targets the dialog itself; the inner box
          fills it, so a click on any content never does. */}
      <dialog
        ref={drawerRef}
        id={drawerId}
        aria-label={sectionLabel || 'Menú'}
        onClose={() => setDrawerOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        className={[
          'm-0 h-dvh max-h-none w-72 max-w-[85vw] border-0 border-r border-border bg-card p-0 text-foreground',
          'backdrop:bg-black/40 md:hidden',
        ].join(' ')}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <span className="truncate text-base font-semibold tracking-tight">{app.name}</span>
            <button type="button" onClick={closeDrawer} aria-label="Cerrar menú" className={iconButtonClass}>
              <CloseGlyph />
            </button>
          </div>
          <SidebarBody
            sectionLabel={sectionLabel}
            nav={nav}
            feedback={feedback}
            collapsed={false}
            onNavigate={closeDrawer}
            navRef={drawerNavRef}
          />
        </div>
      </dialog>
    </div>
  );
}
