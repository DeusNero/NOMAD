import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileImage, Loader2 } from 'lucide-react'
import { knowledgebaseApi } from '../../api/client'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)(?:[?#].*)?$/i
const INLINE_TOKEN_REGEX = /!\[\[([^[\]\n]+)\]\]|!\[([^\]]*)\]\(([^)]+)\)|\[\[([^[\]\n]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g
const STANDALONE_OBSIDIAN_IMAGE_REGEX = /^!\[\[([^[\]\n]+)\]\]$/
const STANDALONE_MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)$/
const STANDALONE_RAW_URL_REGEX = /^["'<(]*?(https?:\/\/[^\s"'<>]+)["')>]*$/

function isExternalUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function normalizeReference(reference) {
  return String(reference || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
}

function isImageReference(value) {
  return IMAGE_EXTENSIONS.test(normalizeReference(value))
}

function parseWikiReference(reference) {
  const cleaned = normalizeReference(reference)
    .replace(/^!\[\[|\[\[/, '')
    .replace(/\]\]$/, '')

  const [targetPart, aliasPart] = cleaned.split('|')
  const target = normalizeReference(targetPart || '')
  const label = normalizeReference(aliasPart || '') || target

  return { target, label }
}

function isLikelyNoteReference(reference) {
  const parsed = parseWikiReference(reference)
  const target = (parsed.target || '').split('#')[0].trim()
  if (!target || isExternalUrl(target)) return false

  const lastSegment = target.split('/').pop() || ''
  const extMatch = lastSegment.match(/\.([a-z0-9]+)$/i)
  return !extMatch || extMatch[1].toLowerCase() === 'md'
}

function buildLinkLabel(reference) {
  const parsed = parseWikiReference(reference)
  const target = parsed.target || ''
  const withoutHeading = target.split('#')[0]
  const basename = withoutHeading.split('/').pop() || withoutHeading
  const pretty = basename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim()
  return parsed.label || pretty || target
}

function parseImageBlock(line) {
  const trimmed = String(line || '').trim()
  const obsidianMatch = trimmed.match(STANDALONE_OBSIDIAN_IMAGE_REGEX)
  if (obsidianMatch) {
    const { target, label } = parseWikiReference(obsidianMatch[1])
    if (isImageReference(target)) {
      return { reference: target, alt: label === target ? '' : label }
    }
  }

  const markdownMatch = trimmed.match(STANDALONE_MARKDOWN_IMAGE_REGEX)
  if (markdownMatch) {
    const reference = normalizeReference(markdownMatch[2])
    if (isImageReference(reference)) {
      return {
        reference,
        alt: markdownMatch[1] || '',
      }
    }
  }

  const rawUrlMatch = trimmed.match(STANDALONE_RAW_URL_REGEX)
  if (rawUrlMatch) {
    const reference = normalizeReference(rawUrlMatch[1])
    if (isImageReference(reference)) {
      return {
        reference,
        alt: '',
      }
    }
  }

  return null
}

function AssetImage({ tripId, sourcePath, reference, alt = '' }) {
  const normalizedReference = normalizeReference(reference)
  const externalImage = isExternalUrl(normalizedReference)
  const [src, setSrc] = useState(externalImage ? normalizedReference : null)
  const [loading, setLoading] = useState(!externalImage)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!normalizedReference) {
      setSrc(null)
      setLoading(false)
      setError('')
      return undefined
    }

    if (externalImage) {
      setSrc(normalizedReference)
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
  }, [externalImage, normalizedReference, sourcePath, tripId])

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
        display: 'grid',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border-faint)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FileImage size={14} />
          {error || `Image not available: ${normalizedReference}`}
        </div>
        {externalImage && (
          <a
            href={normalizedReference}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--text-primary)' }}
          >
            Open image directly
          </a>
        )}
      </div>
    )
  }

  return (
    <figure style={{ margin: '16px 0', display: 'grid', gap: 8 }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          setError(`Could not load image: ${normalizedReference}`)
          setSrc(null)
        }}
        style={{
          width: '100%',
          maxHeight: 420,
          objectFit: 'contain',
          borderRadius: 14,
          border: '1px solid var(--border-faint)',
          background: 'var(--bg-secondary)',
        }}
      />
      {(alt || normalizedReference) && (
        <figcaption style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-word' }}>
          {alt || normalizedReference}
        </figcaption>
      )}
    </figure>
  )
}

function ResolvedLink({ tripId, sourcePath, href, onOpenSourceReference, children }) {
  const normalizedHref = normalizeReference(href)
  const external = isExternalUrl(normalizedHref)
  const noteReference = !external && isLikelyNoteReference(normalizedHref)

  const handleClick = async (event) => {
    if (external) return

    event.preventDefault()

    if (noteReference && onOpenSourceReference) {
      onOpenSourceReference(normalizedHref)
      return
    }

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
      href={external ? normalizedHref : '#'}
      onClick={handleClick}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      style={{
        color: 'var(--text-primary)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--border-primary)',
        textUnderlineOffset: 2,
        wordBreak: 'break-word',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'baseline' }}>
        {children}
        <ExternalLink size={12} />
      </span>
    </a>
  )
}

