const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const nodemailer = require('nodemailer');
const { autoUpdater } = require('electron-updater');

let mainWin = null;
app.setAppUserModelId('ch.dayan3d.facturation');

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0b0c',
    title: 'Dayan 3D — Facturation',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin = win;
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Logo en data URL (utilisé dans les PDF et le QR code)
ipcMain.handle('app:logo', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'assets', 'logo.png'));
  return 'data:image/png;base64,' + buf.toString('base64');
});

ipcMain.handle('app:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) return shell.openExternal(url);
});

// HTML -> PDF A4
async function htmlToPdf(html) {
  const tmp = path.join(os.tmpdir(), `dayan3d-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pdfWin.loadFile(tmp);
    return await pdfWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    pdfWin.destroy();
    fs.unlink(tmp, () => {});
  }
}

ipcMain.handle('pdf:save', async (e, { html, filename }) => {
  const data = await htmlToPdf(html);
  const parent = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Enregistrer la facture',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, data);
  return { saved: true, path: filePath };
});

// Impression directe (boîte de dialogue d'impression de Windows)
ipcMain.handle('pdf:print', async (_e, { html }) => {
  const tmp = path.join(os.tmpdir(), `dayan3d-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadFile(tmp);
    return await new Promise((resolve) => {
      w.webContents.print({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } }, (success, reason) => {
        resolve({ printed: success, reason });
      });
    });
  } finally {
    w.destroy();
    fs.unlink(tmp, () => {});
  }
});

/* ---------- E-mail (Gmail) ----------
   L'adresse et le mot de passe d'application sont enregistrés sur CET ordinateur seulement,
   chiffrés avec le coffre sécurisé de Windows (jamais dans la base ni dans le code). */
const mailFile = () => path.join(app.getPath('userData'), 'mail.json');

function readMail() {
  try {
    const j = JSON.parse(fs.readFileSync(mailFile(), 'utf8'));
    return { user: j.user, pass: safeStorage.decryptString(Buffer.from(j.pass, 'base64')) };
  } catch {
    return null;
  }
}

function transport(c) {
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: c.user, pass: c.pass } });
}

function friendlyMailError(e) {
  const m = String(e && e.message ? e.message : e);
  if (/Invalid login|Username and Password not accepted|535/i.test(m)) {
    return "Gmail refuse la connexion : vérifie l'adresse et le mot de passe d'application (16 caractères, validation en 2 étapes activée).";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(m)) return 'Impossible de joindre Gmail (réseau, VPN ou pare-feu ?).';
  return m;
}

ipcMain.handle('mail:status', () => {
  const c = readMail();
  return { configured: !!c, user: c ? c.user : '' };
});

ipcMain.handle('mail:save', (_e, { user, pass }) => {
  if (!user || !pass) throw new Error('Adresse et mot de passe requis.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le stockage sécurisé de Windows n'est pas disponible sur cet ordinateur.");
  const enc = safeStorage.encryptString(String(pass).replace(/\s+/g, '')).toString('base64');
  fs.writeFileSync(mailFile(), JSON.stringify({ user: String(user).trim(), pass: enc }), 'utf8');
  return true;
});

ipcMain.handle('mail:clear', () => {
  try { fs.unlinkSync(mailFile()); } catch {}
  return true;
});

ipcMain.handle('mail:test', async () => {
  const c = readMail();
  if (!c) throw new Error('NOT_CONFIGURED');
  try { await transport(c).verify(); } catch (e) { throw new Error(friendlyMailError(e)); }
  return true;
});

ipcMain.handle('mail:send', async (_e, { to, subject, text, html, pdfHtml, filename, attachments: extra }) => {
  const c = readMail();
  if (!c) throw new Error('NOT_CONFIGURED');
  if (!to || !subject) throw new Error('Destinataire et objet requis.');
  const attachments = [];
  let total = 0;
  for (const a of Array.isArray(extra) ? extra : []) {
    const buf = Buffer.from(String(a.base64 || ''), 'base64');
    total += buf.length;
    if (total > 15 * 1024 * 1024) throw new Error('Les pièces jointes dépassent 15 Mo au total.');
    attachments.push({ filename: String(a.filename || 'fichier'), content: buf, contentType: a.contentType || undefined });
  }
  if (pdfHtml) attachments.push({ filename: filename || 'facture.pdf', content: await htmlToPdf(pdfHtml), contentType: 'application/pdf' });
  try {
    await transport(c).sendMail({ from: `"Dayan 3D" <${c.user}>`, to, replyTo: c.user, subject, text, html, attachments });
  } catch (e) {
    throw new Error(friendlyMailError(e));
  }
  return true;
});

/* ---------- Diagnostic : petites requêtes réseau (adresses autorisées seulement) ---------- */
ipcMain.handle('diag:http', async (_e, { url, method = 'GET', headers = {}, body }) => {
  let u;
  try { u = new URL(url); } catch { throw new Error('Adresse invalide'); }
  if (u.protocol !== 'https:' || !/(^|\.)(supabase\.co|github\.com|githubusercontent\.com|github\.io)$/.test(u.hostname)) throw new Error('Adresse non autorisée');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await net.fetch(url, { method, headers, body, signal: ctrl.signal, redirect: 'follow' });
    return { status: r.status, finalUrl: r.url, text: (await r.text()).slice(0, 600) };
  } catch (e) {
    return { status: 0, text: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
});

/* ---------- Notifications Windows ---------- */
ipcMain.handle('app:notify', (_e, { title, body, target }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || 'Dayan 3D'), body: String(body || ''), icon: path.join(__dirname, 'assets', 'logo.png') });
  n.on('click', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show(); mainWin.focus();
      if (target) mainWin.webContents.send('app:navigate', target);
    }
  });
  n.show();
  return true;
});

/* ---------- Mises à jour automatiques ----------
   L'adresse du serveur de mises à jour est enregistrée dans la base (Paramètres > Mises à jour)
   et transmise ici au démarrage. Le serveur contient simplement latest.yml + l'installateur + le .blockmap. */
const sendUpdate = (payload) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update:status', payload); };
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;
autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', version: i.version, percent: 0 }));
autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
autoUpdater.on('download-progress', (pr) => sendUpdate({ state: 'downloading', percent: Math.round(pr.percent) }));
autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String(e && e.message ? e.message : e).slice(0, 300) }));

let feedSet = false;
ipcMain.handle('app:version', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update:configure', (_e, url) => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  if (!/^https:\/\//.test(String(url || ''))) throw new Error('Adresse invalide (elle doit commencer par https://).');
  autoUpdater.setFeedURL({ provider: 'generic', url: String(url).replace(/\/+$/, '') });
  feedSet = true;
  return { ok: true };
});
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) throw new Error("Les mises à jour ne marchent que dans l'application installée.");
  if (!feedSet) throw new Error("Adresse des mises à jour non enregistrée (Paramètres > Mises à jour).");
  const r = await autoUpdater.checkForUpdates();
  return { version: r && r.updateInfo ? r.updateInfo.version : null };
});
ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall(false, true); });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
