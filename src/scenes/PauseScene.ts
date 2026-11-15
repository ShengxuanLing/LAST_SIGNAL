import Phaser from 'phaser';
import { DEFAULT_SETTINGS, GAME } from '../config/game';
import { UPGRADES } from '../config/upgrades';
import { WEAPONS } from '../config/weapons';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { clearOwnerPairing, peekOwnerPairing, stashOwnerPairing } from '../ai-native/ownerPairing';
import { GameScene } from './GameScene';

export class PauseScene extends Phaser.Scene {
  private inventoryRefresh: (() => void) | null = null;
  private lastInventorySig = '';
  /** C3-b: live external-link status / owner labels rendered by this overlay. */
  private externalStatusText: Phaser.GameObjects.Text | null = null;
  private controlText: Phaser.GameObjects.Text | null = null;
  private lastExternalSig = '';
  /** Native DOM form for the loopback bridge URL + masked token + OWNER key. */
  private externalLinkForm: HTMLElement | null = null;
  private linkFormMode: 'external' | 'companion' = 'external';

  constructor() { super('PauseScene'); }

  /** The inventory overlay is not itself paused, so it can observe the core
   *  commit that happens on the resume tick and refresh its labels. */
  update(): void {
    this.refreshExternalLabels();
    if (!this.inventoryRefresh) return;
    const sig = this.inventorySig();
    if (sig !== this.lastInventorySig) {
      this.lastInventorySig = sig;
      this.inventoryRefresh();
    }
  }

  /** The overlay stays alive while paused, so the link/owner labels must
   *  reflect the real state (a human AUTHORIZE click happens right here). */
  private refreshExternalLabels(): void {
    const world = this.scene.get<GameScene>('GameScene')?.world;
    if (!world) return;
    const status = world.externalLink.snapshot().status;
    const owner = world.player.control.owner;
    const sig = `${status}|${owner}`;
    if (sig === this.lastExternalSig) return;
    this.lastExternalSig = sig;
    if (this.externalStatusText) {
      this.externalStatusText.setText(status === 'CONNECTED' ? 'EXTERNAL AGENT  CONNECTED'
        : status === 'LOST' ? 'EXTERNAL AGENT  LINK LOST'
        : status === 'YIELDED' ? 'EXTERNAL AGENT  YIELDED'
        : 'EXTERNAL AGENT  NOT CONNECTED');
      this.externalStatusText.setColor(status === 'CONNECTED' ? '#7ff0ff' : '#ff8a3c');
    }
    if (this.controlText) {
      const control = world.player.control;
      this.controlText.setText(`CONTROL  ${owner.toUpperCase()} · ${owner === 'external' ? 'EXTERNAL AGENT' : control.aiEnabled ? 'LOCAL DETERMINISTIC DEMO' : 'HUMAN ONLY'}`);
    }
  }

  private inventorySig(): string {
    const parent = this.scene.get('GameScene') as GameScene | undefined;
    const world = parent?.world;
    if (!world) return '';
    return `${world.player.data.weaponKey}|${world.getPendingEquipWeapon() ?? ''}`;
  }

