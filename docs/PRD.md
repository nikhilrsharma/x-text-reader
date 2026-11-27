# X Text Reader Product Requirements

Version: 6.1.1

Status: Implemented baseline for the open source release

Date: 27 November 2026

X Text Reader is a Tampermonkey userscript that makes X easier to read: a wide text-first feed, media revealed on demand, inline expansion of long posts, and a combined reader for detected threads. It works within the X website and uses posts available to the current visitor. It has no separate account, server, analytics service, or AI service.

## Problem and audience

Large media previews, narrow content columns, and oversized List headers can make reading text on X slow and distracting. Long posts require repeated expansion. Threads spread one argument across several posts, mixed with comments, and often require navigation to find the next part.

The primary audience is people who read X on a desktop browser and prefer text, wider lines, and control over when media appears. The initial validated environment is Brave on macOS with Tampermonkey. Other browser and userscript-manager combinations are compatibility candidates, not supported-platform claims.

## Product goals

1. Use the available window width for reading while keeping native navigation and post actions usable.
2. Make text immediately useful without forcing media to appear or play.
3. Let readers expand a long post in place or read a connected thread continuously.
4. Keep thread detection conservative so ordinary comments and unrelated posts are not presented as a thread.
5. Keep processing local, incremental, bounded, and reversible by disabling the userscript and reloading X.

The product prioritizes faithful original text and working links. It does not summarize, rewrite, rank, or generate post content.

## Scope and defaults

The userscript runs on `x.com`, `twitter.com`, and `mobile.twitter.com`, outside embedded frames. The public installable file contains the complete runtime; development dependencies are not needed to use it.

| Area | Default behavior |
| --- | --- |
| Desktop layout | A 72-pixel icon navigation rail and a feed filling the remaining width; no fixed content-width cap or reserved right sidebar |
| Small screens | Keep native navigation below the desktop breakpoint of 500 CSS pixels |
| Post media | Hide recognized attachments and link previews; show a combined reveal control for each post |
| List headers | Compact recognized headers; hide their cover and extra details until requested |
| Long text | Offer expansion when longer text is available or X exposes a native expansion control |
| Automatic expansion | Off; the reader can enable it in Reading settings |
| Reader button | “Read thread” for detected connections, otherwise “Read post” |
| Typography | Use X defaults until the reader changes them |
| Compact media height | 360 pixels, with an additional viewport-relative cap in the feed |
| Floating UI | Hide recognized standalone Grok and chat launchers; keep native navigation and in-post actions |

## Main user flows

**Read the feed.** Install and enable one copy of the userscript, then reload X. Read posts across the available width. Reveal a post's media only when wanted, then hide it again without changing the text view.

**Expand a long post.** Select “Expand text” to replace its preview with available full text in the feed. Select “Collapse text” to restore the preview. If the full text is not already available, expansion opens a separate post-reader tab to try loading it through X.

**Expand long posts automatically.** Open “Aa” → “Automatically expand long posts.” Loaded posts with available full text expand as they are processed. The choice persists for that site in the browser. Media stays hidden. This setting expands individual post text; it does not automatically open or combine threads.

**Read a thread.** Select “Read thread.” A separate X tab opens a wide reader that collects connected posts. The original feed tab stays available at its existing position. Use “Stop loading” to cancel an attempt, “Load more” to try again, or “Close reader” to close the tab opened by the script.

## Functional requirements

