import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

export default function NewCampaign() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email_list: '',
    goal: '',
    additional_context: '',
  })
  const [parsedCount, setParsedCount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Step 1: Create campaign
      const createRes = await api.post('/campaign/new', form)
      const { campaign_id, recipients_count } = createRes.data
      setParsedCount(recipients_count)

      // Step 2: Generate emails
      setGenerating(true)
      const genRes = await api.post(`/campaign/${campaign_id}/generate`)

      if (genRes.data.errors?.length > 0) {
        setError(
          `Generated with ${genRes.data.errors.length} error(s). You can regenerate individual emails in Preview.`
        )
      }

      // Navigate to preview
      navigate(`/campaign/${campaign_id}/preview`)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create campaign')
      setLoading(false)
      setGenerating(false)
    }
  }

  // Show generating state
  if (generating) {
    return (
      <div id="generating-screen" className="max-w-2xl mx-auto text-center py-16">
        <div className="inline-block w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Generating Emails...
        </h2>
        <p className="text-gray-500 text-sm">
          Creating unique, personalized emails for {parsedCount} recipient{parsedCount !== 1 ? 's' : ''}.
          This may take a minute.
        </p>
        {error ? (
          <p className="mt-4 text-amber-600 text-sm">{error}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div id="new-campaign-page" className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Campaign</h1>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Campaign Name */}
        <div>
          <label htmlFor="campaign-name" className="block text-sm font-medium text-gray-700 mb-1">
            Campaign Name *
          </label>
          <input
            id="campaign-name"
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            placeholder="e.g., Summer Internship - ML Companies June 2026"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Email List */}
        <div>
          <label htmlFor="email-list" className="block text-sm font-medium text-gray-700 mb-1">
            Email List * <span className="text-gray-400 font-normal">(paste emails in any format)</span>
          </label>
          <textarea
            id="email-list"
            name="email_list"
            value={form.email_list}
            onChange={handleChange}
            required
            rows={6}
            placeholder={"john@company.com\njane.doe@startup.io, mark@techcorp.com\nAlice <alice@acme.com>\nBob Smith - bob@smith.com"}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Supports: one per line, comma-separated, space-separated, Name &lt;email&gt;, Name - email
          </p>
        </div>

        {/* Campaign Goal */}
        <div>
          <label htmlFor="campaign-goal" className="block text-sm font-medium text-gray-700 mb-1">
            Campaign Goal / Description *
          </label>
          <textarea
            id="campaign-goal"
            name="goal"
            value={form.goal}
            onChange={handleChange}
            required
            rows={3}
            placeholder="e.g., Send emails asking for a summer internship in machine learning or chemical engineering roles"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Additional Context */}
        <div>
          <label htmlFor="additional-context" className="block text-sm font-medium text-gray-700 mb-1">
            Additional Context <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="additional-context"
            name="additional_context"
            value={form.additional_context}
            onChange={handleChange}
            rows={2}
            placeholder="e.g., Mention that I'm available from May to July 2026"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>

        <button
          id="create-campaign-btn"
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating...' : 'Create Campaign & Generate Emails'}
        </button>
      </form>
    </div>
  )
}
