# X Text Reader

A text-first, full-width X feed with optional media, long-post expansion, and a reader for connected threads. Runs locally as a Tampermonkey userscript. No backend, account, API key, or AI service is required beyond your normal access to X.

[Install the userscript](https://raw.githubusercontent.com/nikhilrsharma/x-text-reader/main/dist/x-text-reader.user.js) · [Latest release](https://github.com/nikhilrsharma/x-text-reader/releases/latest) · [Product requirements](docs/PRD.md) · [Report an issue](https://github.com/nikhilrsharma/x-text-reader/issues)

## What it does

- Uses the available window width, with a compact 72-pixel navigation rail and no reserved right sidebar.
- Hides recognized photos, videos, carousels, and link previews until you choose to reveal them. Text and native post actions remain available.
- Expands long posts in the feed, with an optional automatic expansion setting.
- Shows **Read thread** for detected connected posts from the same author and **Read post** otherwise.
- Combines available thread parts in order, with search, copying, printing, and loading controls.
- Compacts recognized List headers and provides controls for their details and cover.
- Saves reading preferences locally: text size, line spacing, post spacing, media height, and automatic long-post expansion.

Version **6.1.1** has been checked in **Brave on macOS with Tampermonkey**. Automated browser tests use isolated Chromium fixtures. Other browser and userscript-manager combinations have not yet been validated against live X.

## Install

1. Install [Tampermonkey from its official website](https://www.tampermonkey.net/) for your browser.
2. Enable userscript execution if Tampermonkey asks. See its [official permission instructions](https://www.tampermonkey.net/faq.php?q=Q209); Chromium-based browsers may expose an **Allow User Scripts** option or require Developer Mode.
3. Open the [installable script](https://raw.githubusercontent.com/nikhilrsharma/x-text-reader/main/dist/x-text-reader.user.js) and select **Install** in Tampermonkey.
4. Reload X. Keep only one version of this script enabled.

If the link displays source code or downloads a file, use **Tampermonkey Dashboard → Utilities → Import from file** and select `x-text-reader.user.js`. The script appears in Tampermonkey as **X / Twitter — Text-Only Mode + Speed**.

For a fixed release, download the userscript asset from [Releases](https://github.com/nikhilrsharma/x-text-reader/releases). To update manually, import the newer asset, select **Update**, and reload your X tabs. To remove the changes, disable the script and reload X. No development tools are needed to install it.

## Reading controls

| Control | Behavior |
| --- | --- |
| **Show photos**, **Show video**, or **Show media** | Reveals the post's recognized attachments together. Mixed photos and videos use a combined control. Revealed media can be hidden again or switched between compact and full size. |
| **Expand text** | Shows available full text in the feed. If X has not provided it yet, opens a post reader to try loading it. **Collapse text** restores the preview. |
| **Read post** | Opens a reader for the selected post in a separate X tab. |
| **Read thread** | Opens a combined reader for detected connected posts, following available same-author reply links. |
| **Aa** | Opens Reading settings. Changes apply immediately and are saved for the current site in this browser. |

To show full long-post text by default, enable **Aa → Automatically expand long posts**. It is off initially. Automatic expansion works for loaded posts whose full text is available; it keeps media hidden.

The reader preserves your original feed tab. **Stop loading** cancels the current attempt, and **Load more** retries or continues. Loading stops when its tab moves into the background; return and select **Load more** to continue. Search filters the collected cards; copying includes all collected posts and their original links, even while a search filter is active. **Close reader** closes the tab opened by the script.

## Thread detection and limits

The script requires an exact same-author reply connection in X's loaded post data before displaying **Read thread**. A thread emoji, numbering, reply count, or two nearby posts by the same person is not enough. A thread starter can initially say **Read post** and change when a connected reply loads.

The reader uses X's native pages and continuation controls. It does not guarantee a complete thread: deleted, muted, restricted, or unloaded parts can leave gaps. It reports possible missing parts and stops at ambiguous branches rather than joining different continuations. A single-post reader remains in single-post mode.

X can change its page structure and internal post data. Some continuation controls are recognized by English labels. Rich-post formatting, unusual media, and other interface languages may need further compatibility work. The script does not bypass X access restrictions.

## Privacy and performance

The script adds no analytics, telemetry, external processing service, or credential interception. It reads relevant rendered content and native post metadata. Preferences use X's browser `localStorage`, which is ordinary site storage accessible to that origin; they are not encrypted secrets or cross-device settings. Post data stays in a bounded in-memory cache. Copying or printing is initiated by the reader.

Updates are processed in batches, with bounded metadata traversal, cached thread detection, and observers that sleep when the tab is hidden. Reader loading is on demand, bounded, and cancellable. **Hiding media does not guarantee that X stops downloading it.** X continues to make its own requests and operate its own tracking independently.

## Develop and test

Use Node.js 22 or newer and npm. There are no runtime dependencies in the installed userscript; Playwright is only a development dependency.

```sh
git clone https://github.com/nikhilrsharma/x-text-reader.git
cd x-text-reader
npm ci --ignore-scripts
npx playwright install chromium
npm test
```

On Linux, `npx playwright install --with-deps chromium` can install the required browser system libraries. See the [Playwright CI guide](https://playwright.dev/docs/ci).

Edit `src/`, then run `npm run build` to regenerate `dist/x-text-reader.user.js`. Commit both source and generated output. `npm run check` verifies that the output matches the source and parses correctly. `npm run test:unit` runs the data tests; `npm run test:browser` runs the layout, media, reader, and settings fixtures. Tests intercept page requests and use synthetic posts without logging in to X.

For an isolated test run against an installed Chromium-based browser, set `BROWSER_EXECUTABLE_PATH` to that browser's executable. This does not use your normal browser profile. Test reports are written to the ignored `test-results/` directory.

```text
src/             Runtime modules and style sources
dist/            Complete installable userscript
scripts/         Dependency-free build script
tests/           Synthetic data and browser regression suites
docs/PRD.md      Product requirements and acceptance criteria
```

See [Contributing](CONTRIBUTING.md) and the [changelog](CHANGELOG.md). Automated fixtures help catch regressions; live X checks are still needed when its markup changes.

## License

[MIT](LICENSE). Created by Nikhil Sharma. This is an independent project and is not affiliated with X, Brave, or Tampermonkey.
