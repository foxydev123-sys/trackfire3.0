/* =====================================================================
   LOBBY STAGE — the tanks you see on the menu screen.

   Your tank stands on the ground south of the Citadel, turned about 35°
   so you see its front and one side, with Hawler behind it. As friends
   join your squad their tanks fall in beside you and the camera eases
   back so the whole line stays in frame; when one leaves it closes up
   again. Everyone's pick is live: change tank and the model swaps.

   The stage only ever runs on the menu and lobby screens — it is torn
   down before a match, so it costs a match nothing.
   ===================================================================== */
import * as THREE from '../three.js';
import { TankView } from './tank.js';

// Every map carries its own staging ground — where the line-up stands, where the camera goes
// and what it looks at — in `map.lobby` (see LOBBY in shared/maps.js). The area around it has
// already been swept clear of rocks, trees and props, so nothing can hide a tank.
const FALLBACK = { stage: { x: 3.1, z: 26.5 }, look: { x: 0, z: 17 },
                   shot: { dist: 23, height: 5.4, side: -2.5, aim: 2.2 }, clear: 15 };

// Up to four standing spots. You take the middle one; the empty ones show a "+" to bring a
// friend in — the same shape as the squad slots in games like Brawl Stars.
//
// The line-up is only as wide as the squad needs: on your own it is you plus one open place,
// and it grows as people arrive. That keeps every tank big enough to see on a phone, instead
// of framing four spots when three of them are empty.
export const SLOTS = 4;
const SPACING = 6.6;            // metres between spots
const ARC = 1.2;                // the outer spots sit a little further back, so none is hidden
const TURN = 0.62;              // radians off facing the camera dead-on — about 35°
// How far the camera pulls back for a line-up of 1, 2, 3 or 4 spots, as a multiple of the
// map's own shot distance. Two tanks need much less room than four.
const ZOOM = [0.74, 0.88, 1.0, 1.12];

const FILL_ORDER = [1, 2, 0, 3];

const TEAM_COL = [
  [0xd8a83c, 0xffe0a0],   // you — the game's amber
  [0x5f92e8, 0xbcd6ff],
  [0x6fb85f, 0xc4f0b8],
  [0xb07fd8, 0xe2c8ff],
];

export class LobbyStage {
  constructor() {
    this.W = null;              // the world we are staged in
    this.views = new Map();     // player id → { view, kind, slot }
    this.t = 0;
    this.L = FALLBACK;
    this.cam = { ...FALLBACK.shot };
    this.want = { ...FALLBACK.shot };
    this.spin = 0;              // a slow drift, so the shot is never dead still
  }

  /** Move the stage into `W` (the menu world). Safe to call with the same world again. */
  attach(W) {
    if (this.W === W) return;
    this.clear();
    this.W = W;
    this.L = (W && W.map && W.map.lobby) || FALLBACK;     // this map's own staging ground
    this.want = { ...this.L.shot };
    this.cam = { ...this.L.shot };                        // snap, don't sweep across the map
  }

  clear() {
    for (const e of this.views.values()) e.view.dispose();
    this.views.clear();
  }

  groundY(x, z) { return this.W && this.W.map ? this.W.map.height(x, z) : 0; }

  /**
   * Set the whole line-up at once.
   * `players` = [{ id, tank }] in the order they should stand, you first.
   */
  setPlayers(players) {
    if (!this.W) return;
    const list = players.slice(0, SLOTS);
    const seen = new Set();
    this.taken = new Set();
    list.forEach((p, i) => {
      seen.add(p.id);
      const slot = FILL_ORDER[i];
      this.taken.add(slot);
      const kind = p.tank || 'zagros';
      let e = this.views.get(p.id);
      if (e && e.kind !== kind) { e.view.dispose(); e = null; }     // they switched tank
      if (!e) {
        const [col, acc] = TEAM_COL[i % 4];
        const view = new TankView(this.W.scene, col, acc, i === 0, kind);
        if (view.teamRing) view.teamRing.visible = false;           // no team ring on the menu
        view.setNight(!!this.W.night);
        e = { view, kind, slot, born: this.t };
        this.views.set(p.id, e);
      }
      e.slot = slot; e.me = i === 0;
    });
    for (const [id, e] of this.views) if (!seen.has(id)) { e.view.dispose(); this.views.delete(id); }
  }

  /** How many standing places are shown: everyone here, plus one empty one to fill. */
  shown() { return Math.max(2, Math.min(SLOTS, this.views.size + 1)); }

  /** Where standing spot `i` is, of the `shown()` on the ground: a shallow arc, middle nearest. */
  spotOf(i) {
    const S = this.L.stage, n = this.shown(), off = this.orderOf(i) - (n - 1) / 2;
    return { x: S.x + off * SPACING, z: S.z - Math.abs(off) * ARC };
  }
  /** Where slot `i` sits left-to-right in a line-up of `shown()` places. */
  orderOf(i) {
    const n = this.shown(), used = FILL_ORDER.slice(0, n).slice().sort((a, b) => a - b);
    const at = used.indexOf(i);
    return at < 0 ? (n - 1) / 2 : at;
  }
  /** The places with nobody on them — one while there is room, none when the squad is full. */
  openSlots() {
    const taken = this.taken || new Set();
    return FILL_ORDER.slice(0, this.shown()).filter((i) => !taken.has(i));
  }

  /** Called every menu frame. Returns the camera position and target to use. */
  frame(dt, camera) {
    this.t += dt;
    // Face the camera, then turn 35° off it, so you see the front and one side of every tank.
    const yaw = Math.atan2(this.cam.side, this.cam.dist) + TURN;
    for (const e of this.views.values()) {
      const s = this.spotOf(e.slot);
      // a gentle idle sway, each tank slightly out of phase with the others
      const sway = Math.sin(this.t * 0.5 + e.slot * 1.3) * 0.035;
      e.view.setPose(s.x, s.z, yaw + sway, yaw + sway, (x, z) => this.groundY(x, z), dt, 0);
      e.view.setShield(false, this.t);
    }
    // frame however many are actually standing there, so two tanks fill the screen properly
    const z = ZOOM[Math.min(ZOOM.length - 1, Math.max(0, this.shown() - 1))];
    this.want = { dist: this.L.shot.dist * z, height: this.L.shot.height * (0.82 + 0.18 * z),
                  side: this.L.shot.side, aim: this.L.shot.aim };
    const k = 1 - Math.exp(-dt * 2.2);
    for (const key of ['dist', 'height', 'side', 'aim']) this.cam[key] += (this.want[key] - this.cam[key]) * k;
    this.spin += dt * 0.055;
    const drift = Math.sin(this.spin) * 1.1;                 // a slow, small left-right drift
    const S = this.L.stage, K = this.L.look;
    const cx = S.x + this.cam.side + drift;
    const cz = S.z + this.cam.dist;
    const cy = this.groundY(cx, cz) + this.cam.height;
    camera.position.set(cx, cy, cz);
    camera.lookAt(K.x + drift * 0.3, this.groundY(K.x, K.z) + this.cam.aim, K.z);
    return { x: S.x, z: S.z };
  }

  /** Where standing spot `i` shows up on screen, `up` metres above the ground. */
  slotScreen(i, camera, out, up = 1.6) {
    const s = this.spotOf(i);
    out.set(s.x, this.groundY(s.x, s.z) + up, s.z);
    out.project(camera);
    return { x: (out.x * 0.5 + 0.5) * innerWidth, y: (-out.y * 0.5 + 0.5) * innerHeight, on: out.z < 1 };
  }
}
