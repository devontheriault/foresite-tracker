import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error: plain JavaScript module
import { buildScript } from '../build.mjs'

// The tests run the minified build, the same bytes the server sends.
let built: string
beforeAll(async () => {
  built = await buildScript()
})

const ENDPOINT = 'https://t.foresite.dev/e'

type Sent = { s: string; n: string; u: string; r?: string; p?: Record<string, unknown>; $?: { a: string; c: string } }

interface Loaded {
  win: Window
  sent: Sent[]
  navigatorReads: Set<PropertyKey>
}

// Runs the built script in a fresh browser window, so every test is isolated.
function load(
  cfg: Record<string, unknown>,
  url = 'https://example.com/pricing',
  opts: { referrer?: string; webdriver?: boolean; storage?: Map<string, string>; queued?: unknown[] } = {},
): Loaded {
  const win = new Window({ url })
  const sent: Sent[] = []
  Object.defineProperty(win.navigator, 'webdriver', { value: opts.webdriver ?? false })
  if (opts.referrer) Object.defineProperty(win.document, 'referrer', { value: opts.referrer })
  const backing = opts.storage ?? new Map<string, string>()
  const storage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  }
  const fetchMock = vi.fn((u: string, init: RequestInit) => {
    expect(u).toBe(ENDPOINT)
    expect(init.credentials).toBe('omit')
    expect(init.keepalive).toBe(true)
    sent.push(JSON.parse(init.body as string))
    return Promise.resolve(new Response(null, { status: 202 }))
  })
  if (opts.queued) (win as any).foresite = Object.assign(() => {}, { q: opts.queued })
  // Records which navigator properties the script reads.
  const navigatorReads = new Set<PropertyKey>()
  const navigator = new Proxy(win.navigator, {
    get: (t, k) => (navigatorReads.add(k), Reflect.get(t, k, t)),
  })
  const src = built.replace('__FORESITE_CONFIG__', JSON.stringify({ s: 's_test', e: ENDPOINT, ...cfg }))
  const globals = {
    window: win, document: win.document, location: win.location, history: win.history,
    navigator, localStorage: storage, fetch: fetchMock, performance: win.performance,
    alert: () => {}, HTMLAnchorElement: win.HTMLAnchorElement,
  }
  new Function(...Object.keys(globals), src)(...Object.values(globals))
  return { win, sent, navigatorReads }
}

function click(win: Window, id: string) {
  win.document.getElementById(id)!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
}

describe('tracking script', () => {
  it('sends one pageview with url and site on load, and sets no cookies', () => {
    const { win, sent } = load({})
    expect(sent).toEqual([{ s: 's_test', n: 'pageview', u: 'https://example.com/pricing' }])
    expect(win.document.cookie).toBe('')
  })

  it('stores nothing in the browser', () => {
    const storage = new Map<string, string>()
    load({ o: 1, d: 1, n: 1 }, 'https://example.com/', { storage })
    expect(storage.size).toBe(0)
  })

  it('reads nothing from the browser that could fingerprint a visitor', () => {
    const { win, navigatorReads } = load({ o: 1, d: 1, n: 1 }, 'https://example.com/', { referrer: 'https://google.com/' })
    win.document.body.innerHTML = '<a id="out" href="https://other.org/">go</a>'
    click(win, 'out')
    // Only the automation flag, so headless browsers aren't counted.
    expect([...navigatorReads]).toEqual(['webdriver'])
    // No other device or browser characteristics, storage, or ways to send data.
    for (const api of [
      'cookie', 'sessionStorage', 'indexedDB', 'caches', 'userAgent', 'platform', 'language', 'plugins',
      'hardwareConcurrency', 'deviceMemory', 'screen', 'devicePixelRatio', 'innerWidth', 'getTimezoneOffset',
      'Intl', 'getContext', 'WebGL', 'AudioContext', 'XMLHttpRequest', 'sendBeacon', 'Image', 'WebSocket',
    ]) {
      expect(built, api).not.toContain(api)
    }
  })

  it('tracks single-page-app navigations once per path', () => {
    const { win, sent } = load({})
    win.history.pushState({}, '', '/about')
    win.history.pushState({}, '', '/about')
    win.history.pushState({}, '', '/contact')
    expect(sent.map((e) => e.u)).toEqual([
      'https://example.com/pricing',
      'https://example.com/about',
      'https://example.com/contact',
    ])
  })

  it('sends custom events with props and revenue, including calls queued before load', () => {
    const { win, sent } = load({}, undefined, { queued: [['early', { props: { a: 1 } }]] })
    ;(win as any).foresite('purchase', { props: { plan: 'pro' }, revenue: { amount: 19.99, currency: 'USD' } })
    expect(sent[1]).toMatchObject({ n: 'early', p: { a: 1 } })
    expect(sent[2]).toMatchObject({ n: 'purchase', p: { plan: 'pro' }, $: { a: '19.99', c: 'USD' } })
  })

  it('respects Self-Exclusion, set and cleared by #foresite-ignore / #foresite-unignore', () => {
    const storage = new Map<string, string>()
    expect(load({}, 'https://example.com/#foresite-ignore', { storage }).sent).toEqual([])
    expect(storage.get('foresite_ignore')).toBe('1')
    expect(load({}, 'https://example.com/', { storage }).sent).toEqual([])
    expect(load({}, 'https://example.com/#foresite-unignore', { storage }).sent).toHaveLength(1)
    expect(storage.has('foresite_ignore')).toBe(false)
  })

  it('does not track localhost or automated browsers', () => {
    expect(load({}, 'http://localhost:3000/').sent).toEqual([])
    expect(load({}, 'https://example.com/', { webdriver: true }).sent).toEqual([])
  })

  it('sends outbound clicks only when enabled, without query strings', () => {
    const on = load({ o: 1 })
    on.win.document.body.innerHTML =
      '<a id="out" href="https://other.org/page?email=x@y.z"><span id="inner">go</span></a><a id="in" href="/local">in</a>'
    click(on.win, 'inner')
    click(on.win, 'in')
    expect(on.sent.slice(1)).toEqual([
      { s: 's_test', n: 'Outbound Link: Click', u: 'https://example.com/pricing', p: { url: 'https://other.org/page' } },
    ])

    const off = load({})
    off.win.document.body.innerHTML = '<a id="out" href="https://other.org/">go</a>'
    click(off.win, 'out')
    expect(off.sent).toHaveLength(1)
  })

  it('sends file downloads when enabled', () => {
    const { win, sent } = load({ d: 1 })
    win.document.body.innerHTML = '<a id="f" href="/files/brochure.pdf?v=2">pdf</a>'
    click(win, 'f')
    expect(sent[1]).toMatchObject({ n: 'File Download', p: { url: 'https://example.com/files/brochure.pdf' } })
  })

  it('sends the referrer only with the first pageview', () => {
    const { win, sent } = load({}, undefined, { referrer: 'https://google.com/' })
    win.history.pushState({}, '', '/next')
    expect(sent[0].r).toBe('https://google.com/')
    expect(sent[1].r).toBeUndefined()
  })
})
