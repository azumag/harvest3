
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.screenshot({ path: 'dashboard.png' });
  const tradeSummaryVisible = await page.isVisible('#trade-summary');
  console.log(`Trade summary visible: ${tradeSummaryVisible}`);
  await browser.close();
})();
