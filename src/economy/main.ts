import Phaser from 'phaser';
import { game } from '../main';
import type { GameScene } from '../scenes/GameScene';
import { audio } from '../systems/AudioSystem';
import type { PlayerData, Room } from '../types';
import { buySupply, clearReward, purchaseBlocker, suppliesFor, terminalRooms } from './supplies';
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
  roomId: number;
  index: number;
  name: string;
  price: number;
}

class SupplyTerminal {
  private readonly roomIds: Set<number>;
  private readonly cleared: Set<number>;
  private readonly listeners = new AbortController();
  private rewardTimer = 0;
  /** Currency reward enqueued but not yet committed by the core tick. */
  private pendingReward = 0;
  /** Purchase enqueued but not yet committed + checkpoint-saved. Guards double-click. */
  private pendingPurchase: PendingPurchase | null = null;

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
      reward.textContent = `+${payout} credits · room cleared`;
      reward.hidden = false;
      window.clearTimeout(this.rewardTimer);
      this.rewardTimer = window.setTimeout(() => { reward.hidden = true; }, 3000);
    }

    // Committed barrier: core.processCommands must have consumed every enqueued
    // command before we may capture a checkpoint. stepFrame runs before this
    // POST_UPDATE handler, so uncommitted commands are still pending here.
    const safe = scene.paused ? undefined : this.safeRoom();
    const committed = !world.hasUncommittedCommands();

    // Room clear reward: wait for the currency command to commit, then save.
    if (this.pendingReward > 0 && committed && safe) {
      const saved = scene.saveCheckpoint();
      if (saved) this.pendingReward = 0;
    }

    // Purchase: wait for the set-player-data command to commit, then save and report.
    if (this.pendingPurchase && committed && safe) {
      const saved = scene.saveCheckpoint();
      if (saved) {
        feedback.textContent = `Purchased ${this.pendingPurchase.name}.`;
        this.pendingPurchase = null;
      }
    }

    const current = world.currentRoom();
    controls.hidden = scene.paused || !current || !this.roomIds.has(current.id);
    openButton.hidden = controls.hidden || !safe;
    const message = controls.hidden || safe ? '' : 'Supply terminal · clear remaining threats';
    if (hint.textContent !== message) hint.textContent = message;
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
    const { player } = this.scene.world;
    const before: PlayerData = player.data;
    const supply = suppliesFor(before, this.scene.seed, roomId)[index];
    const purchased = buySupply(before, supply);
    if (!purchased) return;

    // Deduction + equipment/item in one atomic core command. Committed by the
    // next stepFrame tick via core.processCommands; not applied synchronously.
    this.scene.world.enqueueSetPlayerData(purchased);
    this.pendingPurchase = { roomId, index, name: supply.name, price: supply.price };
    feedback.textContent = `Processing ${supply.name}...`;
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
