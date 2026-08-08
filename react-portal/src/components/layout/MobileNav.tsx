import { useState, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useMailStore } from '../../stores/mailStore'
import { cn } from '../../utils/cn'
import './MobileNav.css'

const PRIMARY_ITEMS = [
  { to: '/now', icon: '\u{2728}', label: 'Now' },
  { to: '/', icon: '\u{1F4AC}', label: 'Chat' },
  { to: '/inbox', icon: '\u{1F4E5}', label: 'Inbox' },
  { to: '/mail', icon: '\u{1F4E8}', label: 'Mail' },
] as const

const MORE_ITEMS = [
  { to: '/calendar', icon: '\u{1F4C5}', label: 'Calendar' },
  { to: '/teams', icon: '\u{1F465}', label: 'Teams' },
  { to: '/docs', icon: '\u{1F4D6}', label: 'Docs' },
  { to: '/sheets', icon: '\u{1F4CA}', label: 'Sheets' },
  { to: '/hub', icon: '\u{1F310}', label: 'HUB' },
  { to: '/browser', icon: '\u{1F30D}', label: 'Browser' },
  { to: '/tgim', icon: '\u{1F3AF}', label: 'TGIM' },
  { to: '/orgchart', icon: '\u{1F3E2}', label: 'Org' },
  { to: '/terminal', icon: '\u{2328}\u{FE0F}', label: 'Terminal' },
  { to: '/context', icon: '\u{1F9E0}', label: 'Context' },
  { to: '/points', icon: '\u{2B50}', label: 'Signals' },
  { to: '/bookmarks', icon: '\u{1F4CC}', label: 'Bookmarks' },
  { to: '/status', icon: '\u{1F4DF}', label: 'Status' },
  { to: '/settings', icon: '\u{2699}\u{FE0F}', label: 'Settings' },
] as const

export function MobileNav() {
  const unreadCount = useMailStore(s => s.unreadCount)
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()

  const handleMoreItem = useCallback((to: string) => {
    navigate(to)
    setMoreOpen(false)
  }, [navigate])

  return (
    <>
      {moreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMoreOpen(false)} />
      )}

      {moreOpen && (
        <div className="mobile-more-sheet">
          <div className="mobile-more-handle" />
          <div className="mobile-more-grid">
            {MORE_ITEMS.map(item => (
              <button
                key={item.to}
                className="mobile-more-item"
                onClick={() => handleMoreItem(item.to)}
                type="button"
              >
                <span className="mobile-more-icon">{item.icon}</span>
                <span className="mobile-more-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="mobile-nav" aria-label="Mobile Portal navigation">
        {PRIMARY_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn('mobile-nav-item', isActive && 'mobile-nav-active')}
            onClick={() => setMoreOpen(false)}
          >
            <span className="mobile-nav-icon">
              {item.icon}
              {item.to === '/mail' && unreadCount > 0 && (
                <span className="mobile-nav-badge">{unreadCount}</span>
              )}
            </span>
            <span className="mobile-nav-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          className={cn('mobile-nav-item', 'mobile-nav-more-btn', moreOpen && 'mobile-nav-active')}
          onClick={() => setMoreOpen(o => !o)}
          type="button"
        >
          <span className="mobile-nav-icon">{moreOpen ? '\u{2716}' : '\u{2630}'}</span>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>
    </>
  )
}
