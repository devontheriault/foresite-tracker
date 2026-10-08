// The Foresite Tracking Script.
//
// What it does, in full:
//  - sends one request per pageview: the page's address (without the #fragment
//    or any query parameter except campaign tags), the referring site (without
//    its path) and the event name;
//  - optionally sends Custom Events you call via window.foresite(), and Automatic
//    Events (outbound clicks, file downloads, 404s) if you switched them on;
//  - sets no cookies and stores nothing on the visitor's device. The single
//    exception is Self-Exclusion: a site owner who opens their site with
//    #foresite-ignore gets a flag in their own browser so their visits aren't counted.
//
// The collector replaces __FORESITE_CONFIG__ when serving this file.

interface Config {
  s: string // Site ID
  e: string // event endpoint
  o?: 1 // outbound link clicks enabled
  d?: 1 // file downloads enabled
  n?: 1 // 404 pages enabled
}

interface Options {
  props?: Record<string, string | number | boolean>
  revenue?: { amount: number | string; currency: string }
}

type Call = [string, Options?]

declare const __FORESITE_CONFIG__: Config

const cfg = __FORESITE_CONFIG__
const w = window as Window & { foresite?: { (n: string, o?: Options): void; q?: Call[] } }
const d = document
const l = location
const IGNORE = 'foresite_ignore'

try {
  if (l.hash === '#foresite-ignore') {
    localStorage.setItem(IGNORE, '1')
    alert('Foresite: not counting your visits here.')
  } else if (l.hash === '#foresite-unignore') {
    localStorage.removeItem(IGNORE)
    alert('Foresite: counting your visits again.')
  }
} catch (_) {
  // Storage blocked: nothing to do.
}

let firstPageview = true

const send = (name: string, opts?: Options): void => {
  try {
    if (
      localStorage.getItem(IGNORE) ||
      /^(localhost|127\.|\[::1\]$)/.test(l.hostname) ||
      l.protocol === 'file:' ||
      navigator.webdriver
    ) {
      return
    }
  } catch (_) {
    // Storage blocked: carry on.
  }
  // The page's origin and path, plus only the query parameters the collector
  // uses: campaign tags as they are, and ad click IDs as "1", since only their
  // presence matters. Never the #fragment, which can hold e.g. an access token.
  let q = ''
  for (const p of l.search.slice(1).split('&')) {
    const k = p.split('=')[0]
    const m = /^(?:(utm_(?:source|medium|campaign|content|term)|ref|source)|gclid|gbraid|wbraid|msclkid|ttclid|twclid|li_fat_id)$/.exec(k)
    if (m) q += (q ? '&' : '?') + (m[1] ? p : k + '=1')
  }
  const body: Record<string, unknown> = { s: cfg.s, n: name, u: l.origin + l.pathname + q }
  // The referrer only matters for a Session's first event, and only its
  // scheme and host are used.
  const r = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(d.referrer)
  if (firstPageview && r) body.r = r[0] + '/'
  if (name === 'pageview') firstPageview = false
  if (opts) {
    if (opts.props) body.p = opts.props
    if (opts.revenue) body.$ = { a: '' + opts.revenue.amount, c: opts.revenue.currency }
  }
  // A plain-text body keeps this a "simple" request, with no CORS preflight.
  fetch(cfg.e, { method: 'POST', body: JSON.stringify(body), keepalive: true, credentials: 'omit' }).catch(() => {})
}

// Public API: window.foresite('signup', { props: { plan: 'pro' } }).
// Calls made before this script loaded were queued in window.foresite.q.
const queued: Call[] = (w.foresite && w.foresite.q) || []
w.foresite = (name: string, opts?: Options) => name && send(name, opts)

// Pageviews, including single-page-app navigations.
let lastPath: string
const pageview = (): void => {
  if (l.pathname !== lastPath) {
    lastPath = l.pathname
    send('pageview')
  }
}
const his = history
const push = his.pushState
his.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
  push.apply(this, args)
  pageview()
}
w.addEventListener('popstate', pageview)
pageview()
queued.forEach((c) => send(c[0], c[1]))

// 404s, where the browser exposes the page's HTTP status.
if (cfg.n) {
  try {
    if ((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).responseStatus === 404) send('404')
  } catch (_) {
    // Not supported.
  }
}

// Outbound link clicks and file downloads.
if (cfg.o || cfg.d) {
  const onClick = (e: MouseEvent): void => {
    if (e.button > 1) return
    let a = e.target as Element | null
    while (a && !(a instanceof HTMLAnchorElement)) a = a.parentElement
    if (!a || !/^https?:$/.test(a.protocol)) return
    // Only origin and path are sent; query strings can carry personal data.
    const url = a.protocol + '//' + a.host + a.pathname
    if (cfg.d && /\.(pdf|zip|gz|rar|7z|dmg|exe|msi|pkg|deb|apk|csv|xlsx?|docx?|pptx?|txt|epub|mp3|mp4|mov)$/i.test(a.pathname)) {
      send('File Download', { props: { url } })
    } else if (cfg.o && a.host !== l.host) {
      send('Outbound Link: Click', { props: { url } })
    }
  }
  d.addEventListener('click', onClick, true)
  d.addEventListener('auxclick', onClick, true)
}
