'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** The renderer's entire view of Steam: plain JSON in, plain JSON out. */
contextBridge.exposeInMainWorld('cube5', {
  steamStatus: () => ipcRenderer.invoke('steam:status'),
  hostLobby: (size) => ipcRenderer.invoke('lobby:host', { size }),
  listLobbies: () => ipcRenderer.invoke('lobby:list'),
  joinLobby: (id) => ipcRenderer.invoke('lobby:join', { id }),
  inviteToLobby: () => ipcRenderer.invoke('lobby:invite'),
  leaveLobby: () => ipcRenderer.invoke('lobby:leave'),
  send: (msg) => ipcRenderer.invoke('net:send', msg),
  quit: () => ipcRenderer.invoke('app:quit'),
  onMessage: (cb) => ipcRenderer.on('net:message', (_e, payload) => cb(payload)),
  onEvent: (cb) => ipcRenderer.on('net:event', (_e, payload) => cb(payload)),
});
