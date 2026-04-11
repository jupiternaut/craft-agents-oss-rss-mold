import { describe, expect, it } from 'bun:test'
import type { LoadedSource } from '../../../shared/types'
import {
  buildArticlePrompt,
  extractRssMoldConfigPath,
  isRssMoldSource,
  parseFeedPayload,
  parseRssMoldConfig,
  resolveConfigPath,
} from '../rss-mold'

function createSource(overrides?: Partial<LoadedSource['config']>): LoadedSource {
  return {
    workspaceId: 'workspace-1',
    folderPath: '/tmp/rss-mold-source',
    config: {
      slug: 'rss-mold',
      name: 'RSS Mold',
      type: 'mcp',
      provider: 'rss-mold',
      mcp: {
        command: 'mcp',
        args: [],
      },
      ...overrides,
    },
  } as LoadedSource
}

describe('rss-mold source helpers', () => {
  it('detects rss-mold sources from provider or module args', () => {
    expect(isRssMoldSource(createSource())).toBe(true)

    expect(isRssMoldSource(createSource({
      provider: 'custom',
      mcp: {
        command: 'mcp',
        args: ['serve', '--module', 'rss-mold'],
      },
    }))).toBe(true)

    expect(isRssMoldSource(createSource({
      provider: 'github',
      mcp: {
        command: 'mcp',
        args: ['serve', '--module', 'github'],
      },
    }))).toBe(false)
  })

  it('extracts and resolves config paths from source args', () => {
    const source = createSource({
      mcp: {
        command: 'mcp',
        args: ['serve', '--module', 'rss-mold', '--config', '~/craft-rss-mold.json'],
      },
    })

    expect(extractRssMoldConfigPath(source)).toBe('~/craft-rss-mold.json')
    expect(resolveConfigPath('~/craft-rss-mold.json', '/Users/tester', source.folderPath))
      .toBe('/Users/tester/craft-rss-mold.json')
    expect(resolveConfigPath('feeds.json', '/Users/tester', source.folderPath))
      .toBe('/tmp/rss-mold-source/feeds.json')
  })

  it('parses nested config shapes and keeps feed categories', () => {
    const feeds = parseRssMoldConfig(JSON.stringify({
      groups: [
        {
          title: 'Ignored title',
          section: 'AI',
          feeds: [
            'https://example.com/rss.xml',
            { title: 'Second Feed', url: 'https://second.example.com/feed' },
            { title: 'Disabled Feed', url: 'https://disabled.example.com/feed', disabled: true },
          ],
        },
      ],
    }))

    expect(feeds).toHaveLength(2)
    expect(feeds.map(feed => ({
      title: feed.title,
      url: feed.url,
      category: feed.category,
    }))).toEqual([
      {
        title: 'example.com',
        url: 'https://example.com/rss.xml',
        category: 'AI',
      },
      {
        title: 'Second Feed',
        url: 'https://second.example.com/feed',
        category: 'AI',
      },
    ])
  })

  it('normalizes JSON Feed payloads into article prompts', () => {
    const [article] = parseFeedPayload(
      {
        id: 'feed-1',
        title: 'Example Feed',
        url: 'https://example.com/feed.json',
      },
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Example Feed',
        items: [
          {
            id: 'story-1',
            title: 'A good story',
            url: 'https://example.com/story',
            content_text: 'Paragraph one.\n\nParagraph two.',
            date_published: '2026-04-10T08:00:00Z',
          },
        ],
      }),
    )

    expect(article).toMatchObject({
      id: 'story-1',
      title: 'A good story',
      url: 'https://example.com/story',
      feedTitle: 'Example Feed',
      body: ['Paragraph one.', 'Paragraph two.'],
    })

    expect(buildArticlePrompt('document', article)).toContain('Craft-style document')
  })
})
