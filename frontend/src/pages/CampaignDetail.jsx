import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'

export default function CampaignDetail() {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [followupContext, setFollowupContext] = useState('')
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    api.get(`/campaign/${campaignId}`)
      .then((res) => setCampaign(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load campaign'))
      .finally(() => setLoading(false))
  }, [campaignId])

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleFollowUp = async () => {
    setGenerating(true)
    setError('')

    try {
      await api.post(`/campaign/${campaignId}/followup/generate`, {
        context: followupContext,
      })
      navigate(`/campaign/${campaignId}/followup/preview`)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate follow-ups')
      setGenerating(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading campaign...</div>
  }

  if (!campaign) {
    return <div className="text-center py-12 text-red-500">{error || 'Campaign not found'}</div>
  }

  const recipients = campaign.recipients || []
  const sentRecipients = recipients.filter((r) => r.status === 'sent')
  const eligibleForFollowUp = sentRecipients.filter((r) => !r.follow_up_sent)
  const canFollowUp = eligibleForFollowUp.length > 0

  return (
    <div id="campaign-detail-page" className="max-w-4xl mx-auto">
      {/* Campaign Info */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Created {new Date(campaign.created_at).toLocaleString()}
        </p>
        <p className="text-sm text-gray-700 mt-2">{campaign.goal}</p>
        {campaign.additional_context ? (
          <p className="text-sm text-gray-500 mt-1 italic">{campaign.additional_context}</p>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      {/* Follow-up Section */}
      {canFollowUp ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-amber-900 mb-2">
            Send Follow-up ({eligibleForFollowUp.length} eligible recipient{eligibleForFollowUp.length !== 1 ? 's' : ''})
          </h3>
          <textarea
            id="followup-context"
            value={followupContext}
            onChange={(e) => setFollowupContext(e.target.value)}
            placeholder={"Optional context: e.g., \"It's been a week, gently remind them\""}
            rows={2}
            className="w-full border border-amber-300 rounded-md px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
          />
          <button
            id="send-followup-btn"
            onClick={handleFollowUp}
            disabled={generating}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating Follow-ups...' : 'Generate & Preview Follow-ups'}
          </button>
        </div>
      ) : null}

      {/* Recipients Table */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Recipients ({recipients.length})
      </h2>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Sent At</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Follow-up</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {recipients.map((r) => (
              <RecipientRow
                key={r.id}
                recipient={r}
                isExpanded={expanded[r.id]}
                onToggle={() => toggleExpand(r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecipientRow({ recipient, isExpanded, onToggle }) {
  const r = recipient

  const statusBadge = {
    sent: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    draft: 'bg-gray-100 text-gray-600',
  }

  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3 text-gray-900">{r.name || '—'}</td>
        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{r.email}</td>
        <td className="px-4 py-3 text-center">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[r.status] || statusBadge.draft}`}>
            {r.status}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}
        </td>
        <td className="px-4 py-3 text-center text-xs">
          {r.follow_up_sent ? (
            <span className="text-green-600">✓ Sent</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={onToggle}
            className="text-indigo-600 hover:underline text-xs font-medium"
          >
            {isExpanded ? 'Hide' : 'Show'} Email
          </button>
        </td>
      </tr>
      {isExpanded ? (
        <tr>
          <td colSpan={6} className="px-4 py-3 bg-gray-50">
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
