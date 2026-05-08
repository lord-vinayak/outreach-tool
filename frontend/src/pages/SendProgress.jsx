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
    <div id="send-progress-page" className="max-w-2xl mx-auto pb-12">
      <div className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">
          {isFollowUp ? 'Sending Follow-ups' : 'Sending Emails'}
        </h1>
      </div>

      {/* Progress Bar */}
      <div className="bg-white border border-zinc-200 p-8 mb-8">
        <ProgressBar
          current={progress.current}
          total={progress.total}
          label="Sending progress"
        />

        {progress.status === 'sending' ? (
          <div className="mt-6 text-sm font-mono text-zinc-600">
            <p>
              CURRENTLY SENDING TO:{' '}
              <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 border border-indigo-200 ml-2">
                {progress.current_email || '...'}
              </span>
            </p>
            {remaining > 0 ? (
              <p className="mt-2 text-zinc-400 text-[10px] uppercase tracking-widest">
                ~{etaMinutes} minute{etaMinutes !== 1 ? 's' : ''} remaining
              </p>
            ) : null}
          </div>
        ) : null}

        {progress.status === 'complete' ? (
          <div className="mt-6">
            <div className="flex gap-4 font-mono text-sm mb-6 border border-zinc-200 p-4 bg-zinc-50">
              <span className="text-emerald-700 font-bold flex items-center gap-2">
                <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5">✓</span> {sentCount} SENT
              </span>
              {failedCount > 0 ? (
                <span className="text-red-700 font-bold flex items-center gap-2">
                  <span className="bg-red-100 text-red-800 px-1.5 py-0.5">✗</span> {failedCount} FAILED
                </span>
              ) : null}
            </div>
            <button
              id="view-campaign-btn"
              onClick={() => navigate(`/campaign/${campaignId}`)}
              className="px-6 py-3 bg-indigo-700 text-white font-display font-bold uppercase tracking-widest text-xs rounded-none hover:bg-indigo-800 transition-colors w-full sm:w-auto"
            >
              View Campaign Details
            </button>
          </div>
        ) : null}
      </div>

      {/* Activity Log */}
      <div>
        <h2 className="text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-3">Activity Log</h2>
        {progress.log.length === 0 ? (
          <p className="text-zinc-500 font-mono text-xs border border-dashed border-zinc-300 p-4 text-center bg-zinc-50 uppercase tracking-widest">
            Waiting for first email to send...
          </p>
        ) : (
          <div className="bg-white border border-zinc-200 divide-y divide-zinc-200 max-h-80 overflow-y-auto font-mono text-xs">
            {[...progress.log].reverse().map((entry, i) => (
              <div key={i} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center gap-3">
                  {entry.status === 'sent' ? (
                    <span className="w-1.5 h-1.5 rounded-none bg-emerald-500" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-none bg-red-500" />
                  )}
                  <span className="text-zinc-900 font-bold">{entry.email}</span>
                </div>
                <div className={`text-[10px] uppercase tracking-widest ${entry.status === 'sent' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {entry.status === 'sent' ? 'SENT' : `FAILED: ${entry.error || 'UNKNOWN ERROR'}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
