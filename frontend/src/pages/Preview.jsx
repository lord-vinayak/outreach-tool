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

  const emailKey = isFollowUp ? 'recipient_email' : 'email'
  const nameKey = isFollowUp ? 'recipient_name' : 'name'

  return (
    <div id="preview-page" className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isFollowUp ? 'Follow-up Preview' : 'Email Preview'}
        </h1>
        <span className="text-sm text-gray-500">
          {items.length} email{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      {/* Top controls */}
      <div className="flex gap-3 mb-6">
        <button
          id="send-all-top-btn"
          onClick={handleSendAll}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          Send All Emails
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
            className="bg-white border border-gray-200 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {item[nameKey] || 'No name'}
                </span>
                <span className="text-sm text-gray-500 ml-2">
                  {item[emailKey]}
                </span>
              </div>
              {!isFollowUp ? (
                <button
                  onClick={() => handleRegenerate(item, index)}
                  disabled={regenerating[item.id]}
                  className="text-xs px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {regenerating[item.id] ? 'Regenerating...' : '↻ Regenerate'}
                </button>
              ) : null}
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
      </div>

      {/* Bottom controls */}
      <div className="flex gap-3 mt-6 mb-8">
        <button
          id="send-all-bottom-btn"
          onClick={handleSendAll}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          Send All Emails
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
