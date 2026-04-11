import type { LoadedSource } from '../../shared/types'

export interface RssMoldFeedDefinition {
  id: string
  title: string
  url: string
  category?: string
}

export interface RssMoldArticle {
  id: string
  title: string
  url: string
  feedTitle: string
  feedUrl: string
  summary: string
  body: string[]
  author?: string
  imageUrl?: string
  publishedAt?: number
  category?: string
}

export interface RssMoldIssueGroup {
  id: string
  label: string
  articles: RssMoldArticle[]
}

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function textSnippet(value: string, maxLength = 220): string {
  const clean = normalizeWhitespace(value)
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`
}

function looksLikeUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'feed'
}

function getHostLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function isRssMoldSource(source: LoadedSource | null | undefined): boolean {
  if (!source) return false
  if (source.config.provider?.toLowerCase() === 'rss-mold') return true

  const command = source.config.mcp?.command?.toLowerCase() ?? ''
  const args = (source.config.mcp?.args ?? []).map(arg => arg.toLowerCase())

  return command.includes('rss-mold') || args.some(arg => arg.includes('rss-mold'))
}

export function extractRssMoldConfigPath(source: LoadedSource): string | null {
  const envPath = source.config.mcp?.env?.RSS_MOLD_CONFIG
  if (envPath) return envPath

  const args = source.config.mcp?.args ?? []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--config' || arg === '-c') {
      return args[i + 1] ?? null
    }
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length)
    }
  }

  return null
}

export function resolveConfigPath(rawPath: string | null, homeDir: string, sourceFolder: string): string | null {
  if (!rawPath) return null
  if (rawPath.startsWith('~/')) return `${homeDir}${rawPath.slice(1)}`
  if (rawPath === '~') return homeDir
  if (rawPath.startsWith('/')) return rawPath
  return `${sourceFolder}/${rawPath}`
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function getCandidateUrl(record: Record<string, unknown>): string | null {
  const keys = ['url', 'feedUrl', 'feedURL', 'xmlUrl', 'xmlURL', 'href', 'source']
  for (const key of keys) {
    const value = record[key]
    if (looksLikeUrl(value)) return value.trim()
  }
  return null
}

function getCandidateTitle(record: Record<string, unknown>, fallbackUrl: string): string {
  const keys = ['title', 'name', 'label']
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return getHostLabel(fallbackUrl)
}

function getCandidateCategory(record: Record<string, unknown>, inheritedCategory?: string): string | undefined {
  const keys = ['category', 'group', 'section', 'folder']
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return inheritedCategory
}

function collectFeedDefinitions(value: unknown, inheritedCategory?: string, output: RssMoldFeedDefinition[] = []): RssMoldFeedDefinition[] {
  if (Array.isArray(value)) {
    value.forEach(item => collectFeedDefinitions(item, inheritedCategory, output))
    return output
  }

  if (looksLikeUrl(value)) {
    output.push({
      id: slugify(value),
      title: getHostLabel(value),
      url: value.trim(),
      category: inheritedCategory,
    })
    return output
  }

  const record = getObjectRecord(value)
  if (!record) return output

  const disabled = record.enabled === false || record.disabled === true
  if (disabled) return output

  const category = getCandidateCategory(record, inheritedCategory)
  const url = getCandidateUrl(record)
  if (url) {
    output.push({
      id: slugify(`${category ?? ''}-${url}`),
      title: getCandidateTitle(record, url),
      url,
      category,
    })
  }

  const nestedKeys = ['feeds', 'subscriptions', 'sources', 'items', 'groups', 'sections']
  nestedKeys.forEach((key) => {
    if (key in record) collectFeedDefinitions(record[key], category, output)
  })

  return output
}

export function parseRssMoldConfig(rawConfig: string): RssMoldFeedDefinition[] {
  const parsed = JSON.parse(rawConfig) as unknown
  const candidates = collectFeedDefinitions(parsed)
  const deduped = new Map<string, RssMoldFeedDefinition>()

  candidates.forEach((feed) => {
    if (!looksLikeUrl(feed.url)) return
    if (!deduped.has(feed.url)) {
      deduped.set(feed.url, {
        ...feed,
        title: feed.title || getHostLabel(feed.url),
      })
    }
  })

  return [...deduped.values()]
}

function htmlToTextAndImage(html: string | null | undefined): { text: string; paragraphs: string[]; imageUrl?: string } {
  if (!html) return { text: '', paragraphs: [] }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imageUrl = doc.querySelector('img')?.getAttribute('src') || undefined
  const paragraphs = Array.from(doc.querySelectorAll('p'))
    .map(node => normalizeWhitespace(node.textContent))
    .filter(Boolean)

  const fallbackText = normalizeWhitespace(doc.body.textContent)
  const text = paragraphs.length > 0 ? paragraphs.join('\n\n') : fallbackText
  const clipped = text.slice(0, 12_000)

  return {
    text: clipped,
    paragraphs: (paragraphs.length > 0 ? paragraphs : clipped.split(/\n{2,}/)).slice(0, 18),
    imageUrl,
  }
}

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseRssItems(feed: RssMoldFeedDefinition, xml: string): RssMoldArticle[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Feed XML could not be parsed')
  }

  const channelTitle = normalizeWhitespace(doc.querySelector('channel > title')?.textContent) || feed.title
  const items = Array.from(doc.querySelectorAll('item'))

  return items.map((item, index) => {
    const title = normalizeWhitespace(item.querySelector('title')?.textContent) || `Untitled story ${index + 1}`
    const url = normalizeWhitespace(item.querySelector('link')?.textContent)
    const guid = normalizeWhitespace(item.querySelector('guid')?.textContent)
    const description = item.querySelector('description')?.textContent || ''
    const contentEncoded = item.getElementsByTagName('content:encoded')[0]?.textContent || ''
    const author = normalizeWhitespace(
      item.querySelector('author')?.textContent ||
      item.getElementsByTagName('dc:creator')[0]?.textContent
    ) || undefined
    const enclosureUrl = item.querySelector('enclosure')?.getAttribute('url') || undefined
    const mediaUrl =
      item.getElementsByTagName('media:content')[0]?.getAttribute('url') ||
      item.getElementsByTagName('media:thumbnail')[0]?.getAttribute('url') ||
      undefined

    const htmlPayload = contentEncoded || description
    const content = htmlToTextAndImage(htmlPayload)
    const summary = textSnippet(content.text || description)

    return {
      id: guid || url || `${feed.id}-${index}`,
      title,
      url: url || feed.url,
      feedTitle: channelTitle,
      feedUrl: feed.url,
      summary,
      body: content.paragraphs.filter(Boolean),
      author,
      imageUrl: enclosureUrl || mediaUrl || content.imageUrl,
      publishedAt: parseDate(item.querySelector('pubDate')?.textContent),
      category: feed.category,
    }
  }).filter(article => article.url)
}

function parseAtomItems(feed: RssMoldFeedDefinition, xml: string): RssMoldArticle[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Feed XML could not be parsed')
  }

  const feedTitle = normalizeWhitespace(doc.querySelector('feed > title')?.textContent) || feed.title
  const entries = Array.from(doc.querySelectorAll('entry'))

  return entries.map((entry, index) => {
    const title = normalizeWhitespace(entry.querySelector('title')?.textContent) || `Untitled story ${index + 1}`
    const linkNode = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link')
    const url = linkNode?.getAttribute('href') || ''
    const contentValue = entry.querySelector('content')?.textContent || entry.querySelector('summary')?.textContent || ''
    const content = htmlToTextAndImage(contentValue)
    const summary = textSnippet(content.text)

    return {
      id: normalizeWhitespace(entry.querySelector('id')?.textContent) || url || `${feed.id}-${index}`,
      title,
      url: url || feed.url,
      feedTitle,
      feedUrl: feed.url,
      summary,
      body: content.paragraphs.filter(Boolean),
      author: normalizeWhitespace(entry.querySelector('author > name')?.textContent) || undefined,
      imageUrl: content.imageUrl,
      publishedAt: parseDate(
        entry.querySelector('published')?.textContent || entry.querySelector('updated')?.textContent
      ),
      category: feed.category,
    }
  }).filter(article => article.url)
}

function parseJsonFeed(feed: RssMoldFeedDefinition, text: string): RssMoldArticle[] {
  const parsed = JSON.parse(text) as Record<string, unknown>
  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : feed.title
  const items = Array.isArray(parsed.items) ? parsed.items : []

  return items.map<RssMoldArticle | null>((rawItem, index) => {
    const item = getObjectRecord(rawItem)
    if (!item) return null

    const url = looksLikeUrl(item.url) ? item.url : looksLikeUrl(item.external_url) ? item.external_url : feed.url
    const content = htmlToTextAndImage(
      (typeof item.content_html === 'string' ? item.content_html : '') ||
      (typeof item.summary === 'string' ? item.summary : '')
    )
    const textBody = typeof item.content_text === 'string' ? item.content_text : content.text
    const summary = textSnippet(textBody)

    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${feed.id}-${index}`,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Untitled story ${index + 1}`,
      url,
      feedTitle: title,
      feedUrl: feed.url,
      summary,
      body: (content.paragraphs.length > 0 ? content.paragraphs : textBody.split(/\n{2,}/))
        .map(paragraph => normalizeWhitespace(paragraph))
        .filter(Boolean)
        .slice(0, 18),
      author: (() => {
        const authors = Array.isArray(item.authors) ? item.authors : []
        const firstAuthor = getObjectRecord(authors[0])
        return typeof firstAuthor?.name === 'string' && firstAuthor.name.trim() ? firstAuthor.name.trim() : undefined
      })(),
      imageUrl: typeof item.image === 'string' ? item.image : content.imageUrl,
      publishedAt: parseDate(
        typeof item.date_published === 'string' ? item.date_published : typeof item.date_modified === 'string' ? item.date_modified : undefined
      ),
      category: feed.category,
    }
  }).filter((article): article is RssMoldArticle => article !== null)
}

export function parseFeedPayload(feed: RssMoldFeedDefinition, text: string): RssMoldArticle[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('{')) {
    return parseJsonFeed(feed, trimmed)
  }

  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  const root = doc.documentElement.localName.toLowerCase()
  if (root === 'feed') return parseAtomItems(feed, trimmed)
  return parseRssItems(feed, trimmed)
}

function dayLabel(timestamp: number | undefined): string {
  if (!timestamp) return 'Undated'

  const now = new Date()
  const date = new Date(timestamp)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const subject = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((today - subject) / 86_400_000)

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function groupArticlesByDay(articles: RssMoldArticle[]): RssMoldIssueGroup[] {
  const grouped = new Map<string, RssMoldArticle[]>()

  articles.forEach((article) => {
    const label = dayLabel(article.publishedAt)
    const list = grouped.get(label) ?? []
    list.push(article)
    grouped.set(label, list)
  })

  return [...grouped.entries()].map(([label, items]) => ({
    id: slugify(label),
    label,
    articles: items.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
  }))
}

export function buildArticlePrompt(kind: 'translate' | 'document' | 'card', article: RssMoldArticle): string {
  const context = [
    `Title: ${article.title}`,
    `Source: ${article.feedTitle}`,
    `URL: ${article.url}`,
    article.author ? `Author: ${article.author}` : null,
    article.summary ? `Summary: ${article.summary}` : null,
    article.body.length > 0 ? `Excerpt:\n${article.body.join('\n\n')}` : null,
  ].filter(Boolean).join('\n')

  if (kind === 'translate') {
    return [
      'Translate this article into Chinese.',
      'Keep names, products, and links accurate, and preserve the tone without turning it into marketing copy.',
      '',
      context,
    ].join('\n')
  }

  if (kind === 'document') {
    return [
      'Turn this article into a Craft-style document.',
      'Use a strong title, a short opening summary, 3-5 key ideas, and a closing "Why it matters" section.',
      'Keep the source URL visible in the document.',
      '',
      context,
    ].join('\n')
  }

  return [
    'Turn this article into a compact knowledge card.',
    'Return: title, source, one-sentence summary, key insight, tags, and one follow-up question.',
    '',
    context,
  ].join('\n')
}