The following requirements describe the release baseline and provide acceptance criteria for future changes.

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| FR-01 | Preserve the full-width layout | At desktop widths, the navigation rail is 72 CSS pixels and the main column fills the remaining space. Settings changes do not reinstate a narrow column. Below 500 CSS pixels, desktop rail overrides do not replace native navigation. |
| FR-02 | Reveal media per post | Recognized photos, videos, mixed carousels, and link previews start hidden. The combined label describes the detected content, such as “Show photos,” “Show video,” or “Show media.” One reveal action exposes that post's recognized media. The revealed state offers compact/full-size sizing and an original-post link when available. |
| FR-03 | Preserve text and interaction when hiding media | Hiding a carousel also collapses its media-only reserved space. It does not hide post text, quoted text, or the reveal control. Revealed videos retain native controls, require user interaction to play, and pause when hidden. |
| FR-04 | Handle replies, duplicates, and reused elements | Each post uses its own identity, not a quoted post's identity or the current page URL. On-screen copies of the same post share media choices. When X reuses an element for another post, its reading controls and expanded text reflect the new post. |
| FR-05 | Compact recognized List headers | A compact header retains the List title, statistics, and native actions. Details and cover have independent show/hide buttons when present. An unfamiliar structure remains unmodified rather than risking hidden feed content. |
| FR-06 | Choose a truthful reader label | “Read thread” requires loaded native metadata confirming an exact reply link between posts by the same author. A self-reply can qualify before its parent is loaded. Wording such as “thread,” a thread emoji, reply counts, and nearby same-author posts do not qualify by themselves. All other identified posts, including media-only posts, offer “Read post.” |
| FR-07 | Update detection as X loads data | A newly loaded connected reply can change an earlier post's label to “Read thread.” Clicking the button rechecks the current identity and connection before choosing the reader mode. A comment by someone else or an author response to that comment does not alone establish a self-thread. |
| FR-08 | Assemble connected posts faithfully | The thread reader follows exact parent-post links, orders the available chain, deduplicates post IDs, and keeps unrelated comments out. It compares author IDs where available, with a handle fallback for assembly when identity data is incomplete. It stops at ambiguous branches instead of silently joining distinct continuations. |
| FR-09 | Keep loading explicit and bounded | Reader loading begins on request, uses X's native navigation and continuation controls, and can be cancelled. Each attempt has time, iteration, continuation-click, and collected-post stop conditions. Backgrounding the tab ends the active attempt with a paused message. The user can retry with “Load more.” |
| FR-10 | Report incomplete results | The reader reports the number of posts loaded and possible missing parts. Missing parents, branches, loading limits, unavailable full text, and failed loading have appropriate status text. It does not claim to have retrieved every part of a thread. |
| FR-11 | Support single-post reading | “Read post” opens the single-post mode in a separate tab. Its content is limited to the selected post and any quoted content available with that post. It tries to obtain available full text and retains a retry path when only a preview is available. |
| FR-12 | Expand long text without revealing media | Manual inline expansion renders the available full text and safe links. Collapse restores the native preview. Automatic expansion applies only when enabled and full text is available. Disabling it collapses automatic expansions while preserving explicit manual choices for the current element. |
| FR-13 | Provide useful reader controls | The reader includes search within collected posts, copying collected text with original links, printing, settings, original-post access, and closing. Search filters collected cards without changing their order. Reader attachments start hidden behind one media control per post; unsupported playable media can link back to X. |
| FR-14 | Save local reading preferences | “Aa” opens settings for text size, line spacing, post spacing, media height, and automatic expansion. Changes apply immediately. Reset restores defaults. Invalid saved values fall back to supported defaults, and failed saving produces a visible message while retaining the current page's changes. |

## Reading settings

| Preference | Supported values | Default |
| --- | --- | --- |
| Text size | X default or 14–24 pixels in one-pixel steps | X default |
| Line spacing | X default or 1.2–1.9 times the font size in 0.1 steps | X default |
| Post spacing | X default, Compact, Comfortable | X default |
| Media height | 240–640 pixels in 20-pixel steps | 360 pixels |
| Automatically expand long posts | On or off | Off |

Preferences are stored in the site's `localStorage` and synchronized across open tabs of the same origin through browser storage events. They do not sync across devices or automatically transfer between the different supported hostnames. Clearing site storage can reset them. Post content and reading history are not persistently stored by the script; media and List display choices remain in memory for the page session.

## Quality requirements

### Privacy and content safety

- Add no telemetry, analytics, remote processing, or external account requirement.
- Inspect only post objects attached to rendered content and the relevant page structure. Do not intercept credentials, request headers, or the global application store.
- Render post content as text nodes and validated HTTP or HTTPS links, never as executable HTML.
- Use protected new-tab links. Fetch reader attachments only when revealed, using recognized X media hosts.
- Respect what X makes available to the visitor. Do not bypass deleted, muted, restricted, or unavailable content.
- Treat site storage as ordinary preference storage, not a secret vault. X continues to operate its own website, requests, storage, and tracking independently of the userscript.

