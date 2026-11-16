import Phaser from 'phaser';
import { game } from '../main';
import type { GameScene } from '../scenes/GameScene';
import { audio } from '../systems/AudioSystem';
import type { Room } from '../types';
import { clearReward, purchaseBlocker, suppliesFor, terminalRooms } from './supplies';
import './economy.css';

const controls = document.querySelector<HTMLDivElement>('#supply-controls')!;
const hint = document.querySelector<HTMLSpanElement>('#supply-hint')!;
const openButton = document.querySelector<HTMLButtonElement>('#supply-open')!;
const closeButton = document.querySelector<HTMLButtonElement>('#supply-close')!;
const dialog = document.querySelector<HTMLDialogElement>('#supply-dialog')!;
const balance = document.querySelector<HTMLParagraphElement>('#supply-balance')!;
const stock = document.querySelector<HTMLUListElement>('#supply-stock')!;
const feedback = document.querySelector<HTMLParagraphElement>('#supply-feedback')!;
const reward = document.querySelector<HTMLParagraphElement>('#supply-reward')!;

interface PendingPurchase {
  transactionId: string;
  roomId: number;
  index: number;
  offerKey: string;
  name: string;
}

class SupplyTerminal {
  private readonly roomIds: Set<number>;
  private readonly cleared: Set<number>;
  private readonly listeners = new AbortController();
  private rewardTimer = 0;
  private txCounter = 0;
  /** Currency reward enqueued but not yet committed by the core tick. */
  private pendingReward = 0;
  /** Supply transaction enqueued; settled only when its committed receipt arrives. */
  private pendingPurchase: PendingPurchase | null = null;
  private storageWarned = false;

  constructor(private readonly scene: GameScene) {
    const { rooms } = scene.world.map;
    this.roomIds = terminalRooms(rooms);
    this.cleared = new Set(rooms.filter((room) => room.cleared).map((room) => room.id));
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.input.keyboard?.on('keydown-G', this.open, this);

    const { signal } = this.listeners;
    openButton.addEventListener('click', this.open, { signal });
    closeButton.addEventListener('click', () => dialog.close(), { signal });
    dialog.addEventListener('close', this.resume, { signal });
    dialog.addEventListener('keydown', (event) => event.stopPropagation(), { signal });
    dialog.addEventListener('keyup', (event) => event.stopPropagation(), { signal });
    this.update();
  }

  private safeRoom(): Room | undefined {
    const { world } = this.scene;
    const current = world.currentRoom();
    if (!current || !world.player.alive || world.won || world.boss ||
        world.enemies.some((enemy) => enemy.alive) ||
        world.map.rooms.some((room) => room.spawned && !room.cleared)) return;
    const room = world.map.rooms[current.id];
    if (room.cleared) return room;
  }

  private nextTransactionId(): string {
    this.txCounter += 1;
    return `${this.scene.seed}-${this.txCounter}-${Math.floor(Math.random() * 1e9)}`;
  }

  private update(): void {
    const { scene } = this;
    const { world } = scene;
    if (!world.player.alive || world.won) {
      controls.hidden = true;
      return;
    }
    // Detect newly cleared rooms and enqueue their currency rewards.
    let payout = 0;
    for (const room of world.map.rooms) {
      if (!room.cleared || this.cleared.has(room.id)) continue;
      this.cleared.add(room.id);
      payout += clearReward(room);
    }
    if (payout > 0) {
      world.enqueueCurrency(payout);
      this.pendingReward = payout;
      this.showBanner(`+${payout} credits · room cleared`);
    }

    // Committed barrier: core.processCommands and World spawns must be fully
    // consumed before we may capture a checkpoint. stepFrame runs before this
    // POST_UPDATE handler, so uncommitted work is still pending here.
    const safe = scene.paused ? undefined : this.safeRoom();
    const committed = !world.hasUncommittedCommands();

    // Room clear reward: wait for the currency command to commit, then save.
    if (this.pendingReward > 0 && committed && safe) {
      if (scene.saveCheckpoint()) this.pendingReward = 0;
    }

    // Supply purchase: settle only on a real committed receipt.
    this.settlePurchase(committed, safe);

    const current = world.currentRoom();
    controls.hidden = scene.paused || !current || !this.roomIds.has(current.id);
    openButton.hidden = controls.hidden || !safe;
    const message = controls.hidden || safe ? '' : 'Supply terminal · clear remaining threats';
    if (hint.textContent !== message) hint.textContent = message;
  }

  private settlePurchase(committed: boolean, safe: Room | undefined): void {
    const pending = this.pendingPurchase;
    if (!pending) return;
    const receipt = this.scene.world.getSupplyReceipt(pending.transactionId);
    if (!receipt) return; // not committed yet
    if (receipt.ok) {
      // A committed success changes saved state; only report success once saved.
      if (!committed || !safe) return;
      if (!this.scene.saveCheckpoint()) {
        if (!this.storageWarned) {
          this.storageWarned = true;
          this.showOutcome('Purchase could not be saved. Retrying…', false);
        }
        return;
      }
      this.storageWarned = false;
      this.pendingPurchase = null;
      this.showOutcome(`Purchased ${pending.name}.`, true);
    } else {
      this.pendingPurchase = null;
      this.storageWarned = false;
      this.showOutcome(receipt.reason ?? 'Purchase failed.', false);
    }
    if (dialog.open) this.renderStock(pending.roomId, pending.index);
  }

