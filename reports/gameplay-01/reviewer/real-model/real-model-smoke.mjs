// GAMEPLAY-01 — real-model minimal smoke (P5 preparation), reviewer-owned harness.
//
// READ-ONLY for src/tests: this file only lives under reports/gameplay-01/reviewer/real-model/.
// Runtime = an independent snapshot (git archive of a fixed commit) built with its own
// dist-mcp, so the shared P2 worktree is untouched.
//
// Chain: official headless MCP server (stdio) -> legal observation -> Magpie chat
// completions (openai-chat) -> strict JSON action validation -> world_action ->
// real core ticks -> next observation. No script picks the action: the model does.
// Nothing secret is logged: no headers, no Owner key, no bridge token, no model
// internal reasoning (only the returned visible content).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SNAP = process.env.SNAP ?? 'D:/tmp/gp01-rm-b6a98e5';
const OUT = path.resolve(process.env.OUT ?? 'reports/gameplay-01/reviewer/real-model');
const MAGPIE = process.env.MAGPIE ?? 'http://127.0.0.1:3425/v1';
const MODEL = process.env.MODEL ?? 'group/elisa';
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS ?? 10); // task allows <=20
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 512);    // task allows <=1024
const WALL_MS = Number(process.env.WALL_MS ?? 8 * 60 * 1000);
const TICKS_PER_STEP = Number(process.env.TICKS_PER_STEP ?? 30);
const DEV = process.env.DEV === '1';
const FIXTURE_KINDS = (process.env.FIXTURE_KINDS ?? 'drone,drone').split(',').map((k) => k.trim()).filter(Boolean);
const FIXTURE_SEED = process.env.FIXTURE_SEED ? Number(process.env.FIXTURE_SEED) : undefined;

fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tracePath = path.join(OUT, `trace-${stamp}.json`);
const trace = {
  startedAt: new Date().toISOString(),
  snapshot: SNAP,
  model: MODEL,
  endpoint: MAGPIE,
  limits: { MAX_REQUESTS, MAX_TOKENS, WALL_MS, TICKS_PER_STEP },
  steps: [],
  outcome: null,
  errors: []
};
const lines = [];
function log(msg) { lines.push(msg); console.log(msg); }

const hex = () => crypto.randomBytes(12).toString('hex');
const reqId = () => `req_${hex()}`;
const aid = () => `aid_${hex()}`;

