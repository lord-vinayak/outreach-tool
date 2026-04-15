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

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Search Contacts</h1>
      
      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Search email, name, or domain..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium">
          Search
        </button>
      </form>
      
      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6 pt-4 border-t border-gray-200">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status:
          <select 
            value={statusFilter} 
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 text-sm"
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
        
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Time:
          <select 
            value={daysFilter} 
            onChange={e => { setDaysFilter(e.target.value); setPage(1); }}
            className="border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 text-sm"
          >
            <option value="">All time</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Campaign:
          <select 
            value={campaignFilter} 
            onChange={e => { setCampaignFilter(e.target.value); setPage(1); }}
            className="border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 text-sm max-w-xs"
          >
            <option value="">All Campaigns</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Searching...</div>
      ) : results.length > 0 ? (
        <>
          <div className="text-gray-500 text-sm mb-4">
            {total} result{total !== 1 ? 's' : ''} for "{q}"
          </div>
          
          <div className="space-y-3 mb-6">
            {results.map(r => (
              <div 
                key={r.id} 
                onClick={() => setSelectedEmail(r.email)}
                className="border border-gray-200 bg-white rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-medium text-gray-900">{r.email}</span>
                    {r.name && (
                      <span className="text-gray-500 text-sm ml-2">({r.name})</span>
                    )}
                  </div>
                  <StatusBadge status={r.reply_status || r.send_status} />
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {r.campaign_name} · Sent {new Date(r.sent_at).toLocaleDateString()}
                </div>
                <div className="text-sm text-gray-400 mt-1 truncate">
                  {r.subject}
                </div>
                {r.reply_content ? (
                  <div className="text-xs text-green-600 font-medium mt-2 flex items-center gap-1">
                    <span>💬</span> Has reply
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="flex justify-between items-center bg-white p-3 border border-gray-200 rounded-lg shadow-sm mb-8">
              <button 
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded text-gray-600 disabled:opacity-50"
              >
                ← Prev
              </button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <button 
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm border rounded text-gray-600 disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          )}
        </>
      ) : q ? (
        <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
          No contacts found for "{q}"
        </div>
      ) : null}

      {/* Re-engagement Candidates Section */}
      {reengagementData.length > 0 && (
        <div className="mt-12">
          <button 
            type="button"
            onClick={() => setShowReengagement(!showReengagement)}
            className="flex items-center gap-2 text-lg font-medium text-gray-900 mb-4 focus:outline-none w-full text-left bg-gray-100 p-3 rounded-md hover:bg-gray-200 transition-colors"
          >
            <span className={`transform transition-transform ${showReengagement ? 'rotate-90' : ''}`}>▶</span>
            Re-engagement Candidates ({reengagementData.length} contacts)
          </button>
          
          {showReengagement ? (
            <div className="pl-6 border-l-2 border-indigo-100 space-y-4 pt-2">
              <p className="text-sm text-gray-500 mb-4">
                Emailed 14–60 days ago · No reply or Check Back · No follow-up sent
              </p>
              
              <div className="grid gap-3">
                {reengagementData.map((cand, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-indigo-100 bg-white rounded shadow-sm gap-3 hover:border-indigo-300">
                    <div>
                      <div className="font-medium text-gray-900">{cand.email}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {cand.campaign_name} · {new Date(cand.sent_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusBadge status={cand.reply_status} />
                      <Link 
                        to={`/campaign/${cand.campaign_id}`}
                        className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 font-medium rounded hover:bg-indigo-100 transition-colors whitespace-nowrap"
                      >
                        Follow up →
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
      />
    </div>
  )
}
