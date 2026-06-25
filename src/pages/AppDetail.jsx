import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchApps } from '../lib/appRegistry.js'
import { PageHeader } from '../components/PageHeader.jsx'

export function AppDetail() {
  const { appId } = useParams()
  const [app, setApp] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => {
    fetchApps()
      .then((apps) => setApp(apps.find((a) => a.id === appId) ?? null))
      .catch(() => setApp(null))
  }, [appId])

  if (app === undefined) return <p className="text-acacia-500">Cargando…</p>
  if (app === null) {
    return (
      <div>
        <PageHeader title="App no encontrada" />
        <Link to="/" className="text-sm text-acacia-700 underline">← Volver al portafolio</Link>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={app.name} subtitle={`${app.backend}${app.external_id ? ` · ${app.external_id}` : ''}`}>
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer"
            className="text-sm text-acacia-700 underline">Abrir app ↗</a>
        )}
      </PageHeader>
      <div className="rounded-xl border bg-white p-5">
        <h2 className="text-sm font-semibold text-acacia-700 mb-2">Config del adapter</h2>
        <pre className="text-xs bg-acacia-50 rounded-lg p-3 overflow-auto">{JSON.stringify(app.config, null, 2)}</pre>
      </div>
    </div>
  )
}
