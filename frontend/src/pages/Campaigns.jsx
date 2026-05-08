import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingCampaignId, setSendingCampaignId] = useState(null)
  const [sendProgress, setSendProgress] = useState({})

  const fetchCampaigns = useCallback(() => {
    api.get('/campaigns')
      .then((res) => setCampaigns(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  const handleSendRemaining = async (campaignId, total) => {
    const confirmed = window.confirm(
      `Send ${total} remaining draft email(s) for this campaign?`
    )
    if (!confirmed) return

    setSendingCampaignId(campaignId)
    setSendProgress(prev => ({ ...prev, [campaignId]: { current: 0, total, status: 'sending' } }))

    try {
      await api.post(`/campaign/${campaignId}/send`)
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to start sending.'
      alert(msg)
      setSendingCampaignId(null)
      return
    }

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/campaign/${campaignId}/progress`)
        setSendProgress(prev => ({ ...prev, [campaignId]: res.data }))
        if (res.data.status === 'complete') {
          clearInterval(interval)
          setSendingCampaignId(null)
          fetchCampaigns()
        }
      } catch {
        clearInterval(interval)
        setSendingCampaignId(null)
      }
    }, 2000)
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading campaigns...</div>
  }

  return (
    <div id="campaigns-page">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">Campaign History</h1>
        <Link
          to="/campaign/new"
          className="px-6 py-2.5 bg-indigo-700 text-white text-sm font-medium rounded-none hover:bg-indigo-800 transition-colors"
        >
          + New Campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No campaigns yet.</p>
          <Link
            to="/campaign/new"
            className="text-indigo-600 hover:underline text-sm font-medium"
          >
            Create your first campaign →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-none overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Campaign</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Date</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recipients</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sent</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Failed</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4 font-medium text-zinc-950">{c.name}</td>
                  <td className="px-5 py-4 text-zinc-500 font-mono text-xs">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-center text-zinc-700 font-mono">
                    {c.total_recipients}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col items-center">
                      <span className="text-sm text-gray-500">
                        📧 <span className="text-green-600 font-medium">{c.sent_count ?? 0}</span> sent
                      </span>
                      <span className={`text-xs mt-1 ${c.followups_sent_count > 0 ? 'text-blue-500' : 'text-gray-400'}`}>
                        🔁 {c.followups_sent_count ?? 0} follow-up{c.followups_sent_count !== 1 ? 's' : ''} sent
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.failed_count > 0 ? (
                      <span className="text-red-600 font-medium">{c.failed_count}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex flex-col items-end gap-2">
                      {/* Send Remaining button — only when drafts with generated emails exist */}
                      {(c.draft_count ?? 0) > 0 && sendingCampaignId !== c.id && (
                        <button
                          id={`send-remaining-${c.id}`}
                          onClick={() => handleSendRemaining(c.id, c.draft_count)}
                          className="text-xs px-3 py-1.5 rounded-none border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all font-medium uppercase tracking-wide"
                        >
                          [📤] Send {c.draft_count} Remaining
                        </button>
                      )}

                      {/* Inline progress while sending */}
                      {sendingCampaignId === c.id && (
                        <div className="text-xs text-gray-500 mt-1">
                          {sendProgress[c.id]
                            ? `Sending... ${sendProgress[c.id].current} / ${sendProgress[c.id].total}`
                            : 'Starting...'}
                        </div>
                      )}

                      <Link
                        to={`/campaign/${c.id}`}
                        className="text-indigo-600 hover:underline font-medium text-sm"
                      >
                        View Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
