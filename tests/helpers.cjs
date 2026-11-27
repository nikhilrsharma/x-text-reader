const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

// Playwright creates a fresh, isolated profile. No personal browser session is used.
function launchOptions() {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}

function writeResults(filename, report) {
  const resultsDirectory = path.join(projectRoot, 'test-results');
  fs.mkdirSync(resultsDirectory, { recursive: true });
  const relativeSource = path.relative(projectRoot, path.resolve(report.sourcePath));
  const sourcePath = relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)
    ? path.basename(report.sourcePath)
    : relativeSource.split(path.sep).join('/');
  const browser = process.env.BROWSER_EXECUTABLE_PATH
    ? 'Isolated Chromium with custom executable'
    : 'Isolated Playwright Chromium';
  const results = report.results.map(result => result.error
    ? { ...result, error: result.error.replaceAll(projectRoot, '<project>') }
    : result);
  fs.writeFileSync(path.join(resultsDirectory, filename), JSON.stringify({
    ...report, sourcePath, browser, results,
  }, null, 2) + '\n');
}

module.exports = { launchOptions, writeResults };
