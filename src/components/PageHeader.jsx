export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-acacia-900">{title}</h1>
        {subtitle && <p className="text-sm text-acacia-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

// Placeholder used by pillar pages until their Fase ships.
export function ComingSoon({ phase }) {
  return (
    <div className="rounded-xl border border-dashed bg-white p-8 text-center text-acacia-500">
      <p className="text-sm">Esta sección se construye en <span className="font-medium">{phase}</span>.</p>
    </div>
  )
}
