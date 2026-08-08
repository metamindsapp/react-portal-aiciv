import { useEffect, useState } from 'react'
import type { PortalErrorEventDetail } from '../../api/client'
import './ErrorCenter.css'

interface VisibleError extends PortalErrorEventDetail {
  id: string
  at: number
}

export function ErrorCenter() {
  const [errors, setErrors] = useState<VisibleError[]>([])

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<PortalErrorEventDetail>).detail
      if (!detail) return
      const item: VisibleError = {
        ...detail,
        id: `${detail.requestId || 'local'}:${Date.now()}`,
        at: Date.now(),
      }
      setErrors(current => [item, ...current].slice(0, 4))
      window.setTimeout(() => {
        setErrors(current => current.filter(error => error.id !== item.id))
      }, 9000)
    }
    window.addEventListener('aiciv:error', onError)
    return () => window.removeEventListener('aiciv:error', onError)
  }, [])

  if (errors.length === 0) return null

  return (
    <aside className="error-center" aria-live="polite" aria-label="Portal errors">
      {errors.map(error => (
        <div key={error.id} className="error-center-card">
          <div className="error-center-head">
            <strong>{error.code.replaceAll('_', ' ')}</strong>
            <button
              type="button"
              onClick={() => setErrors(current => current.filter(item => item.id !== error.id))}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
          <p>{error.message}</p>
          <div className="error-center-meta">
            {error.path && <span>{error.path}</span>}
            {error.requestId && <span title="Use this request ID when debugging">{error.requestId}</span>}
          </div>
        </div>
      ))}
    </aside>
  )
}
