import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'
import ProgressBar from '../components/ProgressBar'

export default function SendProgress({ isFollowUp = false }) {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    status: 'idle',
    log: [],
    current_email: '',
  })
  const intervalRef = useRef(null)

  useEffect(() => {
    const pollUrl = isFollowUp
      ? `/campaign/${campaignId}/followup/progress`
      : `/campaign/${campaignId}/progress`

    // Poll every 5 seconds
    const poll = () => {
      api.get(pollUrl)
        .then((res) => {
          setProgress(res.data)
          if (res.data.status === 'complete') {
            clearInterval(intervalRef.current)
          }
        })
        .catch(console.error)
    }

    poll() // Initial poll
    intervalRef.current = setInterval(poll, 5000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [campaignId, isFollowUp])

  const sentCount = progress.log.filter((l) => l.status === 'sent').length
  const failedCount = progress.log.filter((l) => l.status === 'failed').length

  // Estimate time remaining
  const remaining = progress.total - progress.current
  const etaSeconds = remaining * 60 // Rough estimate assuming 60s delay
  const etaMinutes = Math.ceil(etaSeconds / 60)

  return (
    <div id="send-progress-page" className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isFollowUp ? 'Sending Follow-ups' : 'Sending Emails'}
      </h1>

      {/* Progress Bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <ProgressBar
          current={progress.current}
          total={progress.total}
          label="Sending progress"
        />

        {progress.status === 'sending' ? (
          <div className="mt-4 text-sm text-gray-600">
            <p>
              Currently sending to:{' '}
              <span className="font-medium text-gray-900">
                {progress.current_email || '...'}
              </span>
            </p>
            {remaining > 0 ? (
              <p className="mt-1 text-gray-400">
                ~{etaMinutes} minute{etaMinutes !== 1 ? 's' : ''} remaining
              </p>
            ) : null}
          </div>
        ) : null}

        {progress.status === 'complete' ? (
          <div className="mt-4">
            <div className="flex gap-4 text-sm">
              <span className="text-green-600 font-medium">
                ✓ {sentCount} sent
              </span>
              {failedCount > 0 ? (
                <span className="text-red-600 font-medium">
                  ✗ {failedCount} failed
                </span>
              ) : null}
            </div>
            <button
              id="view-campaign-btn"
              onClick={() => navigate(`/campaign/${campaignId}`)}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
            >
              View Campaign Details
            </button>
          </div>
        ) : null}
      </div>

      {/* Activity Log */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Activity Log</h2>
        {progress.log.length === 0 ? (
          <p className="text-gray-500 text-sm">Waiting for first email to send...</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {[...progress.log].reverse().map((entry, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {entry.status === 'sent' ? (
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                  )}
                  <span className="text-sm text-gray-900">{entry.email}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {entry.status === 'sent' ? 'Sent' : `Failed: ${entry.error || 'Unknown error'}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
