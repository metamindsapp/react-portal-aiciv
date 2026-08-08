import { lazy, Suspense } from 'react'
import './GlobalPresenceControl.css'

const VoicePresenceControl = lazy(async () => {
  const module = await import('../chat/VoicePresenceControl')
  return { default: module.VoicePresenceControl }
})

/**
 * App-shell Presence entrypoint.
 *
 * Provider-specific code remains in the existing VoicePresenceControl module;
 * the shell only knows that the AICIV exposes a live Presence capability.
 */
export function GlobalPresenceControl() {
  return (
    <div className="global-presence">
      <Suspense
        fallback={(
          <button type="button" className="global-presence-loading" disabled>
            Talk live
          </button>
        )}
      >
        <VoicePresenceControl />
      </Suspense>
    </div>
  )
}
