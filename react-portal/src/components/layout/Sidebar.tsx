import { NavLink } from 'react-router-dom'
import { useMailStore } from '../../stores/mailStore'
import { useBookmarkStore } from '../../stores/bookmarkStore'
import { cn } from '../../utils/cn'
import './Sidebar.css'

const NAV_GROUPS = [
  {
    label: 'Together',
    items: [
      { to: '/now', icon: '\u{2728}', label: 'Now' },
      { to: '/', icon: '\u{1F4AC}', label: 'Conversation' },
    ],
  },
  {
    label: 'Work',
    items: [
      { to: '/teams', icon: '\u{1F465}', label: 'Teams' },
      { to: '/calendar', icon: '\u{1F4C5}', label: 'Calendar' },
      { to: '/mail', icon: '\u{1F4E8}', label: 'Mail' },
      { to: '/orgchart', icon: '\u{1F3E2}', label: 'Org' },
      { to: '/tgim', icon: '\u{1F3AF}', label: 'TGIM' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { to: '/docs', icon: '\u{1F4D6}', label: 'Docs' },
      { to: '/sheets', icon: '\u{1F4CA}', label: 'Sheets' },
      { to: '/hub', icon: '\u{1F310}', label: 'HUB' },
      { to: '/bookmarks', icon: '\u{1F4CC}', label: 'Bookmarks' },
      { to: '/points', icon: '\u{2B50}', label: 'Signals' },
    ],
  },
  {
    label: 'Control',
    items: [
      { to: '/browser', icon: '\u{1F30D}', label: 'Browser' },
      { to: '/terminal', icon: '\u{2328}\u{FE0F}', label: 'Terminal' },
      { to: '/context', icon: '\u{1F9E0}', label: 'Context' },
      { to: '/status', icon: '\u{1F4DF}', label: 'Status' },
      { to: '/settings', icon: '\u{2699}\u{FE0F}', label: 'Settings' },
    ],
  },
] as const

export function Sidebar() {
  const unreadCount = useMailStore(s => s.unreadCount)
  const bookmarkCount = useBookmarkStore(s => s.bookmarks.length)

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="Portal navigation">
        {NAV_GROUPS.map(group => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
                {item.to === '/mail' && unreadCount > 0 && (
                  <span className="sidebar-badge">{unreadCount}</span>
                )}
                {item.to === '/bookmarks' && bookmarkCount > 0 && (
                  <span className="sidebar-badge">{bookmarkCount}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a href="https://ai-civ.com" target="_blank" rel="noopener noreferrer" className="sidebar-powered">
          Powered by <strong>AiCIV</strong>
        </a>
        <a href="https://ai-civ.com/blog" target="_blank" rel="noopener noreferrer" className="sidebar-blog-link">
          Chronicles
        </a>
      </div>
    </aside>
  )
}
