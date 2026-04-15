import { Link } from 'react-router-dom'
import { StatusBadge } from './ContactHistoryPanel'

export default function DuplicateWarning({ duplicates, onSkipAll, onIncludeAll, onPerRecipientDecision }) {
  if (!duplicates || duplicates.length === 0) return null

  return (
    <div className="mt-4 border border-amber-200 rounded-lg bg-amber-50 shadow-sm overflow-hidden text-sm">
      <div className="bg-amber-100 px-4 py-3 border-b border-amber-200 flex items-center gap-2">
        <span className="text-xl">⚠️</span>
        <span className="font-semibold text-amber-900">{duplicates.length} email{duplicates.length > 1 ? 's have' : ' has'} been contacted before</span>
      </div>

      <div className="divide-y divide-amber-100 max-h-80 overflow-y-auto">
        {duplicates.map((dup) => (
          <div key={dup.email} className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-amber-900">{dup.email}</span>
              <StatusBadge status={dup.reply_status} />
            </div>
            <div className="text-amber-800 text-xs">
              Last contacted: {new Date(dup.last_contacted).toLocaleDateString()} · Campaign: {dup.campaign_name}
            </div>
            <div className="flex gap-2 mt-1">
              <button 
                type="button"
                onClick={() => onPerRecipientDecision(dup.email, 'skip')}
                className="px-3 py-1 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 text-xs font-medium transition-colors"
              >
                Skip
              </button>
              <button 
                type="button"
                onClick={() => onPerRecipientDecision(dup.email, 'include')}
                className="px-3 py-1 bg-amber-200 border border-amber-300 text-amber-800 rounded hover:bg-amber-300 text-xs font-medium transition-colors"
              >
                Include anyway
              </button>
              <Link 
                to={`/campaign/${dup.campaign_id}`} 
                target="_blank"
                className="px-3 py-1 bg-white border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 text-xs font-medium focus:outline-none transition-colors ml-auto"
              >
                Go to follow-up →
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-amber-100 px-4 py-3 flex gap-3 border-t border-amber-200">
        <button 
          type="button"
          onClick={onSkipAll}
          className="px-4 py-1.5 bg-white border border-gray-300 text-gray-700 rounded font-medium hover:bg-gray-50 transition-colors"
        >
          Skip All Duplicates
        </button>
        <button 
          type="button"
          onClick={onIncludeAll}
          className="px-4 py-1.5 bg-amber-200 text-amber-900 rounded font-medium hover:bg-amber-300 transition-colors border border-amber-300"
        >
          Include All Anyway
        </button>
      </div>
    </div>
  )
}
