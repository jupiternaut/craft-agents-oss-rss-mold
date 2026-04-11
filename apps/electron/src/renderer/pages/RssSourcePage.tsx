import * as React from 'react'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { AlertCircle, ExternalLink, Languages, NotebookPen, RefreshCw, Search, SquareStack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { LoadedSource } from '../../shared/types'
import {
  buildArticlePrompt,
  extractRssMoldConfigPath,
  groupArticlesByDay,
  isRssMoldSource,
  parseFeedPayload,
  parseRssMoldConfig,
  resolveConfigPath,
  type RssMoldArticle,
  type RssMoldFeedDefinition,
  type RssMoldIssueGroup,
} from '@/lib/rss-mold'

interface RssSourcePageProps {
  source: LoadedSource
}

interface LoadState {
  configPath: string | null
  feeds: RssMoldFeedDefinition[]
  groups: RssMoldIssueGroup[]
  articles: RssMoldArticle[]
  errors: string[]
  generatedAt?: number
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'Undated'
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function SourceState({
  title,
  message,
  children,
}: {
  title: string
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[8px] bg-foreground/5 text-muted-foreground">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  )
}

function ArticleListItem({
  article,
  selected,
  onSelect,
}: {
  article: RssMoldArticle
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-[8px] border px-3 py-3 text-left transition-colors',
        selected
          ? 'border-foreground/20 bg-foreground/[0.04]'
          : 'border-transparent hover:border-border/80 hover:bg-foreground/[0.02]'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {article.feedTitle}
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(article.publishedAt)}</div>
      </div>
      <div className="mt-2 text-[15px] font-semibold leading-5 text-foreground">{article.title}</div>
      {article.summary ? (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary}</div>
      ) : null}
      {article.category ? (
        <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">{article.category}</div>
      ) : null}
    </button>
  )
}

export default function RssSourcePage({ source }: RssSourcePageProps) {
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>({
    configPath: null,
    feeds: [],
    groups: [],
    articles: [],
    errors: [],
  })
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  const loadFeedData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const homeDir = await window.electronAPI.getHomeDir()
      const rawConfigPath = extractRssMoldConfigPath(source)
      const configPath = resolveConfigPath(rawConfigPath, homeDir, source.folderPath)

      if (!configPath) {
        setState({
          configPath: null,
          feeds: [],
          groups: [],
          articles: [],
          errors: [],
        })
        setSelectedArticleId(null)
        return
      }

      const configText = await window.electronAPI.readFile(configPath)
      const feeds = parseRssMoldConfig(configText)

      const responses = await Promise.allSettled(
        feeds.map(async (feed) => {
          const text = await window.electronAPI.fetchRssFeedText(feed.url)
          return parseFeedPayload(feed, text)
        })
      )

      const errors: string[] = []
      const articles = responses.flatMap((result, index) => {
        if (result.status === 'fulfilled') return result.value
        errors.push(`${feeds[index]?.title || feeds[index]?.url || 'Feed'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
        return []
      }).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))

      const groups = groupArticlesByDay(articles)
      setState({
        configPath,
        feeds,
        groups,
        articles,
        errors,
        generatedAt: Date.now(),
      })
      setSelectedArticleId((current) => current && articles.some(article => article.id === current) ? current : (articles[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rss-mold data')
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    if (!isRssMoldSource(source)) return
    void loadFeedData()
  }, [loadFeedData, reloadToken, source])

  const filteredGroups = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase()
    if (!lowerQuery) return state.groups
    return state.groups
      .map((group) => ({
        ...group,
        articles: group.articles.filter((article) =>
          [article.title, article.feedTitle, article.summary, article.author, article.category]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .some(value => value.toLowerCase().includes(lowerQuery))
        ),
      }))
      .filter(group => group.articles.length > 0)
  }, [query, state.groups])

  const selectedArticle = useMemo(() => {
    const articles = filteredGroups.flatMap(group => group.articles)
    return articles.find(article => article.id === selectedArticleId)
      || state.articles.find(article => article.id === selectedArticleId)
      || articles[0]
      || state.articles[0]
      || null
  }, [filteredGroups, selectedArticleId, state.articles])

  useEffect(() => {
    if (selectedArticle && selectedArticle.id !== selectedArticleId) {
      setSelectedArticleId(selectedArticle.id)
    }
  }, [selectedArticle, selectedArticleId])

  const openAgentAction = useCallback((kind: 'translate' | 'document' | 'card') => {
    if (!selectedArticle) return
    navigate(routes.action.newSession({
      name:
        kind === 'translate'
          ? `Translate: ${selectedArticle.title}`
          : kind === 'document'
            ? `Document: ${selectedArticle.title}`
            : `Card: ${selectedArticle.title}`,
      input: buildArticlePrompt(kind, selectedArticle),
    }))
  }, [selectedArticle])

  const articleCount = state.articles.length

  if (!isRssMoldSource(source)) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PanelHeader
        title={source.config.name}
        actions={(
          <div className="flex items-center gap-2">
            {state.configPath && canRevealLocally ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.electronAPI.showInFolder(state.configPath!)}
              >
                Open Config
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken(token => token + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        )}
      />

      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-start gap-3">
          <SourceAvatar source={source} fluid />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Private paper</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {loading ? 'Refreshing feed river...' : `${articleCount} stories from ${state.feeds.length} feeds`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {state.generatedAt ? `Updated ${formatTimestamp(state.generatedAt)}` : 'Ready to read inside Craft Agents'}
            </div>
          </div>
        </div>
        {state.errors.length > 0 ? (
          <div className="mt-3 rounded-[8px] border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-muted-foreground">
            {state.errors.length} feed{state.errors.length === 1 ? '' : 's'} could not be loaded. The rest of the paper is still usable.
          </div>
        ) : null}
      </div>

      {!state.configPath && !loading ? (
        <SourceState
          title="No rss-mold config found"
          message="This source looks like rss-mold, but Craft Agents could not find a readable config path. Add --config ~/craft-rss-mold.json to the MCP args, or set RSS_MOLD_CONFIG in the source env."
        />
      ) : null}

      {state.configPath && error ? (
        <SourceState
          title="Could not load the paper"
          message={error}
        >
          <Button variant="outline" onClick={() => setReloadToken(token => token + 1)}>
            Try again
          </Button>
        </SourceState>
      ) : null}

      {state.configPath && !error ? (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={38} minSize={28}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border/50 px-4 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search this paper"
                    className="h-9 w-full rounded-[8px] border border-border/60 bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/20"
                  />
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 px-4 py-4">
                  {loading ? (
                    <div className="space-y-3">
                      {[0, 1, 2, 3].map(index => (
                        <div key={index} className="rounded-[8px] border border-border/50 px-3 py-3">
                          <div className="h-3 w-24 rounded bg-foreground/8" />
                          <div className="mt-3 h-4 w-4/5 rounded bg-foreground/10" />
                          <div className="mt-2 h-3 w-full rounded bg-foreground/6" />
                          <div className="mt-1 h-3 w-2/3 rounded bg-foreground/6" />
                        </div>
                      ))}
                    </div>
                  ) : filteredGroups.length > 0 ? (
                    filteredGroups.map(group => (
                      <section key={group.id}>
                        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{group.label}</div>
                        <div className="space-y-2">
                          {group.articles.map(article => (
                            <ArticleListItem
                              key={article.id}
                              article={article}
                              selected={selectedArticle?.id === article.id}
                              onSelect={() => setSelectedArticleId(article.id)}
                            />
                          ))}
                        </div>
                      </section>
                    ))
                  ) : (
                    <div className="py-10 text-sm text-muted-foreground">No stories matched this search.</div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize={62} minSize={36}>
            <div className="flex h-full min-h-0 flex-col">
              {selectedArticle ? (
                <>
                  <div className="border-b border-border/50 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      <span>{selectedArticle.feedTitle}</span>
                      {selectedArticle.author ? <span>{selectedArticle.author}</span> : null}
                      <span>{formatTimestamp(selectedArticle.publishedAt)}</span>
                    </div>
                    <h1 className="mt-3 max-w-3xl text-2xl font-semibold leading-tight text-foreground">
                      {selectedArticle.title}
                    </h1>
                    {selectedArticle.summary ? (
                      <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
                        {selectedArticle.summary}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openAgentAction('translate')}>
                        <Languages className="h-3.5 w-3.5" />
                        Translate
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openAgentAction('document')}>
                        <NotebookPen className="h-3.5 w-3.5" />
                        To Doc
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openAgentAction('card')}>
                        <SquareStack className="h-3.5 w-3.5" />
                        To Card
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.electronAPI.openUrl(selectedArticle.url)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open original
                      </Button>
                    </div>
                  </div>

                  <ScrollArea className="min-h-0 flex-1">
                    <div className="mx-auto flex w-full max-w-3xl flex-col px-5 py-6">
                      {selectedArticle.imageUrl ? (
                        <img
                          src={selectedArticle.imageUrl}
                          alt={selectedArticle.title}
                          className="mb-6 aspect-[16/9] w-full rounded-[8px] object-cover"
                        />
                      ) : null}

                      {selectedArticle.body.length > 0 ? (
                        selectedArticle.body.map((paragraph, index) => (
                          <p key={`${selectedArticle.id}-${index}`} className="mb-5 text-[15px] leading-8 text-foreground/90">
                            {paragraph}
                          </p>
                        ))
                      ) : (
                        <p className="text-[15px] leading-8 text-muted-foreground">
                          This story does not expose readable body text in the feed. Use Open original to continue in the browser, or send it to the agent for capture.
                        </p>
                      )}

                      <Separator className="my-4" />

                      <div className="text-sm text-muted-foreground">
                        Source URL:{' '}
                        <button
                          type="button"
                          className="text-foreground hover:underline"
                          onClick={() => window.electronAPI.openUrl(selectedArticle.url)}
                        >
                          {selectedArticle.url}
                        </button>
                      </div>
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <SourceState
                  title="No stories yet"
                  message="Once the configured feeds return items, they will appear here with a reader-first layout."
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : null}
    </div>
  )
}
