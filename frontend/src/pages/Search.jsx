import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import api from '../api'
import ContactHistoryPanel, { StatusBadge } from '../components/ContactHistoryPanel'

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  
  const [query, setQuery] = useState(q)
  const [statusFilter, setStatusFilter] = useState('all')
  const [daysFilter, setDaysFilter] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  
  const [campaigns, setCampaigns] = useState([])
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  
  const [reengagementData, setReengagementData] = useState([])
  const [showReengagement, setShowReengagement] = useState(false)
  
  const [selectedEmail, setSelectedEmail] = useState(null)
  const [blockedDomains, setBlockedDomains] = useState([])
  
  useEffect(() => {
    let active = true;
    api.get('/campaigns').then(res => {
      if(active) setCampaigns(res.data)
    }).catch(console.error)
    
    api.get('/reengagement?min_days=14&max_days=60&status=no_reply,check_back')
      .then(res => {
        if(active) setReengagementData(res.data.candidates)
      })
      .catch(console.error)

    api.get('/blocked-domains')
      .then(res => {
        if(active) setBlockedDomains(res.data.map(d => d.domain))
      })
      .catch(console.error)

    return () => { active = false };
  }, [])
  
  useEffect(() => {
    if (!q || q.length < 2) {
      setResults([])
      setTotal(0)
      return
    }
    
    let active = true;
    setLoading(true)
    let url = `/search?q=${encodeURIComponent(q)}&page=${page}`
    if (statusFilter !== 'all') url += `&status=${encodeURIComponent(statusFilter)}`
    if (daysFilter) url += `&days=${daysFilter}`
    if (campaignFilter) url += `&campaign_id=${campaignFilter}`
    
    api.get(url)
      .then(res => {
        if (active) {
            setResults(res.data.results)
            setTotal(res.data.total)
            setTotalPages(res.data.pages)
        }
      })
      .catch(console.error)
      .finally(() => {
        if(active) setLoading(false)
      })

    return () => { active = false };
  }, [q, statusFilter, daysFilter, campaignFilter, page])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (query.length >= 2) {
      setPage(1)
      setSearchParams({ q: query })
    }
  }

  const toggleDomainBlock = async (domain) => {
    if (!domain) return
    if (blockedDomains.includes(domain)) {
      try {
        await api.delete(`/blocked-domains/${domain}`)
        setBlockedDomains(prev => prev.filter(d => d !== domain))
      } catch (err) {
        console.error('Failed to unblock domain:', err)
      }
    } else {
      const reason = window.prompt(`Reason for blocking ${domain}? (optional)`) ?? ''
      try {
        await api.post('/blocked-domains', { domain, reason })
        setBlockedDomains(prev => [...prev, domain])
      } catch (err) {
        console.error('Failed to block domain:', err)
      }
    }
  }

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">Search Contacts</h1>
      </div>
      
      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="mb-8 flex gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-4 py-3 border border-zinc-300 rounded-none leading-5 bg-zinc-50 placeholder-zinc-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-zinc-900 font-mono text-sm transition-colors"
            placeholder="Search email, name, or domain..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="px-8 py-3 bg-indigo-700 text-white rounded-none hover:bg-indigo-800 font-display font-bold uppercase tracking-widest text-xs transition-colors">
          Search
        </button>
      </form>
      
      {/* Filters */}
      <div className="flex flex-wrap gap-5 mb-8 pt-6 border-t border-zinc-200">
        <label className="flex items-center gap-2 text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest">
          Status:
          <select 
            value={statusFilter} 
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="border-zinc-300 rounded-none bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-900 font-mono text-xs normal-case tracking-normal px-2 py-1 outline-none transition-colors"
          >
            <option value="all">All Statuses</option>
            <option value="no_reply">No Reply</option>
            <option value="check_back">Check Back</option>
            <option value="interested">Interested</option>
            <option value="no_openings">No Openings</option>
            <option value="interview_scheduled">Interview Scheduled</option>
            <option value="final_rejection">Rejected</option>
            <option value="invalid_email">Invalid Email</option>
          </select>
        </label>
        
        <label className="flex items-center gap-2 text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest">
          Time:
          <select 
            value={daysFilter} 
            onChange={e => { setDaysFilter(e.target.value); setPage(1); }}
            className="border-zinc-300 rounded-none bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-900 font-mono text-xs normal-case tracking-normal px-2 py-1 outline-none transition-colors"
          >
            <option value="">All time</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        
        <label className="flex items-center gap-2 text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest">
          Campaign:
          <select 
            value={campaignFilter} 
            onChange={e => { setCampaignFilter(e.target.value); setPage(1); }}
            className="border-zinc-300 rounded-none bg-zinc-50 focus:bg-white focus:ring-1 focus:ring-zinc-900 font-mono text-xs normal-case tracking-normal px-2 py-1 outline-none max-w-xs transition-colors"
          >
            <option value="">All Campaigns</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-500 font-mono text-sm uppercase tracking-widest border border-dashed border-zinc-300">Searching...</div>
      ) : results.length > 0 ? (
        <>
          <div className="text-zinc-500 font-mono text-xs uppercase tracking-widest mb-4">
            {total} result{total !== 1 ? 's' : ''} for "{q}"
          </div>
          
          <div className="space-y-4 mb-8">
            {results.map(r => {
              const domain = r.email?.split('@')[1]?.toLowerCase()
              const blocked = domain && blockedDomains.includes(domain)
              return (
                <div 
                  key={r.id} 
                  onClick={() => setSelectedEmail(r.email)}
                  className={`border bg-white rounded-none p-5 hover:bg-zinc-50 cursor-pointer transition-colors ${
                    blocked ? 'border-red-300 bg-red-50/50' : 'border-zinc-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-display font-bold text-zinc-950 text-lg">{r.email}</span>
                      {r.name && (
                        <span className="text-zinc-500 font-mono text-sm ml-3">({r.name})</span>
                      )}
                      {blocked && (
                        <span className="ml-3 text-[10px] font-mono bg-red-100 border border-red-200 text-red-700 px-2 py-0.5 uppercase tracking-widest inline-block -translate-y-0.5">BLOCKED</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => toggleDomainBlock(domain)}
                        className={`text-[10px] font-mono px-2.5 py-1 rounded-none border transition-colors uppercase tracking-widest ${
                          blocked
                            ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                            : 'bg-zinc-50 text-zinc-600 border-zinc-300 hover:bg-red-50 hover:border-red-300 hover:text-red-700'
                        }`}
                        title={blocked ? 'Click to unblock this domain' : 'Block this company\'s domain'}
                      >
                        {blocked ? 'UNBLOCK' : 'BLOCK DOMAIN'}
                      </button>
                      <StatusBadge status={r.reply_status || r.send_status} />
                    </div>
                  </div>
                  <div className="text-xs font-mono text-zinc-500 mt-2">
                    {r.campaign_name} · <span className="text-zinc-400">Sent {new Date(r.sent_at).toLocaleDateString()}</span>
                  </div>
                  <div className="text-sm text-zinc-600 mt-3 truncate max-w-2xl bg-zinc-50 p-2 border border-zinc-100 font-mono">
                    {r.subject}
                  </div>
                  {r.reply_content ? (
                    <div className="text-[10px] font-mono text-emerald-700 font-bold mt-3 flex items-center gap-1.5 uppercase tracking-widest border border-emerald-200 bg-emerald-50 inline-flex px-2 py-1">
                      HAS REPLY
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          
          {totalPages > 1 && (
            <div className="flex justify-between items-center bg-zinc-50 p-4 border border-zinc-200 rounded-none mb-8">
              <button 
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-4 py-1.5 text-[10px] font-mono border border-zinc-300 bg-white rounded-none text-zinc-700 disabled:opacity-50 hover:bg-zinc-100 uppercase tracking-widest"
              >
                Prev
              </button>
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Page {page} of {totalPages}</span>
              <button 
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-4 py-1.5 text-[10px] font-mono border border-zinc-300 bg-white rounded-none text-zinc-700 disabled:opacity-50 hover:bg-zinc-100 uppercase tracking-widest"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : q ? (
        <div className="text-center py-16 font-mono text-sm text-zinc-500 bg-zinc-50 border border-dashed border-zinc-300">
          No contacts found for "{q}"
        </div>
      ) : null}

      {/* Re-engagement Candidates Section */}
      {reengagementData.length > 0 && (
        <div className="mt-12 pt-8 border-t border-zinc-200">
          <button 
            type="button"
            onClick={() => setShowReengagement(!showReengagement)}
            className="flex items-center justify-between w-full p-4 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 transition-colors group"
          >
            <span className="font-display font-bold text-zinc-950 uppercase tracking-widest text-sm">
              Re-engagement Candidates
              <span className="ml-3 text-[10px] font-mono bg-zinc-200 px-2 py-0.5 text-zinc-600 border border-zinc-300">{reengagementData.length}</span>
            </span>
            <span className={`text-zinc-400 font-mono transform transition-transform ${showReengagement ? 'rotate-90' : ''}`}>
              [+]
            </span>
          </button>
          
          {showReengagement ? (
            <div className="mt-4 border-l-4 border-indigo-500 pl-6 space-y-4 py-2">
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest mb-6">
                Conditions: Emailed 14–60 days ago · No reply or Check Back · No follow-up sent
              </p>
              
              <div className="grid gap-4">
                {reengagementData.map((cand, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-zinc-200 bg-white hover:border-zinc-400 transition-colors gap-4">
                    <div>
                      <div className="font-display font-bold text-zinc-900">{cand.email}</div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-1 uppercase tracking-wider">
                        {cand.campaign_name} <span className="mx-2 text-zinc-300">|</span> {new Date(cand.sent_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusBadge status={cand.reply_status} />
                      <Link 
                        to={`/campaign/${cand.campaign_id}`}
                        className="text-[10px] font-mono px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors uppercase tracking-widest whitespace-nowrap"
                      >
                        Follow up
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      
      <ContactHistoryPanel 
        email={selectedEmail} 
        isOpen={!!selectedEmail} 
        onClose={() => setSelectedEmail(null)} 
        onBlockUpdated={(domain, isBlocked) => {
          if (isBlocked) {
            setBlockedDomains(prev => [...prev, domain])
          } else {
            setBlockedDomains(prev => prev.filter(d => d !== domain))
          }
        }}
      />
    </div>
  )
}
