import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import api from '../api'
import ContactHistoryPanel, { StatusBadge } from './ContactHistoryPanel'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/campaign/new', label: 'New Campaign' },
  { to: '/campaigns', label: 'History' },
  { to: '/search', label: 'Search' },
  { to: '/profile', label: 'Profile' },
  { to: '/settings', label: 'Settings' },
]

export default function Navbar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [dropdownVisible, setDropdownVisible] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState(null)
  const searchInputRef = useRef(null)
  const dropdownRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setDropdownVisible(false)
        searchInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setDropdownVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }
    
    let active = true
    const timeoutId = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(query)}&limit=6`)
        .then(res => {
            if(active) setResults(res.data.results)
        })
        .catch(console.error)
    }, 300)
    
    return () => { active = false; clearTimeout(timeoutId); }
  }, [query])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (query.length >= 2) {
      setDropdownVisible(false)
      navigate(`/search?q=${encodeURIComponent(query)}`)
    }
  }

  const openContactHistory = (email) => {
    setDropdownVisible(false)
    setSelectedEmail(email)
  }

  return (
    <>
      <nav id="main-navbar" className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <span className="text-lg font-bold text-gray-900 tracking-tight shrink-0 mr-4">
              📧 Outreach
            </span>
            
            {/* Global Search Bar */}
            <div className="flex-1 max-w-sm mr-auto relative hidden md:block">
              <form onSubmit={handleSearchSubmit}>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-sm">🔍</span>
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setDropdownVisible(true); }}
                    onFocus={() => { if (query.length >= 2) setDropdownVisible(true); }}
                    className="block w-full pl-9 pr-12 py-1.5 border border-gray-300 rounded-md leading-5 bg-gray-50 placeholder-gray-500 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm transition-colors"
                    placeholder="Search contacts..."
                  />
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-xs font-mono border border-gray-200 rounded px-1.5 bg-gray-100">Ctrl+K</span>
                  </div>
                </div>
              </form>

              {/* Live Dropdown */}
              {dropdownVisible && results.length > 0 && (
                <div ref={dropdownRef} className="absolute top-full mt-1 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                  {results.slice(0, 6).map(r => (
                    <div 
                      key={r.id}
                      onClick={() => openContactHistory(r.email)}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="truncate pr-2">
                          <span className="font-medium text-sm text-gray-900">{r.email}</span>
                          {r.name && (
                            <span className="text-gray-500 text-xs ml-2">({r.name})</span>
                          )}
                        </div>
                        <div className="shrink-0">
                           <StatusBadge status={r.reply_status || r.send_status} />
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mt-1 line-clamp-1">
                        {r.campaign_name} · {new Date(r.sent_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                  <div 
                    onClick={() => { setDropdownVisible(false); navigate(`/search?q=${encodeURIComponent(query)}`); }}
                    className="px-4 py-2 text-center text-sm text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 cursor-pointer font-medium transition-colors"
                  >
                    See all results for "{query}" →
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 overflow-x-auto no-scrollbar">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <ContactHistoryPanel 
        email={selectedEmail} 
        isOpen={!!selectedEmail} 
        onClose={() => setSelectedEmail(null)} 
      />
    </>
  )
}