  /** Outcome for the player: inside the dialog when open, otherwise the banner. */
  private showOutcome(message: string, ok: boolean): void {
    if (dialog.open) {
      feedback.textContent = message;
      feedback.dataset.ok = ok ? '1' : '0';
      return;
    }
    this.showBanner(message);
  }

  private showBanner(message: string): void {
    reward.textContent = message;
    reward.hidden = false;
    window.clearTimeout(this.rewardTimer);
    this.rewardTimer = window.setTimeout(() => { reward.hidden = true; }, 3000);
  }

  private open = (): void => {
    if (dialog.open || this.scene.paused || !this.scene.scene.isActive()) return;
    const room = this.safeRoom();
    if (!room || !this.roomIds.has(room.id)) return;

    this.scene.fireHeld = false;
    this.scene.world.player.setFireHeld(false);
    this.scene.input.keyboard?.resetKeys();
    this.scene.scene.pause();
    feedback.textContent = '';
    delete feedback.dataset.ok;
    this.renderStock(room.id);
    audio.ui();
    dialog.showModal();
    closeButton.focus();
  };

  private resume = (): void => {
    this.scene.input.keyboard?.resetKeys();
    this.scene.scene.resume();
    audio.ui();
  };

  private renderStock(roomId: number, focusIndex?: number): void {
    const player = this.scene.world.player.data;
    balance.textContent = `${player.currency} run credits`;
    const buttons: HTMLButtonElement[] = [];
    const rows = suppliesFor(player, this.scene.seed, roomId).map((supply, index) => {
      const row = document.createElement('li');
      const details = document.createElement('div');
      const title = document.createElement('h2');
      const description = document.createElement('p');
      const button = document.createElement('button');
      const reason = purchaseBlocker(player, supply);
      // Double-click guard: disable all purchase buttons while a purchase is pending.
      const disabled = !!reason || this.pendingPurchase !== null;
      title.textContent = supply.name;
      description.textContent = supply.description;
      if (reason) description.append(` ${reason}.`);
      details.append(title, description);
      button.type = 'button';
      button.textContent = `${supply.price} credits`;
      button.setAttribute('aria-label', `Buy ${supply.name} for ${supply.price} credits`);
      button.disabled = disabled;
      button.addEventListener('click', () => this.purchase(roomId, index));
      buttons.push(button);
      row.append(details, button);
      return row;
    });
    stock.replaceChildren(...rows);
    if (focusIndex !== undefined) {
      const button = buttons[focusIndex];
      (button && !button.disabled ? button : closeButton).focus();
    }
  }

  private purchase(roomId: number, index: number): void {
    if (!dialog.open || this.safeRoom()?.id !== roomId) return;
    // Double-click guard: reject if a purchase is already pending commit.
    if (this.pendingPurchase) return;
    const player = this.scene.world.player.data;
    const supply = suppliesFor(player, this.scene.seed, roomId)[index];
    if (!supply) return;
    const blocker = purchaseBlocker(player, supply);
    if (blocker) {
      feedback.textContent = blocker;
      return;
    }

    // Atomic core transaction: the core re-validates offer/room/balance at
    // commit time. The UI only records a pending transaction id.
    const transactionId = this.nextTransactionId();
    this.scene.world.enqueuePurchaseSupply(transactionId, supply.key, roomId);
    this.pendingPurchase = { transactionId, roomId, index, offerKey: supply.key, name: supply.name };
    feedback.textContent = `Close the terminal to complete your purchase of ${supply.name}.`;
    delete feedback.dataset.ok;
    audio.ui();
    this.renderStock(roomId, index);
  }

  private destroy(): void {
    this.listeners.abort();
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.update, this);
    this.scene.input.keyboard?.off('keydown-G', this.open, this);
    window.clearTimeout(this.rewardTimer);
    controls.hidden = true;
    reward.hidden = true;
    if (dialog.open) dialog.close();
    // Uncommitted purchases/rewards are discarded on shutdown: exit/refresh
    // returns to the last committed checkpoint state, no partial success shown.
    this.pendingReward = 0;
    this.pendingPurchase = null;
    this.storageWarned = false;
  }
}

function installSupplyTerminals(): void {
  const scene = game.scene.getScene('GameScene') as GameScene;
  scene.events.on(Phaser.Scenes.Events.CREATE, () => {
    if (scene.world) new SupplyTerminal(scene);
  });
}

if (game.scene.isBooted) installSupplyTerminals();
else game.events.once(Phaser.Core.Events.READY, installSupplyTerminals);
