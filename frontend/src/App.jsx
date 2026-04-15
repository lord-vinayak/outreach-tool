import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import api from './api'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import NewCampaign from './pages/NewCampaign'
import Preview from './pages/Preview'
import Search from './pages/Search'
import SendProgress from './pages/SendProgress'
import Campaigns from './pages/Campaigns'
import CampaignDetail from './pages/CampaignDetail'

export default function App() {
  const [profileComplete, setProfileComplete] = useState(null)
  const location = useLocation()

  useEffect(() => {
    api.get('/profile')
      .then((res) => setProfileComplete(res.data.is_complete))
      .catch(() => setProfileComplete(false))
  }, [location.pathname])

  // Show nothing while checking profile status
  if (profileComplete === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route
            path="/"
            element={
              profileComplete ? <Dashboard /> : <Navigate to="/profile" replace />
            }
          />
          <Route path="/profile" element={<Profile onSave={() => setProfileComplete(true)} />} />
          <Route
            path="/settings"
            element={
              profileComplete ? <Settings /> : <Navigate to="/profile" replace />
            }
          />
          <Route
            path="/campaign/new"
            element={
              profileComplete ? <NewCampaign /> : <Navigate to="/profile" replace />
            }
          />
          <Route path="/search" element={profileComplete ? <Search /> : <Navigate to="/profile" replace />} />
          <Route path="/campaign/:campaignId/preview" element={<Preview />} />
          <Route path="/campaign/:campaignId/send" element={<SendProgress />} />
          <Route path="/campaign/:campaignId/followup/preview" element={<Preview isFollowUp />} />
          <Route path="/campaign/:campaignId/followup/send" element={<SendProgress isFollowUp />} />
          <Route
            path="/campaigns"
            element={
              profileComplete ? <Campaigns /> : <Navigate to="/profile" replace />
            }
          />
          <Route path="/campaign/:campaignId" element={<CampaignDetail />} />
        </Routes>
      </main>
    </div>
  )
}
