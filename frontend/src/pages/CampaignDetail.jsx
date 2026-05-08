import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'

// Status definitions
const STATUS_OPTIONS = [
  { value: "no_reply",            label: "No Reply",            color: "bg-gray-400" },
  { value: "check_back",          label: "Check Back",          color: "bg-blue-500" },
  { value: "interested",          label: "Interested",          color: "bg-green-500" },
  { value: "no_openings",         label: "No Openings",         color: "bg-orange-400" },
  { value: "interview_scheduled", label: "Interview Scheduled", color: "bg-purple-500" },
  { value: "final_rejection",     label: "Rejected",            color: "bg-red-500" },
  { value: "invalid_email",       label: "Invalid Email",       color: "bg-red-900" },
];

export default function CampaignDetail() {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState(null)
  const [bounces, setBounces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [followupContext, setFollowupContext] = useState('')
  const [generationProgress, setGenerationProgress] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [replyExpanded, setReplyExpanded] = useState({})
  const [showDeliveryIssues, setShowDeliveryIssues] = useState(false)

  // Fetch campaign
  useEffect(() => {
    fetchCampaign()
  }, [campaignId])

  const fetchCampaign = () => {
    Promise.all([
      api.get(`/campaign/${campaignId}`),
      api.get(`/campaign/${campaignId}/bounces`)
    ])
      .then(([campRes, bouncesRes]) => {
        setCampaign(campRes.data)
        setBounces(bouncesRes.data)
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load campaign'))
      .finally(() => setLoading(false))
  }

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleReplyExpand = (id) => {
    setReplyExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const updateRecipientLocally = (id, updates) => {
    setCampaign(prev => ({
      ...prev,
      recipients: prev.recipients.map(r => r.id === id ? { ...r, ...updates } : r)
    }))
  }

  const handleFollowUp = async () => {
    if (eligibleRecipients.length === 0) return;
    setGenerationProgress({ total: eligibleRecipients.length, completed: 0, failed: 0, status: "generating", errors: [] })
    setError('')

    try {
      const res = await api.post(`/campaign/${campaignId}/generate-followups`, {
        global_context: followupContext,
        recipient_ids: eligibleRecipients.map(r => r.id)
      })
      setGenerationProgress(prev => ({ ...prev, total: res.data.total }))

      const interval = setInterval(async () => {
        const progressRes = await api.get(`/campaign/${campaignId}/generate-followup-progress`);
        const data = progressRes.data;
        setGenerationProgress(data);

        if (data.status === "complete" || data.status === "error") {
          clearInterval(interval);
          if (data.status === "complete") {
            navigate(`/campaign/${campaignId}/followup/preview`)
          }
        }
      }, 1500);

    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate follow-ups')
      setGenerationProgress(null)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading campaign...</div>
  }

  if (!campaign) {
    return <div className="text-center py-12 text-red-500">{error || 'Campaign not found'}</div>
  }

  const recipients = campaign.recipients || []
  
  // Calculate Summary Counts
  const summary = {
    no_reply: 0, check_back: 0, interested: 0, no_openings: 0, 
    interview_scheduled: 0, final_rejection: 0, invalid_email: 0, excluded: 0
  }
  
  const eligibleRecipients = []
  const reminders = []
  const now = new Date()
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  recipients.forEach(r => {
    const status = r.reply_status || 'no_reply'
    if (status in summary) summary[status]++
    const isAutoExcluded = ['invalid_email', 'interview_scheduled', 'final_rejection'].includes(status)
    if (isAutoExcluded || r.exclude_followup) {
      summary.excluded++
    }

    if (r.status === 'sent' && !r.follow_up_sent && !isAutoExcluded && !r.exclude_followup) {
      eligibleRecipients.push(r)
    }

    if (status === 'check_back' && r.check_back_date) {
      const cbDate = new Date(r.check_back_date)
      if (cbDate <= sevenDaysFromNow && cbDate >= new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
        reminders.push(r)
      }
    }
  })

  return (
    <div id="campaign-detail-page" className="max-w-4xl mx-auto">
      {/* Campaign Info */}
      <div className="mb-8 pb-6 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">{campaign.name}</h1>
        <p className="text-sm text-zinc-500 font-mono mt-2">
          Created {new Date(campaign.created_at).toLocaleString()}
        </p>
        <p className="text-sm text-zinc-700 mt-4 max-w-2xl">{campaign.goal}</p>
        {campaign.additional_context ? (
          <p className="text-sm text-zinc-500 mt-2 italic border-l-2 border-zinc-300 pl-3">{campaign.additional_context}</p>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      {/* Check back reminders */}
      {reminders.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="font-semibold text-yellow-800 mb-2">⚠️ {reminders.length} recipient(s) asked you to follow up soon:</p>
          <ul className="list-disc pl-5 text-sm text-yellow-700">
            {reminders.map(r => (
              <li key={r.id}>{r.email} (Check back by {new Date(r.check_back_date).toLocaleDateString()})</li>
            ))}
          </ul>
        </div>
      )}

      {/* Follow-up Summary Bar */}
      <div className="bg-zinc-50 border border-zinc-200 border-l-4 border-l-amber-500 rounded-none p-5 mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
          <div>
            <h3 className="font-display font-semibold text-zinc-950 mb-1 flex items-center gap-2">
              <span className="text-amber-600 font-mono text-xs border border-amber-200 bg-amber-50 px-1 py-0.5 leading-none">ACTION</span> Follow-up Summary
            </h3>
            <div className="text-sm text-zinc-600 flex gap-4 flex-wrap font-mono mt-3">
              <span>No Reply: <strong className="text-zinc-900">{summary.no_reply}</strong></span>
              <span>Check Back: <strong className="text-zinc-900">{summary.check_back}</strong></span>
              <span>Interested: <strong className="text-green-700">{summary.interested}</strong></span>
              <span>Excluded: <strong className="text-red-700">{summary.excluded}</strong></span>
            </div>
          </div>
        </div>
        
        {eligibleRecipients.length > 0 && (
          <div className="mt-2">
            <input
              type="text"
              value={followupContext}
              onChange={(e) => setFollowupContext(e.target.value)}
              placeholder="Any additional context for this follow-up batch? (optional)"
              className="w-full border border-zinc-300 rounded-none px-3 py-2 text-sm mb-3 focus:ring-1 focus:ring-zinc-900 outline-none bg-white font-mono placeholder-zinc-400"
            />
            {generationProgress ? (
              <div className="generation-progress-box border border-amber-200 rounded-lg p-5 mt-2 bg-white shadow-sm text-left">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-amber-800">
                    {generationProgress.status === "complete"
                      ? "✅ Follow-ups Generated"
                      : generationProgress.status === "error"
                      ? "❌ Generation Stopped"
                      : "⚡ Generating Follow-ups..."}
                  </span>
                  <span className="text-sm text-gray-500 font-mono">
                    {generationProgress.completed} / {generationProgress.total}
                  </span>
                </div>
                
                <div className="w-full bg-amber-100 rounded-full h-2 mb-3 overflow-hidden">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                    style={{
                      width: generationProgress.total > 0
                        ? `${Math.round((generationProgress.completed / generationProgress.total) * 100)}%`
                        : "0%"
                    }}
                  />
                </div>
                
                <div className="flex gap-4 text-xs font-mono text-gray-500">
                  <span>✅ {generationProgress.completed} generated</span>
                  {generationProgress.failed > 0 && (
                    <span className="text-red-500">❌ {generationProgress.failed} failed</span>
                  )}
                  {generationProgress.status === "generating" && (
                    <span className="text-amber-600 animate-pulse ml-auto">Running in parallel...</span>
                  )}
                </div>
                
                {generationProgress.errors && generationProgress.errors.length > 0 && (
                  <div className="mt-3 text-[10px] font-mono text-red-600 bg-red-50 border border-red-200 rounded p-2 max-h-24 overflow-y-auto text-left">
                    {generationProgress.errors.map((e, i) => (
                      <div key={i} className="truncate"><span className="font-semibold">{e.email}:</span> {e.error}</div>
                    ))}
                  </div>
                )}
                {generationProgress.status === "error" && (
                  <div className="mt-4 border-t border-amber-100 pt-3">
                    <button
                      onClick={() => navigate(`/campaign/${campaignId}/followup/preview`)}
                      className="px-4 py-1.5 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 font-medium"
                    >
                      Continue to Preview
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleFollowUp}
                className="px-6 py-2 bg-amber-600 text-white text-sm font-medium rounded-none hover:bg-amber-700 transition-colors uppercase tracking-wide"
              >
                {`Generate Follow-ups for ${eligibleRecipients.length} eligible recipients`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delivery Issues */}
      {bounces && bounces.length > 0 && (
        <div className="mb-6 border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-red-900">
              ⚠️ Delivery Issues ({bounces.length})
            </h3>
            <button
              onClick={() => setShowDeliveryIssues(!showDeliveryIssues)}
              className="text-xs text-red-700 hover:text-red-900 font-medium"
            >
              {showDeliveryIssues ? '[▲ Hide]' : '[▼ Show]'}
            </button>
          </div>
          {showDeliveryIssues && (
            <div className="mt-4">
               <p className="text-sm text-red-800 mb-3">
                These addresses hard-bounced — emails were not delivered. Valid email addresses do not exist or are unreachable. They have been permanently excluded from future follow-ups.
               </p>
               <div className="space-y-2">
                 {bounces.map(b => (
                   <div key={b.id} className="flex justify-between items-center bg-white/50 p-2 rounded border border-red-100">
                     <div className="flex items-center gap-3">
                       <span className="text-red-500 font-bold">✗</span>
                       <span className="text-gray-900 font-medium line-through decoration-red-400">{b.email}</span>
                       {b.resolved_full_name && <span className="text-xs text-gray-500">({b.resolved_full_name})</span>}
                     </div>
                     <div className="flex items-center gap-3">
                       <span className="text-xs text-gray-500">
                         detected {new Date(b.status_updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                       </span>
                       <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                         {(b.error_message || '').includes('Hard bounce') ? 'Auto-detected' : 'Manual'}
                       </span>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          )}
        </div>
      )}

      {/* Recipients Table */}
      <h2 className="text-xs font-display font-semibold text-zinc-500 mb-3 uppercase tracking-wider">
        Recipients ({recipients.length})
      </h2>

      <div className="bg-white border border-zinc-200 rounded-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Company / Email</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Reply Status</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sending</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {recipients.map((r) => (
                <RecipientRow
                  key={r.id}
                  recipient={r}
                  isExpanded={expanded[r.id]}
                  isReplyExpanded={replyExpanded[r.id]}
                  onToggle={() => toggleExpand(r.id)}
                  onToggleReply={() => toggleReplyExpand(r.id)}
                  updateLocal={updateRecipientLocally}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function RecipientRow({ recipient, isExpanded, isReplyExpanded, onToggle, onToggleReply, updateLocal }) {
  const r = recipient
  const [saveFlash, setSaveFlash] = useState(false)
  
  // Flash state
  const showFlash = () => {
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 2000)
  }

  // Handle status select change
  const handleStatusChange = async (e) => {
    const newStatus = e.target.value
    updateLocal(r.id, { reply_status: newStatus })
    try {
      await api.patch(`/recipient/${r.id}/status`, { reply_status: newStatus })
      showFlash()
    } catch (err) {
      console.error(err)
    }
  }

  const currentStatusObj = STATUS_OPTIONS.find(opt => opt.value === (r.reply_status || 'no_reply'))
  const statusColor = currentStatusObj?.color || 'bg-gray-400'
  const isAutoExcluded = ['invalid_email', 'interview_scheduled', 'final_rejection'].includes(r.reply_status)

  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors group">
        <td className="px-4 py-3 text-gray-900 border-r border-gray-100 border-dashed">
          <div className="font-medium">{r.name || '—'}</div>
          <div className="text-gray-500 font-mono text-xs">{r.email}</div>
          <div className="flex gap-2 mt-1">
            <button
              onClick={onToggleReply}
              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center"
            >
              <span className="mr-1">{isReplyExpanded ? '▲' : '▼'}</span> Paste Reply
            </button>
            <button
              onClick={onToggle}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {isExpanded ? 'Hide' : 'Show'} Email
            </button>
          </div>
        </td>
        
        <td className="px-4 py-3 border-r border-gray-100 border-dashed">
          <div className="flex flex-col items-center gap-1">
            <div className="relative flex items-center">
              <div className={`absolute left-2 w-2 h-2 rounded-full ${statusColor} pointer-events-none`}></div>
              <select
                value={r.reply_status || 'no_reply'}
                onChange={handleStatusChange}
                className="pl-6 pr-6 py-1 text-xs bg-gray-50 border border-gray-200 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none w-36 appearance-none cursor-pointer hover:bg-white"
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="absolute right-2 pointer-events-none text-gray-500 text-[10px]">▼</div>
            </div>
            {saveFlash && <span className="text-[10px] text-green-600">Saved!</span>}
          </div>
        </td>

        <td className="px-4 py-3 text-center text-xs">
          <div className="flex flex-col gap-1 items-center">
            {r.status === 'sent' ? (
              <span className="text-gray-500">Orig: <span className="text-green-600 font-medium">✓</span></span>
            ) : (
              <span className="text-gray-400">Orig: {r.status}</span>
            )}
            
            {r.follow_up_sent ? (
              <span className="text-gray-500">F/Up: <span className="text-green-600 font-medium">✓</span></span>
            ) : (
              <span className="text-gray-400">F/Up: —</span>
            )}
          </div>
        </td>

        <td className="px-4 py-3 text-right">
            {/* removed standard buttons to move logic into column 1 */}
        </td>
      </tr>

      {/* Reply pasting panel */}
      {isReplyExpanded && (
        <tr>
          <td colSpan={4} className="px-4 py-3 bg-indigo-50 border-b border-gray-200">
            <ReplyPanel recipient={r} updateLocal={updateLocal} isAutoExcluded={isAutoExcluded} />
          </td>
        </tr>
      )}

      {/* Original email viewing panel */}
      {isExpanded ? (
        <tr>
          <td colSpan={4} className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="text-xs text-gray-500 mb-1">Subject: <span className="text-gray-900">{r.subject}</span></div>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white p-3 rounded border border-gray-200">
              {r.email_body}
            </pre>
            {r.error_message ? (
              <p className="mt-2 text-xs text-red-600">Error: {r.error_message}</p>
            ) : null}

            {/* Show follow-ups if any */}
            {r.followups?.length > 0 ? (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <p className="text-xs font-medium text-gray-600 mb-2">Follow-up(s):</p>
                {r.followups.map((fu) => (
                  <div key={fu.id} className="mb-2 bg-amber-50 p-2 rounded border border-amber-200">
                    <div className="text-xs text-gray-500">Subject: <span className="text-gray-900">{fu.subject}</span></div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono mt-1">
                      {fu.email_body}
                    </pre>
                    <div className="text-xs text-gray-400 mt-1">
                      Status: {fu.status} {fu.sent_at ? `| ${new Date(fu.sent_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function ReplyPanel({ recipient, updateLocal, isAutoExcluded }) {
  const [content, setContent] = useState(recipient.reply_content || '')
  const [date, setDate] = useState(recipient.check_back_date || '')
  const [include, setInclude] = useState(!recipient.exclude_followup)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const updates = {
      reply_content: content,
      check_back_date: date || null,
      exclude_followup: include ? 0 : 1
    }
    
    try {
      await api.patch(`/recipient/${recipient.id}/status`, updates)
      updateLocal(recipient.id, updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="text-sm bg-white p-3 rounded border border-indigo-100 shadow-sm">
      <label className="block text-xs font-medium text-indigo-900 mb-1">Their Reply</label>
      <textarea
        className="w-full border border-gray-300 rounded px-2 py-2 text-xs focus:ring-1 focus:ring-indigo-500 outline-none mb-3"
        rows={3}
        placeholder="Paste the recruiter's reply here for smarter follow-up generation..."
        value={content}
        onChange={e => setContent(e.target.value)}
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {recipient.reply_status === 'check_back' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-700">Check Back Date:</label>
              <input 
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            {isAutoExcluded ? (
              <span className="bg-gray-200 text-gray-500 text-xs px-2 py-1 rounded">Excluded from follow-ups</span>
            ) : (
              <label className="flex items-center gap-1 text-xs text-gray-700 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={include} 
                  onChange={e => setInclude(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                Include in follow-up batch
              </label>
            )}
          </div>
        </div>

        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 text-white px-3 py-1 text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : (saved ? '✓ Saved' : 'Save Reply Params')}
        </button>
      </div>
    </div>
  )
}

