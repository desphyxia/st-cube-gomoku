/**
 * Renderer-side transport. Wraps the preload bridge in a small emitter and
 * defines the wire protocol both peers speak.
 *
 *   hello   { name }              sent by both sides once connected
 *   start   { size, first }       host only: begins (or restarts) a game
 *   move    { move, n }           { t:'place', id } or { t:'twist', axis, layer, dir }
 *   start   also carries `rules`, the game mode for this game
 *   resign  { }
 *   rematch { }                   a request; the host answers with `start`
 *   bye     { }
 */
export const PROTOCOL_VERSION = 2;

export class Net {
  constructor() {
    this.bridge = typeof window !== 'undefined' ? window.cube5 : null;
    this.listeners = new Map();
    this.status = {
      ok: false,
      error: this.bridge ? null : 'not running inside the desktop shell',
      name: null,
      steamId: null,
    };

    if (this.bridge) {
      this.bridge.onMessage(({ msg }) => this.emit('message', msg));
      this.bridge.onEvent((ev) => this.emit('event', ev));
    }
  }

  get available() {
    return !!this.bridge && this.status.ok;
  }

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }

  emit(name, payload) {
    for (const fn of this.listeners.get(name) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`listener for "${name}" threw`, err);
      }
    }
  }

  async refreshStatus() {
    if (!this.bridge) return this.status;
    try {
      this.status = await this.bridge.steamStatus();
    } catch (err) {
      this.status = { ok: false, error: err.message, name: null, steamId: null };
    }
    return this.status;
  }

  host(size) { return this.bridge.hostLobby(size); }
  list() { return this.bridge.listLobbies(); }
  join(id) { return this.bridge.joinLobby(id); }
  invite() { return this.bridge.inviteToLobby(); }
  leave() { return this.bridge ? this.bridge.leaveLobby() : Promise.resolve(); }
  quit() { return this.bridge ? this.bridge.quit() : Promise.resolve(); }

  send(type, body = {}) {
    if (!this.bridge) return Promise.resolve(false);
    return this.bridge.send({ t: type, v: PROTOCOL_VERSION, ...body });
  }
}
