import { useState, useEffect } from 'react'
import api from '../api'

export default function Settings() {
  const [form, setForm] = useState({
    gmail_address: '',
    gmail_app_password: '',
    gemini_api_key: '',
    send_delay_seconds: 60,
  })
  const [hasPassword, setHasPassword] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/settings')
      .then((res) => {
        setForm((prev) => ({
          ...prev,
          gmail_address: res.data.gmail_address,
          send_delay_seconds: res.data.send_delay_seconds,
        }))
        setHasPassword(res.data.has_gmail_password)
        setHasKey(res.data.has_gemini_key)
      })
      .catch(console.error)
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: name === 'send_delay_seconds' ? parseInt(value, 10) : value,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setFlash('')
    setSaving(true)

    try {
      await api.post('/settings', form)
      setFlash('Settings saved successfully!')
      if (form.gmail_app_password) setHasPassword(true)
      if (form.gemini_api_key) setHasKey(true)
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="settings-page" className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {flash ? (
        <div className="flash-message mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">
          {flash}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Gmail Address */}
        <div>
          <label htmlFor="gmail-address" className="block text-sm font-medium text-gray-700 mb-1">
            Gmail Address
          </label>
          <input
            id="gmail-address"
            type="email"
            name="gmail_address"
            value={form.gmail_address}
            onChange={handleChange}
            placeholder="youremail@gmail.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Gmail App Password */}
        <div>
          <label htmlFor="gmail-password" className="block text-sm font-medium text-gray-700 mb-1">
            Gmail App Password
            {hasPassword ? (
              <span className="ml-2 text-green-600 text-xs">✓ Configured</span>
            ) : null}
          </label>
          <input
            id="gmail-password"
            type="password"
            name="gmail_app_password"
            value={form.gmail_app_password}
            onChange={handleChange}
            placeholder={hasPassword ? '••••••••••••••••' : 'Enter your app password'}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            To generate a Gmail App Password, go to{' '}
            <a
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline"
            >
              Google Account → Security
            </a>{' '}
            → 2-Step Verification → App Passwords.
          </p>
        </div>

        {/* Gemini API Key */}
        <div>
          <label htmlFor="gemini-key" className="block text-sm font-medium text-gray-700 mb-1">
            Gemini API Key
            {hasKey ? (
              <span className="ml-2 text-green-600 text-xs">✓ Configured</span>
            ) : null}
          </label>
          <input
            id="gemini-key"
            type="password"
            name="gemini_api_key"
            value={form.gemini_api_key}
            onChange={handleChange}
            placeholder={hasKey ? '••••••••••••••••' : 'Enter your Gemini API key'}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Get a free API key at{' '}
            <a
              href="https://aistudio.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline"
            >
              aistudio.google.com
            </a>
          </p>
        </div>

        {/* Send Delay */}
        <div>
          <label htmlFor="send-delay" className="block text-sm font-medium text-gray-700 mb-1">
            Delay Between Emails: {form.send_delay_seconds}s
          </label>
          <input
            id="send-delay"
            type="range"
            name="send_delay_seconds"
            min="45"
            max="90"
            value={form.send_delay_seconds}
            onChange={handleChange}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>45s</span>
            <span>90s</span>
          </div>
        </div>

        <button
          id="save-settings-btn"
          type="submit"
          disabled={saving}
          className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  )
}
