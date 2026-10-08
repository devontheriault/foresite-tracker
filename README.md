# Foresite Tracking Script

This is the JavaScript that [Foresite](https://foresite.dev), a privacy-first web analytics service, runs on its customers' websites. It's open source so that anyone, whether a site owner, one of their visitors, or a regulator, can check what it collects instead of taking our word for it.

The whole script is one file, [`src/foresite.ts`](src/foresite.ts), about 140 lines. It builds to about 1.9 KB of minified JavaScript, about 1.1 KB gzipped. Reading it takes a few minutes, and that read is the best check there is. This README summarises it and points to the code and tests behind each claim.

## What it does

A site loads it with one line:

```html
<script defer src="https://t.foresite.dev/s/YOUR_SITE_ID.js"></script>
```

It then sends one small request for each page a visitor loads, plus any events the site owner chose to measure. Each request is a `POST` of a JSON body to the Foresite collector, with these fields and nothing else ([`send()` in `src/foresite.ts`](src/foresite.ts)):

| Field | Contents | When |
|---|---|---|
| `s` | The site's public ID, e.g. `s_abc123def456` | Always |
| `n` | The event name: `pageview`, `404`, or a name the site chose, such as `signup` | Always |
| `u` | The page's address: its origin and path, plus only the query parameters Foresite uses. UTM campaign tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, and `ref` or `source`) are sent as they are. Ad click IDs (`gclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`) are sent as `1`, because only their presence matters. Every other query parameter and the `#fragment` are left out | Always |
| `r` | The referring site's scheme and host from `document.referrer`, e.g. `https://www.google.com/`, without its path or query | Only with the first pageview after the page loads |
| `p` | Properties the site attached to its own event, e.g. `{ "plan": "pro" }` | Only for custom events, file downloads and outbound clicks |
| `$` | An amount and currency the site attached to its own event | Only for custom events that have revenue |

What triggers a request:

- **Pageviews.** One when the page loads, and one each time a single-page app moves to a new path (`history.pushState` or the back button). Going to the path the visitor is already on doesn't send another one. Tests: *sends one pageview with url and site on load*, *tracks single-page-app navigations once per path*, *sends the referrer only with the first pageview*.
- **Custom events** that the site's own code sends with `window.foresite('signup', { props: { plan: 'pro' } })`. Test: *sends custom events with props and revenue*.
- **Automatic events**, each one off unless the site owner turns it on: clicks on links to other websites, clicks on links to files (`.pdf`, `.zip` and so on), and pages that return a 404. For clicked links, only the link's origin and path are sent and the query string is dropped, because query strings can contain personal data. Tests: *sends outbound clicks only when enabled, without query strings*, *sends file downloads when enabled*.

It doesn't send anything when the page is on `localhost`, `127.*` or `[::1]`, is opened from a `file:` URL, or is driven by an automated browser (`navigator.webdriver`), and it doesn't send anything from a browser that has opted out with Self-Exclusion (see below). Test: *does not track localhost or automated browsers*.

## What it never does

Each claim below is backed by the code and by a test in [`test/tracker.test.ts`](test/tracker.test.ts). The tests run the **minified build**, the same bytes the server sends, not the TypeScript source.

### No cookies

The script never reads or writes `document.cookie`, and the word `cookie` doesn't appear in the build.

- Tests: *sends one pageview with url and site on load, and sets no cookies* checks that `document.cookie` is empty afterwards. *reads nothing from the browser that could fingerprint a visitor* fails if `cookie` appears anywhere in the built script.

### Nothing stored on the device, except Self-Exclusion

The script uses `localStorage` for one thing only: a flag named `foresite_ignore`, which is set when someone opens a page whose address ends in `#foresite-ignore` and removed by `#foresite-unignore`. This is how site owners stop counting their own visits. Nobody gets the flag unless they open one of those addresses themselves, and a confirmation pops up when it's set. Before each request the script reads the flag, and if it's there, nothing is sent. It never uses `sessionStorage`, IndexedDB, the Cache API or any other storage.

- Code: the `try` block at the top of [`src/foresite.ts`](src/foresite.ts) that checks `l.hash`, and the `localStorage.getItem(IGNORE)` check in `send()`.
- Tests: *stores nothing in the browser* runs the script with every feature on and checks that storage stays empty. *respects Self-Exclusion* checks that the flag is set, honoured and cleared. *reads nothing from the browser…* fails if `sessionStorage`, `indexedDB` or `caches` appears in the build.

### No credentials

Every request is made with `fetch(..., { credentials: 'omit' })`, so the browser sends no cookies or HTTP authentication with it, even if the collector's domain had set some. The body is sent as plain text with no custom headers, so the browser doesn't need a CORS preflight.

- Code: the `fetch` call at the end of `send()`.
- Tests: every request in every test goes through the `fetch` mock in `load()`, which fails the test unless `credentials` is `'omit'`.

### No fingerprinting

The script reads only what it needs to describe the page: the page address (`location`), the referrer (`document.referrer`), the automation flag (`navigator.webdriver`, so that bots aren't counted), and, only when 404 tracking is on, the HTTP status of the page load (`performance.getEntriesByType('navigation')`). It never reads the user agent, platform, languages, plugins, screen size, pixel ratio, time zone, hardware details, canvas, WebGL or audio. Those are what fingerprinting scripts use to tell browsers apart.

- Test: *reads nothing from the browser that could fingerprint a visitor* runs the script with every feature on. It records every property read from `navigator` and fails if anything other than `webdriver` is read. It also fails if any of those fingerprinting APIs appears in the build.

### No third parties, no other channels

The script sends data only with `fetch`, and only to the endpoint configured for the site: Foresite's collector, or the site's own custom domain or proxy. It loads no other scripts and makes no other requests, and it doesn't use `XMLHttpRequest`, `sendBeacon`, image pixels or WebSockets.

- Tests: the `fetch` mock in `load()` fails the test if a request goes anywhere other than the configured endpoint, and *reads nothing from the browser…* fails if any of those other APIs appears in the build.

## What this repository can't show you

Your browser sends your IP address and User-Agent with every web request, to any server. The script doesn't add them, but the collector receives them. What the collector does with them is server-side code, which isn't in this repository. According to Foresite's [privacy policy](https://foresite.dev/privacy) and [How we count](https://foresite.dev/docs/how-we-count), they are held in memory only. They're used to find the country and region (never the city) and the browser, operating system and device type, and to compute a visitor hash that only works for one site on one day. Then they're discarded and never written to disk. For the page address, only the path and UTM campaign tags are kept, and the rest of the query string is thrown away. That code is closed source, so for this part you're relying on what we say rather than on code you can check.

## How the server delivers it

The collector serves the built file, with the placeholder `__FORESITE_CONFIG__` replaced by the site's settings as a JSON object:

```js
{"s":"s_abc123def456","e":"https://t.foresite.dev/e","o":1,"d":1,"n":1}
```

`s` is the site ID and `e` is where to send events. `o`, `d` and `n` turn on outbound clicks, file downloads and 404 tracking, and are left out when off. Nothing else in the file changes.

## Build and test

You need Node.js 20 or later.

```sh
npm ci          # installs the exact dependency versions in package-lock.json
npm test        # builds the script in memory and runs the tests against it
npm run build   # type-checks src/, then writes dist/foresite.js
```

`npm run build -- --outfile=some/other/path.js` writes the file somewhere else.

## Check that the served script matches this source

The build is deterministic: the same source and the same esbuild version, which `package-lock.json` pins, always produce the same bytes. To check the script a site is serving:

```sh
npm ci
npm run verify -- https://t.foresite.dev/s/SITE_ID.js
```

Use the ID of any site that runs Foresite. It's in that site's `<script>` tag, and the check works the same with a custom domain's script address. You can also save the script first and pass the file: `npm run verify -- saved.js`.

[`verify.mjs`](verify.mjs) builds this source and checks that the served file is exactly the build up to the placeholder, then a JSON object holding only the settings listed above, then exactly the rest of the build. If any byte outside the settings is different, it prints `MISMATCH` and exits with status 1. If the check fails, make sure you're on the latest commit of `main`, because a new version may already be live.

You can also do it by hand: run `npm run build`, download the served script, and diff the two files. The only difference should be `__FORESITE_CONFIG__` turned into the site's settings.

## Contributing and security

This repository is published from Foresite's main (private) codebase, so pull requests can't be merged here directly. Bug reports and questions are welcome as issues. Please report security problems privately to support@foresite.dev rather than in a public issue.

## License

[MIT](LICENSE)
