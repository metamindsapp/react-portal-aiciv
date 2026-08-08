import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react'
import { apiGet, apiPost } from '../../api/client'
import './VoicePresenceControl.css'

interface PresenceStatusResponse {
  configured: boolean
  surface: string
  civ: string
  voice: {
    available: boolean
  }
}

interface VoiceTokenResponse {
  token: string
  conversationId: string
}

type VoiceUiState = 'checking' | 'unavailable' | 'ready' | 'starting' | 'connected' | 'error'

/**
 * Keep ElevenLabs conversation state scoped to this one control. The rest of
 * Portal never receives provider credentials or provider-specific state.
 */
export function VoicePresenceControl() {
  return (
    <ConversationProvider>
      <VoicePresenceControlInner />
    </ConversationProvider>
  )
}

function VoicePresenceControlInner() {
  const { startSession, endSession } = useConversationControls()
  const { status, message: providerStatusMessage } = useConversationStatus()
  const { isMuted, setMuted } = useConversationInput()
  const { isSpeaking, isListening } = useConversationMode()

  const [availability, setAvailability] = useState<PresenceStatusResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    apiGet<PresenceStatusResponse>('/api/presence/status')
      .then((result) => {
        if (active) setAvailability(result)
      })
      .catch(() => {
        if (active) {
          setAvailability({
            configured: false,
            surface: 'portal',
            civ: '',
            voice: { available: false },
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  const uiState: VoiceUiState = useMemo(() => {
    if (!availability) return 'checking'
    if (!availability.voice.available) return 'unavailable'
    if (localError) return 'error'
    if (starting || status === 'connecting') return 'starting'
    if (status === 'connected') return 'connected'
    return 'ready'
  }, [availability, localError, starting, status])

  const startVoice = useCallback(async () => {
    if (starting || status !== 'disconnected') return

    setStarting(true)
    setLocalError(null)

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone capture.')
      }

      // Ask for microphone permission on the user's click. We immediately stop
      // this probe stream; ElevenLabs owns the actual WebRTC capture lifecycle.
      // Doing it here produces a clear Portal-level permission failure instead
      // of an opaque provider connection error.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      permissionStream.getTracks().forEach((track) => track.stop())

      const credentials = await apiPost<VoiceTokenResponse>('/api/presence/voice/token', {
        participantName: 'portal-web',
      })

      if (!credentials.token) {
        throw new Error('The voice service did not return a usable session token.')
      }

      // A conversation token selects authenticated WebRTC. The token is
      // intentionally short-lived and is never persisted to localStorage.
      await startSession({ conversationToken: credentials.token })
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to start voice.'
      if (/permission|denied|notallowed/i.test(text)) {
        setLocalError('Microphone permission is required for voice.')
      } else {
        setLocalError('Voice could not connect. Try again.')
      }
    } finally {
      setStarting(false)
    }
  }, [startSession, starting, status])

  const stopVoice = useCallback(async () => {
    setLocalError(null)
    try {
      await endSession()
    } catch {
      setLocalError('Voice did not close cleanly. You can reconnect.')
    }
  }, [endSession])

  const toggleMute = useCallback(() => {
    setMuted(!isMuted)
  }, [isMuted, setMuted])

  const label = useMemo(() => {
    if (uiState === 'checking') return 'Voice'
    if (uiState === 'unavailable') return 'Voice off'
    if (uiState === 'starting') return 'Connecting'
    if (uiState === 'error') return 'Retry voice'
    if (uiState === 'connected') {
      if (isMuted) return 'Muted'
      if (isSpeaking) return 'Speaking'
      if (isListening) return 'Listening'
      return 'Voice live'
    }
    return 'Voice'
  }, [uiState, isMuted, isSpeaking, isListening])

  const title = useMemo(() => {
    if (uiState === 'unavailable') return 'Voice Presence is not configured on this Portal'
    if (localError) return localError
    if (providerStatusMessage) return providerStatusMessage
    if (uiState === 'connected') return 'End voice conversation'
    return 'Talk to your AICIV'
  }, [localError, providerStatusMessage, uiState])

  const isConnected = status === 'connected'

  return (
    <div
      className={`voice-presence voice-presence-${uiState}`}
      aria-live="polite"
      data-speaking={isSpeaking ? 'true' : 'false'}
      data-listening={isListening ? 'true' : 'false'}
    >
      <button
        type="button"
        className="voice-presence-main"
        onClick={isConnected ? stopVoice : startVoice}
        disabled={uiState === 'checking' || uiState === 'unavailable' || uiState === 'starting'}
        title={title}
        aria-label={isConnected ? 'End voice conversation' : 'Start voice conversation'}
      >
        <span className="voice-presence-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img">
            <path d="M12 15.25a4.25 4.25 0 0 0 4.25-4.25V6.25a4.25 4.25 0 1 0-8.5 0V11A4.25 4.25 0 0 0 12 15.25Z" />
            <path d="M5.75 10.75v.5a6.25 6.25 0 0 0 12.5 0v-.5M12 17.5V21M9 21h6" />
          </svg>
        </span>
        <span className="voice-presence-label">{label}</span>
        <span className="voice-presence-pulse" aria-hidden="true" />
      </button>

      {isConnected && (
        <button
          type="button"
          className={`voice-presence-mute ${isMuted ? 'voice-presence-mute-active' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={isMuted}
        >
          {isMuted ? '◉' : '○'}
        </button>
      )}

      {localError && <span className="voice-presence-error">{localError}</span>}
    </div>
  )
}
