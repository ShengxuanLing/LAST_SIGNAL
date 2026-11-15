// AI-NATIVE-02 C3c fix — PUBLIC EVENT ALLOWLIST for the Player headless surface.
//
// Player must never receive hidden-entity events (drone FSM steps, hidden
// spawns, room generation, owner reset) or events at unperceived positions.
// This is an explicit per-type projection (allowlist), not a blacklist that
// strips a couple of fields.

import type { SimEvent } from '../world/sim/core';

export type PublicPerceivable = (x: number, y: number) => boolean;

/**
 * Project a step's events into the legal public view:
 *  - own player facts are always included (movement/fire/hurt/death/currency/xp/
 *    level/equip/purchase);
 *  - entity events are included ONLY when their position is legally perceivable;
 *  - `drone-step`, `room-generated` and `player-reset` are never public.
 */
export function publicEvents(events: readonly SimEvent[], isPerceivable: PublicPerceivable): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const event of events) {
    switch (event.type) {
      case 'player-moved':
        out.push({ type: 'player-moved', position: { x: event.position.x, y: event.position.y } });
        break;
      case 'player-fired':
        out.push({ type: 'player-fired' });
        break;
      case 'player-hurt':
        out.push({ type: 'player-hurt', damage: event.damage });
        break;
      case 'player-death':
        out.push({ type: 'player-death' });
        break;
      case 'player-healed':
        out.push({ type: 'player-healed', amount: event.amount, hp: event.hp });
        break;
      case 'currency-gained':
        out.push({ type: 'currency-gained', amount: event.amount, currency: event.currency });
        break;
      case 'xp-gained':
        out.push({ type: 'xp-gained', amount: event.amount, xp: event.xp, level: event.level });
        break;
      case 'player-levelup':
        out.push({ type: 'player-levelup', level: event.level });
        break;
      case 'player-upgraded':
        out.push({ type: 'player-upgraded', key: event.key, level: event.level });
        break;
      case 'player-equipped':
        out.push({ type: 'player-equipped', key: event.key });
        break;
      case 'loot-collected':
        out.push({ type: 'loot-collected', id: event.id, kind: event.kind, key: event.key, amount: event.amount });
        break;
      case 'supply-purchase-result':
        // The player's OWN transaction; never carries seed/map/RNG.
        out.push({
          type: 'supply-purchase-result', offerKey: event.offerKey, ok: event.ok,
          price: event.price, currency: event.currency, hp: event.hp, weaponKey: event.weaponKey
        });
        break;
      case 'projectile-spawned':
        if (isPerceivable(event.projectile.pos.x, event.projectile.pos.y)) {
          out.push({
            type: 'projectile-spawned',
            projectile: { id: event.projectile.id, side: event.projectile.side, kind: event.projectile.kind }
          });
        }
        break;
      case 'enemy-hit':
        if (isPerceivable(event.hit.position.x, event.hit.position.y)) {
          out.push({ type: 'enemy-hit', enemyId: event.enemyId, damage: event.damage, crit: event.crit });
        }
        break;
      case 'enemy-died':
        if (isPerceivable(event.x, event.y)) {
          out.push({ type: 'enemy-died', enemyId: event.enemyId, x: event.x, y: event.y });
        }
        break;
      case 'loot-dropped':
        if (isPerceivable(event.loot.x, event.loot.y)) {
          // Flat public fields: never the owner `loot` array shape.
          out.push({
            type: 'loot-dropped', id: event.loot.id, kind: event.loot.kind,
            key: event.loot.key, amount: event.loot.amount
          });
        }
        break;
      case 'enemy-spawned':
        if (isPerceivable(event.x, event.y)) {
          out.push({ type: 'enemy-spawned', id: event.id, kind: event.kind, x: event.x, y: event.y });
        }
        break;
      case 'projectile-wall':
        if (isPerceivable(event.x, event.y)) out.push({ type: 'projectile-wall', x: event.x, y: event.y });
        break;
      case 'drone-step':
      case 'room-generated':
      case 'player-reset':
        // Hidden FSM / room generation / owner reset: never public.
        break;
    }
  }
  return out;
}
