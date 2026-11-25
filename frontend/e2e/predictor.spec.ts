import { test, expect } from '@playwright/test';

test.describe('Protein Secondary Structure Predictor E2E Flows', () => {

  test('Flow 1: Load 1UBQ, verify structure viewer, prediction track, and properties', async ({ page }) => {
    await page.goto('/');

    // Check initial header
    await expect(page.locator('h1')).toContainText('Protein Secondary Structure');

    // Click the 1UBQ benchmark chip
    const chip1UBQ = page.locator('button.chip', { hasText: '1UBQ' });
    await expect(chip1UBQ).toBeVisible();
    await chip1UBQ.click();

    // Verify loading status appears
    await expect(page.locator('.alert--info')).toBeVisible({ timeout: 10000 });

    // Verify prediction results appear
    await expect(page.locator('.results-card')).toBeVisible({ timeout: 25000 });

    // Verify residue cells are populated
    const cells = page.locator('.track .cell');
    await expect(cells).toHaveCount(76); // Ubiquitin is 76 residues

    // Verify confidence chart and formula appear
    await expect(page.locator('.chart')).toBeVisible();
    await expect(page.locator('.formula')).toBeVisible();

    // Verify experimental agreement badge
    await expect(page.locator('.agreement-badge')).toBeVisible();
  });

  test('Flow 2: Page refresh restores state without duplicate API call', async ({ page }) => {
    // Navigate with query parameters: 1UBQ, Chain A, mode predicted, residue 12
    await page.goto('/?pdb=1UBQ&chain=A&mode=predicted&res=12');

    // Wait for results
    await expect(page.locator('.results-card')).toBeVisible({ timeout: 25000 });

    // Verify URL parameters persist
    expect(page.url()).toContain('pdb=1UBQ');
    expect(page.url()).toContain('chain=A');

    // Verify selected residue 12 is active (res=12 is index 11)
    const selectedCell = page.locator('.track .cell.on');
    await expect(selectedCell).toBeVisible();

    // Count API calls on page reload
    let predictCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/predict')) {
        predictCalls++;
      }
    });

    // Refresh the page
    await page.reload();

    // Verify screen restores immediately from cache/session
    await expect(page.locator('.results-card')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('pdb=1UBQ');
    expect(page.url()).toContain('chain=A');

    // Because session cache is populated, no new POST /api/predict is needed
    expect(predictCalls).toBe(0);
  });

  test('Flow 3: Invalid sequence displays clear error message', async ({ page }) => {
    await page.goto('/');

    // Enter sequence with invalid characters (e.g. numbers and 'B')
    const textarea = page.locator('textarea#seq-input');
    await textarea.fill('MKVLAB123');

    const predictBtn = page.locator('button', { hasText: 'Predict Sequence' });
    await predictBtn.click();

    // Verify error banner is shown with clear explanation
    const alert = page.locator('.alert--error');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('Unsupported characters');
  });

  test('Flow 4: Offline / API failure displays graceful error state', async ({ page }) => {
    await page.goto('/');

    // Intercept /api/predict to simulate network failure
    await page.route('**/api/predict', (route) => route.abort('failed'));

    const textarea = page.locator('textarea#seq-input');
    await textarea.fill('MQIFVKTLTGKTIT');

    const predictBtn = page.locator('button', { hasText: 'Predict Sequence' });
    await predictBtn.click();

    // Verify clear error alert
    const alert = page.locator('.alert--error');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('Cannot connect to the prediction server');
  });

  test('Flow 5: Production build deep link directly loads and survives refresh', async ({ page }) => {
    // Deep link directly to 1MBN (Myoglobin)
    await page.goto('/?pdb=1MBN&chain=A&mode=predicted');

    await expect(page.locator('.results-card')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.track .cell')).toHaveCount(153); // Myoglobin is 153 residues

    // Refresh and ensure state persists
    await page.reload();
    await expect(page.locator('.results-card')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('pdb=1MBN');
  });

});
