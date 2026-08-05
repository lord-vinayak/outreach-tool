import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [replyStats, setReplyStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [monitorResult, setMonitorResult] = useState(null)

  const startPollingStatus = useCallback(() => {
    setChecking(true);
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/inbox/status');
        setMonitorResult(res.data);
        if (res.data.status !== 'running') {
          clearInterval(interval);
          setChecking(false);
          // Refresh stats after monitor finishes
          Promise.all([
            api.get('/dashboard'),
            api.get('/dashboard/reply-stats')
          ]).then(([dashRes, replyRes]) => {
            setStats(dashRes.data.stats);
            setReplyStats(replyRes.data);
          }).catch(console.error);
        }
      } catch {
        clearInterval(interval);
        setChecking(false);
      }
    }, 2000);
  }, []);

  const fetchDashboardData = useCallback(() => {
    Promise.all([
      api.get('/dashboard'),
      api.get('/dashboard/reply-stats'),
      api.get('/inbox/status')
    ])
      .then(([dashRes, replyRes, inboxRes]) => {
        setStats(dashRes.data.stats)
        setRecent(dashRes.data.recent_campaigns)
        setReplyStats(replyRes.data)
        setMonitorResult(inboxRes.data)
        if (inboxRes.data?.status === 'running') {
          startPollingStatus();
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [startPollingStatus])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData])

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      const res = await api.post('/inbox/check');
      setMonitorResult(res.data);
      startPollingStatus();
    } catch (err) {
      if (err.response?.status === 429) {
        // Monitor is already running in background, poll for results
        startPollingStatus();
      } else {
        setMonitorResult({ error: err.response?.data?.error || "Check failed." });
        setChecking(false);
      }
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading dashboard...</div>
  }

  return (
    <div id="dashboard-page">
      <h1 className="text-3xl font-display font-bold text-zinc-950 mb-8 tracking-tight">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          id="stat-campaigns"
          label="Total Campaigns"
          value={stats?.total_campaigns ?? 0}
          color="indigo"
        />
        <StatCard
          id="stat-sent"
          label="Emails Sent"
          value={stats?.total_sent ?? 0}
          color="green"
        />
        <StatCard
          id="stat-failed"
          label="Failed"
          value={stats?.total_failed ?? 0}
          color="red"
        />
        <StatCard
          id="stat-followups"
          label="Follow-ups Sent"
          value={stats?.total_followups_sent ?? 0}
          color="amber"
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <Link
          to="/campaign/new"
          id="new-campaign-btn"
          className="inline-flex items-center px-6 py-2.5 bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800 transition-colors rounded-none"
        >
          + New Campaign
        </Link>
      </div>

      {/* Inbox Monitor */}
      <div className="mb-8 p-5 bg-white border border-zinc-200 rounded-none border-l-4 border-l-zinc-800">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-display font-semibold text-zinc-950 mb-1 flex items-center gap-2">
              <span className="text-zinc-400 font-mono text-xs border border-zinc-200 px-1 py-0.5 leading-none">SYS</span> Inbox Monitor
            </h2>
            <p className="text-sm text-zinc-500 font-mono mt-2">
              {monitorResult?.last_run 
                ? `Last checked: ${Math.max(0, Math.floor((new Date() - new Date(monitorResult.last_run + "Z")) / 60000))} minutes ago`
                : "Monitor has not run yet. Click Check Now to scan your inbox."}
            </p>
            <p className="text-xs text-zinc-400 font-mono mt-1">Status: Auto-check [ACTIVE, 10m]</p>
            
            <div className="mt-4 text-sm text-zinc-700 border-l-2 border-zinc-200 pl-4 font-mono">
              {monitorResult?.error ? (
                <p className="text-red-600 font-medium">{monitorResult.error}</p>
              ) : monitorResult && (monitorResult.bounces_detected > 0 || monitorResult.ooo_detected > 0) ? (
                <>
                  <p className="text-zinc-500 uppercase text-xs mb-1">Last run results</p>
                  <ul className="space-y-1">
                    {monitorResult.bounces_detected > 0 && <li>[!] {monitorResult.bounces_detected} hard bounce(s) detected → marked invalid</li>}
                    {monitorResult.ooo_detected > 0 && <li>[*] {monitorResult.ooo_detected} out-of-office replie(s) → check back</li>}
                    <li>[+] {monitorResult.updated} recipients updated</li>
                  </ul>
                </>
              ) : monitorResult?.last_run ? (
                <p className="text-green-700">[✓] No new bounces or OOO replies found.</p>
              ) : null}
            </div>
          </div>
          <button
            onClick={handleCheckNow}
            disabled={checking}
            className="inline-flex justify-center items-center px-4 py-2 border border-zinc-200 bg-zinc-50 text-zinc-900 text-sm font-medium hover:bg-zinc-100 transition-colors disabled:opacity-50 min-w-[120px] rounded-none shadow-sm"
          >
            {checking ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full" />
                Scanning...
              </span>
            ) : "Check Now"}
          </button>
        </div>
      </div>

      {/* CRM Stats */}
      {replyStats && (
        <div className="mb-8 p-6 bg-white border border-zinc-200 rounded-none">
          <h2 className="text-xs font-display font-semibold text-zinc-500 mb-5 uppercase tracking-wider">Global Reply CRM Snapshot</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Interested" value={replyStats.interested ?? 0} color="green" />
            <StatCard label="Check Back" value={replyStats.check_back ?? 0} color="blue" />
            <StatCard label="No Reply" value={replyStats.no_reply ?? 0} color="gray" />
            <StatCard label="Invalid / Excluded" value={replyStats.invalid_email ?? 0} color="red" />
          </div>
        </div>
      )}

      {/* Recent Campaigns */}
      <div>
        <h2 className="text-xs font-display font-semibold text-zinc-500 mb-3 uppercase tracking-wider">Recent Campaigns</h2>
        {recent.length === 0 ? (
          <p className="text-zinc-500 text-sm">No campaigns yet. Create your first one!</p>
        ) : (
          <div className="bg-white border border-zinc-200 divide-y divide-zinc-200 rounded-none">
            {recent.map((c) => (
              <Link
                key={c.id}
                to={`/campaign/${c.id}`}
                className="block px-5 py-4 hover:bg-zinc-50 transition-colors group"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium text-zinc-950 group-hover:text-indigo-700 transition-colors">{c.name}</span>
                  <span className="text-sm text-zinc-500 font-mono">
                    {c.recipient_count} recipients
                  </span>
                </div>
                <div className="text-xs text-zinc-400 mt-1 font-mono">
                  {new Date(c.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ id, label, value, color }) {
  const borderColors = {
    indigo: 'border-t-indigo-600',
    green: 'border-t-emerald-600',
    red: 'border-t-rose-600',
    amber: 'border-t-amber-500',
    blue: 'border-t-blue-600',
    gray: 'border-t-zinc-400',
  }

  return (
    <div id={id} className={`bg-white border border-zinc-200 p-5 rounded-none border-t-4 ${borderColors[color]} hover:bg-zinc-50 transition-colors`}>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-4xl font-display font-semibold text-zinc-950 mt-3">{value}</div>
    </div>
  )
}
