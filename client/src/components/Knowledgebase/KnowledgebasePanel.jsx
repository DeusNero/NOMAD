import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ExternalLink, FileText, Loader2, RefreshCw, Save, SendHorizontal, Settings2, ShieldCheck, Upload } from 'lucide-react'
import { getKnowledgebaseSessionId, knowledgebaseApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'
import { useAuthStore } from '../../store/authStore'
import KnowledgebaseMarkdown from './KnowledgebaseMarkdown'
import Modal from '../shared/Modal'
import { useToast } from '../shared/Toast'

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value.endsWith?.('Z') ? value : `${value}Z`)
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function mergeMessages(existingMessages, nextMessages) {
  const seen = new Set(existingMessages
    .filter(message => message?.id != null)
    .map(message => String(message.id)))
  const merged = [...existingMessages]

  for (const message of nextMessages) {
    if (!message) continue

    if (message.id == null) {
      merged.push(message)
      continue
    }

    const id = String(message.id)
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(message)
  }

  return merged
}

function formatSourceTitle(relativePath, fallback = 'Source Note') {
  if (!relativePath) return fallback
  const fileName = String(relativePath).split('/').pop() || ''
  return fileName.replace(/\.md$/i, '') || fallback
}

function MessageBubble({ message, currentSessionId, onOpenSource, openingSourcePath }) {
  const isOwn = message.role === 'user' && String(message.session_id) === String(currentSessionId)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: message.role === 'assistant' ? 'stretch' : (isOwn ? 'flex-end' : 'flex-start'),
      gap: 4,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: message.role === 'assistant' ? 'flex-start' : (isOwn ? 'flex-end' : 'flex-start'),
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: message.role === 'assistant' ? 'rgba(15,23,42,0.08)' : 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {message.avatar_url ? (
            <img src={message.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : message.role === 'assistant' ? (
            <Brain size={14} />
          ) : (
            (message.username || '?').slice(0, 1).toUpperCase()
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            {message.username}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {message.pending ? 'Searching vault...' : formatTimestamp(message.created_at)}
          </span>
        </div>
      </div>

      <div style={{
        marginLeft: message.role === 'assistant' ? 36 : 0,
        marginRight: isOwn ? 36 : 0,
        maxWidth: message.role === 'assistant' ? '100%' : '78%',
        border: '1px solid var(--border-faint)',
        background: message.role === 'assistant'
          ? 'linear-gradient(180deg, rgba(15,23,42,0.03), rgba(15,23,42,0.01))'
          : (isOwn ? '#0f172a' : 'var(--bg-secondary)'),
        color: message.role === 'assistant'
          ? 'var(--text-primary)'
          : (isOwn ? '#fff' : 'var(--text-primary)'),
        borderRadius: 16,
        padding: '12px 14px',
        lineHeight: 1.5,
        fontSize: 14,
      }}>
        {message.pending ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={15} className="animate-spin" />
            <span>{message.content}</span>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        )}
      </div>

      {message.role === 'assistant' && message.citations?.length > 0 && (
        <div style={{
          marginLeft: 36,
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {message.citations.map(citation => (
            <button
              key={`${message.id}-${citation.index}`}
              type="button"
              onClick={() => onOpenSource?.(citation)}
              style={{
                border: '1px solid var(--border-faint)',
                borderRadius: 12,
                background: 'var(--bg-card)',
                padding: 10,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'rgba(15,23,42,0.08)',
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}>
                    {citation.index}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
                    {citation.title || citation.relative_path}
                  </span>
                </div>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                }}>
                  {openingSourcePath === citation.relative_path ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ExternalLink size={13} />
                  )}
                  Open
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {citation.relative_path}{citation.heading && citation.heading !== citation.title ? ` > ${citation.heading}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.45 }}>
                {citation.excerpt}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function KnowledgebasePanel({ tripId }) {
  const user = useAuthStore(s => s.user)
  const toast = useToast()
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)
  const knowledgebaseSessionId = useMemo(() => getKnowledgebaseSessionId(), [])

  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState(null)
  const [capabilities, setCapabilities] = useState({})
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [startingSynthesis, setStartingSynthesis] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [openingSourcePath, setOpeningSourcePath] = useState(null)
  const [sourcePreview, setSourcePreview] = useState(null)
  const [synthesis, setSynthesis] = useState(null)
  const [uploadPrompt, setUploadPrompt] = useState(null)
  const [settingsForm, setSettingsForm] = useState({
    vault_path: '',
    upload_path: '',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    allow_uploads: true,
  })

  const loadState = useCallback(async () => {
    setLoading(true)
    try {
      const data = await knowledgebaseApi.getState(tripId)
      setConfig(data.config)
      setSynthesis(data.synthesis || null)
      setCapabilities(data.capabilities || {})
      setMessages(data.messages || [])
      setSettingsForm(prev => ({
        ...prev,
        vault_path: data.config?.vault_path || '',
        upload_path: data.config?.upload_path || '',
        provider: data.config?.provider || 'gemini',
        model: data.config?.model || 'gemini-2.5-pro',
        allow_uploads: data.config?.allow_uploads !== false,
      }))
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load knowledgebase')
    } finally {
      setLoading(false)
    }
  }, [tripId, toast])

  const refreshSynthesisStatus = useCallback(async ({ silent = true } = {}) => {
    try {
      const data = await knowledgebaseApi.getSynthesisStatus(tripId)
      setSynthesis(data.synthesis || null)
      if (data.stats) {
        setConfig(prev => prev ? ({
          ...prev,
          stats: data.stats,
          last_indexed_at: data.stats.last_indexed_at || prev.last_indexed_at,
        }) : prev)
      }
    } catch (err) {
      if (!silent) {
        toast.error(err.response?.data?.error || 'Failed to load synthesis status')
      }
    }
  }, [tripId, toast])

  useEffect(() => {
    loadState()
  }, [loadState])

  useEffect(() => {
    if (!config?.configured) return undefined
    const intervalMs = synthesis?.active ? 4000 : 15000
    const intervalId = window.setInterval(() => {
      refreshSynthesisStatus()
    }, intervalMs)

    return () => window.clearInterval(intervalId)
  }, [config?.configured, refreshSynthesisStatus, synthesis?.active])

  useEffect(() => {
    const handler = (event) => {
      if (String(event.tripId) !== String(tripId)) return

      if (event.type === 'knowledgebase:message:created' && event.message) {
        if (String(event.message.session_id) !== String(knowledgebaseSessionId)) return
        setMessages(prev => prev.some(msg => msg.id === event.message.id) ? prev : [...prev, event.message])
      }

      if (event.type === 'knowledgebase:config:updated' && event.config) {
        setConfig(prev => ({ ...prev, ...event.config }))
      }

      if (event.type === 'knowledgebase:indexed' && event.stats) {
        setConfig(prev => prev ? ({
          ...prev,
          stats: event.stats,
          last_indexed_at: event.stats.last_indexed_at || prev.last_indexed_at,
        }) : prev)
      }
    }

    addListener(handler)
    return () => removeListener(handler)
  }, [knowledgebaseSessionId, tripId])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const statusChips = useMemo(() => ([
    config?.provider ? `${config.provider}${config.model ? ` · ${config.model}` : ''}` : 'Not configured',
    config?.stats?.file_count ? `${config.stats.file_count} files` : '0 files',
    config?.stats?.chunk_count ? `${config.stats.chunk_count} chunks` : '0 chunks',
    config?.last_indexed_at ? `Indexed ${formatTimestamp(config.last_indexed_at)}` : 'Not indexed yet',
  ]), [config])

  const statusChipsDisplay = useMemo(() => ([
    config?.provider ? `${config.provider}${config.model ? ` | ${config.model}` : ''}` : 'Not configured',
    config?.stats?.file_count ? `${config.stats.file_count} files` : '0 files',
    config?.stats?.chunk_count ? `${config.stats.chunk_count} chunks` : '0 chunks',
    config?.last_indexed_at ? `Indexed ${formatTimestamp(config.last_indexed_at)}` : 'Not indexed yet',
    synthesis?.pending_count ? `${synthesis.pending_count} pending raw` : 'No pending raw',
  ]), [config, synthesis?.pending_count])

  const synthesisTone = synthesis?.error
    ? 'error'
    : (synthesis?.state === 'completed' && !synthesis?.pending_count
        ? 'success'
        : (synthesis?.active ? 'active' : 'idle'))

  const synthesisSummary = useMemo(() => {
    if (!synthesis?.available) return null

    if (synthesis.error) {
      return {
        title: 'Synthesis needs attention',
        body: synthesis.error,
      }
    }

    if (synthesis.state === 'reindexing') {
      return {
        title: 'Refreshing search',
        body: 'Hermes finished writing notes. Nomad is rebuilding the Japan search index now.',
      }
    }

    if (synthesis.state === 'synthesizing') {
      return {
        title: 'Hermes is synthesizing pending Japan sources',
        body: synthesis.task_summary
          || `Processed ${synthesis.processed_count} of ${synthesis.queued_count} queued sources so far.`,
      }
    }

    if (synthesis.state === 'queued' && synthesis.active) {
      return {
        title: 'Queued for Hermes',
        body: `Waiting for Hermes to pick up ${synthesis.queued_count} pending source${synthesis.queued_count === 1 ? '' : 's'}.`,
      }
    }

    if (synthesis.pending_count > 0) {
      return {
        title: 'Raw Japan sources are waiting',
        body: `${synthesis.pending_count} markdown file${synthesis.pending_count === 1 ? '' : 's'} are sitting in raw and are not searchable until Hermes synthesizes them into wiki/japan.`,
      }
    }

    if (synthesis.state === 'completed') {
      return {
        title: 'Japan knowledgebase updated',
        body: synthesis.queued_count
          ? 'Hermes finished the batch and Nomad refreshed the searchable Japan notes.'
          : 'The latest synthesis batch already finished.',
      }
    }

    return null
  }, [synthesis])

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed || sending) return

    const tempBase = Date.now()
    const pendingUserMessage = {
      id: `pending-user-${tempBase}`,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
      user_id: user?.id,
      session_id: knowledgebaseSessionId,
      username: user?.username || 'You',
      avatar_url: user?.avatar ? `/uploads/avatars/${user.avatar}` : null,
    }
    const pendingAssistantMessage = {
      id: `pending-assistant-${tempBase}`,
      role: 'assistant',
      content: 'Searching the vault and ranking the most relevant notes...',
      created_at: new Date().toISOString(),
      username: 'Knowledgebase',
      citations: [],
      pending: true,
    }

    setMessages(prev => [...prev, pendingUserMessage, pendingAssistantMessage])
    setQuestion('')
    setSending(true)
    try {
      const data = await knowledgebaseApi.query(tripId, trimmed)
      setMessages(prev => mergeMessages(
        prev.filter(message => message.id !== pendingUserMessage.id && message.id !== pendingAssistantMessage.id),
        [data.userMessage, data.assistantMessage]
      ))
    } catch (err) {
      setMessages(prev => prev.filter(message => message.id !== pendingUserMessage.id && message.id !== pendingAssistantMessage.id))
      setQuestion(trimmed)
      toast.error(err.response?.data?.error || 'Knowledgebase query failed')
    } finally {
      setSending(false)
    }
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      const data = await knowledgebaseApi.updateConfig(tripId, settingsForm)
      setConfig(data.config)
      await refreshSynthesisStatus()
      setShowSettings(false)
      toast.success('Knowledgebase settings saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save knowledgebase settings')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      const data = await knowledgebaseApi.reindex(tripId)
      setConfig(prev => prev ? ({
        ...prev,
        stats: data.stats,
        last_indexed_at: data.stats.last_indexed_at || prev.last_indexed_at,
      }) : prev)
      toast.success(`Indexed ${data.indexed_files} files`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reindex knowledgebase')
    } finally {
      setReindexing(false)
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setUploading(true)
    try {
      const data = await knowledgebaseApi.uploadMarkdown(tripId, formData)
      setConfig(prev => prev ? ({
        ...prev,
        stats: data.stats || prev.stats,
      }) : prev)
      setSynthesis(data.synthesis || null)
      toast.success(`Uploaded ${data.file.file_name}`)
      if (!data.file.indexed && data.synthesis?.pending_count > 0 && !data.synthesis?.active) {
        setUploadPrompt({
          fileName: data.file.file_name,
          pendingCount: data.synthesis.pending_count,
        })
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Markdown upload failed')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleStartSynthesis = async ({ closePrompt = false } = {}) => {
    if (startingSynthesis) return

    setStartingSynthesis(true)
    try {
      const data = await knowledgebaseApi.synthesize(tripId)
      setSynthesis(data.synthesis || null)
      if (data.stats) {
        setConfig(prev => prev ? ({
          ...prev,
          stats: data.stats,
          last_indexed_at: data.stats.last_indexed_at || prev.last_indexed_at,
        }) : prev)
      }
      if (closePrompt) setUploadPrompt(null)
      if (data.queued) {
        toast.success(`Queued ${data.queued_count} pending source${data.queued_count === 1 ? '' : 's'} for Hermes`)
      } else if (data.synthesis?.active) {
        toast.success('Hermes is already working through the pending Japan sources')
      } else {
        toast.success('There are no pending raw sources to synthesize')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start synthesis')
    } finally {
      setStartingSynthesis(false)
    }
  }

  const handleOpenSource = useCallback(async (citation) => {
    if (!citation?.relative_path || openingSourcePath) return

    setOpeningSourcePath(citation.relative_path)
    try {
      const source = await knowledgebaseApi.getSource(tripId, citation.relative_path)
      setSourcePreview({
        ...source,
        heading: citation.heading || null,
        title: citation.title || formatSourceTitle(source.relative_path),
        excerpt: citation.excerpt || '',
      })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to open source note')
    } finally {
      setOpeningSourcePath(null)
    }
  }, [openingSourcePath, toast, tripId])

  const handleOpenSourceReference = useCallback(async (reference) => {
    if (!sourcePreview?.relative_path || !reference || openingSourcePath) return

    setOpeningSourcePath(`reference:${reference}`)
    try {
      const source = await knowledgebaseApi.resolveSource(tripId, sourcePreview.relative_path, reference)
      setSourcePreview({
        ...source,
        heading: source.focus_heading || null,
        title: formatSourceTitle(source.relative_path),
        excerpt: '',
      })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to open related source note')
    } finally {
      setOpeningSourcePath(null)
    }
  }, [openingSourcePath, sourcePreview?.relative_path, toast, tripId])

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '2px solid var(--border-primary)',
          borderTopColor: 'var(--text-primary)',
          animation: 'kb-spin 0.8s linear infinite',
        }} />
        <style>{'@keyframes kb-spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    )
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid var(--border-faint)',
        background: 'var(--bg-card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: 'rgba(15,23,42,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
              }}>
                <Brain size={18} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Knowledgebase</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  Shared vault research with private chat history per trip member.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {statusChipsDisplay.map(chip => (
                <span key={chip} style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-faint)',
                  borderRadius: 999,
                  padding: '5px 10px',
                }}>
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {capabilities.can_upload && (
              <>
                <input ref={fileInputRef} type="file" accept=".md,text/markdown,text/plain" style={{ display: 'none' }} onChange={handleUpload} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || !config?.configured}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border-faint)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: uploading ? 'default' : 'pointer',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  <Upload size={15} />
                  {uploading ? 'Uploading...' : 'Upload .md'}
                </button>
              </>
            )}

            {capabilities.can_configure && (
              <>
                <button
                  onClick={handleReindex}
                  disabled={reindexing || !config?.configured}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border-faint)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: reindexing ? 'default' : 'pointer',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  <RefreshCw size={15} className={reindexing ? 'animate-spin' : ''} />
                  {reindexing ? 'Reindexing...' : 'Reindex'}
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: 'none',
                    background: 'var(--text-primary)',
                    color: 'var(--bg-card)',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontFamily: 'inherit',
                  }}
                >
                  <Settings2 size={15} />
                  Settings
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {config?.configured && synthesisSummary && (
        <div style={{ padding: '14px 18px 0' }}>
          <div style={{
            borderRadius: 16,
            border: synthesisTone === 'error'
              ? '1px solid rgba(185, 28, 28, 0.22)'
              : '1px solid var(--border-faint)',
            background: synthesisTone === 'active'
              ? 'rgba(15, 23, 42, 0.03)'
              : (synthesisTone === 'success' ? 'rgba(5, 150, 105, 0.08)' : 'var(--bg-card)'),
            padding: 16,
            display: 'grid',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {(synthesis?.active || startingSynthesis) ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {synthesisSummary.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)', maxWidth: 780 }}>
                  {synthesisSummary.body}
                </div>
              </div>

              {capabilities.can_synthesize && (synthesis?.pending_count > 0 || synthesis?.active) && (
                <button
                  onClick={() => handleStartSynthesis()}
                  disabled={startingSynthesis || synthesis?.active || synthesis?.pending_count < 1}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border-faint)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: (startingSynthesis || synthesis?.active || synthesis?.pending_count < 1) ? 'default' : 'pointer',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  {startingSynthesis ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  {synthesis?.active ? 'Synthesis running' : 'Synthesize pending'}
                </button>
              )}
            </div>

            {synthesis?.pending_files?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {synthesis.pending_files.slice(0, 4).map(file => (
                  <span key={file.relative_path} style={{
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-faint)',
                    borderRadius: 999,
                    padding: '5px 10px',
                  }}>
                    {file.file_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!config?.configured ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            maxWidth: 520,
            width: '100%',
            borderRadius: 18,
            border: '1px solid var(--border-faint)',
            background: 'var(--bg-card)',
            padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <ShieldCheck size={20} style={{ color: 'var(--text-primary)' }} />
              <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Knowledgebase not configured</h3>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
              {capabilities.can_configure
                ? 'Set the indexed wiki path, raw upload folder, provider, and model first. Then reindex the searchable notes.'
                : 'An admin still needs to connect the vault and provider keys before trip members can use this tab.'}
            </p>
            {capabilities.can_configure && (
              <button
                onClick={() => setShowSettings(true)}
                style={{
                  marginTop: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--text-primary)',
                  color: 'var(--bg-card)',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                <Settings2 size={15} />
                Open Settings
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}>
            {messages.length === 0 ? (
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 240,
              }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Brain size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Ask the vault something</div>
                  <div style={{ fontSize: 13 }}>Answers are grounded in indexed markdown from the shared Obsidian vault.</div>
                </div>
              </div>
            ) : (
              messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  currentSessionId={knowledgebaseSessionId}
                  onOpenSource={handleOpenSource}
                  openingSourcePath={openingSourcePath}
                />
              ))
            )}
          </div>

          <div style={{
            padding: '14px 18px 18px',
            borderTop: '1px solid var(--border-faint)',
            background: 'var(--bg-card)',
          }}>
            <div style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-end',
            }}>
              <textarea
                rows={2}
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleAsk()
                  }
                }}
                placeholder="Ask about the vault, trip research, notes, or anything already stored there..."
                style={{
                  flex: 1,
                  resize: 'none',
                  borderRadius: 16,
                  border: '1px solid var(--border-faint)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  padding: '12px 14px',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  lineHeight: 1.5,
                  minHeight: 54,
                }}
              />
              <button
                onClick={handleAsk}
                disabled={sending || !question.trim()}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  border: 'none',
                  background: question.trim() ? 'var(--text-primary)' : 'var(--border-primary)',
                  color: 'var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: question.trim() ? 'pointer' : 'default',
                }}
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />}
              </button>
            </div>
            {sending && (
              <div style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}>
                <Loader2 size={14} className="animate-spin" />
                Searching the vault and preparing a cited answer...
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Knowledgebase Settings"
        size="lg"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              API keys are configured in Admin settings and are shared server-side for every trip member. This form stores the trip's indexed search path, raw upload path, and provider choice.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border-faint)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--text-primary)',
                  color: 'var(--bg-card)',
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  cursor: savingConfig ? 'default' : 'pointer',
                }}
              >
                <Save size={15} />
                {savingConfig ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{
            borderRadius: 14,
            border: '1px solid var(--border-faint)',
            background: 'rgba(15,23,42,0.03)',
            padding: 14,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}>
            <FileText size={16} style={{ marginTop: 1, color: 'var(--text-primary)' }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Use the absolute filesystem paths from the server. Point the indexed path at the curated notes Nomad should search, and point the raw upload path at the markdown inbox Hermes should synthesize later.
            </div>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Indexed path</span>
            <input
              type="text"
              value={settingsForm.vault_path}
              onChange={event => setSettingsForm(prev => ({ ...prev, vault_path: event.target.value }))}
              placeholder="/path/to/your/obsidian-vault/wiki/japan"
              style={{
                borderRadius: 12,
                border: '1px solid var(--border-faint)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                padding: '10px 12px',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Raw upload path</span>
            <input
              type="text"
              value={settingsForm.upload_path}
              onChange={event => setSettingsForm(prev => ({ ...prev, upload_path: event.target.value }))}
              placeholder="/path/to/your/obsidian-vault/raw/japan"
              style={{
                borderRadius: 12,
                border: '1px solid var(--border-faint)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                padding: '10px 12px',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Provider</span>
              <select
                value={settingsForm.provider}
                onChange={event => setSettingsForm(prev => ({
                  ...prev,
                  provider: event.target.value,
                  model: event.target.value === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gemini-2.5-pro',
                }))}
                style={{
                  borderRadius: 12,
                  border: '1px solid var(--border-faint)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  padding: '10px 12px',
                  fontFamily: 'inherit',
                }}
              >
                <option value="gemini">Gemini</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Model</span>
              <input
                type="text"
                value={settingsForm.model}
                onChange={event => setSettingsForm(prev => ({ ...prev, model: event.target.value }))}
                placeholder={settingsForm.provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gemini-2.5-pro'}
                style={{
                  borderRadius: 12,
                  border: '1px solid var(--border-faint)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  padding: '10px 12px',
                  fontFamily: 'inherit',
                }}
              />
            </label>
          </div>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            border: '1px solid var(--border-faint)',
            borderRadius: 14,
            background: 'var(--bg-card)',
            padding: 14,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Allow uploads to raw/</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Trip members can upload markdown files directly into the configured vault upload folder.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settingsForm.allow_uploads}
              onChange={event => setSettingsForm(prev => ({ ...prev, allow_uploads: event.target.checked }))}
            />
          </label>

          <div style={{
            borderRadius: 14,
            border: '1px solid var(--border-faint)',
            background: 'var(--bg-secondary)',
            padding: 14,
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}>
            Saved API keys:
            {' '}
            Gemini {capabilities.has_gemini_key ? 'connected' : 'missing'}
            {' · '}
            Anthropic {capabilities.has_anthropic_key ? 'connected' : 'missing'}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!uploadPrompt}
        onClose={() => setUploadPrompt(null)}
        title="Upload complete"
        size="md"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => setUploadPrompt(null)}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid var(--border-faint)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Not now
            </button>
            <button
              onClick={() => handleStartSynthesis({ closePrompt: true })}
              disabled={startingSynthesis}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 12,
                border: 'none',
                background: 'var(--text-primary)',
                color: 'var(--bg-card)',
                fontFamily: 'inherit',
                fontWeight: 700,
                cursor: startingSynthesis ? 'default' : 'pointer',
              }}
            >
              {startingSynthesis ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Synthesize now
            </button>
          </div>
        )}
      >
        {uploadPrompt && (
          <div style={{ display: 'grid', gap: 12, color: 'var(--text-primary)' }}>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <strong>{uploadPrompt.fileName}</strong>
              {' '}
              was saved into the raw Japan inbox.
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
              Do you want Hermes to synthesize the pending Japan sources into the existing knowledgebase now? This will process all currently pending raw markdown files, not just the one you uploaded.
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-faint)',
              borderRadius: 12,
              padding: '10px 12px',
            }}>
              Pending raw sources: {uploadPrompt.pendingCount}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!sourcePreview}
        onClose={() => setSourcePreview(null)}
        title={sourcePreview?.title || 'Source Note'}
        size="2xl"
      >
        {sourcePreview && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{
              borderRadius: 14,
              border: '1px solid var(--border-faint)',
              background: 'var(--bg-secondary)',
              padding: 14,
              display: 'grid',
              gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                {sourcePreview.relative_path}
              </div>
              {sourcePreview.heading && sourcePreview.heading !== sourcePreview.title && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Focused section: {sourcePreview.heading}
                </div>
              )}
              {sourcePreview.excerpt && (
                <div style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-primary)',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-faint)',
                }}>
                  {sourcePreview.excerpt}
                </div>
              )}
            </div>

            <div style={{
              borderRadius: 14,
              border: '1px solid var(--border-faint)',
              background: 'var(--bg-card)',
              padding: 16,
              maxHeight: '55vh',
              overflow: 'auto',
            }}>
              <KnowledgebaseMarkdown
                tripId={tripId}
                sourcePath={sourcePreview.relative_path}
                content={sourcePreview.content}
                onOpenSourceReference={handleOpenSourceReference}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