### Performance

Processing responds to relevant page mutations and batches dirty posts into animation frames. The current implementation processes up to 24 dirty articles per frame, skips its own UI mutations, and uses only a few startup recovery checks rather than permanent polling. Feed observers disconnect when the tab is hidden and resume when it becomes visible.

Thread detection results are cached until connection data changes. Post-data extraction bounds its traversal and collections. The reader data cache holds up to 500 posts; media choices retain up to 1,500 identities, and List choices retain up to 100 Lists. Reader loading stops an attempt after roughly 45 seconds or 45 passes, repeated passes without progress, or when at least 200 posts have been collected. Each attempt can click at most 12 distinct continuation controls. The 200-post threshold stops further loading; it is not a strict limit on how many already-cached posts can appear.

Acceptance requires that unchanged content does not trigger a persistent self-generated update loop and that cancellation stops further reader loading. Performance benefits are assessed through behavior and regression checks; the release makes no measured battery, bandwidth, or speed guarantee. Visual media hiding does not prevent X from downloading hidden media.

### Accessibility and visual behavior

Use native buttons, links, inputs, and modal dialogs. Controls need readable names, visible focus states, and appropriate expanded or pressed states. Settings fields require labels; reader loading status should be announced politely. Closing settings returns focus to its invoking control when that control still exists.

Preserve normal browser keyboard access and X's existing interaction. Custom navigation shortcuts are outside scope. Match supported light and dark page themes, allow controls to wrap on smaller windows, and keep printing focused on reader content. Accessibility conformance certification and exhaustive screen-reader compatibility are not claimed for this release.

## Compatibility and limitations

X can change markup, layout, internal post objects, language, or loading behavior without notice. Text and media detection therefore need maintenance. Some continuation labels are matched in English, so thread loading in other interface languages may be incomplete.

A thread's first post may show “Read post” until a qualifying connection is loaded. A single-post reader does not automatically become a thread reader when later data arrives. Private or unavailable parts, native loading failures, and ambiguous branches can leave gaps. Full-text availability and rich-post formatting depend on what X exposes; the product is not an offline archive or a guaranteed reproduction of every rich-text feature.

Popup restrictions can prevent a reader tab from opening, and browser restrictions can prevent clipboard copying or closing a tab that the browser does not consider script-opened. The original-post link and the browser's own controls remain available. Disable duplicate or conflicting X userscripts when diagnosing layout or interaction problems.

## Explicit exclusions

- Separate photo and video reveal controls within one post.
- Optional quieter or hidden engagement controls.
- New keyboard navigation shortcuts.
- Background thread crawling, guaranteed complete-thread retrieval, or private API authentication.
- AI summarization, content rewriting, feed ranking, or recommendations.
- Cloud accounts, synchronized reading history, offline libraries, and persistent post archives.

## Release acceptance

The release must include an installable userscript, its maintainable sources, an open source license, installation and update instructions, and this PRD. Generated output must match its source build.

Automated checks cover layout, media collapse and reveal, correct identity handling, conservative thread labels, late data, thread ordering and deduplication, comment exclusion, cancellation, text expansion, and settings validation. The 6.1.1 baseline has 12 passing data unit cases and 15 passing reader integration cases; earlier media and layout integration checks provide additional regression coverage.

Live Brave acceptance covers a standalone post opening the single-post reader, a confirmed thread opening a combined reader, ordinary comments retaining “Read post,” and the full-width layout remaining intact. Test material published with the project must be synthetic and must not include private browsing data, credentials, local account paths, or personal screenshots.

## Future candidates

These are possible follow-up projects, not commitments in 6.1.1:

- Additional browser and userscript-manager compatibility validation.
- Localized continuation detection and broader language testing.
- Stronger diagnostics for X layout changes, with locally generated information that excludes post content by default.
- Better preservation of available rich-post formatting and media descriptions.
- More coverage for screen readers, zoom, and narrow viewports.
- A clear user-driven path from an initially unknown single post to a newly detected thread.
