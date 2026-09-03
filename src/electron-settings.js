export function readAutoLaunch(app) {
  return Boolean(app.getLoginItemSettings?.().openAtLogin);
}

export function setAutoLaunch(app, enabled) {
  const openAtLogin = Boolean(enabled);
  app.setLoginItemSettings({ openAtLogin });
  return openAtLogin;
}
