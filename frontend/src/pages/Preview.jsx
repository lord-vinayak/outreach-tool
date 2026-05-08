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
    <div id="preview-page" className="max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">
          {isFollowUp ? 'Follow-up Preview' : 'Email Preview'}
        </h1>
        <div className="text-xs font-mono bg-zinc-100 border border-zinc-200 px-3 py-1 text-zinc-600">
          {items.length} EMAIL{items.length !== 1 ? 'S' : ''}
          {blockedItems.length > 0 && (
            <span className="ml-2 text-red-600">({blockedItems.length} BLOCKED)</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      {blockedItems.length > 0 && (
        <div className="text-xs font-mono text-red-800 bg-red-50 border border-red-200 rounded-none px-4 py-3 mb-6">
          <span className="font-bold">⚠️ BLOCKED DOMAINS:</span> {blockedItems.length} recipient{blockedItems.length !== 1 ? 's' : ''} from blocked domains will be skipped.
          Only <strong>{sendableCount}</strong> email{sendableCount !== 1 ? 's' : ''} will actually be sent.
        </div>
      )}

      {/* Top controls */}
      <div className="flex gap-4 mb-8">
        <button
          id="send-all-top-btn"
          onClick={handleSendAll}
          disabled={items.length === 0 || sendableCount === 0}
          className="px-6 py-2.5 bg-indigo-700 text-white font-display font-bold text-xs rounded-none hover:bg-indigo-800 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors uppercase tracking-widest"
        >
          {sendableCount > 0 ? `Send ${sendableCount} Email${sendableCount !== 1 ? 's' : ''}` : 'No Emails to Send'}
        </button>
        <button
          id="discard-btn"
          onClick={handleDiscard}
          className="px-6 py-2.5 bg-zinc-50 border border-zinc-300 text-zinc-700 font-display font-bold text-xs rounded-none hover:bg-zinc-100 transition-colors uppercase tracking-widest"
        >
          {isFollowUp ? 'Cancel' : 'Discard Campaign'}
        </button>
      </div>

      {/* Email cards */}
      <div className="space-y-6">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`bg-white border rounded-none p-6 ${
              isBlocked(item[emailKey])
                ? 'border-red-300 bg-red-50/50'
                : 'border-zinc-300'
            }`}
          >
            {isBlocked(item[emailKey]) && (
              <div className="text-[10px] font-mono text-red-700 bg-red-100 border border-red-200 rounded-none px-3 py-1.5 mb-4 inline-flex items-center gap-1.5">
                <span className="font-bold">BLOCKED:</span> {item[emailKey].split('@')[1]}
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 pb-3 border-b border-zinc-100 gap-4">
              <div>
                <div className="font-display font-bold text-zinc-950 text-lg">
                  {item[nameKey] || 'No name'}
                </div>
                <div className="text-sm font-mono text-zinc-500 mt-1">
                  {item[emailKey]}
                </div>
                {isFollowUp && item.reply_status && (
                  <span className="inline-block mt-2 text-[10px] font-mono px-2 py-0.5 border border-amber-200 bg-amber-50 text-amber-800 uppercase tracking-wider">
                    Context: {item.reply_status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {!isFollowUp && (
                  <button
                    onClick={() => handleRegenerate(item, index)}
                    disabled={regenerating[item.id]}
                    className="text-[11px] font-mono px-3 py-1.5 border border-zinc-300 bg-zinc-50 rounded-none text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 transition-colors uppercase tracking-wider"
                  >
                    {regenerating[item.id] ? 'Regenerating...' : 'Regenerate'}
                  </button>
                )}
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  title="Remove from campaign"
                  className="text-[11px] font-mono px-3 py-1.5 border border-red-200 bg-white rounded-none text-red-600 hover:bg-red-50 transition-all uppercase tracking-wider"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Subject */}
            <div className="mb-4">
              <label className="text-[10px] font-display font-bold text-zinc-500 mb-1.5 block uppercase tracking-widest">Subject</label>
              <input
                type="text"
                value={item.subject || ''}
                onChange={(e) => handleEdit(index, 'subject', e.target.value)}
                onBlur={() => saveEdit(item, index)}
                className="w-full border border-zinc-300 rounded-none px-3 py-2 text-sm focus:ring-1 focus:ring-zinc-900 outline-none font-mono text-zinc-900 bg-zinc-50 focus:bg-white transition-colors"
              />
            </div>

            {/* Body */}
            <div>
              <label className="text-[10px] font-display font-bold text-zinc-500 mb-1.5 block uppercase tracking-widest">Body</label>
              <textarea
                value={item.email_body || ''}
                onChange={(e) => handleEdit(index, 'email_body', e.target.value)}
                onBlur={() => saveEdit(item, index)}
                rows={8}
                className="w-full border border-zinc-300 rounded-none px-3 py-3 text-sm font-mono leading-relaxed focus:ring-1 focus:ring-zinc-900 outline-none resize-y text-zinc-900 bg-zinc-50 focus:bg-white transition-colors"
              />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-16 bg-white border-2 border-dashed border-zinc-200 rounded-none text-zinc-500 font-mono text-sm">
            No emails to send.
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex gap-4 mt-8 mb-8 pt-6 border-t border-zinc-200">
        <button
          id="send-all-bottom-btn"
          onClick={handleSendAll}
          disabled={items.length === 0 || sendableCount === 0}
          className="w-full sm:w-auto px-8 py-3.5 bg-indigo-700 text-white font-display font-bold text-sm rounded-none hover:bg-indigo-800 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors uppercase tracking-widest"
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
