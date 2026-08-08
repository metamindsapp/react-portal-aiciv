import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { AuthModal } from './AuthModal'
import { FullPageSpinner } from '../common/LoadingSpinner'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const authenticated = useAuthStore(s => s.authenticated)
  const loading = useAuthStore(s => s.loading)
  const checkAuth = useAuthStore(s => s.checkAuth)
  const logout = useAuthStore(s => s.logout)

  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  useEffect(() => {
    const onExpired = () => logout()
    window.addEventListener('aiciv:auth-expired', onExpired)
    return () => window.removeEventListener('aiciv:auth-expired', onExpired)
  }, [logout])

  if (loading) return <FullPageSpinner />
  if (!authenticated) return <AuthModal />

  return <>{children}</>
}
