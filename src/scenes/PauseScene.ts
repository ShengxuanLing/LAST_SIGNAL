import Phaser from 'phaser';
import { DEFAULT_SETTINGS, GAME } from '../config/game';
import { UPGRADES } from '../config/upgrades';
import { WEAPONS } from '../config/weapons';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { clearOwnerPairing, peekOwnerPairing } from '../ai-native/ownerPairing';
import {
  MenuPage, UI_NORMAL, UI_COMPACT, resolveUITokens,
  type UITokens, type Focusable, type ButtonHandle
} from '../ui/menuKit';
import { GameScene } from './GameScene';

/**
 * UI-REWORK-01 — unified Pause navigator.
 *
 * One page is on screen at a time; leaving a page destroys every object it
 * created, so a hidden page is never interactive and re-opening a page never
 * stacks duplicates. ESC walks one level back (root ESC resumes); the direct
 * `KeyI` inventory overlay behaves as a single-level overlay (ESC/I resume).
 *
 * Compact tokens: at 800x600/1024x768 the FIT scale is < 0.85, so a compact
 * token set raises the logical font sizes to keep the effective CSS size
 * readable (same criterion as GameScene F-06).
 */
type Page = 'pause' | 'ai' | 'echo' | 'llm' | 'inventory' | 'settings';

const PARENT_PAGE: Record<Page, Page | null> = {
  pause: null,
  ai: 'pause',
  echo: 'ai',
  llm: 'ai',
  inventory: 'pause',
  settings: 'pause'
};

interface StatusModel {
  owner: string;
  aiOn: boolean;
  ext: string;
  echoHp: number | null;
  echoMax: number | null;
  echoMode: string;
  echoAssist: boolean;
  echoSuggestion: boolean;
  linkStatus: string;
  linkError: string;
  optIn: boolean;
  relay: string | null;
}

export class PauseScene extends Phaser.Scene {
  private gameScene!: GameScene;
  private page: Page = 'pause';
  private pageHandle: MenuPage | null = null;
  private dim!: Phaser.GameObjects.Rectangle;
  private closing = false;
  private inventoryFromPause = false;
  private frame = 0;
  private tokens: UITokens = UI_NORMAL;
  private compact = false;

  /** Native DOM form for the loopback bridge URL + masked token + OWNER key. */
  private domForm: HTMLElement | null = null;
  /** Phaser-side click absorber while the DOM form is open, so a pointer that
   *  escapes the DOM bubble cannot activate a menu button underneath. */
  private formBlocker: Phaser.GameObjects.Rectangle | null = null;
  private linkFormMode: 'external' | 'companion' | 'companion-reauth' = 'external';

  // Dynamic state (reset on every page change).
  private inventoryRefresh: (() => void) | null = null;
  private lastInventorySig = '';
  private lastStatusSig = '';
  private lastCompanionSig = '';
  private lastPendingSig: string | null = null;
  private statusTexts: Record<string, Phaser.GameObjects.Text> = {};
  private llmState: Phaser.GameObjects.Text | null = null;
  private llmNotice: Phaser.GameObjects.Text | null = null;
  private llmPending: Phaser.GameObjects.Text | null = null;
  private llmFooter: Phaser.GameObjects.Text | null = null;
  private confirmBtn: ButtonHandle | null = null;
  private rejectBtn: ButtonHandle | null = null;
  private decideEnabled = false;
  private selectedSuggestionId: string | null = null;
  private aiNotice: Phaser.GameObjects.Text | null = null;
  private echoStatus: Phaser.GameObjects.Text | null = null;
  private echoModeText: Phaser.GameObjects.Text | null = null;
  private echoSuggest: Phaser.GameObjects.Text | null = null;
  private btnEchoAssist: ButtonHandle | null = null;
  private pageCleanups: Array<() => void> = [];
  /** Cached Signal opt-in for the status footer (avoids a per-frame save parse). */
  private optInCache = false;

  // Stable handgrips (also used by the UI-REWORK-01 test surface).
  btnResume: ButtonHandle | null = null;
  btnInventory: ButtonHandle | null = null;
  btnSettings: ButtonHandle | null = null;
  btnAi: ButtonHandle | null = null;
  btnQuit: ButtonHandle | null = null;
  btnAiControl: ButtonHandle | null = null;
  btnEcho: ButtonHandle | null = null;
  btnLlm: ButtonHandle | null = null;
  btnAuthorizeExternal: ButtonHandle | null = null;
  btnAiBack: ButtonHandle | null = null;
  btnEchoToggle: ButtonHandle | null = null;
  btnEchoBack: ButtonHandle | null = null;
  btnInventoryClose: ButtonHandle | null = null;
  btnSettingsBack: ButtonHandle | null = null;
  btnLinkSetup: ButtonHandle | null = null;
  btnEnable: ButtonHandle | null = null;
  btnDisconnect: ButtonHandle | null = null;
  btnLlmBack: ButtonHandle | null = null;
  btnResetAudio: ButtonHandle | null = null;
  btnShake: ButtonHandle | null = null;
  btnSignalCollab: ButtonHandle | null = null;
  /** Owner decision controls (ButtonHandle: .rect/.label/.enabled). */
  get confirmHandle(): ButtonHandle | null { return this.confirmBtn; }
  get rejectHandle(): ButtonHandle | null { return this.rejectBtn; }
  /** Backward-compatible read-only aliases (no duplicate controls). */
  get llmConfirm(): ButtonHandle | null { return this.confirmBtn; }
  get llmReject(): ButtonHandle | null { return this.rejectBtn; }

  /** Read-only UI observation interface for the UI-REWORK-01 test surface. */
  get currentPage(): Page { return this.page; }
  get uiObjects(): Phaser.GameObjects.GameObject[] { return this.pageHandle ? this.pageHandle.objects : []; }
  get uiButtons(): ButtonHandle[] { return this.pageHandle ? this.pageHandle.buttons : []; }

  constructor() { super('PauseScene'); }

  create(config?: { mode?: Page }): void {
    this.closing = false;
    this.frame = 0;
    this.gameScene = this.scene.get<GameScene>('GameScene');
    this.optInCache = saveSystem.load().permanent.signalCollaborationOptIn === true;
    this.applyTokens(resolveUITokens());

    const dim = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x04060b, 0.9).setOrigin(0, 0);
    dim.setAlpha(0);
    this.dim = dim;
    this.tweens.add({ targets: dim, alpha: 0.9, duration: 150 });

    this.input.keyboard?.on('keydown-ESC', this.onEsc);
    this.input.keyboard?.on('keydown-I', this.onInventoryKey);
    this.scale.on('resize', this.onResize);
    this.events.once('shutdown', () => {
      this.input.keyboard?.off('keydown-ESC', this.onEsc);
      this.input.keyboard?.off('keydown-I', this.onInventoryKey);
      this.scale.off('resize', this.onResize);
      this.destroyPage();
      this.closeExternalLinkForm();
      this.lastStatusSig = '';
      this.lastCompanionSig = '';
      this.lastPendingSig = null;
      this.gameScene?.setHudVisible(true);
    });

