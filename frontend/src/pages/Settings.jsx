import { useState, useEffect } from 'react'
import api from '../api'

export default function Settings() {
  const [form, setForm] = useState({
    gmail_address: '',
    gmail_app_password: '',
    groq_api_key: '',
    groq_api_key_2: '',
    groq_api_key_3: '',
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
          groq_api_key_2: res.data.groq_api_key_2 || '',
          groq_api_key_3: res.data.groq_api_key_3 || '',
          send_delay_seconds: res.data.send_delay_seconds,
        }))
        setHasPassword(res.data.has_gmail_password)
        setHasKey(res.data.has_groq_key)
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
      if (form.groq_api_key) setHasKey(true)
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="settings-page" className="max-w-2xl mx-auto pb-12">
      <div className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">Settings</h1>
      </div>

      {flash ? (
        <div className="flash-message mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-sm rounded-none">
          {flash}
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 font-mono text-sm rounded-none">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 border border-zinc-200">
        {/* Gmail Address */}
        <div>
          <label htmlFor="gmail-address" className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2">
            Gmail Address
          </label>
          <input
            id="gmail-address"
            type="email"
            name="gmail_address"
            value={form.gmail_address}
            onChange={handleChange}
            placeholder="youremail@gmail.com"
            className="w-full border border-zinc-300 bg-zinc-50 rounded-none px-4 py-3 font-mono text-sm focus:bg-white focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none transition-colors"
          />
        </div>

        {/* Gmail App Password */}
        <div>
          <label htmlFor="gmail-password" className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center justify-between">
            Gmail App Password
            {hasPassword ? (
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 inline-block">✓ CONFIGURED</span>
            ) : null}
          </label>
          <input
            id="gmail-password"
            type="password"
            name="gmail_app_password"
            value={form.gmail_app_password}
            onChange={handleChange}
            placeholder={hasPassword ? '••••••••••••••••' : 'Enter your app password'}
            className="w-full border border-zinc-300 bg-zinc-50 rounded-none px-4 py-3 font-mono text-sm focus:bg-white focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none transition-colors"
          />
          <p className="mt-2 text-[11px] font-mono text-zinc-500 leading-relaxed">
            To generate a Gmail App Password, go to{' '}
            <a
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 underline decoration-indigo-300 underline-offset-4"
            >
              Google Account → Security
            </a>{' '}
            → 2-Step Verification → App Passwords.
          </p>
        </div>

        {/* Groq API Key */}
        <div>
          <label htmlFor="groq-key" className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center justify-between">
            Groq API Key
            {hasKey ? (
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 inline-block">✓ CONFIGURED</span>
            ) : null}
          </label>
          <input
            id="groq-key"
            type="password"
            name="groq_api_key"
            value={form.groq_api_key}
            onChange={handleChange}
            placeholder={hasKey ? '••••••••••••••••' : 'Enter your Groq API key'}
            className="w-full border border-zinc-300 bg-zinc-50 rounded-none px-4 py-3 font-mono text-sm focus:bg-white focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none transition-colors"
          />
        </div>

        <div className="form-group">
          <label className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center">
            Groq API Key 2
            <span className="text-[10px] text-zinc-400 ml-2 font-normal lowercase tracking-normal">optional — for higher rate limits</span>
          </label>
          <input
            type="password"
            name="groq_api_key_2"
            value={form.groq_api_key_2 || ""}
            onChange={handleChange}
            placeholder="gsk_... (optional)"
            className="w-full border border-zinc-300 bg-zinc-50 rounded-none px-4 py-3 font-mono text-sm focus:bg-white focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none transition-colors"
          />
        </div>

        <div className="form-group">
          <label className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2 flex items-center">
            Groq API Key 3
            <span className="text-[10px] text-zinc-400 ml-2 font-normal lowercase tracking-normal">optional — for higher rate limits</span>
          </label>
          <input
            type="password"
            name="groq_api_key_3"
            value={form.groq_api_key_3 || ""}
            onChange={handleChange}
            placeholder="gsk_... (optional)"
            className="w-full border border-zinc-300 bg-zinc-50 rounded-none px-4 py-3 font-mono text-sm focus:bg-white focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 outline-none transition-colors"
          />
        </div>

        <div className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-1">
          💡 Adding multiple Groq keys enables round-robin rotation — 
          this multiplies your effective rate limit. 
          Get free keys at <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="underline">console.groq.com</a>.
          Only Key 1 is required.
        </div>

        {/* Send Delay */}
        <div className="pb-6 border-b border-zinc-200">
          <label htmlFor="send-delay" className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-4">
            Delay Between Emails: <span className="text-indigo-700 font-mono text-sm">{form.send_delay_seconds}s</span>
          </label>
          <input
            id="send-delay"
            type="range"
            name="send_delay_seconds"
            min="20"
            max="60"
            value={form.send_delay_seconds}
            onChange={handleChange}
            className="w-full accent-indigo-700 h-2 bg-zinc-200 rounded-none appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-widest mt-2">
            <span>20s</span>
            <span>60s</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            id="save-settings-btn"
            type="submit"
            disabled={saving}
            className="w-full py-4 bg-indigo-700 text-white font-display font-bold rounded-none hover:bg-indigo-800 disabled:opacity-50 transition-colors uppercase tracking-widest text-xs"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
