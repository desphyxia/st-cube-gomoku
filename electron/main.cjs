'use strict';
/**
 * Electron main process.
 *
 * Everything that touches the Steamworks native module lives here; the
 * renderer only ever sees the small, JSON-shaped bridge exposed in
 * preload.cjs. Transport is Steam lobbies for matchmaking plus reliable P2P
 * packets for the moves themselves.
 */
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const APP_ID = 480;            // Spacewar, Valve's public test app id
const LOBBY_TAG = 'cube5';
const PROTOCOL_VERSION = '2';
const POLL_MS = 40;

let win = null;
let steam = null;
let steamError = null;
let steamworks = null;

const net = {
  lobby: null,
  lobbyId: null,     // bigint
  peer: null,        // bigint
  isHost: false,
  pollTimer: null,
};

// ------------------------------------------------------------------ utilities

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const enumValue = (holder, key, fallback) => {
  const v = holder && holder[key];
  return typeof v === 'number' ? v : fallback;
};

const RELIABLE = () => enumValue(steam?.networking?.SendType, 'Reliable', 2);
const PUBLIC_LOBBY = () => enumValue(steam?.matchmaking?.LobbyType, 'Public', 2);
const CB = (key, fallback) => enumValue(steamworks?.SteamCallback, key, fallback);

function localName() {
  try {
    return steam.localplayer.getName();
  } catch {
    return 'Player';
  }
}