function unwrap(res) {
  if (res && res.structuredContent) return res.structuredContent;
  const text = res?.content?.find?.((c) => c.type === 'text')?.text;
  if (!text) return res;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** Strict v1 action parser: exactly one JSON object, allowed type + params. */
function parseAction(content) {
  if (typeof content !== 'string') return { ok: false, code: 'no_content' };
  const cleaned = content.replace(/```json/gi, '```').split('```').filter((s) => s.includes('{')).join('\n');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, code: 'no_json', content };
  let raw;
  try { raw = JSON.parse(cleaned.slice(start, end + 1)); } catch { return { ok: false, code: 'bad_json', content }; }
  const type = raw?.type;
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000;
  if (!['move', 'stop', 'aim', 'fire', 'interact'].includes(type)) return { ok: false, code: 'type_not_allowed', raw };
  if (type === 'move') {
    const d = raw?.dir;
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return { ok: false, code: 'move_needs_dir', raw };
    const len = Math.hypot(d.x, d.y);
    if (!(len > 0.05) || len > 1.5) return { ok: false, code: 'move_dir_not_unit', raw };
    return { ok: true, action: { type: 'move', dir: { x: d.x, y: d.y }, ticks: TICKS_PER_STEP } };
  }
  if (type === 'fire') {
    const t = raw?.target;
    if (t && !(num(t.x) && num(t.y))) return { ok: false, code: 'fire_bad_target', raw };
    return { ok: true, action: { type: 'fire', ...(t ? { target: { x: t.x, y: t.y } } : {}), ticks: TICKS_PER_STEP } };
  }
  if (type === 'aim') {
    const t = raw?.target;
    if (!t || !num(t.x) || !num(t.y)) return { ok: false, code: 'aim_bad_target', raw };
    return { ok: true, action: { type: 'aim', target: { x: t.x, y: t.y } } };
  }
  if (type === 'interact') return { ok: true, action: { type: 'interact' } };
  return { ok: true, action: { type: 'stop' } };
}

function summarizeObservation(obs) {
  const o = obs?.observation ?? obs;
  const p = o?.player ?? {};
  const drones = Array.isArray(o?.drones) ? o.drones : [];
  const targets = Array.isArray(o?.targets) ? o.targets : [];
  const actors = Array.isArray(o?.perceivedActors) ? o.perceivedActors : [];
  const enemies = drones.length || targets.length
    ? [...drones, ...targets]
    : actors;
  return {
    tick: o?.tick ?? null,
    epoch: o?.epoch ?? null,
    roomId: o?.roomId ?? null,
    player: { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, alive: p.alive },
    aimYaw: p.aimYaw ?? null,
    weapon: p.weaponKey ?? null,
    availableActions: Array.isArray(o?.availableActions) ? o.availableActions : null,
    enemies: enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp, state: e.state ?? null })),
    enemyCount: enemies.length,
    objective: o?.objective ?? null,
    portal: o?.portal ?? null,
    // Hard guard: the model-visible projection must never carry these.
    leaks: ['mapHash', 'seed', 'rngState', 'canonicalState', 'dev'].filter((k) => k in o)
  };
}

const SYSTEM = [
  'You are the human player in a small tactical roguelike, acting through a strict tool surface.',
  'You receive ONE legal observation JSON (already perception-filtered). You must answer with EXACTLY ONE JSON object and nothing else.',
  'Allowed actions:',
  '{"type":"move","dir":{"x":<number>,"y":<number>}}  // dir length must be <= 1.5 and > 0',
  '{"type":"fire","target":{"x":<number>,"y":<number>}} // target is optional',
  '{"type":"aim","target":{"x":<number>,"y":<number>}}',
  '{"type":"interact"}',
  '{"type":"stop"}',
  'Coordinates are the same grid used by the observation (player.x/player.y and enemy x/y).',
  'Goal: make real progress (damage/kill perceived enemies) without dying. Prefer firing at the nearest perceived enemy when one is visible.',
  'Never output prose, markdown fences, or extra keys.'
].join('\n');

async function callModel(observation) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(observation) }
    ],
    max_tokens: MAX_TOKENS,
    stream: false
  };
  const t0 = Date.now();
  const res = await fetch(`${MAGPIE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const latencyMs = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return {
    httpStatus: res.status,
    latencyMs,
    id: json?.id ?? null,
    returnedModel: json?.model ?? null,
    finishReason: json?.choices?.[0]?.finish_reason ?? null,
    content: json?.choices?.[0]?.message?.content ?? null,
    usage: json?.usage ? {
      prompt: json.usage.prompt_tokens, completion: json.usage.completion_tokens,
      reasoning: json.usage.completion_tokens_details?.reasoning_tokens ?? null
    } : null,
    rawLength: text.length,
    rawSnippet: json ? null : text.slice(0, 300)
  };
}

async function main() {
  const serverEntry = path.join(SNAP, 'dist-mcp', 'worldHeadlessMcpServer.mjs');
  if (!fs.existsSync(serverEntry)) throw new Error(`missing headless MCP server: ${serverEntry}`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: DEV ? [serverEntry, '--dev'] : [serverEntry],
    cwd: SNAP,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'gp01-real-model-smoke', version: '0.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  trace.toolSurface = (tools.tools ?? []).map((t) => t.name);
  log(`[tools] ${trace.toolSurface.join(', ')}`);

  const created = unwrap(await client.callTool({ name: 'world_headless_create_session', arguments: DEV && FIXTURE_SEED !== undefined ? { seed: FIXTURE_SEED } : {} }));
  if (!created?.ok) throw new Error(`create_session failed: ${JSON.stringify(created).slice(0, 300)}`);
  const session = created.session ?? created.value?.session;
  let epoch = created.epoch ?? created.value?.epoch ?? 0;
  log(`[session] ${session} epoch=${epoch}`);
  trace.fixture = null;
  if (DEV && FIXTURE_KINDS.length) {
    // Labelled fixture: seed a small REAL combat scene through the existing dev
    // tool (same core, real enemies). The model never sees this tool or its args.
    const spawned = unwrap(await client.callTool({
      name: 'world_headless_dev_spawn_enemies',
      arguments: { session, kinds: FIXTURE_KINDS }
    }));
    trace.fixture = { tool: 'world_headless_dev_spawn_enemies', kinds: FIXTURE_KINDS, seed: FIXTURE_SEED ?? 'server', result: spawned };
    log(`[fixture] spawn_enemies ${JSON.stringify(FIXTURE_KINDS)} -> ${JSON.stringify(spawned).slice(0, 200)}`);
  }

  const wallStart = Date.now();
  let requests = 0;
  let last = null;
  let sawEnemy = false;
  while (requests < MAX_REQUESTS && Date.now() - wallStart < WALL_MS) {
    const obsRes = unwrap(await client.callTool({ name: 'world_observe', arguments: { session, epoch } }));
    if (!obsRes?.ok) { trace.errors.push({ stage: 'observe', obsRes }); break; }
    if (typeof obsRes.epoch === 'number') epoch = obsRes.epoch;
    const obsSummary = summarizeObservation(obsRes);
    if (obsSummary.player?.hp !== undefined && obsSummary.player.hp <= 0) {
      trace.outcome = 'player_dead';
      break;
    }

    requests += 1;
    const m = await callModel(obsRes.observation ?? obsRes);
    if (m.httpStatus !== 200) { trace.errors.push({ stage: 'model', m }); trace.steps.push({ request: requests, obsSummary, model: m, action: null, executed: null }); break; }
    const parsed = parseAction(m.content);
    const step = { request: requests, obsSummary, model: m, parsed, executed: null, after: null };
    trace.steps.push(step);
    log(`[req ${requests}] model=${m.returnedModel} ${m.latencyMs}ms content=${JSON.stringify((m.content ?? '').slice(0, 160))}`);

    if (!parsed.ok) {
      log(`[req ${requests}] INVALID_ACTION ${parsed.code} -> not executed (counted as failure)`);
      // A model format failure is a real failure: record and stop (no retry-until-green).
      trace.outcome = 'model_invalid_action';
      break;
    }

    const action = { ...parsed.action, actionId: aid() };
    if (action.type === 'stop' || action.type === 'interact' || action.type === 'aim') {
      // schema: stop/interact have no ticks; aim has no ticks
      delete action.ticks;
    }
    const actionRes = unwrap(await client.callTool({
      name: 'world_action',
      arguments: { session, epoch, requestId: reqId(), actions: [action], ttlTicks: 60 }
    }));
    step.executed = { action, result: actionRes };
    log(`[req ${requests}] action=${JSON.stringify(action)} -> ${JSON.stringify(actionRes).slice(0, 200)}`);
    if (!actionRes?.ok) { trace.outcome = 'action_rejected'; break; }

    const stepRes = unwrap(await client.callTool({
      name: 'world_headless_step',
      arguments: { session, epoch, requestId: reqId(), ticks: TICKS_PER_STEP }
    }));
    step.stepResult = stepRes;
    const evs = Array.isArray(stepRes?.events) ? stepRes.events : [];
    const counts = {};
    for (const ev of evs) { const t = ev?.type ?? 'unknown'; counts[t] = (counts[t] ?? 0) + 1; }
    step.eventSummary = {
      counts,
      combat: evs.filter((ev) => ['projectile-spawned','drone-damaged','drone-died','echo-hurt','player-hurt','loot-dropped'].includes(ev?.type)).slice(0, 20)
    };
    if (step.eventSummary.combat.length) log(`[req ${requests}] events ${JSON.stringify(step.eventSummary.counts)}`);
    if (typeof stepRes?.epoch === 'number') epoch = stepRes.epoch;
    if (!stepRes?.ok) { trace.outcome = 'step_rejected'; break; }

    const after = unwrap(await client.callTool({ name: 'world_observe', arguments: { session, epoch } }));
    step.after = summarizeObservation(after);
    last = step.after;
    log(`[req ${requests}] after: player(${step.after.player?.x},${step.after.player?.y}) hp=${step.after.player?.hp}/${step.after.player?.maxHp} enemies=${step.after.enemyCount} hp=${JSON.stringify(step.after.enemies.map((e) => e.hp))} tick=${step.after.tick}`);
    if (step.after.enemyCount > 0) sawEnemy = true;
    if (sawEnemy && step.after.enemyCount === 0) { trace.outcome = 'no_perceived_enemy_left'; break; }
  }

  trace.requestsUsed = requests;
  trace.wallMs = Date.now() - wallStart;
  trace.final = last;
  trace.outcome = trace.outcome ?? (requests >= MAX_REQUESTS ? 'request_cap' : 'wall_clock');
  trace.finishedAt = new Date().toISOString();
  await client.callTool({ name: 'world_close', arguments: { session } }).catch(() => undefined);
  await client.close().catch(() => undefined);
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2));
  fs.writeFileSync(path.join(OUT, `run-${stamp}.log`), lines.join('\n') + '\n');
  log(`[outcome] ${trace.outcome} requests=${requests} wallMs=${trace.wallMs}`);
  log(`[trace] ${tracePath}`);
}

main().catch((e) => {
  trace.errors.push({ fatal: String(e && e.stack || e) });
  trace.outcome = 'fatal';
  try { fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2)); } catch {}
  try { fs.writeFileSync(path.join(OUT, `run-${stamp}.log`), lines.join('\n') + '\n' + String(e && e.stack || e)); } catch {}
  console.error(String(e && e.stack || e));
  process.exit(1);
});
