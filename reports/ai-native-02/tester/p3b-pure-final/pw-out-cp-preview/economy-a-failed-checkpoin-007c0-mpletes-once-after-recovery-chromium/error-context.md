# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: economy.spec.ts >> a failed checkpoint save keeps the purchase pending and completes once after recovery
- Location: tests\economy.spec.ts:123:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('#supply-open')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('#supply-open') with timeout 5000ms
  - waiting for locator('#supply-open')

```

# Test source

```ts
  60  | 
  61  |   const repair = terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  62  |   const calibration = terminal.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' });
  63  |   const weapon = terminal.getByRole('button', { name: /Buy .* for 40 credits/ });
  64  | 
  65  |   // Purchase is queued in the paused dialog and commits on the resume tick;
  66  |   // success is shown only after the checkpoint save.
  67  |   await repair.click();
  68  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  69  |   await page.keyboard.press('Escape');
  70  |   await expect(terminal).toBeHidden();
  71  |   await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  72  |   await expect.poll(async () => (await checkpoint(page)).run.player.hp).toBe(60);
  73  |   await expect.poll(async () => (await checkpoint(page)).run.player.currency).toBe(82 + roomReward - 16);
  74  | 
  75  |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  76  |   await expect(terminal).toBeVisible();
  77  |   await weapon.click();
  78  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  79  |   await page.keyboard.press('Escape');
  80  |   await expect(terminal).toBeHidden();
  81  |   await expect(page.locator('#supply-reward')).toContainText('Purchased');
  82  |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  83  |   await expect(terminal).toBeVisible();
  84  |   await expect(weapon).toBeDisabled();
  85  |   await expect(terminal.getByText(/Already owned/)).toBeVisible();
  86  | 
  87  |   await calibration.click();
  88  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  89  |   await page.keyboard.press('Escape');
  90  |   await expect(terminal).toBeHidden();
  91  |   // Closing resumes the scene; the calibration command commits on the next
  92  |   // normal tick and only then is the checkpoint saved.
  93  |   await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  94  |   const after = await checkpoint(page);
  95  |   expect(after.run.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  96  |   expect(after.run.player.weapons).toHaveLength(2);
  97  |   expect(after.run.player.weapons.find((entry: any) => entry.key === after.run.player.weaponKey)?.level).toBe(2);
  98  |   expect(after.permanent).toMatchObject({ cores: 0, unlockedWeapons: ['pulse'] });
  99  | 
  100 |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  101 |   await expect(terminal).toBeVisible();
  102 |   await expect(calibration).toBeDisabled();
  103 |   await expect(terminal.getByText(/Not enough credits/).first()).toBeVisible();
  104 |   await page.keyboard.press('Escape');
  105 |   await expect(terminal).toBeHidden();
  106 |   await waitForScene(page, 'GameScene');
  107 | 
  108 |   await page.reload();
  109 |   await waitForScene(page, 'MainMenuScene');
  110 |   await page.mouse.click(640, 460);
  111 |   await waitForScene(page, 'GameScene');
  112 |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  113 |   await expect(terminal.getByText(`${after.run.player.currency} run credits`)).toBeVisible();
  114 |   await expect(weapon).toBeDisabled();
  115 |   await expect.poll(async () => (await checkpoint(page)).run.player).toMatchObject({
  116 |     currency: after.run.player.currency,
  117 |     hp: 60,
  118 |     weapons: after.run.player.weapons
  119 |   });
  120 |   expect(errors).toEqual([]);
  121 | });
  122 | 
  123 | test('a failed checkpoint save keeps the purchase pending and completes once after recovery', async ({ page }) => {
  124 |   const errors: string[] = [];
  125 |   page.on('pageerror', (error) => errors.push(error.message));
  126 |   await page.goto('/economy.html');
  127 |   await waitForScene(page, 'MainMenuScene');
  128 |   await page.evaluate(() => {
  129 |     const menu = (window as any).__game.scene.getScene('MainMenuScene');
  130 |     const start = menu.scene.start.bind(menu.scene);
  131 |     menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  132 |   });
  133 |   await page.mouse.click(640, 340);
  134 |   await waitForScene(page, 'GameScene');
  135 |   await page.evaluate(() => {
  136 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  137 |     const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  138 |     world.player.reset(world.portal.wx, world.portal.wy);
  139 |     world.resetSimulationAccumulator();
  140 |     world.stepFrame(1000 / 60 + 1e-6, neutral);
  141 |     world.tryInteract(world.player);
  142 |     world.resetSimulationAccumulator();
  143 |     world.stepFrame(1000 / 60 + 1e-6, neutral);
  144 |     world.resetSimulationAccumulator();
  145 |     world.stepFrame(1000 / 60 + 1e-6, neutral);
  146 |     world.simFixture.drones = [];
  147 |     world.simFixture.targets = [];
  148 |     for (const enemy of world.enemies) if (enemy.sprite?.scene) enemy.sprite.destroy();
  149 |     world.enemies = [];
  150 |     if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
  151 |     for (let i = 0; i < 5; i += 1) {
  152 |       world.resetSimulationAccumulator();
  153 |       world.stepFrame(1000 / 60 + 1e-6, neutral);
  154 |     }
  155 |     const data = world.playerDataFixture;
  156 |     data.currency = 200;
  157 |     data.hp = 40;
  158 |     (window as any).__game.scene.getScene('GameScene').saveCheckpoint();
  159 |   });
> 160 |   await expect(page.locator('#supply-open')).toBeVisible();
      |                                              ^ Error: expect(locator).toBeVisible() failed
  161 | 
  162 |   // Inject a real storage failure, then buy: the commit succeeds in memory but
  163 |   // the checkpoint save fails, so the UI must NOT report success and must keep
  164 |   // the transaction pending (dirty) for retry.
  165 |   await page.evaluate(() => {
  166 |     const original = Storage.prototype.setItem;
  167 |     Storage.prototype.setItem = () => { throw new Error('Storage unavailable for the test'); };
  168 |     window.addEventListener('restore-test-storage', () => { Storage.prototype.setItem = original; }, { once: true });
  169 |     // Force the checkpoint dirty so the failed write's dirty-flag semantics are
  170 |     // observable independently of prior state.
  171 |     (window as any).__game.scene.getScene('GameScene').markCheckpointDirty();
  172 |   });
  173 |   const baseline = await page.evaluate(() => {
  174 |     const w = (window as any).__game.scene.getScene('GameScene').world;
  175 |     return { currency: w.sim.player.data.currency, disk: JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}').run?.player?.currency };
  176 |   });
  177 |   const diskBefore = baseline.disk as number;
  178 | 
  179 |   await page.locator('#supply-open').click();
  180 |   const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  181 |   await expect(terminal).toBeVisible();
  182 |   await terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' }).click();
  183 |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  184 |   await page.keyboard.press('Escape');
  185 |   await expect(terminal).toBeHidden();
  186 | 
  187 |   await expect(page.locator('#supply-reward')).toContainText('could not be saved');
  188 |   await expect(page.locator('#supply-reward')).not.toContainText('Purchased');
  189 |   const failedState = await page.evaluate(() => {
  190 |     const gs = (window as any).__game.scene.getScene('GameScene');
  191 |     return { dirty: !!gs.checkpointDirty, pending: gs.world.hasUncommittedCommands() };
  192 |   });
  193 |   expect(failedState.dirty, 'failed save keeps checkpointDirty').toBe(true);
  194 |   expect(failedState.pending, 'committed purchase leaves no pending commands').toBe(false);
  195 |   const mid = await checkpoint(page);
  196 |   // In-memory commit deducted once; the failed save left the on-disk checkpoint untouched.
  197 |   const memAfter = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.player.data.currency);
  198 |   expect(memAfter, 'in-memory commit deducted exactly once').toBe(baseline.currency - 16);
  199 |   expect(mid.run.player.currency, 'on-disk checkpoint unchanged while storage fails').toBe(diskBefore);
  200 | 
  201 |   // Recover storage: the pending transaction retries and completes exactly once.
  202 |   await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));
  203 |   await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  204 |   await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(baseline.currency - 16);
  205 |   await expect.poll(async () => (await checkpoint(page)).run?.player.hp).toBe(75);
  206 |   const dirtyAfter = await page.evaluate(() => !!(window as any).__game.scene.getScene('GameScene').checkpointDirty);
  207 |   expect(dirtyAfter, 'successful save clears checkpointDirty').toBe(false);
  208 |   const after = await checkpoint(page);
  209 |   expect(after.run.player.currency, 'no double deduction after retry').toBe(baseline.currency - 16);
  210 |   expect(after.run.player.hp).toBe(75);
  211 |   expect(after.run.player.weapons).toHaveLength(1);
  212 |   expect(errors).toEqual([]);
  213 | });
  214 | 
```