function localSteamId() {
  try {
    return steam.localplayer.getSteamId().steamId64;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- steam

function initSteam() {
  try {
    steamworks = require('steamworks.js');
    steam = steamworks.init(APP_ID);
    registerCallbacks();
    startPolling();
    return true;
  } catch (err) {
    steam = null;
    steamError = err && err.message ? err.message : String(err);
    console.warn('[steam] unavailable:', steamError);
    return false;
  }
}

function registerCallbacks() {
  const { callback } = steam;

  callback.register(CB('P2PSessionRequest', 6), ({ remote }) => {
    try {
      steam.networking.acceptP2PSession(remote);
    } catch (err) {
      console.warn('[steam] acceptP2PSession failed', err);
    }
    if (net.peer === null) net.peer = remote;
  });

  callback.register(CB('P2PSessionConnectFail', 7), ({ remote, error }) => {
    if (net.peer !== null && remote === net.peer) {
      send('net:event', { type: 'peer-lost', reason: `connection failed (${error})` });
    }
  });

  callback.register(CB('LobbyChatUpdate', 5), (u) => {
    if (net.lobbyId === null || u.lobby !== net.lobbyId) return;
    const me = localSteamId();
    if (u.user_changed === me) return;
    if (u.member_state_change === 0) {
      net.peer = u.user_changed;
      try {
        steam.networking.acceptP2PSession(net.peer);
      } catch { /* the session request callback will retry */ }
      if (net.lobby && net.isHost) net.lobby.setJoinable(false);
      send('net:event', { type: 'peer-joined', steamId: String(u.user_changed) });
    } else {
      send('net:event', { type: 'peer-lost', reason: 'opponent left the lobby' });
      net.peer = null;
      if (net.lobby && net.isHost) net.lobby.setJoinable(true);
    }
  });

  // Accepting an invite from the Steam friends list / overlay.
  callback.register(CB('GameLobbyJoinRequested', 8), async ({ lobby_steam_id }) => {
    try {
      await joinLobbyById(lobby_steam_id);
      send('net:event', { type: 'invited-join', lobbyId: String(lobby_steam_id) });
    } catch (err) {
      send('net:event', { type: 'error', reason: `could not join invite: ${err.message}` });
    }
  });
}

function startPolling() {
  if (net.pollTimer) return;
  net.pollTimer = setInterval(() => {
    if (!steam) return;
    try {
      let size = steam.networking.isP2PPacketAvailable();
      let guard = 0;
      while (size > 0 && guard++ < 64) {
        const packet = steam.networking.readP2PPacket(size);
        handlePacket(packet);
        size = steam.networking.isP2PPacketAvailable();
      }
    } catch (err) {
      console.warn('[steam] packet poll failed', err);
    }
  }, POLL_MS);
}

function handlePacket(packet) {
  if (!packet || !packet.data) return;
  const from = packet.steamId ? packet.steamId.steamId64 : null;
  if (net.peer === null && from !== null) net.peer = from;
  let msg;
  try {
    msg = JSON.parse(Buffer.from(packet.data).toString('utf8'));
  } catch {
    return; // not ours; app id 480 is shared with every other test app
  }
  if (!msg || msg.app !== LOBBY_TAG) return;
  send('net:message', { from: from === null ? null : String(from), msg });
}

async function joinLobbyById(idBigInt) {
  leaveLobby();
  const lobby = await steam.matchmaking.joinLobby(idBigInt);
  net.lobby = lobby;
  net.lobbyId = lobby.id;
  net.isHost = false;
  const owner = lobby.getOwner().steamId64;
  net.peer = owner;
  try {
    steam.networking.acceptP2PSession(owner);
  } catch { /* handled by callback */ }
  return lobby;
}

function leaveLobby() {
  if (net.lobby) {
    try {
      net.lobby.leave();
    } catch { /* already gone */ }
  }
  net.lobby = null;
  net.lobbyId = null;
  net.peer = null;
  net.isHost = false;
}

// ------------------------------------------------------------------- ipc api

ipcMain.handle('steam:status', () => ({
  ok: !!steam,
  error: steamError,
  name: steam ? localName() : null,
  steamId: steam ? String(localSteamId()) : null,
  appId: APP_ID,
}));

ipcMain.handle('lobby:host', async (_e, { size }) => {
  if (!steam) throw new Error('Steam is not running');
  leaveLobby();
  const lobby = await steam.matchmaking.createLobby(PUBLIC_LOBBY(), 2);
  net.lobby = lobby;
  net.lobbyId = lobby.id;
  net.isHost = true;
  lobby.mergeFullData({
    app: LOBBY_TAG,
    ver: PROTOCOL_VERSION,
    size: String(size),
    host: localName(),
  });
  lobby.setJoinable(true);
  return { lobbyId: String(lobby.id) };
});

ipcMain.handle('lobby:list', async () => {
  if (!steam) throw new Error('Steam is not running');
  const lobbies = await steam.matchmaking.getLobbies();
  const me = localSteamId();
  const out = [];
  for (const lobby of lobbies) {
    let data;
    try {
      data = lobby.getFullData();
    } catch {
      continue;
    }
    if (!data || data.app !== LOBBY_TAG || data.ver !== PROTOCOL_VERSION) continue;
    let members = 0;
    let owner = null;
    try {
      members = Number(lobby.getMemberCount());
      owner = lobby.getOwner().steamId64;
    } catch { /* stale lobby */ }
    if (owner === me) continue;
    if (members >= 2) continue;
    out.push({ id: String(lobby.id), host: data.host || 'Unknown', size: Number(data.size) || 5, members });
  }
  return out;
});

ipcMain.handle('lobby:join', async (_e, { id }) => {
  if (!steam) throw new Error('Steam is not running');
  let asBigInt;
  try {
    asBigInt = BigInt(String(id).trim());
  } catch {
    throw new Error('That does not look like a lobby ID');
  }
  const lobby = await joinLobbyById(asBigInt);
  return { lobbyId: String(lobby.id), host: lobby.getData('host') || 'Host', size: Number(lobby.getData('size')) || 5 };
});

ipcMain.handle('lobby:invite', () => {
  if (!steam || net.lobbyId === null) return false;
  try {
    steam.overlay.activateInviteDialog(net.lobbyId);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('lobby:leave', () => {
  leaveLobby();
  return true;
});

ipcMain.handle('net:send', (_e, msg) => {
  if (!steam || net.peer === null) return false;
  try {
    const body = Buffer.from(JSON.stringify({ ...msg, app: LOBBY_TAG }), 'utf8');
    return steam.networking.sendP2PPacket(net.peer, RELIABLE(), body);
  } catch (err) {
    console.warn('[steam] send failed', err);
    return false;
  }
});

ipcMain.handle('app:quit', () => {
  app.quit();
});

// ------------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#04060d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  initSteam();
  createWindow();
  if (steamworks) {
    try {
      steamworks.electronEnableSteamOverlay();
    } catch (err) {
      console.warn('[steam] overlay hook unavailable', err);
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (net.pollTimer) clearInterval(net.pollTimer);
  leaveLobby();
  if (process.platform !== 'darwin') app.quit();
});
