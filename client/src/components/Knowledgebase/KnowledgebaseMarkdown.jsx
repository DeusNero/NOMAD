import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileImage, Loader2 } from 'lucide-react'
import { knowledgebaseApi } from '../../api/client'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/i
const INLINE_TOKEN_REGEX = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)/g
const STANDALONE_OBSIDIAN_IMAGE_REGEX = /^!\[\[([^[\]\n]+)\]\]$/
const STANDALONE_MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)$/

function isExternalUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function isImageReference(value) {
  return IMAGE_EXTENSIONS.test(String(value || ''))
}

function normalizeReference(reference) {
  return String(reference || '').trim().replace(/^<|>$/g, '')
}

function parseImageBlock(line) {
  const trimmed = String(line || '').trim()
  const obsidianMatch = trimmed.match(STANDALONE_OBSIDIAN_IMAGE_REGEX)
  if (obsidianMatch) {
    const reference = normalizeReference(obsidianMatch[1].split('|')[0])
    if (isImageReference(reference)) {
      return { reference, alt: reference }
    }
  }

  const markdownMatch = trimmed.match(STANDALONE_MARKDOWN_IMAGE_REGEX)
  if (markdownMatch) {
    return {
      reference: normalizeReference(markdownMatch[2]),
      alt: markdownMatch[1] || '',
    }
  }

  return null
}

function AssetImage({ tripId, sourcePath, reference, alt = '' }) {
  const normalizedReference = normalizeReference(reference)
  const [src, setSrc] = useState(isExternalUrl(normalizedReference) ? normalizedReference : null)
  const [loading, setLoading] = useState(!isExternalUrl(normalizedReference))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!normalizedReference || isExternalUrl(normalizedReference)) {
      setSrc(normalizedReference || null)
      setLoading(false)
      setError('')
      return undefined
    }

    let active = true
    let objectUrl = null

    setLoading(true)
    setError('')

    knowledgebaseApi.getAssetBlob(tripId, sourcePath, normalizedReference)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!active) return
        setError(`Could not load image: ${normalizedReference}`)
        setSrc(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [normalizedReference, sourcePath, tripId])

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border-faint)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}>
        <Loader2 size={14} className="animate-spin" />
        Loading image...
      </div>
    )
  }

  if (!src) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border-faint)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}>
        <FileImage size={14} />
        {error || `Image not available: ${normalizedReference}`}
      </div>
    )
  }

  return (
    <figure style={{ margin: '16px 0', display: 'grid', gap: 8 }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: '100%',
          maxHeight: 360,
          objectFit: 'contain',
          borderRadius: 14,
          border: '1px solid var(--border-faint)',
          background: 'var(--bg-secondary)',
        }}
      />
      {alt && (
        <figcaption style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {alt}
        </figcaption>
      )}
    </figure>
  )
}

function AssetLink({ tripId, sourcePath, href, children }) {
  const normalizedHref = normalizeReference(href)

  const handleClick = async (event) => {
    if (isExternalUrl(normalizedHref)) return

    event.preventDefault()
    try {
      const blob = await knowledgebaseApi.getAssetBlob(tripId, sourcePath, normalizedHref)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // Keep the source viewer usable even if an attachment cannot be fetched.
    }
  }

  return (
    <a
      href={isExternalUrl(normalizedHref) ? normalizedHref : '#'}
      onClick={handleClick}
      target="_blank"
      rel="noreferrer"
      style={{
        color: 'var(--text-primary)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--border-primary)',
        textUnderlineOffset: 2,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        <ExternalLink size={12} />
      </span>
    </a>
  )
}

function renderInlineContent(tripId, sourcePath, text, keyPrefix) {
  const input = String(text || '')
  const parts = []
  let lastIndex = 0
  let match = null
  let matchIndex = 0

  INLINE_TOKEN_REGEX.lastIndex = 0

  while ((match = INLINE_TOKEN_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      parts.push(input.slice(lastIndex, match.index))
    }

    if (match[2]) {
      parts.push(
        <AssetLink
          key={`${keyPrefix}-link-${matchIndex}`}
          tripId={tripId}
          sourcePath={sourcePath}
          href={match[2]}
        >
          {match[1]}
        </AssetLink>
      )
    } else if (match[3]) {
      parts.push(
        <AssetLink
          key={`${keyPrefix}-url-${matchIndex}`}
          tripId={tripId}
          sourcePath={sourcePath}
          href={match[3]}
        >
          {match[3]}
        </AssetLink>
      )
    }

    lastIndex = INLINE_TOKEN_REGEX.lastIndex
    matchIndex += 1
  }

  if (lastIndex < input.length) {
    parts.push(input.slice(lastIndex))
  }

  return parts.map((part, index) => (
    typeof part === 'string'
      ? <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
      : part
  ))
}

function buildBlocks(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let paragraph = []
  let list = null
  let codeFence = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
    paragraph = []
  }

  const flushList = () => {
    if (!list?.items?.length) return
    blocks.push(list)
    list = null
  }

  const flushCodeFence = () => {
    if (!codeFence) return
    blocks.push(codeFence)
    codeFence = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushList()
      if (codeFence) {
        flushCodeFence()
      } else {
        codeFence = {
          type: 'code',
          language: trimmed.slice(3).trim(),
          text: '',
        }
      }
      continue
    }

    if (codeFence) {
      codeFence.text += `${codeFence.text ? '\n' : ''}${line}`
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      })
      continue
    }

    const imageBlock = parseImageBlock(trimmed)
    if (imageBlock) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'image',
        ...imageBlock,
      })
      continue
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      if (!list || list.ordered) {
        flushList()
        list = { type: 'list', ordered: false, items: [] }
      }
      list.items.push(bulletMatch[1].trim())
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (!list || !list.ordered) {
        flushList()
        list = { type: 'list', ordered: true, items: [] }
      }
      list.items.push(orderedMatch[1].trim())
      continue
    }

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  flushCodeFence()

  return blocks
}

export default function KnowledgebaseMarkdown({ tripId, sourcePath, content }) {
  const blocks = useMemo(() => buildBlocks(content), [content])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const HeadingTag = `h${Math.min(block.level + 1, 6)}`
          return (
            <HeadingTag
              key={`heading-${index}`}
              style={{
                margin: 0,
                color: 'var(--text-primary)',
                fontSize: Math.max(16, 24 - (block.level * 2)),
                lineHeight: 1.3,
              }}
            >
              {block.text}
            </HeadingTag>
          )
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag
              key={`list-${index}`}
              style={{
                margin: 0,
                paddingLeft: 20,
                color: 'var(--text-primary)',
                display: 'grid',
                gap: 8,
              }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`list-${index}-item-${itemIndex}`} style={{ lineHeight: 1.7 }}>
                  {renderInlineContent(tripId, sourcePath, item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          )
        }

        if (block.type === 'code') {
          return (
            <pre
              key={`code-${index}`}
              style={{
                margin: 0,
                padding: 14,
                borderRadius: 14,
                border: '1px solid var(--border-faint)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                overflowX: 'auto',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <code>{block.text}</code>
            </pre>
          )
        }

        if (block.type === 'image') {
          return (
            <AssetImage
              key={`image-${index}`}
              tripId={tripId}
              sourcePath={sourcePath}
              reference={block.reference}
              alt={block.alt}
            />
          )
        }

        return (
          <p
            key={`paragraph-${index}`}
            style={{
              margin: 0,
              color: 'var(--text-primary)',
              fontSize: 13,
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}
          >
            {renderInlineContent(tripId, sourcePath, block.text, `paragraph-${index}`)}
          </p>
        )
      })}
    </div>
  )
}
