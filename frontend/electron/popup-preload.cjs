// Preload for the posture alert popup window only (public/alert-popup.html).
// The popup can receive its text and ask to close or to bring the app forward; nothing else.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('posegoodPopup', {
  onShow: (listener) => ipcRenderer.on('popup:show', (_event, alert) => listener(alert)),
  onHide: (listener) => ipcRenderer.on('popup:hide', () => listener()),
  // `immediate` skips the sink animation (the card was already swiped away).
  close: (immediate) => ipcRenderer.send('popup:close', immediate === true),
  openApp: () => ipcRenderer.send('popup:open-app'),
})
