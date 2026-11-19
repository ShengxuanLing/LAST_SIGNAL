# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vs01.spec.ts >> route B reaches the east shore within one guard Jam from the real entrance
- Location: tests\vs01.spec.ts:131:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 2.6
Received:    2.7
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main "Station Zero 原型" [ref=e2]
  - generic:
    - generic:
      - generic: 能量
      - generic: 100 / 100
      - generic: 未扫描。按 Z 观察中继器的连接。
    - generic:
      - generic:
        - generic: 失稳走廊
        - generic: 桥梁断开 · 不可通行
        - generic: 中继器 关 · 有供电 · 输出 OFF
        - generic: HP 100 / 100 · 守卫在场
    - generic: 失稳走廊 · 前往东岸
    - generic:
      - generic: 反馈
      - generic: 失稳走廊：可清除守卫，或按 G 压制守卫后用 F 建桥。
    - generic:
      - generic: 位置
      - generic: 2.7, 10.5
    - navigation "操作" [ref=e4]:
      - button "扫描" [ref=e5] [cursor=pointer]
      - button "压制中继器" [ref=e6] [cursor=pointer]
      - button "压制守卫" [ref=e7] [cursor=pointer]
      - button "切换中继器" [ref=e8] [cursor=pointer]
      - button "暂停" [ref=e9] [cursor=pointer]
      - button "重开" [ref=e10] [cursor=pointer]
      - button "保存" [ref=e11] [cursor=pointer]
    - paragraph: Z 扫描 · X 压制中继器 · G 压制守卫 · F 操作控制器 · J 开火
