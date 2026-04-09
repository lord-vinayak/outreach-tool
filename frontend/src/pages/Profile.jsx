import { useState, useEffect } from 'react'
import api from '../api'

export default function Profile({ onSave }) {
  const [form, setForm] = useState({
    name: '',
    college: '',
    branch: '',
    year: '',
    cgpa: '',
    skills: '',
    github: '',
    linkedin: '',
    bio: '',
  })
  const [hasResume, setHasResume] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.get('/profile')
      .then((res) => {
        setForm((prev) => ({ ...prev, ...res.data.profile }))
        setHasResume(res.data.has_resume)
      })
      .catch(console.error)
  }, [])

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setFlash('')
    setSaving(true)

    try {
      await api.post('/profile', form)
      setFlash('Profile saved successfully!')
      if (onSave) onSave()
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleResumeUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large. Maximum size is 5MB.')
      return
    }

    setUploading(true)
    setError('')

    const formData = new FormData()
    formData.append('resume', file)

    try {
      await api.post('/upload-resume', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setHasResume(true)
      setFlash('Resume uploaded successfully!')
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload resume')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div id="profile-page" className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Profile</h1>

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
        <Field label="Full Name *" name="name" value={form.name} onChange={handleChange} required />
        <Field label="College / University *" name="college" value={form.college} onChange={handleChange} required />
        <Field label="Branch / Department *" name="branch" value={form.branch} onChange={handleChange} placeholder="e.g., Chemical Engineering" required />
        <Field label="Year of Study *" name="year" value={form.year} onChange={handleChange} placeholder="e.g., 3rd Year" required />
        <Field label="CGPA" name="cgpa" value={form.cgpa} onChange={handleChange} placeholder="Optional" />
        <Field label="Key Skills *" name="skills" value={form.skills} onChange={handleChange} placeholder="e.g., Python, Machine Learning, Flask, React" required />
        <Field label="GitHub Profile URL" name="github" value={form.github} onChange={handleChange} placeholder="https://github.com/username" />
        <Field label="LinkedIn Profile URL" name="linkedin" value={form.linkedin} onChange={handleChange} placeholder="https://linkedin.com/in/username" />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            About Me / Short Bio *
          </label>
          <textarea
            id="field-bio"
            name="bio"
            value={form.bio}
            onChange={handleChange}
            rows={3}
            required
            placeholder="2–3 sentences about yourself"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Resume Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resume (PDF, max 5MB)
          </label>
          <div className="flex items-center gap-3">
            <input
              id="resume-upload"
              type="file"
              accept=".pdf"
              onChange={handleResumeUpload}
              className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
            />
            {uploading ? (
              <span className="text-sm text-gray-500">Uploading...</span>
            ) : null}
            {hasResume ? (
              <span className="text-sm text-green-600">✓ Resume uploaded</span>
            ) : null}
          </div>
        </div>

        <button
          id="save-profile-btn"
          type="submit"
          disabled={saving}
          className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, name, value, onChange, placeholder, required }) {
  return (
    <div>
      <label htmlFor={`field-${name}`} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={`field-${name}`}
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
      />
    </div>
  )
}
