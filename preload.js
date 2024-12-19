const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send: (Channel, data) => ipcRenderer.send(Channel, data),
    on: (Channel, Callback) => ipcRenderer.on(Channel, (event, args) => Callback(event, args))
});