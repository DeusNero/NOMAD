import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ExternalLink, FileText, Loader2, RefreshCw, Save, SendHorizontal, Settings2, ShieldCheck, Upload } from 'lucide-react'
import { knowledgebaseApi } from '../../api/client'
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

function MessageBubble({ message, currentUserId, onOpenSource, openingSourcePath }) {
  const isOwn = message.role === 'user' && String(message.user_id) === String(currentUserId)

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
            }}>
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

  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState(null)
  const [capabilities, setCapabilities] = useState({})
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [openingSourcePath, setOpeningSourcePath] = useState(null)
  const [sourcePreview, setSourcePreview] = useState(null)
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

  useEffect(() => {
    loadState()
  }, [loadState])

  useEffect(() => {
    const handler = (event) => {
      if (String(event.tripId) !== String(tripId)) return

      if (event.type === 'knowledgebase:message:created' && event.message) {
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
  }, [tripId])

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
      toast.success(`Uploaded ${data.file.file_name}`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Markdown upload failed')
    } finally {
      setUploading(false)
      event.target.value = ''
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
        title: citation.title || source.relative_path,
        excerpt: citation.excerpt || '',
      })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to open source note')
    } finally {
      setOpeningSourcePath(null)
    }
  }, [openingSourcePath, toast, tripId])

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
                  Shared vault Q&A and markdown uploads for this trip.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {statusChips.map(chip => (
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
                ? 'Set the vault path, raw upload folder, provider, and model first. Then reindex the vault to make it searchable.'
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
                  currentUserId={user?.id}
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
              API keys are configured in Admin settings. This form only stores the trip vault path and provider choice.
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
              Use the absolute Mac paths from the server. For your current setup that means the vault root like <code>/Users/odin/projects/omega</code> and the upload folder inside it like <code>/Users/odin/projects/omega/raw</code>.
            </div>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Vault path</span>
            <input
              type="text"
              value={settingsForm.vault_path}
              onChange={event => setSettingsForm(prev => ({ ...prev, vault_path: event.target.value }))}
              placeholder="/Users/odin/projects/omega"
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
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Upload path</span>
            <input
              type="text"
              value={settingsForm.upload_path}
              onChange={event => setSettingsForm(prev => ({ ...prev, upload_path: event.target.value }))}
              placeholder="/Users/odin/projects/omega/raw"
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
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
