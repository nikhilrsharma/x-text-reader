# Contributing to X Text Reader

Bug reports and focused improvements are welcome. Include the browser, operating system, userscript manager, script version, and steps to reproduce. Share a public example only when appropriate; remove personal information from screenshots and logs. Never include cookies, access tokens, or private post content.

## Making a change

1. Follow the development setup in [README.md](README.md).
2. Edit files in `src/`; `dist/x-text-reader.user.js` is generated.
3. Add or update a focused regression case for a behavior change.
4. Run `npm run build` and `npm test`.
5. Check relevant interactions on X in a separate browser profile, especially when changing selectors or media handling.
6. Describe the problem, changed behavior, validation, and any remaining limitations in the pull request.

Keep the full-width layout and existing reading preferences intact. Avoid unbounded scanning, background crawling, credential access, analytics, and external dependencies in the runtime. Test fixtures should use synthetic post data. Consult [the PRD](docs/PRD.md) before expanding scope.

The GitHub workflow checks generated output, data behavior, and isolated Chromium interactions. A passing workflow does not guarantee compatibility with every live X layout.

Contributions are provided under the project's [MIT license](LICENSE).
