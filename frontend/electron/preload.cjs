// Preload: the only bridge between the page and the desktop shell.
// The page sees `window.posegoodDesktop` with a few launch-related calls and nothing else.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('posegoodDesktop', {
  version: 1,
  // 화면이 일체형 제목 표시줄 여백을 맞출 수 있게 OS 이름만 동기로 알려 준다.
  platform: process.platform,
  getLaunchInfo: () => ipcRenderer.invoke('desktop:launch-info'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('desktop:set-launch-at-login', enabled === true),
  setAutoCamera: (enabled) => ipcRenderer.invoke('desktop:set-auto-camera', enabled === true),
  setAlertPopup: (enabled) => ipcRenderer.invoke('desktop:set-alert-popup', enabled === true),
  // 자세 알림을 앱 밖 팝업으로도 보낸다. 앱을 보고 있으면 main이 'in-app'으로 건너뛴다.
  showAlert: (alert) => ipcRenderer.invoke('desktop:alert', { title: String(alert?.title ?? ''), body: String(alert?.body ?? '') }),
})
