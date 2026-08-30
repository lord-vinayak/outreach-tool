import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import DuplicateWarning from '../components/DuplicateWarning'

export default function NewCampaign() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email_list: '',
    goal: '',
    additional_context: '',
  })
  const [provider, setProvider] = useState('groq')
  const [parsedCount, setParsedCount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(null)
  const [campaignId, setCampaignId] = useState(null)
  const [error, setError] = useState('')
  
  const [parsedEmails, setParsedEmails] = useState([])
  const [duplicates, setDuplicates] = useState([])
  const [skippedEmails, setSkippedEmails] = useState(new Set())
  const [showWarning, setShowWarning] = useState(false)
  const [parseSummary, setParseSummary] = useState('')
  const [blockedDomains, setBlockedDomains] = useState([])
  const [blockedInPaste, setBlockedInPaste] = useState([])

  useEffect(() => {
    api.get('/blocked-domains')
      .then(res => setBlockedDomains(res.data.map(d => d.domain)))
      .catch(() => {})
  }, [])

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const extractEmails = (text) => {
    const rawEmails = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi
    const validEmails = []
    
    rawEmails.forEach(str => {
      const match = str.match(emailRegex)
      if (match) {
        validEmails.push({ email: match[0], raw: str })
      }
    })
    return validEmails
  }

  const checkDuplicates = async (rawText) => {
    const emails = extractEmails(rawText)
    setParsedEmails(emails)
    if (emails.length === 0) {
       setParseSummary('')
       setShowWarning(false)
       setBlockedInPaste([])
       return
    }

    // Check for blocked domains
    const blocked = emails.filter(e => {
      const domain = e.email.split('@')[1]?.toLowerCase()
      return domain && blockedDomains.includes(domain)
    })
    setBlockedInPaste(blocked)

    try {
      const res = await api.post('/campaign/check-duplicates', {
        emails: emails.map(e => e.email)
      })
      
      const dups = res.data.duplicates || []
      
      if (dups.length > 0) {
         setDuplicates(dups)
         setShowWarning(true)
      } else {
         setShowWarning(false)
      }
      
      updateSummary(emails.length, dups.length, 0)
    } catch (err) {
      console.error(err)
    }
  }

  const updateSummary = (total, dupsCount, skippedCount) => {
    const newCount = total - dupsCount
    const included = dupsCount - skippedCount
    setParseSummary(`✓ ${total} valid emails parsed · ${dupsCount} already contacted (${skippedCount} skipped, ${included} included) · ${newCount} new emails`)
  }

  const handleDecision = (email, action) => {
    if (action === 'skip') {
      const newSkipped = new Set(skippedEmails)
      newSkipped.add(email)
      setSkippedEmails(newSkipped)
      
      setForm(f => ({ ...f, email_list: f.email_list.split(/[\n,]+/).filter(l => !l.includes(email)).join('\n') }))
      
      setDuplicates(prev => prev.filter(d => d.email !== email))
      updateSummary(parsedEmails.length, duplicates.length - 1, newSkipped.size)
    } else if (action === 'include') {
      setDuplicates(prev => prev.filter(d => d.email !== email))
    }
    
    if (duplicates.length <= 1) setShowWarning(false)
  }

  const onSkipAll = () => {
    const allDups = new Set([...skippedEmails, ...duplicates.map(d => d.email)])
    setSkippedEmails(allDups)
    
    const dupEmailsList = duplicates.map(d => d.email)
    setForm(f => ({ 
      ...f, 
      email_list: f.email_list.split(/[\n,]+/).filter(l => !dupEmailsList.some(e => l.includes(e))).join('\n')
    }))
    
    setDuplicates([])
    setShowWarning(false)
    updateSummary(parsedEmails.length, 0, allDups.size)
  }

  const onIncludeAll = () => {
    setDuplicates([])
    setShowWarning(false)
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
      setCampaignId(campaign_id)

      // Step 2: Generate emails
      setGenerationProgress({ total: recipients_count, completed: 0, failed: 0, status: "generating", errors: [] })
      const genRes = await api.post(`/campaign/${campaign_id}/generate`, { provider })
      setGenerationProgress(prev => ({ ...prev, total: genRes.data.total }))

      const interval = setInterval(async () => {
        const progressRes = await api.get(`/campaign/${campaign_id}/generate-progress`);
        const data = progressRes.data;
        setGenerationProgress(data);

        if (data.status === "complete" || data.status === "error") {
          clearInterval(interval);
          if (data.status === "complete") {
            navigate(`/campaign/${campaign_id}/preview`)
          }
        }
      }, 1500);

    } catch (err) {
      setGenerationProgress(null);
      setError(err.response?.data?.error || 'Failed to start generation');
      setLoading(false);
    }
  }

  // Show generating state
  if (generationProgress) {
    return (
      <div id="generating-screen" className="max-w-2xl mx-auto text-center py-20 border border-zinc-200 bg-white mt-10">
        <div className="generation-progress-box border border-gray-200 rounded-lg p-6 mt-4 mx-8 bg-gray-50 text-left shadow-sm">
          {/* Header */}
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-medium text-gray-700">
              {generationProgress.status === "complete"
                ? "✅ Generation Complete"
                : generationProgress.status === "error"
                ? "❌ Generation Stopped"
                : "⚡ Generating Emails..."}
            </span>
            <span className="text-sm text-gray-500 font-mono">
              {generationProgress.completed} / {generationProgress.total}
            </span>
          </div>
          
          {/* Progress bar track */}
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3 overflow-hidden">
            <div
              className="bg-green-500 h-2.5 rounded-full transition-all duration-500"
              style={{
                width: generationProgress.total > 0
                  ? `${Math.round((generationProgress.completed / generationProgress.total) * 100)}%`
                  : "0%"
              }}
            />
          </div>
          
          {/* Sub-stats */}
          <div className="flex gap-4 text-xs font-mono text-gray-500">
            <span>✅ {generationProgress.completed} generated</span>
            {generationProgress.failed > 0 && (
              <span className="text-red-500">❌ {generationProgress.failed} failed</span>
            )}
            {generationProgress.status === "generating" && (
              <span className="text-blue-500 animate-pulse ml-auto">Running in parallel...</span>
            )}
          </div>
          
          {/* Error list — only show if there are errors */}
          {generationProgress.errors && generationProgress.errors.length > 0 && (
            <div className="mt-4 text-[10px] font-mono text-red-600 bg-red-50 border border-red-200 rounded p-3 max-h-32 overflow-y-auto text-left">
              <div className="font-bold mb-1">Errors encountered:</div>
              {generationProgress.errors.map((e, i) => (
                <div key={i} className="mb-1 truncate"><span className="font-semibold">{e.email}:</span> {e.error}</div>
              ))}
            </div>
          )}
        </div>

        {generationProgress.status === "error" ? (
          <div className="mt-8">
            <button
              onClick={() => navigate(`/campaign/${campaignId}/preview`)}
              className="px-6 py-3 bg-indigo-700 text-white font-display font-bold uppercase tracking-widest text-xs hover:bg-indigo-800 transition-colors"
            >
              Continue to Preview
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div id="new-campaign-page" className="max-w-2xl mx-auto pb-12">
      <div className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">New Campaign</h1>
      </div>

      {error ? (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-none text-sm font-mono">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Campaign Name */}
        <div>
          <label htmlFor="campaign-name" className="block text-xs font-display font-bold text-zinc-950 uppercase tracking-widest mb-2">
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
            className="w-full border border-zinc-300 rounded-none px-4 py-2.5 text-sm focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none placeholder-zinc-400 bg-zinc-50 focus:bg-white transition-colors"
          />
        </div>

        {/* Email List */}
        <div>
          <label htmlFor="email-list" className="block text-xs font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center justify-between">
            <span>Email List *</span>
            <span className="text-zinc-500 font-mono normal-case tracking-normal text-[10px] bg-zinc-100 px-2 py-0.5 border border-zinc-200">paste any format</span>
          </label>
          <textarea
            id="email-list"
            name="email_list"
            value={form.email_list}
            onChange={handleChange}
            onBlur={(e) => checkDuplicates(e.target.value)}
            required
            rows={6}
            placeholder={"john@company.com\njane.doe@startup.io, mark@techcorp.com\nAlice <alice@acme.com>\nBob Smith - bob@smith.com"}
            className="w-full border border-zinc-300 rounded-none px-4 py-3 text-sm font-mono leading-relaxed focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none placeholder-zinc-400 bg-zinc-50 focus:bg-white transition-colors"
          />
          
          <div className="flex justify-between items-center mt-2">
             <p className="text-[11px] font-mono text-zinc-500">
               Supports: newline, comma, space-separated, Name &lt;email&gt;
             </p>
             <button type="button" onClick={() => checkDuplicates(form.email_list)} className="text-[11px] font-mono font-medium text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-none border border-indigo-200 transition-colors uppercase tracking-wider">
               Check Duplicates
             </button>
          </div>
          
          {parseSummary ? (
            <div className="mt-3 text-xs font-mono text-emerald-800 bg-zinc-50 px-4 py-2.5 rounded-none border border-zinc-200 border-l-2 border-l-emerald-500 flex items-center gap-2">
               {parseSummary}
            </div>
          ) : null}

          {blockedInPaste.length > 0 && (
            <div className="text-xs font-mono text-red-800 bg-red-50 border border-red-200 rounded-none p-4 mt-3">
              <span className="font-bold">⚠️ BLOCKED DOMAINS DETECTED</span>
              <p className="mt-1 mb-2">The following emails are from blocked domains and will be skipped:</p>
              <ul className="list-disc list-inside text-[11px]">
                {blockedInPaste.map(e => (
                  <li key={e.email}>{e.email}</li>
                ))}
              </ul>
            </div>
          )}

          {showWarning && duplicates.length > 0 && (
            <DuplicateWarning 
              duplicates={duplicates} 
              onSkipAll={onSkipAll} 
              onIncludeAll={onIncludeAll} 
              onPerRecipientDecision={handleDecision} 
            />
          )}
        </div>

        {/* Campaign Goal */}
        <div>
          <label htmlFor="campaign-goal" className="block text-xs font-display font-bold text-zinc-950 uppercase tracking-widest mb-2">
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
            className="w-full border border-zinc-300 rounded-none px-4 py-3 text-sm leading-relaxed focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none placeholder-zinc-400 bg-zinc-50 focus:bg-white transition-colors"
          />
        </div>

        {/* Additional Context */}
        <div>
          <label htmlFor="additional-context" className="block text-xs font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center justify-between">
            <span>Additional Context</span>
            <span className="text-zinc-400 font-mono normal-case tracking-normal text-[10px]">optional</span>
          </label>
          <textarea
            id="additional-context"
            name="additional_context"
            value={form.additional_context}
            onChange={handleChange}
            rows={2}
            placeholder="e.g., Mention that I'm available from May to July 2026"
            className="w-full border border-zinc-300 rounded-none px-4 py-3 text-sm leading-relaxed focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none placeholder-zinc-400 bg-zinc-50 focus:bg-white transition-colors"
          />
        </div>

        {/* Model Provider */}
        <div>
          <label className="block text-xs font-display font-bold text-zinc-950 uppercase tracking-widest mb-2">
            Model Provider
          </label>
          <select
            id="provider-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full border border-zinc-300 rounded-none px-4 py-2.5 text-sm focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none bg-zinc-50 focus:bg-white transition-colors"
          >
            <option value="groq">Groq (free, slower)</option>
            <option value="openai">OpenAI (paid, fast)</option>
            <option value="anthropic">Anthropic (paid, fast)</option>
          </select>
          <p className="mt-2 text-[11px] font-mono text-zinc-500">
            Company-name lookups always use Groq regardless of this choice.
          </p>
        </div>

        <div className="pt-4 border-t border-zinc-200">
          <button
            id="create-campaign-btn"
            type="submit"
            disabled={loading || generationProgress?.status === "generating"}
            className="w-full py-3.5 bg-indigo-700 text-white font-display font-bold uppercase tracking-widest text-sm rounded-none hover:bg-indigo-800 disabled:opacity-50 disabled:bg-zinc-400 transition-colors"
          >
            {generationProgress?.status === "generating" ? 'Generating...' : 'Create Campaign & Generate'}
          </button>
        </div>
      </form>
    </div>
  )
}