```

# Test source

```ts
  44  |   const errors: string[] = [];
  45  |   const offOrigin: string[] = [];
  46  |   page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  47  |   page.on('pageerror', (error) => errors.push(error.message));
  48  |   page.on('request', (request) => { if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) offOrigin.push(request.url()); });
  49  |   await page.goto('/station-zero.html');
  50  |   await expect(page.locator('body')).toHaveAttribute('data-vs00-ready', '1');
  51  |   await page.evaluate((key) => localStorage.setItem(key, 'original-and-economy-save'), MAIN_KEY);
  52  | 
  53  |   const room = page.locator('body');
  54  |   const door = page.getByTestId('vs00-door-state');
  55  |   const bridge = page.getByTestId('vs01-bridge-state');
  56  |   const relay = page.getByTestId('vs01-relay-state');
  57  |   const health = page.getByTestId('vs01-health');
  58  |   const feedback = page.getByTestId('vs00-feedback');
  59  |   const scan = page.getByTestId('vs00-scan-details');
  60  |   await page.keyboard.press('x');
  61  |   await expect(door).toHaveAttribute('data-state', 'JAMMED_OPEN');
  62  |   await walk(page, east, async () => (await room.getAttribute('data-slice-room')) === 'corridor');
  63  |   expect((await readSave(page)).corridor).toBeUndefined();
  64  |   await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  65  |   await expect(relay).toHaveAttribute('data-state', 'INACTIVE');
  66  | 
  67  |   await page.keyboard.press('f');
  68  |   await expect(feedback).toHaveAttribute('data-code', 'E_ILLEGAL_TARGET');
  69  |   await expect(feedback).toHaveAttribute('data-cost', '0');
  70  |   await page.keyboard.press('z');
  71  |   await expect(scan).toContainText('中继器 → 桥梁承重');
  72  |   await expect(scan).toContainText('中继器 → 守卫感知（已断开）');
  73  |   await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  74  | 
  75  |   await page.keyboard.press('j');
  76  |   await expect(health).toHaveAttribute('data-guard', '12');
  77  |   await page.waitForTimeout(220);
  78  |   await page.keyboard.press('j');
  79  |   await expect(health).toHaveAttribute('data-guard', '0');
  80  |   await walk(page, north, async () => (await coordinate(page, 'y')) <= 9.5);
  81  |   await walk(page, east, async () => (await coordinate(page, 'x')) >= 8.4);
  82  |   await page.keyboard.press('f');
  83  |   await expect(relay).toHaveAttribute('data-output', '1');
  84  |   await expect(bridge).toHaveAttribute('data-state', 'TRANSITIONING');
  85  |   await expect(bridge).toHaveAttribute('data-passable', '0');
  86  |   await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  87  |   await expect(relay).toHaveAttribute('data-cooldown-ticks', '0', { timeout: 9000 });
  88  |   await walk(page, east, async () => (await coordinate(page, 'x')) >= 12.4);
  89  |   await expect(health).toHaveAttribute('data-on-bridge', '1');
  90  |   await page.keyboard.press('x');
  91  |   await expect(relay).toHaveAttribute('data-state', 'JAMMED');
  92  |   await expect(bridge).toHaveAttribute('data-state', 'UNSTABLE');
  93  |   await expect(bridge).toHaveAttribute('data-passable', '1');
  94  |   await expect(bridge).toContainText('退往西岸');
  95  |   await page.keyboard.press('Escape');
  96  |   await expect(feedback).toContainText('已暂停');
  97  |   const frozen = await bridge.getAttribute('data-ticks');
  98  |   await page.waitForTimeout(1650);
  99  |   await expect(bridge).toHaveAttribute('data-ticks', frozen!);
  100 |   await expect(health).toHaveAttribute('data-hp', '100');
  101 |   await page.keyboard.press('Escape');
  102 |   await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  103 |   await expect(feedback).toContainText('西岸安全点，损失 20 HP');
  104 |   await expect(health).toHaveAttribute('data-hp', '80');
  105 |   await expect(health).toHaveAttribute('data-on-bridge', '0');
  106 |   await expect(page.getByTestId('vs00-player-position')).toHaveAttribute('data-x', '9.5');
  107 | 
  108 |   await page.getByTestId('vs00-btn-save').click();
  109 |   const saved = await readSave(page);
  110 |   expect(saved.corridor.jamRemaining).toBeGreaterThan(0);
  111 |   await page.reload();
  112 |   await expect(room).toHaveAttribute('data-slice-room', 'corridor');
  113 |   await expect(health).toHaveAttribute('data-hp', '80');
  114 |   await expect(health).toHaveAttribute('data-guard', '0');
  115 |   await expect(relay).toHaveAttribute('data-state', 'JAMMED');
  116 |   expect(Number(await relay.getAttribute('data-jam-ticks'))).toBeLessThanOrEqual(saved.corridor.jamRemaining);
  117 |   await expect(relay).toHaveAttribute('data-state', 'ACTIVE', { timeout: 7500 });
  118 |   await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  119 |   await walk(page, east, async () => (await page.getByTestId('vs00-complete').getAttribute('data-complete')) === '1');
  120 |   await expect(page.getByTestId('vs00-complete')).toContainText('已到达东岸');
  121 |   expect((await readSave(page)).corridor).toMatchObject({ crossed: true, bridge: 'STABLE', hp: 80 });
  122 |   await page.getByTestId('vs00-btn-restart').click();
  123 |   await expect(room).toHaveAttribute('data-slice-room', 'lab');
  124 |   await expect(door).toHaveAttribute('data-state', 'SEALED');
  125 |   await expect(page.getByTestId('vs00-energy')).toHaveAttribute('data-energy', '100');
  126 |   expect(await page.evaluate((key) => localStorage.getItem(key), MAIN_KEY)).toBe('original-and-economy-save');
  127 |   expect(errors).toEqual([]);
  128 |   expect(offOrigin).toEqual([]);
  129 | });
  130 | 
  131 | test('route B reaches the east shore within one guard Jam from the real entrance', async ({ page }) => {
  132 |   await page.goto('/station-zero.html');
  133 |   const room = page.locator('body');
  134 |   const bridge = page.getByTestId('vs01-bridge-state');
  135 |   const relay = page.getByTestId('vs01-relay-state');
  136 |   const health = page.getByTestId('vs01-health');
  137 |   const complete = page.getByTestId('vs00-complete');
  138 |   const feedback = page.getByTestId('vs00-feedback');
  139 |   await expect(room).toHaveAttribute('data-vs00-ready', '1');
  140 |   await page.keyboard.press('x');
  141 |   await expect(page.getByTestId('vs00-door-state')).toHaveAttribute('data-state', 'JAMMED_OPEN');
  142 |   await walk(page, east, async () => (await room.getAttribute('data-slice-room')) === 'corridor');
  143 |   await expect(relay).toHaveAttribute('data-cooldown-ticks', '0', { timeout: 10000 });
> 144 |   expect(await coordinate(page, 'x')).toBeLessThanOrEqual(2.6);
      |                                       ^ Error: expect(received).toBeLessThanOrEqual(expected)
  145 |   expect(await coordinate(page, 'y')).toBe(10.5);
  146 |   const labCheckpoint = await readSave(page);
  147 |   expect(labCheckpoint.corridor).toBeUndefined();
  148 | 
  149 |   const elapsed = page.evaluate(() => new Promise<number>((resolve) => {
  150 |     const guard = document.querySelector('[data-testid="vs01-health"]')!;
  151 |     const eastShore = document.querySelector('[data-testid="vs00-complete"]')!;
  152 |     let started: number | undefined;
  153 |     const observer = new MutationObserver(() => {
  154 |       if (started === undefined && guard.getAttribute('data-guard-link') === 'JAMMED') started = performance.now();
  155 |       if (started !== undefined && eastShore.getAttribute('data-complete') === '1') {
  156 |         observer.disconnect();
  157 |         resolve(performance.now() - started);
  158 |       }
  159 |     });
  160 |     observer.observe(guard, { attributes: true, attributeFilter: ['data-guard-link'] });
  161 |     observer.observe(eastShore, { attributes: true, attributeFilter: ['data-complete'] });
  162 |   }));
  163 |   await page.keyboard.press('g');
  164 |   await expect(feedback).toHaveAttribute('data-cost', '25');
  165 |   const jamUntil = Number(await health.getAttribute('data-guard-jam-until'));
  166 |   expect(jamUntil).toBeGreaterThan(0);
  167 |   await walk(page, north, async () => (await coordinate(page, 'y')) <= 9.5);
  168 |   for (const key of east) await page.keyboard.down(key);
  169 |   try {
  170 |     await expect.poll(() => coordinate(page, 'x'), { intervals: [16] }).toBeGreaterThanOrEqual(8.4);
  171 |     await page.keyboard.press('f');
  172 |     await expect(bridge).toHaveAttribute('data-state', 'TRANSITIONING');
  173 |     await expect(health).toHaveAttribute('data-guard-shared', '1');
  174 |     await expect(health).toHaveAttribute('data-guard-jam-until', String(jamUntil));
  175 |     await expect(complete).toHaveAttribute('data-complete', '1', { timeout: 6000 });
  176 |   } finally {
  177 |     for (const key of east) await page.keyboard.up(key);
  178 |   }
  179 |   const duration = await elapsed;
  180 |   const elapsedTicks = Number(await complete.getAttribute('data-crossed-tick')) - (jamUntil - 360);
  181 |   console.log(`Route B reached SAFE_E in ${duration.toFixed(0)}ms / ${elapsedTicks} logic ticks`);
  182 |   expect(duration).toBeLessThanOrEqual(6000);
  183 |   expect(elapsedTicks).toBeGreaterThan(0);
  184 |   expect(elapsedTicks).toBeLessThanOrEqual(360);
  185 |   expect(await coordinate(page, 'x')).toBeGreaterThanOrEqual(16.5);
  186 |   await expect(health).toHaveAttribute('data-guard', '24');
  187 |   await expect(bridge).toHaveAttribute('data-state', 'STABLE');
  188 |   await expect(feedback).toContainText('守卫仍在场');
  189 |   await page.getByTestId('vs00-btn-save').click();
  190 |   expect(await readSave(page)).toEqual(labCheckpoint);
  191 |   await page.reload();
  192 |   await expect(room).toHaveAttribute('data-slice-room', 'corridor');
  193 |   await expect(bridge).toHaveAttribute('data-state', 'UNAVAILABLE');
  194 |   await expect(health).toHaveAttribute('data-guard-link', 'DISCONNECTED');
  195 |   await expect(complete).toHaveAttribute('data-complete', '0');
  196 | });
  197 | 
  198 | test('a lethal collapse clears the run and permits a fresh start', async ({ page }) => {
  199 |   // Fixture shortens the setup. The warning, movement and collapse use real input.
  200 |   await page.addInitScript((key) => {
  201 |     localStorage.setItem(key, JSON.stringify({
  202 |       schema: key, version: 1, roomId: 'station-zero-r1', passed: true, energy: 100, tick: 100,
  203 |       doorState: 'SEALED', manualOpenIntent: false, sealSourcePresent: true,
  204 |       position: { x: 12.5, y: 5.5 },
  205 |       remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 0, safeClear: 60, regenAcc: 0 },
  206 |       corridor: {
  207 |         template: 'station-zero-r2-v1', position: { x: 9.5, y: 9.5 }, hp: 20,
  208 |         relayEnabled: true, powered: true, bridge: 'STABLE', guardCleared: true, crossed: false,
  209 |         jamRemaining: 0, scanRemaining: 0, reveal: null,
  210 |       },
  211 |     }));
  212 |   }, SLICE_KEY);
  213 |   await page.goto('/station-zero.html');
  214 |   await expect(page.getByTestId('vs01-bridge-state')).toHaveAttribute('data-state', 'STABLE');
  215 |   await walk(page, east, async () => (await coordinate(page, 'x')) >= 12.4);
  216 |   await page.keyboard.press('x');
  217 |   await expect(page.getByTestId('vs01-bridge-state')).toHaveAttribute('data-state', 'UNSTABLE');
  218 |   await expect(page.getByTestId('vs01-health')).toHaveAttribute('data-hp', '0');
  219 |   await expect(page.getByTestId('vs00-complete')).toContainText('本局失败');
  220 |   expect(await page.evaluate((key) => localStorage.getItem(key), SLICE_KEY)).toBeNull();
  221 |   await page.getByTestId('vs00-btn-restart').click();
  222 |   await expect(page.getByTestId('vs00-player-position')).toHaveAttribute('data-x', '3.5');
  223 | });
  224 | 
```