  create(config?: { mode?: 'pause' | 'inventory' | 'echo' | 'companion' }): void {
    const mode = config?.mode ?? 'pause';
    const parent = this.scene.get<GameScene>('GameScene');
    const player = parent.world.player;

    // dim overlay (not interactive, so it cannot steal clicks from the buttons)
    const dim = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x04060b, 0.82)
      .setOrigin(0, 0);
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 0.82, duration: 150 });

    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      this.tweens.add({ targets: dim, alpha: 0, duration: 150, onComplete: () => {
        this.scene.stop();
        if (parent) parent.onResume();
      }});
    };
    const closeFromKey = (event: KeyboardEvent) => {
      if (!event.repeat) close();
    };
    this.input.keyboard?.on('keydown-ESC', closeFromKey);
    if (mode === 'inventory') this.input.keyboard?.on('keydown-I', closeFromKey);
    this.events.once('shutdown', () => {
      this.input.keyboard?.off('keydown-ESC', closeFromKey);
      this.input.keyboard?.off('keydown-I', closeFromKey);
      this.inventoryRefresh = null;
      this.lastInventorySig = '';
      // Scene instances are reused across restart(): clear references to
      // destroyed Text objects, otherwise update() can touch a stale object.
      this.externalStatusText = null;
      this.controlText = null;
      this.lastExternalSig = '';
      this.closeExternalLinkForm();
    });

    if (mode === 'inventory') {
      this.add.text(GAME.WINDOW_W / 2, 90, 'INVENTORY', { fontFamily: 'monospace', fontSize: '30px', color: '#33e0ff', fontStyle: 'bold' }).setOrigin(0.5, 0.5);

      // weapons
      this.add.text(120, 150, 'WEAPON ARSENAL', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      const description = this.add.text(120, 390, '', {
        fontFamily: 'monospace', fontSize: '14px', color: '#8fb8c8', wordWrap: { width: 350 }
      });
      const equipWeapon = (key: string) => {
        if (closing || !player.equipWeapon(key)) return;
        audio.ui();
        refreshWeapons();
      };
      // The inventory overlay pauses the world, so an equip command commits on
      // the first normal tick after the overlay closes. Until then the UI must
      // show the requested selection as PENDING instead of pretending it is
      // already equipped (the core state is unchanged until the commit).
      const pendingEquip = () => parent.world.getPendingEquipWeapon();
      const shortcuts = ['ONE', 'TWO', 'THREE', 'FOUR'];
      const refreshWeaponRows = player.data.weapons.map((w, i) => {
        const def = WEAPONS[w.key];
        const y = 186 + i * 44;
        const name = this.add.text(120, y, def?.name ?? w.key, { fontFamily: 'monospace', fontSize: '18px' });
        this.add.text(120, y + 20, `level ${w.level} · ${w.magazine > 0 ? `${w.ammo}/${w.magazine}` : '∞ energy'}`, { fontFamily: 'monospace', fontSize: '13px', color: '#8fb8c8' });
        const equip = this.add.text(420, y, '', {
          fontFamily: 'monospace', fontSize: '13px', padding: { x: 8, y: 3 }
        }).setOrigin(0.5, 0);
        equip.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          equipWeapon(w.key);
        });
        const shortcut = shortcuts[i];
        if (shortcut) {
          const eventName = `keydown-${shortcut}`;
          const onKey = (event: KeyboardEvent) => {
            if (!event.repeat) equipWeapon(w.key);
          };
          this.input.keyboard?.on(eventName, onKey);
          this.events.once('shutdown', () => this.input.keyboard?.off(eventName, onKey));
        }
        return () => {
          const active = player.data.weaponKey === w.key;
          const queued = !active && pendingEquip() === w.key;
          name.setColor(active ? '#ffd233' : '#cfe8ef');
          const label = active ? 'EQUIPPED' : queued ? 'QUEUED' : 'EQUIP';
          equip.setText(label)
            .setColor(active ? '#7ff0ff' : queued ? '#ffd233' : '#eafaff')
            .setBackgroundColor(active ? '#00000000' : '#274a55');
          if (active) equip.disableInteractive();
          else equip.setInteractive({ useHandCursor: true });
        };
      });
      const refreshWeapons = () => {
        refreshWeaponRows.forEach((refresh) => refresh());
        description.setText(player.weapon.description);
      };
      refreshWeapons();
      // Committed state may change on the resume tick; keep the labels in sync.
      this.inventoryRefresh = refreshWeapons;
      this.lastInventorySig = this.inventorySig();
      if (player.data.weapons.length > 1) {
        this.add.text(120, 355, `1–${Math.min(player.data.weapons.length, shortcuts.length)} EQUIP`, {
          fontFamily: 'monospace', fontSize: '13px', color: '#7ff0ff'
        });
      }

      // stats
      const s = player.data;
      this.add.text(520, 150, 'STATS', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      const stats = [
        `Level ${s.level}`, `HP ${Math.ceil(s.hp)}/${s.maxHp}`, `Speed ${Math.round(s.speed)}`,
        `Damage ${s.damage.toFixed(2)}`, `Crit ${Math.round(s.critChance * 100)}%`, `Crit Dmg ${s.critDamage.toFixed(2)}x`,
        `Armor ${s.armor}`, `Pierce ${s.pierceCount}`, `Regen ${s.hpRegen}/s`, `Magnet ${Math.round(s.pickupRange)}`,
        `Run credits ${s.currency}`
      ];
      stats.forEach((txt, i) => this.add.text(520, 186 + i * 26, txt, { fontFamily: 'monospace', fontSize: '15px', color: '#eafaff' }));

      // upgrades
      const activeUp = player.data.upgrades.filter((u) => u.level > 0);
      this.add.text(900, 150, 'RUN UPGRADES', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      if (activeUp.length === 0) this.add.text(900, 186, 'none yet', { fontFamily: 'monospace', fontSize: '15px', color: '#8fb8c8' });
      activeUp.forEach((u, i) => {
        const def = UPGRADES[u.key];
        this.add.text(900, 186 + i * 30, `${def ? def.name : u.key}  ${u.level}/${def?.maxLevel ?? 1}`, { fontFamily: 'monospace', fontSize: '15px', color: '#eafaff' });
      });

      this._button(GAME.WINDOW_W / 2, GAME.WINDOW_H - 60, 'CLOSE', close, 0x274a55);
    } else if (mode === 'echo') {
      this.echoPanel(parent, close);
    } else if (mode === 'companion') {
      this.companionPanel(parent);
    } else {
      // pause menu
      this.add.text(GAME.WINDOW_W / 2, 150, 'PAUSED', { fontFamily: 'monospace', fontSize: '48px', color: '#33e0ff', fontStyle: 'bold', letterSpacing: 6 }).setOrigin(0.5, 0.5);
      this._button(GAME.WINDOW_W / 2, 300, 'RESUME', close, 0x33e0ff);
      this._button(GAME.WINDOW_W / 2, 360, 'INVENTORY', () => this.scene.restart({ mode: 'inventory' }), 0x274a55);
      this._button(GAME.WINDOW_W / 2, 420, 'SETTINGS', () => this.showSettings(), 0x274a55);
      this._button(GAME.WINDOW_W / 2, 480, 'QUIT TO MENU', () => {
        parent.saveCheckpoint();
        // scene.start() only shuts down the calling scene; GameScene would stay
        // active (and paused) underneath the menu. Stop it explicitly so a later
        // NEW RUN boots a fresh, unpaused run.
        this.scene.stop('GameScene');
        this.scene.start('MainMenuScene', {});
      }, 0x5a2a3a);
      // AI-NATIVE-02 P1 development entry in the real World. It is honestly
      // labelled as a local deterministic demo; no external agent is attached.
      const control = parent.world.player.control;
      this._button(GAME.WINDOW_W / 2, 540, `AI CONTROL: ${control.aiEnabled ? 'ON · LOCAL DEMO' : 'OFF'}`, () => {
        parent.toggleAiControl();
        this.scene.restart({ mode: 'pause' });
      }, 0x274a55);
      this.controlText = this.add.text(GAME.WINDOW_W / 2, 585, `CONTROL  ${control.owner.toUpperCase()} · ${control.aiEnabled ? 'LOCAL DETERMINISTIC DEMO' : 'HUMAN ONLY'}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#8fb8c8'
      }).setOrigin(0.5);
      // C3-b: the human explicitly authorizes an external agent link. The
      // bridge URL/token come from the host page configuration (never typed
      // here, never logged, never part of the scene text).
      const externalState = parent.world.externalLink.snapshot();
      const externalLabel = externalState.status === 'CONNECTED' ? 'EXTERNAL AGENT  CONNECTED'
        : externalState.status === 'LOST' ? 'EXTERNAL AGENT  LINK LOST'
        : externalState.status === 'YIELDED' ? 'EXTERNAL AGENT  YIELDED'
        : 'EXTERNAL AGENT  NOT CONNECTED';
      this.externalStatusText = this.add.text(GAME.WINDOW_W / 2, 605, externalLabel, {
        fontFamily: 'monospace', fontSize: '12px', color: externalState.status === 'CONNECTED' ? '#7ff0ff' : '#ff8a3c'
      }).setOrigin(0.5);
      const authorizeExternal = this.add.text(GAME.WINDOW_W / 2, 622, 'AUTHORIZE EXTERNAL AGENT', {
        fontFamily: 'monospace', fontSize: '12px', color: '#eafaff', backgroundColor: '#274a55'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      authorizeExternal.on('pointerdown', () => {
        audio.ui();
        const config = (globalThis as unknown as {
          __externalLinkConfig?: { bridgeUrl?: string; token?: string };
        }).__externalLinkConfig;
        const bridgeUrl = config?.bridgeUrl;
        const token = config?.token;
        if (!bridgeUrl || !token) {
          this.add.text(GAME.WINDOW_W / 2, 638, 'NO BRIDGE CONFIGURED — CONTROL STAYS HUMAN', {
            fontFamily: 'monospace', fontSize: '11px', color: '#ff8a3c'
          }).setOrigin(0.5);
          return;
        }
        const stashedKey = peekOwnerPairing(parent)?.consumeKey() ?? '';
        const configKey = (config as { ownerKey?: string })?.ownerKey ?? '';
        const ownerKey = stashedKey || configKey;
        void parent.authorizeExternalAgent(bridgeUrl, token, ownerKey).then((ok) => {
          if (!ok) clearOwnerPairing(parent);
          this.lastExternalSig = '';
          this.refreshExternalLabels();
          if (!ok) {
            this.add.text(GAME.WINDOW_W / 2, 638, 'EXTERNAL LINK FAILED — CONTROL STAYS HUMAN', {
              fontFamily: 'monospace', fontSize: '11px', color: '#ff8a3c'
            }).setOrigin(0.5);
          }
        });
      });
      this.add.text(GAME.WINDOW_W / 2, 625, 'ANY MOVE / FIRE INPUT TAKES HUMAN CONTROL', {
        fontFamily: 'monospace', fontSize: '12px', color: '#5a7480'
      }).setOrigin(0.5);
      const companionLink = this.add.text(140, 230, 'LLM COMPANION >', {
        fontFamily: 'monospace', fontSize: '16px', color: '#7ff0ff', backgroundColor: '#274a55'
      }).setOrigin(0, 0).setPadding(10, 8, 10, 8).setInteractive({ useHandCursor: true });
      companionLink.on('pointerdown', () => {
        audio.ui();
        this.scene.restart({ mode: 'companion' });
      });
      const echoLink = this.add.text(140, 200, 'ECHO COMPANION >', {
        fontFamily: 'monospace', fontSize: '16px', color: '#33e0ff', backgroundColor: '#274a55'
      }).setOrigin(0, 0).setPadding(10, 8, 10, 8).setInteractive({ useHandCursor: true });
      echoLink.on('pointerdown', () => {
        audio.ui();
        this.scene.restart({ mode: 'echo' });
      });
      this.add.text(GAME.WINDOW_W / 2, 655, 'CONTINUE RESUMES FROM YOUR LAST SAFE CHECKPOINT', {
        fontFamily: 'monospace', fontSize: '14px', color: '#8fb8c8'
      }).setOrigin(0.5);
    }
  }

  /**
   * P3-a echo panel. Every command goes through this pause entry, so no gameplay
   * key binding is stolen. The human is always the protagonist's controller.
   */
  private echoPanel(parent: GameScene, close: () => void): void {
    const world = parent.world;
    const title = (y: number, text: string, size: string, color: string) =>
      this.add.text(GAME.WINDOW_W / 2, y, text, { fontFamily: 'monospace', fontSize: size, color }).setOrigin(0.5);
    title(130, 'ECHO COMPANION', '40px', '#33e0ff');
    title(172, 'Independent actor · own 12-tile perception · never driven by an external agent', '13px', '#8fb8c8');

    const echo = world.echoActor;
    const status = !echo ? 'DISABLED — the original solo run is unchanged'
      : echo.data.hp <= 0 ? `DOWN — HP 0/${echo.data.maxHp} (the protagonist is unaffected)`
      : `HP ${Math.ceil(echo.data.hp)}/${echo.data.maxHp} · ${world.echoMode.toUpperCase()} · ${world.echoAssistArmed ? 'ASSIST ARMED' : 'ASSIST SAFE'}`;
    title(210, status, '15px', echo && echo.data.hp > 0 ? '#eafaff' : '#ff8a3c');

    const suggestion = parent.suggestEcho();
    title(240, suggestion === 'fire'
      ? 'ASSIST READY: an enemy is inside the echo perception cone — confirm below'
      : 'ASSIST: no perceived target — the echo will not fire', '13px', suggestion === 'fire' ? '#ffd233' : '#5a7480');

    const redraw = () => this.scene.restart({ mode: 'echo' });
    this._button(GAME.WINDOW_W / 2, 300, echo ? 'DISABLE ECHO' : 'ENABLE ECHO', () => {
      if (echo) parent.disableEcho(); else parent.enableEcho();
      redraw();
    }, echo ? 0x5a2a3a : 0x274a55);
    this._button(GAME.WINDOW_W / 2, 356, `MODE: ${world.echoMode === 'follow' ? 'FOLLOW' : world.echoMode === 'hold' ? 'HOLD' : 'MOVE'}  >  FOLLOW`, () => {
      parent.setEchoMode('follow'); redraw();
    }, 0x274a55);
    this._button(GAME.WINDOW_W / 2, 412, 'MODE: HOLD POSITION', () => {
      parent.setEchoMode('hold'); redraw();
    }, 0x274a55);
    this._button(GAME.WINDOW_W / 2, 468, 'MODE: MOVE TO AIM', () => {
      parent.setEchoMode('move-to'); redraw();
    }, 0x274a55);
    this._button(GAME.WINDOW_W / 2, 524, world.echoAssistArmed ? 'ASSIST ARMED — CLICK TO REVOKE' : 'CONFIRM ASSIST FIRE', () => {
      if (world.echoAssistArmed) parent.revokeEchoAssist(); else parent.confirmEchoAssist();
      redraw();
    }, suggestion === 'fire' ? 0x4a4420 : 0x274a55);
    this._button(GAME.WINDOW_W / 2, 592, 'BACK', close, 0x33e0ff);
    this.add.text(GAME.WINDOW_W / 2, 650, 'ANY MOVE / FIRE INPUT TAKES HUMAN CONTROL OF THE PROTAGONIST', {
      fontFamily: 'monospace', fontSize: '12px', color: '#5a7480'
    }).setOrigin(0.5);
  }

  /** P3-b A: Owner-only Companion panel. NO confirm capability leaves this scene. */
  private companionPanel(parent: GameScene): void {
    const title = (y: number, text: string, size: string, color: string) =>
      this.add.text(GAME.WINDOW_W / 2, y, text, { fontFamily: 'monospace', fontSize: size, color }).setOrigin(0.5);
    title(120, 'LLM COMPANION · OWNER CONFIRM', '34px', '#33e0ff');
    title(160, 'Only a human here can confirm. The agent MCP has NO confirm tool.', '13px', '#8fb8c8');
    const stateText = title(210, `STATE ${parent.companionStatus}`, '18px', '#eafaff');
    const listText = title(270, 'WAITING FOR SUGGESTIONS', '15px', '#8fb8c8');

    const redraw = (): void => {
      stateText.setText(`STATE ${parent.companionStatus}`);
      if (!parent.companionLink) {
        listText.setText('NOT CONNECTED · NO MODEL (no fake connected state)');
        return;
      }
      if (parent.companionStatus === 'READ_ONLY') {
        listText.setText('READ ONLY · AI/External controls the protagonist');
        return;
      }
      void parent.companionLink.pending().then((pending) => {
        if (!pending.length) {
          listText.setText('WAITING · no proposal / expired');
          return;
        }
        listText.setText(pending.slice(0, 4).map((p) =>
          `${p.kind.toUpperCase()} · ${p.reason} · ${p.target ? `(${p.target.x.toFixed(1)},${p.target.y.toFixed(1)})` : 'no target'}`
        ).join('   |   '));
      });
    };
    redraw();

    this._button(GAME.WINDOW_W / 2, 340, 'ENABLE / RE-AUTHORIZE (HUMAN)', () => {
      if (!parent.world.echoActor) parent.world.enableEcho();
      // The host-private pairing key is entered into a masked DOM form; it is
      // never injected into a global config or shown to an Agent route.
      this.linkFormMode = 'companion';
      this.openExternalLinkForm('companion');
    }, 0x274a55);
    this._button(GAME.WINDOW_W / 2, 400, 'REJECT FIRST PROPOSAL', () => {
      const link = parent.companionLink;
      if (!link) return;
      void link.pending().then((pending) => {
        if (pending.length) void link.decide(pending[0], 'reject').then(redraw);
      });
    }, 0x5a2a3a);
    this._button(GAME.WINDOW_W / 2, 460, 'CONFIRM FIRST PROPOSAL (OWNER)', () => {
      const link = parent.companionLink;
      if (!link) return;
      void link.pending().then((pending) => {
        if (pending.length) void link.decide(pending[0], 'confirm').then(redraw);
      });
    }, 0x33e0ff);
    this._button(GAME.WINDOW_W / 2, 520, 'DISCONNECT (NO MODEL)', () => {
      parent.companionLink?.disconnect();
      redraw();
    }, 0x5a2a3a);
    this._button(GAME.WINDOW_W / 2, 600, 'BACK', () => this.scene.restart({ mode: 'pause' }), 0x274a55);
    this.add.text(GAME.WINDOW_W / 2, 650, 'CONFIRMED ACTIONS ARE COMMITTED BY THE NEXT CORE TICK · NO FORCED FLUSH', {
      fontFamily: 'monospace', fontSize: '12px', color: '#5a7480'
    }).setOrigin(0.5);
  }

  private showSettings(): void {
    const save = saveSystem.load();
    // Transparent input blocker: Phaser input is top-only, so this swallows clicks
    // that would otherwise land on the pause-menu buttons underneath.
    const blocker = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x000000, 0)
      .setOrigin(0, 0).setInteractive();
    const panel = this.add.rectangle(GAME.WINDOW_W / 2, 403, 780, 310, 0x0d1822);
    const wrap = this.add.container(GAME.WINDOW_W / 2, 300);

    const vol = this.add.text(0, 0, `MASTER ${Math.round(save.settings.masterVolume * 100)}%`, { fontFamily: 'monospace', fontSize: '18px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    const sfx = this.add.text(0, 40, `SFX ${Math.round(save.settings.sfxVolume * 100)}%`, { fontFamily: 'monospace', fontSize: '18px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    wrap.add([vol, sfx]);

    const arrow = (x: number, y: number, label: string) => this.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize: '24px', color: '#33e0ff', backgroundColor: '#0d1822'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    const masterLeft = arrow(-160, 0, '◀');
    const masterRight = arrow(160, 0, '▶');
    const sfxLeft = arrow(-160, 40, '◀');
    const sfxRight = arrow(160, 40, '▶');
    wrap.add([masterLeft, masterRight, sfxLeft, sfxRight]);

    let master = save.settings.masterVolume;
    let sfxVol = save.settings.sfxVolume;
    let screenShake = save.settings.screenShake;
    const shake = this.add.text(0, 70, '', {
      fontFamily: 'monospace', fontSize: '16px', color: '#eafaff', backgroundColor: '#274a55'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    shake.setText(`SCREEN SHAKE ${screenShake ? 'ON' : 'OFF'}`);
    wrap.add(shake);
    const apply = () => {
      vol.setText(`MASTER ${Math.round(master * 100)}%`);
      sfx.setText(`SFX ${Math.round(sfxVol * 100)}%`);
      audio.setVolumes(master, sfxVol);
      const latest = saveSystem.load();
      latest.settings.masterVolume = master;
      latest.settings.sfxVolume = sfxVol;
      latest.settings.screenShake = screenShake;
      saveSystem.save(latest);
    };
    const step = (v: number, delta: number) => Math.max(0, Math.min(1, Math.round((v + delta) * 10) / 10));
    masterLeft.on('pointerdown', () => { master = step(master, -0.1); apply(); audio.ui(); });
    masterRight.on('pointerdown', () => { master = step(master, 0.1); apply(); audio.ui(); });
    sfxLeft.on('pointerdown', () => { sfxVol = step(sfxVol, -0.1); apply(); audio.ui(); });
    sfxRight.on('pointerdown', () => { sfxVol = step(sfxVol, 0.1); apply(); audio.ui(); });

    shake.on('pointerdown', () => {
      screenShake = !screenShake;
      shake.setText(`SCREEN SHAKE ${screenShake ? 'ON' : 'OFF'}`);
      apply();
      audio.ui();
    });
    const reset = this.add.text(0, 105, 'RESET AUDIO', {
      fontFamily: 'monospace', fontSize: '14px', color: '#eafaff', backgroundColor: '#274a55'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    reset.on('pointerdown', () => {
      master = DEFAULT_SETTINGS.masterVolume;
      sfxVol = DEFAULT_SETTINGS.sfxVolume;
      apply();
      audio.ui();
    });
    const hint = this.add.text(0, 175, 'ESC RESUME', { fontFamily: 'monospace', fontSize: '12px', color: '#8fb8c8' }).setOrigin(0.5);
    const back = this.add.text(0, 140, 'BACK', { fontFamily: 'monospace', fontSize: '14px', color: '#8fb8c8', backgroundColor: '#0d1822' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    // Native input entry: a normal player can configure the local bridge
    // WITHOUT opening the browser console. The token is masked, never saved,
    // never logged and cleared from the DOM immediately after submission.
    const linkSetup = this.add.text(0, 210, 'EXTERNAL LINK SETUP', {
      fontFamily: 'monospace', fontSize: '14px', color: '#eafaff', backgroundColor: '#274a55'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    linkSetup.on('pointerdown', () => {
      audio.ui();
      this.openExternalLinkForm();
    });
    wrap.add([reset, hint, back, linkSetup]);
    back.on('pointerdown', () => {
      audio.ui();
      this.closeExternalLinkForm();
      blocker.destroy();
      panel.destroy();
      wrap.destroy();
      this.scene.restart({ mode: 'pause' });
    });
  }

  /** Tear down the DOM form (idempotent). */
  private closeExternalLinkForm(): void {
    if (this.externalLinkForm && this.externalLinkForm.parentNode) {
      this.externalLinkForm.parentNode.removeChild(this.externalLinkForm);
    }
    this.externalLinkForm = null;
  }

  /**
   * Minimal native DOM form (no framework). It is appended to <body> and only
   * lives while the Settings panel is open. Typing is isolated from Phaser's
   * window keyboard listeners so W/A/S/D/SPACE/ESC cannot take over or close
   * the pause menu while the player enters a URL/token.
   */
  private openExternalLinkForm(mode: 'external' | 'companion' = 'external'): void {
    if (this.externalLinkForm) return;
    this.linkFormMode = mode;
    const parent = this.scene.get<GameScene>('GameScene');
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
    title.textContent = mode === 'companion' ? 'COMPANION · HUMAN OWNER PAIRING' : 'EXTERNAL AGENT LINK';
    title.style.cssText = 'font-size:18px;font-weight:700;letter-spacing:2px;color:#33e0ff';
    const note = document.createElement('div');
    note.textContent = mode === 'companion'
      ? 'Enter the host-private OWNER_KEY_FILE value. It is masked, used once, then cleared. Only this human can authorize the companion.'
      : 'Local bridge only. Token and Owner pairing key are masked, never saved and never logged. You must click AUTHORIZE.';
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
    // keyboard listeners never see it (no takeover, no ESC close).
    for (const type of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(type, (event) => event.stopPropagation());
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      root.addEventListener(type, (event) => event.stopPropagation());
    }
    root.addEventListener('submit', (event) => event.preventDefault());

    const setStatus = (text: string, color: string): void => {
      status.textContent = text;
      status.style.color = color;
    };

    cancel.addEventListener('click', () => {
      this.closeExternalLinkForm();
    });

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
      // Clear BOTH secrets from the DOM immediately; the raw key goes only
      // into a module-private WeakMap (#private fields), never a global config.
      tokenInput.value = '';
      ownerKeyInput.value = '';
      stashOwnerPairing(parent, ownerKey);
      if (this.linkFormMode === 'companion') {
        setStatus('PAIRING OWNER…', '#ffd233');
        void parent.authorizeCompanionFromConfig().then((ok) => {
          if (ok) {
            setStatus('CONNECTED · Owner authority registered', '#7ff0ff');
            this.closeExternalLinkForm();
          } else {
            setStatus('FAILED · owner pairing rejected — control stays human', '#ff8a3c');
          }
        });
        return;
      }
      (globalThis as unknown as { __externalLinkConfig?: { bridgeUrl: string; token: string } })
        .__externalLinkConfig = { bridgeUrl, token };
      setStatus('AUTHORIZING…', '#ffd233');
      void parent.authorizeExternalAgent(bridgeUrl, token, ownerKey).then((ok) => {
        if (ok) {
          this.lastExternalSig = '';
          this.refreshExternalLabels();
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
    this.externalLinkForm = root;
    urlInput.focus();
  }

  private _button(cx: number, y: number, label: string, cb: () => void, color: number): void {
    const w = 340;
    const g = this.add.rectangle(cx, y, w, 46, color, 0.35).setOrigin(0.5, 0.5).setStrokeStyle(2, 0x33e0ff, 0.7);
    const t = this.add.text(cx, y, label, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff', fontStyle: 'bold', letterSpacing: 3 }).setOrigin(0.5, 0.5);
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => g.setFillStyle(color, 0.6));
    hit.on('pointerout', () => g.setFillStyle(color, 0.35));
  }
}
