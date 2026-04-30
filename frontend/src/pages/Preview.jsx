import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'
import ConfirmModal from '../components/ConfirmModal'

export default function Preview({ isFollowUp = false }) {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)
  const [regenerating, setRegenerating] = useState({})
  const [error, setError] = useState('')
  const [blockedDomains, setBlockedDomains] = useState([])

  useEffect(() => {
    api.get('/blocked-domains')
      .then(res => setBlockedDomains(res.data.map(d => d.domain)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const url = isFollowUp
      ? `/campaign/${campaignId}/followup/preview`
      : `/campaign/${campaignId}/preview`

    api.get(url)
      .then((res) => {
        if (isFollowUp) {
          setItems(res.data.followups || [])
        } else {
          setCampaign(res.data.campaign)
          setItems(res.data.recipients || [])
        }
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load preview'))
      .finally(() => setLoading(false))
  }, [campaignId, isFollowUp])

  const isBlocked = (email) => {
    const domain = email?.split('@')[1]?.toLowerCase()
    return domain ? blockedDomains.includes(domain) : false
  }

  const emailKey = isFollowUp ? 'recipient_email' : 'email'

  const handleEdit = (index, field, value) => {
    setItems((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const saveEdit = async (item, index) => {
    try {
      if (isFollowUp) {
        await api.put(`/followup/${item.id}`, {
          subject: item.subject,
          email_body: item.email_body,
        })
      } else {
        await api.put(`/campaign/${campaignId}/recipient/${item.id}`, {
          subject: item.subject,
          email_body: item.email_body,
        })
      }
    } catch (err) {
      console.error('Failed to save edit:', err)
    }
  }

  const handleRegenerate = async (item, index) => {
    if (isFollowUp) return // Follow-ups don't support individual regeneration
    setRegenerating((prev) => ({ ...prev, [item.id]: true }))

    try {
      const res = await api.post(
        `/campaign/${campaignId}/recipient/${item.id}/regenerate`
      )
      setItems((prev) => {
        const updated = [...prev]
        updated[index] = {
          ...updated[index],
          subject: res.data.subject,
          email_body: res.data.body,
        }
        return updated
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to regenerate')
    } finally {
      setRegenerating((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  const handleDeleteItem = async (itemId) => {
    const confirmed = window.confirm(
      isFollowUp
        ? "Permanently remove this follow-up?"
        : "Permanently remove this recipient from the campaign?"
    );
    if (!confirmed) return;

    try {
      const url = isFollowUp ? `/followup/${itemId}` : `/recipient/${itemId}`;
      await api.delete(url);
      setItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete item");
    }
  };

  const handleSendAll = () => {
    setShowConfirm(true)
  }

  const confirmSend = async () => {
    setShowConfirm(false)

    // Save any pending edits first
    await Promise.all(items.map((item, i) => saveEdit(item, i)))

    try {
      const url = isFollowUp
        ? `/campaign/${campaignId}/followup/send`
        : `/campaign/${campaignId}/send`
      await api.post(url)

      const sendPath = isFollowUp
        ? `/campaign/${campaignId}/followup/send`
        : `/campaign/${campaignId}/send`
      navigate(sendPath)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start sending')
    }
  }

  const handleDiscard = async () => {
    if (!isFollowUp) {
      try {
        await api.delete(`/campaign/${campaignId}`)
      } catch (err) {
        console.error('Failed to delete campaign:', err)
      }
    }
    navigate('/campaigns')
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading preview...</div>
  }

  const nameKey = isFollowUp ? 'recipient_name' : 'name'

  const blockedItems = items.filter(item => isBlocked(item[emailKey]))
  const sendableCount = items.length - blockedItems.length

  return (
    <div id="preview-page" className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isFollowUp ? 'Follow-up Preview' : 'Email Preview'}
        </h1>
        <span className="text-sm text-gray-500">
          {items.length} email{items.length !== 1 ? 's' : ''}
          {blockedItems.length > 0 && (
            <span className="ml-2 text-red-500">({blockedItems.length} blocked)</span>
          )}
        </span>
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      {blockedItems.length > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          ⚠️ {blockedItems.length} recipient{blockedItems.length !== 1 ? 's' : ''} from blocked domains will be skipped.
          Only <strong>{sendableCount}</strong> email{sendableCount !== 1 ? 's' : ''} will actually be sent.
        </div>
      )}

      {/* Top controls */}
      <div className="flex gap-3 mb-6">
        <button
          id="send-all-top-btn"
          onClick={handleSendAll}
          disabled={items.length === 0 || sendableCount === 0}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {sendableCount > 0 ? `Send ${sendableCount} Email${sendableCount !== 1 ? 's' : ''}` : 'No Emails to Send'}
        </button>
        <button
          id="discard-btn"
          onClick={handleDiscard}
          className="px-5 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
        >
          {isFollowUp ? 'Cancel' : 'Discard Campaign'}
        </button>
      </div>

      {/* Email cards */}
      <div className="space-y-4">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`bg-white border rounded-lg p-4 ${
              isBlocked(item[emailKey])
                ? 'border-red-200 bg-red-50'
                : 'border-gray-200'
            }`}
          >
            {isBlocked(item[emailKey]) && (
              <div className="text-xs text-red-600 bg-red-100 border border-red-200 rounded px-2 py-1 mb-2 flex items-center gap-1">
                🚫 <strong>{item[emailKey].split('@')[1]}</strong> is a blocked domain — this email will be skipped during send
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {item[nameKey] || 'No name'}
                </span>
                <span className="text-sm text-gray-500 ml-2">
                  {item[emailKey]}
                </span>
                {isFollowUp && item.reply_status && (
                  <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 capitalize">
                    Context: {item.reply_status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {!isFollowUp && (
                  <button
                    onClick={() => handleRegenerate(item, index)}
                    disabled={regenerating[item.id]}
                    className="text-xs px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {regenerating[item.id] ? 'Regenerating...' : '↻ Regenerate'}
                  </button>
                )}
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  title="Remove from campaign"
                  className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded border border-red-200 transition-all"
                >
                  ✕ Remove
                </button>
              </div>
            </div>

            {/* Subject */}
            <div className="mb-2">
              <label className="text-xs text-gray-500 mb-1 block">Subject</label>
              <input
                type="text"
                value={item.subject || ''}
                onChange={(e) => handleEdit(index, 'subject', e.target.value)}
                onBlur={() => saveEdit(item, index)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
            </div>

            {/* Body */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Body</label>
              <textarea
                value={item.email_body || ''}
                onChange={(e) => handleEdit(index, 'email_body', e.target.value)}
                onBlur={() => saveEdit(item, index)}
                rows={8}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono leading-relaxed focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
              />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 bg-white border border-dashed border-gray-300 rounded-lg text-gray-500">
            No emails to send.
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex gap-3 mt-6 mb-8">
        <button
          id="send-all-bottom-btn"
          onClick={handleSendAll}
          disabled={items.length === 0 || sendableCount === 0}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {sendableCount > 0 ? `Send ${sendableCount} Email${sendableCount !== 1 ? 's' : ''}` : 'No Emails to Send'}
        </button>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title="Confirm Send"
        message={`You are about to send ${items.length} email${items.length !== 1 ? 's' : ''}. This cannot be undone. Proceed?`}
        onConfirm={confirmSend}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
