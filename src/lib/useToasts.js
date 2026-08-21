import { useCallback, useRef, useState } from 'react'

// Avisos de resultado del panel. Vive aparte de <ToastStack> porque este repo no
// mezcla un hook y un componente en el mismo archivo (react-refresh, ver
// CLAUDE.md).
//
// Un acierto se va solo a los 6s; un error se queda hasta que alguien lo cierra.
// Esa asimetría es a propósito: "listo" es una confirmación, "falló" es trabajo
// pendiente y no debe poder pasar desapercibido.
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const push = useCallback((ok, msg) => {
    const id = ++seq.current
    setToasts((ts) => [...ts, { id, ok, msg }])
    if (ok) setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 6000)
    return id
  }, [])

  const ok = useCallback((msg) => push(true, msg), [push])
  const fail = useCallback((msg) => push(false, msg), [push])

  return { toasts, ok, fail, dismiss }
}