function renderInlineContent(tripId, sourcePath, text, keyPrefix, onOpenSourceReference) {
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

    if (match[1]) {
      const { target, label } = parseWikiReference(match[1])
      if (isImageReference(target)) {
        parts.push(
          <ResolvedLink
            key={`${keyPrefix}-obsidian-image-link-${matchIndex}`}
            tripId={tripId}
            sourcePath={sourcePath}
            href={target}
            onOpenSourceReference={onOpenSourceReference}
          >
            {label || buildLinkLabel(target)}
          </ResolvedLink>
        )
      } else {
        parts.push(
          <ResolvedLink
            key={`${keyPrefix}-obsidian-link-${matchIndex}`}
            tripId={tripId}
            sourcePath={sourcePath}
            href={target}
            onOpenSourceReference={onOpenSourceReference}
          >
            {label || buildLinkLabel(target)}
          </ResolvedLink>
        )
      }
    } else if (match[3]) {
      const reference = normalizeReference(match[3])
      if (isImageReference(reference)) {
        parts.push(
          <ResolvedLink
            key={`${keyPrefix}-markdown-image-link-${matchIndex}`}
            tripId={tripId}
            sourcePath={sourcePath}
            href={reference}
            onOpenSourceReference={onOpenSourceReference}
          >
            {match[2] || reference}
          </ResolvedLink>
        )
      } else {
        parts.push(
          <ResolvedLink
            key={`${keyPrefix}-markdown-link-${matchIndex}`}
            tripId={tripId}
            sourcePath={sourcePath}
            href={reference}
            onOpenSourceReference={onOpenSourceReference}
          >
            {match[2]}
          </ResolvedLink>
        )
      }
    } else if (match[4]) {
      const { target, label } = parseWikiReference(match[4])
      parts.push(
        <ResolvedLink
          key={`${keyPrefix}-wiki-link-${matchIndex}`}
          tripId={tripId}
          sourcePath={sourcePath}
          href={target}
          onOpenSourceReference={onOpenSourceReference}
        >
          {label || buildLinkLabel(target)}
        </ResolvedLink>
      )
    } else if (match[6]) {
      parts.push(
        <ResolvedLink
          key={`${keyPrefix}-markdown-target-${matchIndex}`}
          tripId={tripId}
          sourcePath={sourcePath}
          href={match[6]}
          onOpenSourceReference={onOpenSourceReference}
        >
          {match[5]}
        </ResolvedLink>
      )
    } else if (match[7]) {
      parts.push(
        <ResolvedLink
          key={`${keyPrefix}-raw-url-${matchIndex}`}
          tripId={tripId}
          sourcePath={sourcePath}
          href={match[7]}
          onOpenSourceReference={onOpenSourceReference}
        >
          {match[7]}
        </ResolvedLink>
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
  let currentHeading = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim(), heading: currentHeading })
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
      currentHeading = headingMatch[2].trim()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: currentHeading,
      })
      continue
    }

    const imageBlock = parseImageBlock(trimmed)
    if (imageBlock) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'image',
        heading: currentHeading,
        ...imageBlock,
      })
      continue
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      if (!list || list.ordered) {
        flushList()
        list = { type: 'list', ordered: false, items: [], heading: currentHeading }
      }
      list.items.push(bulletMatch[1].trim())
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (!list || !list.ordered) {
        flushList()
        list = { type: 'list', ordered: true, items: [], heading: currentHeading }
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

function renderRelatedPageItem(tripId, sourcePath, item, key, onOpenSourceReference) {
  const trimmed = String(item || '').trim()
  const rawUrlMatch = trimmed.match(STANDALONE_RAW_URL_REGEX)
  const relatedHref = rawUrlMatch ? rawUrlMatch[1] : trimmed

  return (
    <ResolvedLink
      key={key}
      tripId={tripId}
      sourcePath={sourcePath}
      href={relatedHref}
      onOpenSourceReference={onOpenSourceReference}
    >
      {buildLinkLabel(trimmed)}
    </ResolvedLink>
  )
}

export default function KnowledgebaseMarkdown({ tripId, sourcePath, content, onOpenSourceReference }) {
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
          const relatedPages = /related pages/i.test(String(block.heading || ''))
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
                  {relatedPages && isLikelyNoteReference(item)
                    ? renderRelatedPageItem(
                      tripId,
                      sourcePath,
                      item,
                      `list-${index}-related-${itemIndex}`,
                      onOpenSourceReference
                    )
                    : renderInlineContent(
                      tripId,
                      sourcePath,
                      item,
                      `list-${index}-${itemIndex}`,
                      onOpenSourceReference
                    )}
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
            {renderInlineContent(
              tripId,
              sourcePath,
              block.text,
              `paragraph-${index}`,
              onOpenSourceReference
            )}
          </p>
        )
      })}
    </div>
  )
}
