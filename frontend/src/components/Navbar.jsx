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
      <nav id="main-navbar" className="bg-white border-b border-zinc-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <span className="text-xl font-display font-bold text-zinc-950 tracking-tight shrink-0 mr-6">
              Outreach
            </span>
            
            {/* Global Search Bar */}
            <div className="flex-1 max-w-sm mr-auto relative hidden md:block">
              <form onSubmit={handleSearchSubmit}>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-zinc-400 text-sm">/</span>
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setDropdownVisible(true); }}
                    onFocus={() => { if (query.length >= 2) setDropdownVisible(true); }}
                    className="block w-full pl-9 pr-12 py-1.5 border border-zinc-200 rounded-none leading-5 bg-zinc-50 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 sm:text-sm transition-colors"
                    placeholder="Search contacts..."
                  />
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                    <span className="text-zinc-400 text-xs font-mono border border-zinc-200 px-1.5 bg-zinc-100">Ctrl+K</span>
                  </div>
                </div>
              </form>

              {/* Live Dropdown */}
              {dropdownVisible && results.length > 0 && (
                <div ref={dropdownRef} className="absolute top-full mt-2 left-0 w-full bg-white border border-zinc-200 shadow-sm z-50 max-h-80 overflow-y-auto">
                  {results.slice(0, 6).map(r => (
                    <div 
                      key={r.id}
                      onClick={() => openContactHistory(r.email)}
                      className="px-4 py-3 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="truncate pr-2">
                          <span className="font-medium text-sm text-zinc-900">{r.email}</span>
                          {r.name && (
                            <span className="text-zinc-500 text-xs ml-2">({r.name})</span>
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
                    className="px-4 py-3 text-center text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer font-medium transition-colors"
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
                    `px-3 h-16 inline-flex items-center text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                      isActive
                        ? 'border-zinc-950 text-zinc-950'
                        : 'border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-300'
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
