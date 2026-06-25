import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchApps } from '../lib/appRegistry.js'
import { PageHeader } from '../components/PageHeader.jsx'

const BACKEND_LABEL = {
  base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático',
}

export function Dashboard() {
  const [apps, setApps] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchApps().then(setApps).catch((e) => setError(e.message))
  }, [])

  return (
    <div>
      <PageHeader title="Portafolio" subtitle="Vista general de las apps de ACACIA" />
      {error && <p className="text-sm text-red-600 mb-4">No se pudo leer el registro: {error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {apps.map((a) => (
          <Link key={a.id} to={`/apps/${a.id}`}
            className="block rounded-xl border bg-white p-5 hover:shadow transition-shadow">
            <div className="flex items-center justify-between">
              <span className="font-medium text-acacia-900">{a.name}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${a.status === 'active' ? 'bg-green-500' : 'bg-amber-400'}`} />
            </div>
            <div className="mt-2 text-xs text-acacia-500">
              {BACKEND_LABEL[a.backend] ?? a.backend}
              {a.external_id && <span className="ml-1 font-mono">· {a.external_id.slice(0, 8)}…</span>}
            </div>
            {a.url && <div className="mt-1 text-xs text-acacia-500 truncate">{a.url}</div>}
          </Link>
        ))}
      </div>
      {apps.length === 0 && !error && (
        <p className="text-sm text-acacia-500">El registro de apps está vacío. Aplica el seed 0002.</p>
      )}
    </div>
  )
}