    this.gameScene?.setHudVisible(false);
    this.inventoryFromPause = false;
    this.navigate(config?.mode ?? 'pause');
  }

  update(): void {
    this.frame += 1;
    // Bounded heartbeat: keep a paused companion session alive and let it
    // degrade to a real NO_MODEL state on heartbeat failure. Never advances the
    // game tick.
    const link = this.gameScene?.companionLink;
    if (link && link.status === 'CONNECTED') link.startHeartbeat();
    this.pageHandle?.refresh?.();
  }

  private applyTokens(next: UITokens): void {
    this.tokens = next;
    this.compact = next === UI_COMPACT;
  }

  /** Re-resolve tokens on a real viewport change; only rebuild on a compact flip. */
  private onResize = (): void => {
    if (this.closing) return;
    const next = resolveUITokens();
    if ((next === UI_COMPACT) === this.compact) return;
    this.applyTokens(next);
    this.navigate(this.page);
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private onEsc = (event: KeyboardEvent): void => {
    if (event.repeat || this.closing) return;
    if (this.domForm) return;
    if (this.page === 'inventory') { this.closeInventory(); return; }
    const parent = PARENT_PAGE[this.page];
    if (parent) { this.navigate(parent); return; }
    this.close();
  };

  private onInventoryKey = (event: KeyboardEvent): void => {
    if (event.repeat || this.closing || this.domForm) return;
    if (this.page === 'inventory') this.closeInventory();
  };

  private navigate(page: Page): void {
    this.destroyPage();
    this.page = page;
    const p = new MenuPage(this, this.tokens);
    this.pageHandle = p;
    this.statusTexts = {};
    this.lastStatusSig = '';
    this.lastCompanionSig = '';
    this.selectedSuggestionId = null;
    switch (page) {
      case 'pause': this.buildPause(p); break;
      case 'ai': this.buildAi(p); break;
      case 'echo': this.buildEcho(p); break;
      case 'llm': this.buildLlm(p); break;
      case 'inventory': this.buildInventory(p); break;
      case 'settings': this.buildSettings(p); break;
    }
    p.finishButtons();
  }

  private destroyPage(): void {
    for (const cleanup of this.pageCleanups) { try { cleanup(); } catch { /* ignore */ } }
    this.pageCleanups = [];
    this.pageHandle?.destroy();
    this.pageHandle = null;
    this.inventoryRefresh = null;
    this.lastInventorySig = '';
    this.llmState = null;
    this.llmPending = null;
    this.llmNotice = null;
    this.llmFooter = null;
    this.confirmBtn = null;
    this.rejectBtn = null;
    this.decideEnabled = false;
    this.selectedSuggestionId = null;
    this.lastPendingSig = null;
    this.aiNotice = null;
    this.echoStatus = null;
    this.echoModeText = null;
    this.echoSuggest = null;
    this.btnEchoAssist = null;
    this.btnResume = null;
    this.btnInventory = null;
    this.btnSettings = null;
    this.btnAi = null;
    this.btnQuit = null;
    this.btnAiControl = null;
    this.btnEcho = null;
    this.btnLlm = null;
    this.btnAuthorizeExternal = null;
    this.btnAiBack = null;
    this.btnEchoToggle = null;
    this.btnEchoBack = null;
    this.btnInventoryClose = null;
    this.btnSettingsBack = null;
    this.btnLinkSetup = null;
    this.btnEnable = null;
    this.btnDisconnect = null;
    this.btnLlmBack = null;
    this.btnResetAudio = null;
    this.btnShake = null;
    this.btnSignalCollab = null;
  }

  private closeInventory(): void {
    if (this.inventoryFromPause) this.navigate('pause');
    else this.close();
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    this.destroyPage();
    this.closeExternalLinkForm();
    const gs = this.gameScene;
    // Restore the HUD only after the fade completes (shutdown runs at stop()).
    this.tweens.add({ targets: this.dim, alpha: 0, duration: 120, onComplete: () => {
      this.scene.stop();
      gs?.onResume();
    }});
  }

  private quitToMenu(): void {
    this.gameScene?.saveCheckpoint();
    this.destroyPage();
    this.closeExternalLinkForm();
    // scene.start() only shuts down the calling scene; GameScene would stay
    // active (and paused) underneath the menu, so stop it explicitly.
    this.scene.stop('GameScene');
    this.scene.start('MainMenuScene', {});
  }

  // ---------------------------------------------------------------------------
  // Shared status model (honest, real state only)
  // ---------------------------------------------------------------------------

  private statusModel(): StatusModel {
    const gs = this.gameScene;
    const world = gs.world;
    const control = world.player.control;
    const ext = world.externalLink.snapshot().status;
    const echo = world.echoActor;
    const link = gs.companionLink;
    const signal = world.signalView() as { relay?: string } | null;
    return {
      owner: control.owner,
      aiOn: control.aiEnabled,
      ext,
      echoHp: echo ? echo.data.hp : null,
      echoMax: echo ? echo.data.maxHp : null,
      echoMode: world.echoMode,
      echoAssist: world.echoAssistArmed,
      echoSuggestion: world.echoSuggestion === 'fire',
      linkStatus: link?.status ?? 'OFF',
      linkError: link?.error ?? '',
      optIn: this.optInCache,
      relay: signal?.relay ?? null
    };
  }

  private controlLine(m: StatusModel): string {
    return `CONTROL  ${m.owner === 'external' ? 'EXTERNAL AGENT' : m.aiOn ? 'AI · LOCAL DEMO' : 'HUMAN'}`;
  }

  private aiLine(m: StatusModel): string {
    return `AI CONTROL: ${m.aiOn ? 'ON · LOCAL DETERMINISTIC DEMO' : 'OFF'}`;
  }

  private aiModeLine(m: StatusModel): string {
    return `AI MODE  ${m.aiOn ? 'LOCAL DETERMINISTIC DEMO' : 'OFF'}`;
  }

  private externalLine(m: StatusModel): string {
    return m.ext === 'CONNECTED' ? 'EXTERNAL AGENT  CONNECTED'
      : m.ext === 'LOST' ? 'EXTERNAL AGENT  LINK LOST'
      : m.ext === 'YIELDED' ? 'EXTERNAL AGENT  YIELDED'
      : 'EXTERNAL AGENT  NOT CONNECTED';
  }

  private echoLine(m: StatusModel): string {
    if (m.echoHp === null) return 'ECHO  OFF · NO ACTOR';
    if (m.echoHp <= 0) return `ECHO  DOWN · HP 0/${m.echoMax}`;
    const mode = m.echoMode === 'follow' ? 'FOLLOW' : m.echoMode === 'hold' ? 'HOLD' : 'MOVE';
    const assist = m.echoAssist ? 'ASSIST ARMED' : 'ASSIST SAFE';
    const suggest = m.echoSuggestion ? ' · CONFIRM FIRE' : '';
    return `ECHO  HP ${Math.ceil(m.echoHp)}/${m.echoMax} · ${mode} · ${assist}${suggest}`;
  }

  private companionLine(m: StatusModel): string {
    return `ECHO  ${m.echoHp === null ? 'OFF' : 'ON'} · LLM COMPANION  ${m.linkStatus}`;
  }

  private signalLine(m: StatusModel): string {
    return `SIGNAL COLLABORATION · ${m.optIn ? 'ON' : 'OFF'} · RELAY ${m.relay ?? 'OFF'}`;
  }

  private refreshStatusTexts(): void {
    const m = this.statusModel();
    const sig = [m.owner, m.aiOn, m.ext, m.echoHp, m.echoMode, m.echoAssist, m.echoSuggestion,
      m.linkStatus, m.optIn, m.relay].join('|');
    if (sig === this.lastStatusSig) return;
    this.lastStatusSig = sig;
    const t = this.statusTexts;
    if (t.control) { t.control.setText(this.controlLine(m)); t.control.setColor(m.owner === 'human' ? '#8fb8c8' : '#7ff0ff'); }
    if (t.ai) { t.ai.setText(this.aiLine(m)); t.ai.setColor(m.aiOn ? '#7ff0ff' : '#8fb8c8'); }
    if (t.aiMode) { t.aiMode.setText(this.aiModeLine(m)); t.aiMode.setColor(m.aiOn ? '#7ff0ff' : '#8fb8c8'); }
    if (t.external) { t.external.setText(this.externalLine(m)); t.external.setColor(m.ext === 'CONNECTED' ? '#7ff0ff' : '#ff8a3c'); }
    if (t.echo) { t.echo.setText(this.echoLine(m)); t.echo.setColor(m.echoHp === null ? '#8fb8c8' : '#33e0ff'); }
    if (t.companion) { t.companion.setText(this.companionLine(m)); t.companion.setColor(m.linkStatus === 'CONNECTED' ? '#7ff0ff' : '#8fb8c8'); }
    if (t.llmLink) { t.llmLink.setText(`LLM LINK  ${m.linkStatus}`); t.llmLink.setColor(m.linkStatus === 'CONNECTED' ? '#7ff0ff' : m.linkStatus === 'OFF' ? '#8fb8c8' : '#ff8a3c'); }
    if (t.signal) { t.signal.setText(this.signalLine(m)); t.signal.setColor(m.optIn ? '#00ff77' : '#8fb8c8'); }
  }

  // ---------------------------------------------------------------------------
  // Pause root
  // ---------------------------------------------------------------------------

  private buildPause(p: MenuPage): void {
    const c = this.compact;
    const fx = (n: number, k: number) => (c ? k : n);
    p.title('PAUSED', fx(62, 56));
    p.text(GAME.WINDOW_W / 2, fx(104, 100), 'CONTINUE RESUMES FROM YOUR LAST SAFE CHECKPOINT', {
      fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8'
    });
    const y0 = fx(168, 152);
    const stride = this.tokens.BTN_STRIDE;
    this.btnResume = p.button({ y: y0, label: 'RESUME', tone: 'primary', onClick: () => this.close() });
    this.btnInventory = p.button({ y: y0 + stride, label: 'INVENTORY', onClick: () => {
      this.inventoryFromPause = true;
      this.navigate('inventory');
    }});
    this.btnSettings = p.button({ y: y0 + stride * 2, label: 'SETTINGS', onClick: () => this.navigate('settings') });
    this.btnAi = p.button({ y: y0 + stride * 3, label: 'AI & COMPANION', onClick: () => this.navigate('ai') });
    this.btnQuit = p.button({ y: y0 + stride * 4, label: 'QUIT TO MENU', tone: 'danger', onClick: () => this.quitToMenu() });

    // Independent status footer (never a fake claim, never a control). The
    // rows share words with the AI page on purpose but avoid repeating the same
    // fact twice (control owner + AI mode + link + echo/llm + signal).
    p.head('STATUS', fx(474, 436));
    const rows: Array<[string, number, number]> = [
      ['control', 500, 462], ['ai', 520, 486], ['external', 540, 510],
      ['companion', 560, 534], ['signal', 580, 558]
    ];
    for (const [key, ny, cy] of rows) {
      this.statusTexts[key] = p.text(GAME.WINDOW_W / 2, fx(ny, cy), '', {
        fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8'
      });
    }
    p.text(GAME.WINDOW_W / 2, fx(698, 690), 'ESC RESUME · ↑↓ SELECT · ENTER ACTIVATE', {
      fontSize: this.tokens.SMALL_FONT, color: '#48606b'
    });
    p.refresh = () => this.refreshStatusTexts();
    this.refreshStatusTexts();
  }

  // ---------------------------------------------------------------------------
  // AI & Companion hub
  // ---------------------------------------------------------------------------

  private buildAi(p: MenuPage): void {
    const c = this.compact;
    const fx = (n: number, k: number) => (c ? k : n);
    p.title('AI & COMPANION', fx(54, 56));
    p.text(GAME.WINDOW_W / 2, fx(86, 100), 'HUMAN ALWAYS RETAINS CONTROL · ANY MOVE / FIRE / F RE-CLAIMS IT', {
      fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8'
    });
    p.text(GAME.WINDOW_W / 2, fx(110, 128), 'MODES  HUMAN · LOCAL DETERMINISTIC DEMO · EXTERNAL AGENT', {
      fontSize: this.tokens.SMALL_FONT, color: '#5a7480'
    });
    const rows: Array<[string, number, number]> = [
      ['control', 136, 156], ['aiMode', 160, 182], ['external', 184, 208],
      ['echo', 208, 234], ['llmLink', 232, 260], ['signal', 256, 286]
    ];
    for (const [key, ny, cy] of rows) {
      this.statusTexts[key] = p.text(GAME.WINDOW_W / 2, fx(ny, cy), '', {
        fontSize: this.tokens.BODY_FONT, color: '#cfe8ef'
      });
    }
    this.aiNotice = p.text(GAME.WINDOW_W / 2, fx(280, 314), '', {
      fontSize: this.tokens.SMALL_FONT, color: '#ff8a3c'
    });

    const control = this.gameScene.world.player.control;
    const y0 = fx(316, 348);
    const stride = this.tokens.BTN_STRIDE;
    this.btnAiControl = p.button({
      y: y0, label: `AI CONTROL: ${control.aiEnabled ? 'ON · LOCAL DEMO' : 'OFF'}`,
      onClick: () => { this.gameScene.toggleAiControl(); this.navigate('ai'); }
    });
    this.btnEcho = p.button({ y: y0 + stride, label: 'ECHO COMPANION >', onClick: () => this.navigate('echo') });
    this.btnLlm = p.button({ y: y0 + stride * 2, label: 'LLM COMPANION >', onClick: () => this.navigate('llm') });
    this.btnAuthorizeExternal = p.button({
      y: y0 + stride * 3, label: 'AUTHORIZE EXTERNAL AGENT',
      onClick: () => this.authorizeExternalFromConfig()
    });
    this.btnAiBack = p.button({ y: y0 + stride * 4, label: 'BACK', onClick: () => this.navigate('pause') });
    p.text(GAME.WINDOW_W / 2, fx(690, 690), 'ESC BACK · ↑↓ SELECT · ENTER ACTIVATE', {
      fontSize: this.tokens.SMALL_FONT, color: '#48606b'
    });
    p.refresh = () => this.refreshStatusTexts();
    this.refreshStatusTexts();
  }

  /** HUMAN action: read the host-injected one-shot config and authorize. */
  private authorizeExternalFromConfig(): void {
    const config = (globalThis as unknown as {
      __externalLinkConfig?: { bridgeUrl?: string; token?: string; ownerKey?: string };
    }).__externalLinkConfig;
    const bridgeUrl = config?.bridgeUrl;
    const token = config?.token;
    if (!bridgeUrl || !token) {
      this.aiNotice?.setText('NO BRIDGE CONFIGURED — CONTROL STAYS HUMAN');
      return;
    }
    const stashedKey = peekOwnerPairing(this.gameScene)?.consumeKey() ?? '';
    const ownerKey = stashedKey || (config?.ownerKey ?? '');
    this.aiNotice?.setText('AUTHORIZING…');
    void this.gameScene.authorizeExternalAgent(bridgeUrl, token, ownerKey).then((ok) => {
      if (!ok) {
        clearOwnerPairing(this.gameScene);
        this.aiNotice?.setText('EXTERNAL LINK FAILED — CONTROL STAYS HUMAN');
      } else {
        this.aiNotice?.setText('');
      }
      this.lastStatusSig = '';
      this.refreshStatusTexts();
    });
  }

  // ---------------------------------------------------------------------------
  // ECHO companion
  // ---------------------------------------------------------------------------

  private buildEcho(p: MenuPage): void {
    const gs = this.gameScene;
    const world = gs.world;
    const c = this.compact;
    const fx = (n: number, k: number) => (c ? k : n);
    p.title('ECHO COMPANION', fx(52, 56));
    p.text(GAME.WINDOW_W / 2, fx(84, 100), 'INDEPENDENT ACTOR · OWN 12-TILE PERCEPTION · NEVER DRIVEN BY AN EXTERNAL AGENT', {
      fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8'
    });
    this.echoStatus = p.text(GAME.WINDOW_W / 2, fx(124, 132), '', { fontSize: this.tokens.BODY_FONT, color: '#eafaff' });
    this.echoModeText = p.text(GAME.WINDOW_W / 2, fx(148, 160), '', { fontSize: this.tokens.BODY_FONT, color: '#cfe8ef' });
    this.echoSuggest = p.text(GAME.WINDOW_W / 2, fx(172, 188), '', { fontSize: this.tokens.SMALL_FONT, color: '#5a7480' });

    const y0 = fx(214, 224);
    const stride = this.tokens.BTN_STRIDE;
    this.btnEchoToggle = p.button({
      y: y0, label: world.echoActor ? 'DISABLE ECHO' : 'ENABLE ECHO',
      tone: world.echoActor ? 'danger' : 'neutral',
      onClick: () => {
        if (this.gameScene.world.echoActor) this.gameScene.disableEcho();
        else this.gameScene.enableEcho();
        this.navigate('echo');
      }
    });
    p.button({ y: y0 + stride, label: 'MODE: FOLLOW', onClick: () => { gs.setEchoMode('follow'); this.navigate('echo'); } });
    p.button({ y: y0 + stride * 2, label: 'MODE: HOLD POSITION', onClick: () => { gs.setEchoMode('hold'); this.navigate('echo'); } });
    p.button({ y: y0 + stride * 3, label: 'MODE: MOVE TO AIM', onClick: () => { gs.setEchoMode('move-to'); this.navigate('echo'); } });
    this.btnEchoAssist = p.button({
      y: y0 + stride * 4, label: 'CONFIRM ASSIST FIRE',
      onClick: () => {
        if (this.gameScene.world.echoAssistArmed) gs.revokeEchoAssist(); else gs.confirmEchoAssist();
        this.navigate('echo');
      }
    });
    this.btnEchoBack = p.button({ y: y0 + stride * 4 + fx(78, 70), label: 'BACK', onClick: () => this.navigate('ai') });
    p.text(GAME.WINDOW_W / 2, fx(698, 690), 'ESC BACK · ↑↓ SELECT · ENTER ACTIVATE', {
      fontSize: this.tokens.SMALL_FONT, color: '#48606b'
    });
    p.refresh = () => this.refreshEcho();
    this.refreshEcho(true);
  }

  private refreshEcho(force = false): void {
    if (!force && this.frame % 10 !== 0) return;
    const gs = this.gameScene;
    const world = gs.world;
    const echo = world.echoActor;
    if (this.echoStatus) {
      if (!echo) {
        this.echoStatus.setText('STATUS  DISABLED');
        this.echoStatus.setColor('#ff8a3c');
      } else if (echo.data.hp <= 0) {
        this.echoStatus.setText(`STATUS  DOWN — HP 0/${echo.data.maxHp}`);
        this.echoStatus.setColor('#ff8a3c');
      } else {
        this.echoStatus.setText(`STATUS  HP ${Math.ceil(echo.data.hp)}/${echo.data.maxHp} · ${world.echoMode.toUpperCase()}`);
        this.echoStatus.setColor('#eafaff');
      }
    }
    if (this.echoModeText) {
      this.echoModeText.setText(`MOVEMENT  ${world.echoMode.toUpperCase()} · ${world.echoAssistArmed ? 'ASSIST ARMED' : 'ASSIST SAFE'}`);
    }
    const suggestion = gs.suggestEcho();
    if (this.echoSuggest) {
      this.echoSuggest.setText(suggestion === 'fire'
        ? 'ASSIST READY: an enemy is inside the echo perception cone — confirm below'
        : 'ASSIST: no perceived target — the echo will not fire');
      this.echoSuggest.setColor(suggestion === 'fire' ? '#ffd233' : '#5a7480');
    }
    if (this.btnEchoAssist) {
      this.btnEchoAssist.setLabel(world.echoAssistArmed ? 'ASSIST ARMED — CLICK TO REVOKE' : 'CONFIRM ASSIST FIRE');
      this.btnEchoAssist.setTone(suggestion === 'fire' || world.echoAssistArmed ? 'primary' : 'neutral');
    }
  }

  // ---------------------------------------------------------------------------
  // LLM companion (Owner confirm)
  // ---------------------------------------------------------------------------

  private buildLlm(p: MenuPage): void {
    const c = this.compact;
    const fx = (n: number, k: number) => (c ? k : n);
    p.title('LLM COMPANION', fx(50, 48));
    p.text(GAME.WINDOW_W / 2, fx(82, 78), 'ONLY A HUMAN HERE CAN CONFIRM · THE AGENT HAS NO CONFIRM TOOL', {
      fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8'
    });
    p.head('CONNECTION', fx(108, 104));
    this.llmState = p.text(GAME.WINDOW_W / 2, fx(130, 126), '', { fontSize: this.tokens.BODY_FONT, color: '#eafaff' });
    this.llmNotice = p.text(GAME.WINDOW_W / 2, 150, '', { fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8' });
    this.btnEnable = p.button({
      y: fx(186, 184), label: 'ENABLE / RE-AUTHORIZE (HUMAN)',
      onClick: () => this.openOwnerForm()
    });

    p.head('PENDING PROPOSAL', fx(232, 228));
    this.llmPending = p.text(410, fx(256, 254), '', {
      origin: [0, 0], fontSize: this.compact ? 16 : 13, color: '#8fb8c8', align: 'left', wrapWidth: 460
    });

    const y0 = fx(348, 344);
    const stride = this.tokens.BTN_STRIDE;
    this.rejectBtn = p.button({
      y: y0, label: 'REJECT FIRST PROPOSAL', tone: 'danger', disabled: true,
      onClick: () => this.decide(false)
    });
    this.confirmBtn = p.button({
      y: y0 + stride, label: 'CONFIRM FIRST PROPOSAL (OWNER)', tone: 'primary', disabled: true,
      onClick: () => this.decide(true)
    });
    this.btnDisconnect = p.button({
      y: y0 + stride * 2, label: 'DISCONNECT (NO MODEL)', tone: 'danger',
      onClick: () => { this.gameScene.companionLink?.disconnect(); this.lastCompanionSig = ''; this.refreshLlm(true); }
    });
    this.btnLlmBack = p.button({ y: y0 + stride * 3, label: 'BACK', onClick: () => this.navigate('ai') });
    this.llmFooter = p.text(GAME.WINDOW_W / 2, fx(690, 686), 'CONFIRM ACTS ON THE ▶ LINE ONLY · COMMIT ON THE NEXT CORE TICK', {
      fontSize: this.tokens.SMALL_FONT, color: '#48606b'
    });
    p.refresh = () => { this.refreshStatusTexts(); this.refreshLlm(); };
    this.refreshStatusTexts();
    this.refreshLlm(true);
  }

  private openOwnerForm(): void {
    const gs = this.gameScene;
    if (!gs.world.echoActor) gs.world.enableEcho();
    const link = gs.companionLink;
    // The live-link case MUST reach GameScene.reauthorizeCompanion (atomic
    // capability swap, old suggestions cancelled). openExternalLinkForm sets
    // the mode from its argument, so pass the correct mode here.
    this.openExternalLinkForm(link && link.status === 'CONNECTED' ? 'companion-reauth' : 'companion');
  }

  private decide(confirm: boolean): void {
    const id = this.selectedSuggestionId;
    if (!id) { this.setActionMsg('NO SELECTED PROPOSAL', '#ff8a3c'); return; }
    const link = this.gameScene.companionLink;
    if (!link) return;
    void link.pending().then((pending) => {
      const suggestion = pending.find((s) => s.suggestionId === id);
      if (!suggestion) {
        // Never silently switch to a different pending[0]: the id the human saw
        // is gone (expired or replaced). Refuse and refresh the real list.
        this.selectedSuggestionId = null;
        this.setActionMsg('PROPOSAL CHANGED OR EXPIRED — NOT SENT', '#ff8a3c');
        this.refreshLlm(true);
        return;
      }
      void link.decide(suggestion, confirm ? 'confirm' : 'reject').then(() => {
        this.lastCompanionSig = '';
        this.refreshLlm(true);
      });
    });
  }

  private setActionMsg(text: string, color: string): void {
    if (this.llmFooter) { this.llmFooter.setText(text); this.llmFooter.setColor(color); }
  }

  private refreshLlm(force = false): void {
    const gs = this.gameScene;
    const link = gs.companionLink;
    const status = gs.companionStatus;
    const error = link?.error ?? '';
    const sig = `${status}|${error}`;
    if (force || sig !== this.lastCompanionSig) {
      this.lastCompanionSig = sig;
      if (this.llmState) {
        this.llmState.setText(`STATE  ${status}`);
        this.llmState.setColor(status === 'CONNECTED' ? '#7ff0ff' : '#ff8a3c');
      }
      if (this.llmNotice) {
        this.llmNotice.setText(status === 'CONNECTED'
          ? 'MODEL  CONNECTED — human confirm required'
          : status === 'FALLBACK:NO_MODEL' ? `MODEL  OFFLINE${error ? ` · ${error}` : ''}`
          : status === 'READ_ONLY' ? 'MODEL  READ ONLY — an external agent controls the protagonist'
          : 'MODEL  NOT CONNECTED');
        this.llmNotice.setColor(status === 'CONNECTED' ? '#8fb8c8' : '#ff8a3c');
      }
    }
    if (force || this.frame % 60 === 0) this.refreshPending();
  }

  private refreshPending(): void {
    const link = this.gameScene.companionLink;
    if (!this.llmPending) return;
    if (!link || link.status !== 'CONNECTED') {
      this.llmPending.setText('No pending proposal.');
      this.llmPending.setColor('#8fb8c8');
      this.selectedSuggestionId = null;
      this.setDecideEnabled(false);
      return;
    }
    void link.pending().then((pending) => {
      if (this.page !== 'llm' || !this.llmPending) return;
      const sig = pending.map((s) => s.suggestionId).join(',');
      if (this.lastPendingSig === sig) return;
      this.lastPendingSig = sig;
      if (!pending.length) {
        this.llmPending.setText('No pending proposal.');
        this.llmPending.setColor('#8fb8c8');
        this.selectedSuggestionId = null;
        this.setDecideEnabled(false);
        return;
      }
      // Bind the rendered first row to its id: Confirm/Reject can only ever act
      // on the id shown with ▶.
      this.selectedSuggestionId = pending[0].suggestionId;
      this.llmPending.setText(pending.slice(0, 3).map((s, i) => {
        const marker = i === 0 ? '▶ ' : '   ';
        const target = s.target ? `tgt ${s.target.x.toFixed(1)},${s.target.y.toFixed(1)}` : 'no target';
        const resource = s.kind === 'scan' ? 'energy · SCAN' : s.kind === 'jam' ? 'energy · JAM'
          : s.kind === 'fire' ? 'projectile' : 'movement';
        return `${marker}${s.kind.toUpperCase()} · ${s.reason} · ${target} · ${resource}`;
      }).join('\n'));
      this.llmPending.setColor('#eafaff');
      this.setDecideEnabled(true);
    });
  }

  private setDecideEnabled(enabled: boolean): void {
    this.confirmBtn?.setDisabled(!enabled);
    this.rejectBtn?.setDisabled(!enabled);
    // Never steal focus to CONFIRM: the human must navigate there explicitly.
    this.decideEnabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // Inventory (equip is a queued core command; labels are honest)
  // ---------------------------------------------------------------------------

  private buildInventory(p: MenuPage): void {
    const gs = this.gameScene;
    const player = gs.world.player;
    const c = this.compact;
    const subFont = c ? 16 : 13;
    p.text(GAME.WINDOW_W / 2, 90, 'INVENTORY', { fontSize: 30, color: '#33e0ff', bold: true });
    // Weapons / stats / upgrades form one scrollable region; the title and the
    // CLOSE control stay fixed. The region only scrolls when a very long run
    // makes it overflow (the normal 1280x720 layout fits).
    p.beginRegion();

    p.text(120, 150, 'WEAPON ARSENAL', { origin: [0, 0], fontSize: 18, color: '#ff8a3c' });
    const description = p.text(120, 390, '', { origin: [0, 0], fontSize: c ? 16 : 14, color: '#8fb8c8', wrapWidth: 350 });
    const equipWeapon = (key: string): void => {
      if (this.closing || !player.equipWeapon(key)) return;
      audio.ui();
      refreshWeapons();
    };
    const pendingEquip = (): string | null => gs.world.getPendingEquipWeapon();
    const shortcuts = ['ONE', 'TWO', 'THREE', 'FOUR'];
    const refreshWeaponRows = player.data.weapons.map((w, i) => {
      const def = WEAPONS[w.key];
      const y = 186 + i * 44;
      const name = p.text(120, y, def?.name ?? w.key, { origin: [0, 0], fontSize: 18 });
      p.text(120, y + 20, `level ${w.level} · ${w.magazine > 0 ? `${w.ammo}/${w.magazine}` : '∞ energy'}`, {
        origin: [0, 0], fontSize: subFont, color: '#8fb8c8'
      });
      // The equip control is an interactive Text (stable handgrip for the
      // existing checkpoint test: y = 186/230/274, label EQUIP/EQUIPPED,
      // input.enabled toggles). It is also keyboard-focusable via a focus
      // adapter; focus is shown with the text background, not a new rectangle.
      const equip = p.text(420, y, '', { origin: [0.5, 0], fontSize: subFont });
      equip.setPadding(8, 3, 8, 3);
      equip.setInteractive({ useHandCursor: true });
      equip.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event?.stopPropagation?.();
        equipWeapon(w.key);
      });
      let equipFocused = false;
      const item: Focusable = {
        enabled: true,
        setFocused: (focused) => { equipFocused = focused; paint(); },
        activate: () => { if (item.enabled) equipWeapon(w.key); }
      };
      p.addFocusable(item);
      const shortcut = shortcuts[i];
      if (shortcut) {
        const eventName = `keydown-${shortcut}`;
        const onKey = (event: KeyboardEvent) => { if (!event.repeat) equipWeapon(w.key); };
        this.input.keyboard?.on(eventName, onKey);
        this.pageCleanups.push(() => this.input.keyboard?.off(eventName, onKey));
      }
      function paint(): void {
        const active = player.data.weaponKey === w.key;
        const queued = !active && pendingEquip() === w.key;
        item.enabled = !active;
        name.setColor(active ? '#ffd233' : '#cfe8ef');
        const label = active ? 'EQUIPPED' : queued ? 'QUEUED' : 'EQUIP';
        if (active) equip.disableInteractive();
        else equip.setInteractive({ useHandCursor: true });
        if (equipFocused && !active) equip.setText(label).setColor('#04060b').setBackgroundColor('#33e0ff');
        else equip.setText(label).setColor(active ? '#7ff0ff' : queued ? '#ffd233' : '#eafaff').setBackgroundColor(active ? '#00000000' : '#274a55');
      }
      return paint;
    });
    const refreshWeapons = (): void => {
      refreshWeaponRows.forEach((refresh) => refresh());
      description.setText(player.weapon.description);
    };
    refreshWeapons();
    this.inventoryRefresh = refreshWeapons;
    this.lastInventorySig = this.inventorySig();
    if (player.data.weapons.length > 1) {
      p.text(120, 355, `1–${Math.min(player.data.weapons.length, shortcuts.length)} EQUIP`, {
        origin: [0, 0], fontSize: c ? 16 : 13, color: '#7ff0ff'
      });
    }

    const s = player.data;
    p.text(520, 150, 'STATS', { origin: [0, 0], fontSize: 18, color: '#ff8a3c' });
    const stats = [
      `Level ${s.level}`, `HP ${Math.ceil(s.hp)}/${s.maxHp}`, `Speed ${Math.round(s.speed)}`,
      `Damage ${s.damage.toFixed(2)}`, `Crit ${Math.round(s.critChance * 100)}%`, `Crit Dmg ${s.critDamage.toFixed(2)}x`,
      `Armor ${s.armor}`, `Pierce ${s.pierceCount}`, `Regen ${s.hpRegen}/s`, `Magnet ${Math.round(s.pickupRange)}`,
      `Run credits ${s.currency}`
    ];
    stats.forEach((txt, i) => p.text(520, 186 + i * 26, txt, { origin: [0, 0], fontSize: c ? 16 : 15, color: '#eafaff' }));

    const activeUp = player.data.upgrades.filter((u) => u.level > 0);
    p.text(900, 150, 'RUN UPGRADES', { origin: [0, 0], fontSize: 18, color: '#ff8a3c' });
    if (activeUp.length === 0) p.text(900, 186, 'none yet', { origin: [0, 0], fontSize: c ? 16 : 15, color: '#8fb8c8' });
    activeUp.forEach((u, i) => {
      const def = UPGRADES[u.key];
      p.text(900, 186 + i * 30, `${def ? def.name : u.key}  ${u.level}/${def?.maxLevel ?? 1}`, {
        origin: [0, 0], fontSize: c ? 16 : 15, color: '#eafaff'
      });
    });

    p.endRegion(GAME.WINDOW_H - 52, Math.max(490, 208 + Math.max(0, activeUp.length - 1) * 30));
    this.btnInventoryClose = p.button({ y: GAME.WINDOW_H - 60, label: 'CLOSE', w: 340, onClick: () => this.closeInventory() });
    p.refresh = () => {
      if (!this.inventoryRefresh) return;
      const sig = this.inventorySig();
      if (sig !== this.lastInventorySig) {
        this.lastInventorySig = sig;
        this.inventoryRefresh();
      }
    };
  }

  private inventorySig(): string {
    const world = this.gameScene?.world;
    if (!world) return '';
    return `${world.player.data.weaponKey}|${world.getPendingEquipWeapon() ?? ''}`;
  }

  // ---------------------------------------------------------------------------
  // Settings (grouped by the real persisted settings object)
  // ---------------------------------------------------------------------------

  private buildSettings(p: MenuPage): void {
    const save = saveSystem.load();
    const c = this.compact;
    const fx = (n: number, k: number) => (c ? k : n);
    p.title('SETTINGS', 52);
    p.text(GAME.WINDOW_W / 2, 84, 'APPLIED IMMEDIATELY · SAVED LOCALLY', { fontSize: this.tokens.SMALL_FONT, color: '#8fb8c8' });

    let master = save.settings.masterVolume;
    let sfxVol = save.settings.sfxVolume;
    let screenShake = save.settings.screenShake;

    const apply = (): void => {
      audio.setVolumes(master, sfxVol);
      const latest = saveSystem.load();
      latest.settings.masterVolume = master;
      latest.settings.sfxVolume = sfxVol;
      latest.settings.screenShake = screenShake;
      saveSystem.save(latest);
    };
    const step = (v: number, delta: number): number => Math.max(0, Math.min(1, Math.round((v + delta) * 10) / 10));

    p.head('AUDIO', fx(116, 118));
    const volRow = (label: string, y: number, get: () => number, set: (v: number) => void): void => {
      p.text(400, y, label, { origin: [0, 0.5], fontSize: this.tokens.BODY_FONT, color: '#eafaff' });
      const value = p.text(780, y, `${Math.round(get() * 100)}%`, { fontSize: 18, color: '#eafaff' });
      const applyDelta = (delta: number) => { set(step(get(), delta)); apply(); value.setText(`${Math.round(get() * 100)}%`); };
      p.button({ x: 700, y, w: 40, h: 30, label: '◀', fontSize: 22, tone: 'neutral', onClick: () => applyDelta(-0.1) });
      p.button({ x: 860, y, w: 40, h: 30, label: '▶', fontSize: 22, tone: 'neutral', onClick: () => applyDelta(0.1) });
    };
    volRow('MASTER', fx(148, 148), () => master, (v) => { master = v; });
    volRow('SFX', fx(180, 182), () => sfxVol, (v) => { sfxVol = v; });
    this.btnResetAudio = p.button({ y: 222, w: 300, h: 44, label: 'RESET AUDIO', onClick: () => {
      master = DEFAULT_SETTINGS.masterVolume;
      sfxVol = DEFAULT_SETTINGS.sfxVolume;
      apply();
      this.navigate('settings');
    }});

    p.head('DISPLAY', fx(268, 276));
    this.btnShake = p.button({ y: fx(300, 308), w: 340, h: 44, label: `SCREEN SHAKE: ${screenShake ? 'ON' : 'OFF'}`, onClick: () => {
      screenShake = !screenShake;
      apply();
      this.btnShake?.setLabel(`SCREEN SHAKE: ${screenShake ? 'ON' : 'OFF'}`);
    }});

    p.head('SIGNAL', fx(348, 362));
    let optIn = save.permanent.signalCollaborationOptIn === true;
    this.btnSignalCollab = p.button({
      y: fx(380, 394), w: 420, h: 44, tone: optIn ? 'primary' : 'neutral',
      label: `SIGNAL COLLABORATION · ${optIn ? 'ON' : 'OFF'}`,
      onClick: () => {
        optIn = !optIn;
        this.optInCache = optIn;
        const latest = saveSystem.load();
        latest.permanent.signalCollaborationOptIn = optIn;
        saveSystem.save(latest);
        this.gameScene.world.setSignalCollaborationOptIn(optIn);
        this.btnSignalCollab?.setLabel(`SIGNAL COLLABORATION · ${optIn ? 'ON' : 'OFF'}`);
        this.btnSignalCollab?.setTone(optIn ? 'primary' : 'neutral');
        this.lastStatusSig = '';
      }
    });

    p.head('CONNECTION', fx(428, 448));
    this.btnLinkSetup = p.button({ y: fx(460, 480), w: 380, h: 44, label: 'EXTERNAL LINK SETUP', onClick: () => {
      this.openExternalLinkForm('external');
    }});
    p.text(GAME.WINDOW_W / 2, fx(496, 518), 'HUMAN OWNER FORM · TOKEN + PAIRING KEY MASKED · NEVER STORED', {
      fontSize: this.tokens.SMALL_FONT, color: '#5a7480'
    });
    this.btnSettingsBack = p.button({ y: fx(548, 566), w: 300, label: 'BACK', onClick: () => this.navigate('pause') });
    p.text(GAME.WINDOW_W / 2, fx(690, 690), 'ESC BACK · ↑↓ SELECT · ENTER ACTIVATE', {
      fontSize: this.tokens.SMALL_FONT, color: '#48606b'
    });
  }

  // ---------------------------------------------------------------------------
  // Native DOM external-link / owner-pairing form (unchanged contract)
  // ---------------------------------------------------------------------------

  /** Tear down the DOM form (idempotent). */
  private closeExternalLinkForm(): void {
    if (this.domForm && this.domForm.parentNode) {
      this.domForm.parentNode.removeChild(this.domForm);
    }
    this.domForm = null;
    this.formBlocker?.destroy();
    this.formBlocker = null;
  }

  /**
   * Minimal native DOM form (no framework). It is appended to <body> and only
   * lives while the Settings/LLM panel is open. Typing is isolated from Phaser's
   * window keyboard listeners so W/A/S/D/SPACE cannot take over the pause menu
   * while the player enters a URL/token; ESC closes only this form.
   */
  private openExternalLinkForm(mode: 'external' | 'companion' | 'companion-reauth' = 'external'): void {
    if (this.domForm) return;
    this.linkFormMode = mode;
    const parent = this.gameScene;
    const existing = (globalThis as unknown as { __externalLinkConfig?: { bridgeUrl?: string; token?: string } })
      .__externalLinkConfig;

    const root = document.createElement('div');
    root.setAttribute('data-testid', 'external-link-form');
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(4,6,11,0.82)', 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#eafaff', 'padding:16px', 'box-sizing:border-box'
    ].join(';');
    const panel = document.createElement('form');
    panel.style.cssText = [
      'width:min(560px,94vw)', 'max-height:90vh', 'overflow:auto',
      'background:#0d1822', 'border:2px solid #33e0ff', 'border-radius:6px',
      'padding:18px 20px', 'box-sizing:border-box', 'display:flex',
      'flex-direction:column', 'gap:10px', 'box-shadow:0 0 24px rgba(51,224,255,0.25)'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = mode !== 'external' ? 'COMPANION · HUMAN OWNER PAIRING' : 'EXTERNAL AGENT LINK';
    title.style.cssText = 'font-size:18px;font-weight:700;letter-spacing:2px;color:#33e0ff';
    const note = document.createElement('div');
    note.textContent = mode !== 'external'
      ? 'Enter the host-private OWNER pairing key. It is masked, used once, then cleared. Only this human can authorize the companion. ESC cancels.'
      : 'Local bridge only. Token and Owner pairing key are masked, never saved and never logged. You must click AUTHORIZE. ESC cancels.';
    note.style.cssText = 'font-size:12px;line-height:1.5;color:#8fb8c8';

    const label = (text: string): HTMLLabelElement => {
      const l = document.createElement('label');
      l.textContent = text;
      l.style.cssText = 'font-size:12px;color:#8fb8c8;display:block;margin-top:4px';
      return l;
    };
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.name = 'bridgeUrl';
    urlInput.placeholder = 'http://127.0.0.1:8787';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlInput.value = existing?.bridgeUrl ?? 'http://127.0.0.1:8787';
    urlInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;font:inherit;background:#04060b;color:#eafaff;border:1px solid #274a55;border-radius:4px';

    const tokenInput = document.createElement('input');
    tokenInput.type = 'password';
    tokenInput.name = 'token';
    tokenInput.placeholder = 'bridge token (masked)';
    tokenInput.autocomplete = 'new-password';
    tokenInput.spellcheck = false;
    tokenInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;font:inherit;background:#04060b;color:#eafaff;border:1px solid #274a55;border-radius:4px';

    const ownerKeyInput = document.createElement('input');
    ownerKeyInput.type = 'password';
    ownerKeyInput.name = 'ownerKey';
    ownerKeyInput.placeholder = 'host owner pairing key (masked, 64 hex)';
    ownerKeyInput.autocomplete = 'off';
    ownerKeyInput.spellcheck = false;
    ownerKeyInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;font:inherit;background:#04060b;color:#eafaff;border:1px solid #274a55;border-radius:4px';

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('data-testid', 'external-link-status');
    status.style.cssText = 'font-size:12px;line-height:1.4;color:#8fb8c8;min-height:16px';

    const authorize = document.createElement('button');
    authorize.type = 'submit';
    authorize.textContent = 'AUTHORIZE';
    authorize.style.cssText = 'padding:10px 14px;font:inherit;font-weight:700;letter-spacing:2px;color:#04060b;background:#33e0ff;border:0;border-radius:4px;cursor:pointer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'CANCEL';
    cancel.style.cssText = 'padding:10px 14px;font:inherit;color:#eafaff;background:#274a55;border:0;border-radius:4px;cursor:pointer';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
    row.append(cancel, authorize);

    panel.append(title, note, label('BRIDGE URL'), urlInput, label('TOKEN'), tokenInput,
      label('OWNER PAIRING KEY · from host private OWNER_KEY_FILE'), ownerKeyInput, status, row);
    root.append(panel);
    // Bubble-phase stop: the input still receives typing, but Phaser's window
    // keyboard listeners never see it (no takeover). ESC closes ONLY this form.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(type, (event) => event.stopPropagation());
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      root.addEventListener(type, (event) => event.stopPropagation());
    }
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeExternalLinkForm();
      }
    });
    root.addEventListener('submit', (event) => event.preventDefault());

    const setStatus = (text: string, color: string): void => {
      status.textContent = text;
      status.style.color = color;
    };

    cancel.addEventListener('click', () => { this.closeExternalLinkForm(); });

    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const bridgeUrl = urlInput.value.trim();
      const token = tokenInput.value;
      if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(bridgeUrl)) {
        setStatus('BRIDGE URL must be a local http://127.0.0.1:PORT or http://localhost:PORT', '#ff8a3c');
        return;
      }
      if (token.length < 16) {
        setStatus('TOKEN is empty or too short', '#ff8a3c');
        return;
      }
      const ownerKey = ownerKeyInput.value.trim();
      if (!/^[0-9a-f]{64}$/.test(ownerKey)) {
        setStatus('OWNER PAIRING KEY must be 64 hex characters from OWNER_KEY_FILE', '#ff8a3c');
        return;
      }
      // Clear BOTH secrets from the DOM immediately; the raw key goes only into
      // the module-private link, never a global.
      tokenInput.value = '';
      ownerKeyInput.value = '';
      if (this.linkFormMode === 'companion-reauth') {
        // Re-authorize the EXISTING live link: atomic capability swap, old
        // suggestions cancelled. Never creates a second CompanionLink.
        setStatus('RE-AUTHORIZING…', '#ffd233');
        void parent.reauthorizeCompanion(ownerKey).then((ok) => {
          clearOwnerPairing(parent);
          if (ok) {
            setStatus('RE-AUTHORIZED · capability swapped', '#7ff0ff');
            this.closeExternalLinkForm();
            this.lastCompanionSig = '';
            this.refreshLlm(true);
          } else {
            // Be honest about the real post-failure state: the renderer may have
            // degraded the link (CompanionLink.authorize clears its cap on a
            // rejected reauth). Never claim "unchanged" when it is not.
            const real = parent.companionStatus;
            setStatus(real === 'CONNECTED'
              ? 'RE-AUTH FAILED — active connection unchanged'
              : `RE-AUTH FAILED — link ${real}`, '#ff8a3c');
            this.lastCompanionSig = '';
            this.refreshLlm(true);
          }
        });
        return;
      }
      if (this.linkFormMode === 'companion') {
        setStatus('PAIRING OWNER…', '#ffd233');
        void parent.authorizeCompanion(bridgeUrl, token, ownerKey).then((ok) => {
          if (ok) {
            setStatus('CONNECTED · Owner authority registered', '#7ff0ff');
            this.closeExternalLinkForm();
            this.lastCompanionSig = '';
          } else {
            setStatus('FAILED · owner pairing rejected — control stays human', '#ff8a3c');
          }
        });
        return;
      }
      // External agent link: use the explicit form parameters only. Never write
      // bridgeUrl/token into a window global.
      setStatus('AUTHORIZING…', '#ffd233');
      void parent.authorizeExternalAgent(bridgeUrl, token, ownerKey).then((ok) => {
        if (ok) {
          this.lastStatusSig = '';
          this.refreshStatusTexts();
          setStatus('CONNECTED · external agent link is live', '#7ff0ff');
          this.closeExternalLinkForm();
        } else {
          const error = parent.getExternalLinkError();
          setStatus(
            `FAILED · ${error ? `${error.code} ${error.messageKey}` : 'world.bridge_unreachable'} — control stays human`,
            '#ff8a3c'
          );
        }
      });
    });

    document.body.append(root);
    this.domForm = root;
    // Absorb any pointer event that escapes the DOM bubble so it can never
    // activate a Pause button at the same screen position.
    this.formBlocker = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x000000, 0)
      .setOrigin(0, 0).setDepth(10000).setInteractive();
    urlInput.focus();
  }
}
