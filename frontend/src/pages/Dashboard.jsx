import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [replyStats, setReplyStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/dashboard'),
      api.get('/dashboard/reply-stats')
    ])
      .then(([dashRes, replyRes]) => {
        setStats(dashRes.data.stats)
        setRecent(dashRes.data.recent_campaigns)
        setReplyStats(replyRes.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading dashboard...</div>
  }

  return (
    <div id="dashboard-page">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

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
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          + New Campaign
        </Link>
      </div>

      {/* CRM Stats */}
      {replyStats && (
        <div className="mb-8 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Global Reply CRM Snapshot</h2>
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
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Campaigns</h2>
        {recent.length === 0 ? (
          <p className="text-gray-500 text-sm">No campaigns yet. Create your first one!</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {recent.map((c) => (
              <Link
                key={c.id}
                to={`/campaign/${c.id}`}
                className="block px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <span className="text-sm text-gray-500">
                    {c.recipient_count} recipients
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
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
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  }

  return (
    <div id={id} className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  )
}
