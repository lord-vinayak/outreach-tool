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
  const [resumeParsed, setResumeParsed] = useState(null)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)

  useEffect(() => {
    api.get('/profile')
      .then((res) => {
        setForm((prev) => ({ ...prev, ...res.data.profile }))
        setHasResume(res.data.has_resume)
        setResumeParsed(res.data.resume_parsed)
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
      const res = await api.post('/upload-resume', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setHasResume(true)
      if (res.data.parsed) {
        setResumeParsed(res.data.parsed)
        setFlash('Resume uploaded and parsed successfully!')
      } else {
        setFlash('Resume uploaded successfully!')
      }
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload resume')
    } finally {
      setUploading(false)
    }
  }

  const handleReparse = async () => {
    setError('')
    setParsing(true)
    try {
      const res = await api.post('/resume/reparse')
      setResumeParsed(res.data.parsed)
      setFlash('Resume re-parsed successfully!')
      setTimeout(() => setFlash(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse resume')
    } finally {
      setParsing(false)
    }
  }

  return (
    <div id="profile-page" className="max-w-2xl mx-auto pb-12">
      <div className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-display font-bold text-zinc-950 tracking-tight">My Profile</h1>
      </div>

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

      <form onSubmit={handleSubmit} className="space-y-6">
        <Field label="Full Name *" name="name" value={form.name} onChange={handleChange} required />
        <Field label="College / University *" name="college" value={form.college} onChange={handleChange} required />
        <Field label="Branch / Department *" name="branch" value={form.branch} onChange={handleChange} placeholder="e.g., Chemical Engineering" required />
        <Field label="Year of Study *" name="year" value={form.year} onChange={handleChange} placeholder="e.g., 3rd Year" required />
        <Field label="CGPA" name="cgpa" value={form.cgpa} onChange={handleChange} placeholder="Optional" />
        <Field label="Key Skills *" name="skills" value={form.skills} onChange={handleChange} placeholder="e.g., Python, Machine Learning, Flask, React" required />
        <Field label="GitHub Profile URL" name="github" value={form.github} onChange={handleChange} placeholder="https://github.com/username" />
        <Field label="LinkedIn Profile URL" name="linkedin" value={form.linkedin} onChange={handleChange} placeholder="https://linkedin.com/in/username" />

        <div>
          <label className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-1.5">
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
            className="w-full border border-zinc-300 rounded-none px-3 py-2 text-sm font-mono leading-relaxed focus:ring-1 focus:ring-zinc-900 outline-none bg-zinc-50 focus:bg-white transition-colors"
          />
        </div>

        {/* Resume Upload */}
        <div className="pt-2">
          <label className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-2">
            Resume (PDF, max 5MB)
          </label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              id="resume-upload"
              type="file"
              accept=".pdf"
              onChange={handleResumeUpload}
              className="text-[11px] font-mono text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-none file:border file:border-zinc-300 file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 transition-colors file:uppercase file:tracking-wider file:font-bold file:cursor-pointer"
            />
            {uploading ? (
              <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider animate-pulse">Uploading...</span>
            ) : null}
            {hasResume ? (
              <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 uppercase tracking-wider">✓ Uploaded</span>
            ) : null}
          </div>
        </div>

        <div className="pt-6 border-t border-zinc-200">
          <button
            id="save-profile-btn"
            type="submit"
            disabled={saving}
            className="w-full py-3.5 bg-indigo-700 text-white font-display font-bold uppercase tracking-widest text-sm rounded-none hover:bg-indigo-800 disabled:opacity-50 disabled:bg-zinc-400 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </form>

      {/* Resume Analysis Section */}
      {hasResume && (
        <div className="mt-12 border-t border-zinc-200 pt-8">
          <div className="flex items-center justify-between mb-6 pb-2 border-b border-zinc-100">
            <h2 className="text-xl font-display font-bold text-zinc-950 uppercase tracking-wide">Resume Analysis</h2>
            <button
              onClick={handleReparse}
              disabled={parsing}
              className="text-[10px] font-mono font-medium text-indigo-700 hover:bg-indigo-50 px-2 py-1 border border-indigo-200 disabled:opacity-50 transition-colors uppercase tracking-wider"
            >
              {parsing ? 'Parsing...' : 'Re-parse Resume'}
            </button>
          </div>

          {!resumeParsed || Object.keys(resumeParsed).length === 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-none">
              <p className="text-xs font-mono text-amber-800">
                <span className="font-bold uppercase tracking-wider">Note:</span> Resume has not been analyzed yet. Make sure your Groq API key is set in Settings, then click "Re-parse Resume".
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-zinc-50 p-5 border border-zinc-200">
                <h3 className="text-[10px] font-display font-bold text-zinc-500 uppercase tracking-widest mb-3">Professional Summary</h3>
                <p className="text-sm font-mono text-zinc-700 leading-relaxed bg-white border border-zinc-200 p-4">"{resumeParsed.summary}"</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnalysisCard title="Key Projects" items={resumeParsed.projects} type="project" />
                <AnalysisCard title="Experience" items={resumeParsed.experience} type="experience" />
              </div>

              <div className="bg-white p-5 border border-zinc-200">
                <h3 className="text-[10px] font-display font-bold text-zinc-500 uppercase tracking-widest mb-3">Achievements & Skills</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {resumeParsed.skills?.map((skill, i) => (
                    <span key={i} className="px-2 py-1 bg-indigo-50 text-indigo-800 text-[10px] font-mono border border-indigo-200 uppercase tracking-wider">
                      {skill}
                    </span>
                  ))}
                </div>
                <ul className="space-y-2 border-t border-zinc-100 pt-4">
                  {resumeParsed.achievements?.map((ach, i) => (
                    <li key={i} className="text-xs font-mono text-zinc-700 flex gap-3">
                      <span className="text-indigo-400 select-none">→</span> {ach}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AnalysisCard({ title, items, type }) {
  if (!items || items.length === 0) return null
  
  return (
    <div className="bg-white p-5 border border-zinc-200">
      <h3 className="text-[10px] font-display font-bold text-zinc-500 uppercase tracking-widest mb-4">{title}</h3>
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="border-l-2 border-indigo-200 pl-3">
            <h4 className="text-xs font-display font-bold text-zinc-900 uppercase tracking-wider mb-0.5">
              {type === 'project' ? item.title : `${item.role} @ ${item.organization}`}
            </h4>
            <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1.5">
              {type === 'experience' && item.duration}
            </p>
            <p className="text-xs font-mono text-zinc-600 leading-relaxed">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, name, value, onChange, placeholder, required }) {
  return (
    <div>
      <label htmlFor={`field-${name}`} className="block text-[10px] font-display font-bold text-zinc-950 uppercase tracking-widest mb-1.5">
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
        className="w-full border border-zinc-300 rounded-none px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-zinc-900 outline-none bg-zinc-50 focus:bg-white placeholder-zinc-400 transition-colors"
      />
    </div>
  )
}
