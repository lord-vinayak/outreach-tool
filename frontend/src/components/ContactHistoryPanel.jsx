import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

const statusLabels = {
  draft: 'Draft',
  sent: 'Sent',
  failed: 'Failed',
  interested: 'Interested',
  check_back: 'Check Back',
  no_reply: 'No Reply',
  no_openings: 'No Openings',
  interview_scheduled: 'Interview Scheduled',
  final_rejection: 'Rejected',
  invalid_email: 'Invalid Email',
}

const statusColors = {
  interested: 'bg-green-100 text-green-800',
  interview_scheduled: 'bg-green-500 text-white',
  check_back: 'bg-blue-100 text-blue-800',
  no_reply: 'bg-gray-100 text-gray-800',
  no_openings: 'bg-amber-100 text-amber-800',
  final_rejection: 'bg-red-100 text-red-800',
  invalid_email: 'bg-red-500 text-white',
  sent: 'bg-gray-100 text-gray-800',
  failed: 'bg-red-100 text-red-800',
  draft: 'bg-gray-100 text-gray-800',
}

export function StatusBadge({ status }) {
  const label = statusLabels[status] || status
  const color = statusColors[status] || 'bg-gray-100 text-gray-800'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

export default function ContactHistoryPanel({ email, isOpen, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!isOpen || !email) return
    let active = true
    setLoading(true)
    api.get(`/contact/${encodeURIComponent(email)}`)
      .then(res => {
        if (active) {
          setData(res.data)
          setLoading(false)
        }
      })
      .catch(console.error)
    return () => { active = false }
  }, [isOpen, email])

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEsc)
      // Slight delay to avoid intercepting the click that opened it
      setTimeout(() => window.addEventListener('mousedown', handleClickOutside), 10)
    }
    return () => {
      window.removeEventListener('keydown', handleEsc)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-900 bg-opacity-30 transition-opacity" onClick={onClose} />
      
      {/* Slide-in Drawer */}
      <div 
        ref={panelRef}
        className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col overflow-y-auto transform transition-transform translate-x-0"
      >
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 sticky top-0 z-10">
          <h2 className="text-lg font-semibold text-gray-900">Contact History</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 focus:outline-none">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading history...</div>
        ) : data ? (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">📧</span>
                <span className="font-semibold text-gray-900 text-lg">{data.email}</span>
              </div>
              {data.resolved_name ? (
                <div className="flex items-center gap-2 text-sm text-gray-600 ml-1">
                  <span>👤</span>
                  <span>{data.resolved_name}</span>
                </div>
              ) : null}
              {data.company ? (
                <div className="flex items-center gap-2 text-sm text-gray-600 ml-1 mt-1">
                  <span>🏢</span>
                  <span>{data.company}</span>
                </div>
              ) : null}
              
              <div className="mt-4 text-sm text-gray-500 bg-gray-50 p-2 rounded-md border border-gray-100">
                Contacted <span className="font-semibold">{data.total_contacts}</span> time{data.total_contacts !== 1 ? 's' : ''} across campaigns
              </div>
            </div>

            {/* Campaign History list */}
            <div className="space-y-4">
              {data.history.map((record) => (
                <div key={record.id} className="border border-gray-200 rounded-lg p-3 shadow-sm bg-white">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 border-b border-gray-100 pb-1">
                    Campaign: {record.campaign_name}
                  </div>
                  
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-gray-500">
                      Sent: {new Date(record.sent_at).toLocaleDateString()}
                    </span>
                    <StatusBadge status={record.reply_status || record.status} />
                  </div>
                  
                  <div className="text-sm font-medium text-gray-900 mb-2">
                    Subject: "{record.subject}"
                  </div>

                  {record.reply_content ? (
                    <div className="bg-amber-50 p-2 rounded text-sm text-gray-800 mb-2 border border-amber-100">
                      <span className="font-bold text-amber-700">Reply: </span>
                      <span className="whitespace-pre-line">{record.reply_content}</span>
                    </div>
                  ) : null}

                  <div className="flex gap-4 text-xs mt-3">
                    <details className="group cursor-pointer">
                      <summary className="text-indigo-600 font-medium hover:text-indigo-800 list-none flex items-center">
                        <span className="mr-1 transform transition-transform group-open:rotate-180">▼</span> 
                        Email Body
                      </summary>
                      <div className="mt-2 p-3 bg-gray-50 text-gray-700 rounded border border-gray-200 font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {record.email_body}
                      </div>
                    </details>
                    
                    {record.follow_up_body ? (
                      <details className="group cursor-pointer">
                        <summary className="text-indigo-600 font-medium hover:text-indigo-800 list-none flex items-center">
                          <span className="mr-1 transform transition-transform group-open:rotate-180">▼</span> 
                          Follow-up
                        </summary>
                        <div className="mt-2 p-3 bg-gray-50 text-gray-700 rounded border border-gray-200 font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto">
                          <div className="text-gray-400 mb-2 italic">Sent: {new Date(record.follow_up_sent_at).toLocaleDateString()}</div>
                          {record.follow_up_body}
                        </div>
                      </details>
                    ) : null}
                  </div>

                  <div className="mt-3 text-xs flex justify-between items-center border-t border-gray-100 pt-2">
                    <span className="text-gray-500">
                      Follow-up sent: <span className={record.follow_up_sent ? "text-green-600 font-medium" : "text-gray-400"}>{record.follow_up_sent ? "Yes" : "No"}</span>
                    </span>
                    <Link to={`/campaign/${record.campaign_id}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
                      Go to Campaign →
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Same Domain Contacts */}
            {data.same_domain_contacts && data.same_domain_contacts.length > 0 ? (
              <div className="mt-8 pt-4 border-t border-gray-200">
                <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 block">
                  Same Domain: {data.domain}
                </div>
                <div className="space-y-2">
                  {data.same_domain_contacts.map((sdc, idx) => (
                    <div key={idx} className="text-xs bg-gray-50 p-2 rounded border border-gray-100 flex flex-col gap-1">
                      <div className="font-medium text-gray-800">{sdc.email}</div>
                      <div className="flex justify-between text-gray-500">
                        <span>{sdc.campaign_name}</span>
                        <StatusBadge status={sdc.reply_status || 'sent'} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">No contact history available.</div>
        )}
      </div>
    </div>
  )
}
