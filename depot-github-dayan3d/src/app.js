(() => {
'use strict';

const cfg = window.DAYAN_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
const state = { profile: null, company: null, isAdmin: false, route: 'dashboard' };

/* ============================================================
   Outils
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'CHF' });
const chf = (n) => nf.format(Number(n || 0));
const num = (x) => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const parseD = (iso) => new Date(iso + 'T12:00:00');
const fmtDate = (iso) => (iso ? parseD(iso).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fmtShort = (iso) => (iso ? parseD(iso).toLocaleDateString('fr-CH') : '');
const fmtTs = (ts) => (ts ? new Date(ts).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// Délai de paiement : « N jours fin de mois » (fin du mois d'émission + N jours) ou « N jours nets » (émission + N jours)
const companyTerms = () => ({ mode: (state.company && state.company.pay_term_mode) || 'eom', days: Number(state.company && state.company.pay_term_days != null ? state.company.pay_term_days : 30) });
const clientTerms = (c) => (c && c.pay_term_mode ? { mode: c.pay_term_mode, days: Number(c.pay_term_days || 0) } : companyTerms());
const termsLabel = (t) => (t.mode === 'net' ? (t.days <= 0 ? 'Paiement à réception' : `${t.days} jours net`) : (t.days <= 0 ? 'Paiement à la fin du mois' : `${t.days} jours fin de mois`));
function dueDateFor(issueISO, terms) {
  const t = terms || companyTerms();
  const d = parseD(issueISO);
  if (t.mode === 'net') { d.setDate(d.getDate() + t.days); return toISO(d); }
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  end.setDate(end.getDate() + t.days);
  return toISO(end);
}
// Échéance pour un client donné (on lit ses conditions dans la base)
async function dueFor(clientId, issueISO) {
  let c = null;
  if (clientId) { try { c = await must(sb.from('clients').select('*').eq('id', clientId).single()); } catch { c = null; } }
  return dueDateFor(issueISO, clientTerms(c));
}

const STATUS = {
  brouillon: ['Brouillon', ''],
  envoyee: ['À payer', 'amber'],
  retard: ['En retard', 'red'],
  payee: ['Payée', 'green'],
  annulee: ['Annulée', ''],
};
const effStatus = (i) => (i.status === 'envoyee' && i.due_date && i.due_date < todayISO() ? 'retard' : i.status);
const badge = (i) => { const [l, c] = STATUS[effStatus(i)] || ['?', '']; return `<span class="badge ${c}">${l}</span>`; };

const lastMail = (i) => (i.invoice_emails || []).slice().sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
const mailCell = (i) => { const m = lastMail(i); return m ? (m.kind === 'rappel' ? 'Rappel ' : 'Envoyée ') + new Date(m.sent_at).toLocaleDateString('fr-CH') : '—'; };

async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
async function ok(q) { const { error } = await q; if (error) throw error; }

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind === 'err' ? 'err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function modal(title, html, { wide = false } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="modal-h"><h3>${esc(title)}</h3><button class="x" data-close>✕</button></div><div class="modal-b">${html}</div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { el: ov, body: $('.modal-b', ov), close };
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const all = document.querySelectorAll('.overlay'); if (all.length) all[all.length - 1].remove(); }
});

function fieldHTML(f, v) {
  const val = v ?? f.default ?? '';
  const cls = 'field' + (f.full ? ' full' : '') + (f.type === 'checkbox' ? ' check' : '');
  const id = 'f_' + f.key;
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.key}" ${req}>${esc(val)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.key}" ${req}>${f.options.map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${ov === val ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  else if (f.type === 'date') input = `<input id="${id}" name="${f.key}" type="date" value="${esc(val)}" ${req}>`;
  else if (f.type === 'checkbox') input = `<input id="${id}" name="${f.key}" type="checkbox" ${v ?? f.default ? 'checked' : ''}>`;
  else input = `<input id="${id}" name="${f.key}" type="text" value="${esc(val)}" ${req} ${f.list ? `list="dl_${f.key}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}>${f.list ? `<datalist id="dl_${f.key}">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`;
  return f.type === 'checkbox'
    ? `<div class="${cls}">${input}<label for="${id}">${esc(f.label)}</label></div>`
    : `<div class="${cls}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
}

function formModal({ title, fields, values = {}, onSave, onDelete }) {
  const m = modal(title, `<form class="form">${fields.map((f) => fieldHTML(f, values[f.key])).join('')}
    <div class="form-actions">${onDelete ? '<button type="button" class="btn danger" data-del>Supprimer</button>' : '<span></span>'}
    <div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary">Enregistrer</button></div></div></form>`);
  const form = $('form', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.key];
      let v;
      if (f.type === 'checkbox') v = el.checked;
      else { v = el.value.trim(); if (f.type === 'number') v = num(v); else if (v === '') v = null; }
      data[f.key] = v;
    }
    try { await onSave(data); m.close(); } catch (err) { toast(err.message || String(err), 'err'); }
  });
  const del = $('[data-del]', m.el);
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement ?')) return;
    try { await onDelete(); m.close(); } catch (err) { toast(err.message || String(err), 'err'); }
  });
  return m;
}

async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message; } catch { return error.message; }
}

const ICONS = {
  dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  inv: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg>',
  cli: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.3 3.5 5"/></svg>',
  prod: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  look: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0 0 21 10.7C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/></svg>',
  quote: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/></svg>',
  log: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  stock: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  money: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/></svg>',
  members: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-3.5 2.7-5.3 5.5-5.3s5 1.8 5.5 5.3M15 14.6c2.4-.3 4.6 1 5.5 4.4"/></svg>',
  set: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>',
};

/* ============================================================
   Connexion
   ============================================================ */
const genPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const r = new Uint32Array(12); crypto.getRandomValues(r); return [...r].map((x) => a[x % a.length]).join(''); };

function renderForgot(email0 = '') {
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card">
    <img src="../assets/logo.png" alt="Dayan 3D"><h1>Mot de passe oublié</h1><p id="fp">Entre ton e-mail : un code te sera envoyé.</p>
    <form id="ff1" style="text-align:left"><div class="field"><label>E-mail</label><input id="fem" type="email" value="${esc(email0)}" required autofocus></div>
      <button class="btn primary" style="width:100%;justify-content:center">Envoyer le code</button></form>
    <form id="ff2" style="text-align:left;display:none"><div class="field"><label>Code reçu par e-mail</label><input id="fco" inputmode="numeric" autocomplete="one-time-code" required></div>
      <div class="field"><label>Nouveau mot de passe (8 caractères minimum)</label><input id="fp1" type="password" required></div>
      <div class="field"><label>Répète le mot de passe</label><input id="fp2" type="password" required></div>
      <button class="btn primary" style="width:100%;justify-content:center">Changer le mot de passe</button></form>
    <div class="err" id="fe"></div><div style="margin-top:10px"><button class="btn ghost" id="fback" style="padding:6px 12px">← Retour à la connexion</button></div></div></div>`;
  $('#fback').addEventListener('click', renderLogin);
  const nice = (m) => (/rate limit|too many|security purposes/i.test(m) ? "Trop de demandes d'e-mails : attends quelques minutes, puis réessaie." : /expired|invalid/i.test(m) ? 'Code invalide ou expiré. Redemande un code.' : m);
  $('#ff1').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#fe').textContent = '';
    const email = $('#fem').value.trim();
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) { $('#fe').textContent = nice(error.message || ''); return; }
    $('#ff1').style.display = 'none'; $('#ff2').style.display = 'block';
    $('#fp').textContent = `Un code a été envoyé à ${email} (vérifie aussi les courriers indésirables).`;
    $('#ff2').dataset.email = email; $('#fco').focus();
  });
  $('#ff2').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#fe').textContent = '';
    const p1 = $('#fp1').value;
    if (p1.length < 8) { $('#fe').textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
    if (p1 !== $('#fp2').value) { $('#fe').textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
    const v1 = await sb.auth.verifyOtp({ email: $('#ff2').dataset.email, token: $('#fco').value.trim(), type: 'recovery' });
    if (v1.error) { $('#fe').textContent = nice(v1.error.message || ''); return; }
    const up = await sb.auth.updateUser({ password: p1 });
    if (up.error) { $('#fe').textContent = nice(up.error.message || ''); return; }
    boot();
  });
}

function renderLogin() {
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card">
    <img src="../assets/logo.png" alt="Dayan 3D">
    <h1>Dayan 3D</h1><p>Facturation — connexion</p>
    <form id="lf">
      <div class="field"><label>E-mail</label><input id="em" type="email" required autofocus></div>
      <div class="field"><label>Mot de passe</label><input id="pw" type="password" required></div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:6px">Se connecter</button>
      <div class="err" id="le"></div>
      <div style="text-align:center;margin-top:6px"><a href="#" id="forgot" style="color:var(--muted);font-size:13px">Mot de passe oublié ?</a></div>
    </form></div></div>`;
  $('#forgot').addEventListener('click', (e) => { e.preventDefault(); renderForgot($('#em').value.trim()); });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#le').textContent = '';
    let res;
    try { res = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value }); }
    catch (err) { $('#le').textContent = 'Connexion impossible (réseau ?) : ' + (err.message || err); return; }
    if (res.error) {
      const m = res.error.message || '';
      const hint = /invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect, ou compte inexistant.'
        : /not confirmed/i.test(m) ? 'Compte non confirmé : dans Supabase, confirme l\'utilisateur.'
        : /api key|apikey|invalid.*key/i.test(m) ? 'Clé Supabase invalide : vérifie src/config.js.' : '';
      $('#le').textContent = (hint ? hint + ' ' : '') + '[' + m + ']';
      return;
    }
    boot();
  });
}

async function loadContext() {
  const { data: { session } } = await sb.auth.getSession();
  state.profile = await must(sb.from('profiles').select('*').eq('id', session.user.id).single());
  state.company = await must(sb.from('company_settings').select('*').eq('id', 1).single());
  state.isAdmin = state.profile.role === 'admin';
}

function renderShell() {
  const nav = [['dashboard', 'Tableau de bord', ICONS.dash], ['invoices', 'Factures', ICONS.inv], ['quotes', 'Devis', ICONS.quote], ['stock', 'Stock', ICONS.stock], ['clients', 'Clients', ICONS.cli], ['products', 'Produits et prestations', ICONS.prod], ...(state.isAdmin ? [['members', 'Membres', ICONS.members], ['expenses', 'Dépenses', ICONS.money], ['appearance', 'Apparence', ICONS.look], ['activity', 'Journal', ICONS.log]] : []), ['settings', 'Paramètres', ICONS.set]];
  $('#app').innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><img src="../assets/logo.png" alt=""><div><b>Dayan 3D</b><span>Facturation</span></div></div>
      <nav class="nav">${nav.map(([k, l, i]) => `<button data-nav="${k}">${i}${l}</button>`).join('')}</nav>
      <div id="updbanner"></div>
      <div class="me"><b>${esc(state.profile.full_name || state.profile.email)}</b>
        <span class="role">${state.isAdmin ? 'Administrateur' : 'Collaborateur'}</span><br>
        <button class="btn ghost" id="logout" style="padding:6px 12px">Déconnexion</button></div>
    </aside>
    <main class="main" id="view"></main></div>`;
  document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
  $('#logout').addEventListener('click', async () => { await sb.auth.signOut(); renderLogin(); });
}

const routes = {};

// Ajoute une ligne au journal (réservé aux événements que la base ne voit pas toute seule)
async function logActivity(action, entity, entityId, label, details) {
  try { await sb.from('activity_log').insert({ user_name: state.profile.full_name || state.profile.email, action, entity, entity_id: entityId || null, label, details: details || null }); } catch { /* journal pas installé : ignoré */ }
}


/* ---------- Notifications de paiement ---------- */
const WATCH_MS = 60000;
async function fetchRecentPaid(hours) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  try { return await must(sb.from('invoices').select('id,number,total,paid_amount,paid_at,paid_method,paid_by,clients(name)').eq('status', 'payee').gt('paid_at', since).order('paid_at')); }
  catch { return await must(sb.from('invoices').select('id,number,total,paid_amount,paid_at,clients(name)').eq('status', 'payee').gt('paid_at', since).order('paid_at')); }
}
async function checkPayments(first) {
  try {
    const notifyOn = localStorage.getItem('dayan_notif') !== 'off';
    const rows = await fetchRecentPaid(first ? 48 : 3);
    rows.forEach((r) => {
      if (state.seenPaid.has(r.id)) return;
      state.seenPaid.add(r.id);
      if (first || !notifyOn) return;
      if (r.paid_method === 'manuel' && r.paid_by === state.profile.id) return;
      window.desk.notify('Paiement reçu', `${r.number} · ${r.clients?.name || ''} · ${chf(r.paid_amount ?? r.total)}`, { route: 'invoice', id: r.id });
    });
    try {
      const qs = await must(sb.from('quotes').select('id,number,status,decided_at,accepted_by,accepted_via,clients(name)').eq('accepted_via', 'en ligne').gt('decided_at', new Date(Date.now() - (first ? 48 : 3) * 3600000).toISOString()));
      qs.forEach((x) => {
        const key = 'q' + x.id + x.status;
        if (state.seenPaid.has(key)) return;
        state.seenPaid.add(key);
        if (first || !notifyOn) return;
        window.desk.notify(x.status === 'accepte' ? 'Devis accepté' : 'Devis refusé', `${x.number} · ${x.clients?.name || ''}${x.accepted_by ? ' · ' + x.accepted_by : ''}`, { route: 'quote', id: x.id });
      });
    } catch { /* ignoré */ }
    if (state.isAdmin) {
      let al = [];
      try { al = await must(sb.from('activity_log').select('*').eq('action', 'Alerte').gt('at', new Date(Date.now() - (first ? 48 : 3) * 3600000).toISOString()).order('at')); } catch { al = []; }
      al.forEach((x) => {
        if (state.seenAlerts.has(x.id)) return;
        state.seenAlerts.add(x.id);
        if (!first && notifyOn) window.desk.notify('⚠ Paiement inattendu', `${x.label || ''} : à vérifier dans le tableau de bord`, { route: 'dashboard' });
      });
    }
  } catch { /* ignoré */ }
}
function startPaymentWatcher() {
  if (state.watcher) return;
  state.seenPaid = new Set(); state.seenAlerts = new Set();
  window.desk.onNavigate((t) => { if (t && t.route && routes[t.route]) go(t.route, t.id); });
  checkPayments(true);
  state.watcher = setInterval(() => checkPayments(false), WATCH_MS);
}

/* ---------- Mises à jour automatiques ---------- */
const DEFAULT_UPDATE_URL = 'https://github.com/Daniel151187/dayan3d-mises-a-jour/releases/latest/download';
function renderUpdateBanner() {
  const el = $('#updbanner'); if (!el) return;
  const u = state.update || {};
  if (u.state === 'ready') {
    el.innerHTML = `<div class="upd"><b>Version ${esc(u.version || '')} prête</b><br><span class="muted">Redémarre l'appli pour l'installer.</span><br><button class="btn primary" id="updgo" style="margin-top:8px;padding:6px 12px">Redémarrer et installer</button></div>`;
    $('#updgo').addEventListener('click', () => window.desk.updateInstall());
  } else if (u.state === 'downloading') {
    el.innerHTML = `<div class="upd">Mise à jour en cours… ${u.percent ?? 0} %</div>`;
  } else el.innerHTML = '';
}
async function initUpdates() {
  try {
    state.appInfo = await window.desk.appVersion();
    if (!state.updHooked) {
      state.updHooked = true;
      window.desk.onUpdate((p) => {
        state.update = { ...(state.update || {}), ...p };
        renderUpdateBanner();
        const st = $('#updstatus'); if (st) st.innerHTML = updateStatusText();
      });
    }
    const url = (state.company && state.company.update_url) || DEFAULT_UPDATE_URL;
    if (state.appInfo.packaged && url) {
      await window.desk.updateConfigure(url);
      window.desk.updateCheck().catch(() => {});
      if (!state.updTimer) state.updTimer = setInterval(() => window.desk.updateCheck().catch(() => {}), 4 * 3600 * 1000);
    }
  } catch { /* ignoré */ }
}
function updateStatusText() {
  const u = state.update || {};
  if (u.state === 'checking') return 'Recherche en cours…';
  if (u.state === 'downloading') return `Téléchargement de la version ${esc(u.version || '')} : ${u.percent ?? 0} %`;
  if (u.state === 'ready') return `<b style="color:#4ade80">Version ${esc(u.version || '')} prête</b> : redémarre l'appli pour l'installer.`;
  if (u.state === 'none') return 'Tu as déjà la dernière version.';
  if (u.state === 'error') return `<span style="color:#ff6b76">Impossible de vérifier : ${esc(u.message || '')}</span>`;
  return '';
}
async function go(route, arg) {
  state.route = route; state.arg = arg;
  const base = route === 'invoice' ? 'invoices' : route === 'quote' ? 'quotes' : route;
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === base));
  const v = $('#view');
  v.innerHTML = '<div class="loading">Chargement…</div>';
  try { await routes[route](v, arg); } catch (e) { v.innerHTML = `<div class="empty">Erreur : ${esc(e.message || e)}</div>`; }
}
window.addEventListener('focus', () => {
  if (['dashboard', 'invoices', 'quotes', 'stock', 'expenses', 'members', 'clients', 'products'].includes(state.route) && !document.querySelector('.overlay')) go(state.route);
});

const pageHead = (title, actions = '', sub = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`;

/* ============================================================
   Tableau de bord
   ============================================================ */
routes.dashboard = async (v) => {
  const dcols = 'id,number,issue_date,due_date,status,total,paid_at,paid_amount,clients(name)';
  let inv;
  try { inv = await must(sb.from('invoices').select(dcols + ',invoice_emails(sent_at,kind)').neq('status', 'annulee')); }
  catch { inv = await must(sb.from('invoices').select(dcols).neq('status', 'annulee')); }
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const issued = inv.filter((i) => ['envoyee', 'payee'].includes(i.status));
  const inYear = issued.filter((i) => parseD(i.issue_date).getFullYear() === y);
  const inMonth = inYear.filter((i) => parseD(i.issue_date).getMonth() === m);
  const sum = (a) => a.reduce((s, i) => s + Number(i.total), 0);
  const unpaid = issued.filter((i) => i.status === 'envoyee');
  const late = unpaid.filter((i) => effStatus(i) === 'retard');

  const labels = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const paidBy = Array(12).fill(0), unpaidBy = Array(12).fill(0);
  inYear.forEach((i) => { const k = parseD(i.issue_date).getMonth(); if (i.status === 'payee') paidBy[k] += Number(i.total); else unpaidBy[k] += Number(i.total); });
  const max = Math.max(1, ...paidBy.map((p, k) => p + unpaidBy[k]));
  const chart = labels.map((l, k) => {
    const hp = (paidBy[k] / max) * 100, hu = (unpaidBy[k] / max) * 100;
    return `<div class="col" title="${l} : ${chf(paidBy[k] + unpaidBy[k])}"><div class="bar" style="height:${Math.max(hp + hu, 1)}%"><i class="u" style="flex:${hu}"></i><i class="p" style="flex:${hp}"></i></div><span>${l}</span></div>`;
  }).join('');

  const byClient = {};
  issued.forEach((i) => { const n = i.clients?.name || '—'; byClient[n] = (byClient[n] || 0) + Number(i.total); });
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const daysLate = (i) => Math.floor((parseD(todayISO()) - parseD(i.due_date)) / 86400000);
  const lastRemind = (i) => { const r = (i.invoice_emails || []).filter((m) => m.kind === 'rappel').sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0]; return r ? ' · dernier rappel ' + new Date(r.sent_at).toLocaleDateString('fr-CH') : ''; };
  const lateRows = late.slice().sort((a, b) => a.due_date.localeCompare(b.due_date));
  const lateCard = lateRows.length ? `<div class="card list" style="margin-bottom:16px"><h2>Factures à relancer</h2>${lateRows.map((i) => `<div class="li"><span><b>${esc(i.number)}</b> · ${esc(i.clients?.name || '—')} <span class="muted">· ${daysLate(i)} jour(s) de retard${lastRemind(i)}</span></span><span><b class="mono">${chf(i.total)}</b> <button class="btn" data-remind="${i.id}" style="padding:5px 12px">Rappeler</button></span></div>`).join('')}</div>` : '';
  let qBox = '';
  try {
    const qs = await must(sb.from('quotes').select('id,status,valid_until,total,converted_invoice_id'));
    const open = qs.filter((x) => x.status === 'envoye' && !(x.valid_until && x.valid_until < todayISO()));
    const toInv = qs.filter((x) => x.status === 'accepte' && !x.converted_invoice_id);
    if (open.length || toInv.length) {
      qBox = `<div class="card list" style="margin-bottom:16px"><h2>Devis</h2>
        <div class="li"><span>En attente de réponse : <b>${open.length}</b></span><b class="mono">${chf(open.reduce((a, x) => a + Number(x.total), 0))}</b></div>
        <div class="li"><span>Acceptés, à facturer : <b>${toInv.length}</b></span><b class="mono">${chf(toInv.reduce((a, x) => a + Number(x.total), 0))}</b></div>
        <div style="margin-top:10px"><button class="btn" data-goquotes>Voir les devis</button></div></div>`;
    }
  } catch { /* devis pas encore installés */ }
  let aBox = '';
  if (state.isAdmin) {
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const al = await must(sb.from('activity_log').select('*').eq('action', 'Alerte').gte('at', since).order('at', { ascending: false }).limit(5));
      if (al.length) aBox = `<div class="card list" style="margin-bottom:16px;border-color:#7f1d1d"><h2 style="color:#ff6b76">⚠ Paiement inattendu à vérifier</h2>${al.map((x) => `<div class="li" style="display:block"><b>${esc(x.label || '')}</b> <span class="muted">· ${esc(new Date(x.at).toLocaleDateString('fr-CH'))}</span><div class="muted" style="margin-top:3px">${esc(x.details || '')}</div></div>`).join('')}<div class="hint">Si c'est un doublon, rembourse le client depuis ton tableau de bord Stripe (Paiements).</div></div>`;
    } catch { /* journal pas installé */ }
  }
  let sBox = '';
  try {
    const si = await must(sb.from('stock_items').select('id,name,unit,quantity,min_quantity').eq('active', true));
    const lowS = si.filter((x) => stockLevel(x) !== 'ok').sort((a, b) => Number(a.quantity) - Number(b.quantity)).slice(0, 6);
    if (lowS.length) sBox = `<div class="card list" style="margin-bottom:16px"><h2>Stock à réapprovisionner</h2>${lowS.map((x) => `<div class="li"><span>${esc(x.name)}</span><span>${stockBadge(x)} <b class="mono">${esc(fmtQty(x.quantity))} ${esc(x.unit)}</b></span></div>`).join('')}<div style="margin-top:10px"><button class="btn" data-gostock>Voir le stock</button></div></div>`;
  } catch { /* stock pas encore installé */ }
  let pBox = '';
  if (state.isAdmin) {
    try {
      const exps = await fetchAll('expenses', 'spent_on,amount', 'spent_on');
      const paidAll = inv.filter((i) => i.status === 'payee' && i.paid_at);
      const calc = (a, b) => { const r = paidAll.filter((i) => { const d = localDay(i.paid_at); return d >= a && d <= b; }).reduce((t, i) => t + paidAmount(i), 0); const c = exps.filter((x) => x.spent_on >= a && x.spent_on <= b).reduce((t, x) => t + Number(x.amount), 0); return { r, c, p: r - c }; };
      const mo = calc(periodRange('month').from, periodRange('month').to), yr = calc(periodRange('year').from, periodRange('year').to);
      const fm = (n) => `${n < 0 ? '−' : ''}${chf(Math.abs(n))}`;
      pBox = `<div class="card list" style="margin-bottom:16px"><h2>Bénéfice (encaissé − dépenses)</h2>
        <div class="li"><span>Ce mois <span class="muted">· ${chf(mo.r)} − ${chf(mo.c)}</span></span><b class="mono" style="color:${mo.p >= 0 ? '#4ade80' : '#ff6b76'}">${fm(mo.p)}</b></div>
        <div class="li"><span>Cette année <span class="muted">· ${chf(yr.r)} − ${chf(yr.c)}</span></span><b class="mono" style="color:${yr.p >= 0 ? '#4ade80' : '#ff6b76'}">${fm(yr.p)}</b></div>
        <div style="margin-top:10px"><button class="btn" data-goexp>Voir le détail</button></div></div>`;
    } catch { /* dépenses pas encore installées */ }
  }
  const lastPaid = inv.filter((i) => i.status === 'payee' && i.paid_at).sort((a, b) => b.paid_at.localeCompare(a.paid_at)).slice(0, 5);

  v.innerHTML = pageHead('Tableau de bord', '', `${now.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })}`) + `
    <div class="kpis">
      <div class="card kpi accent"><div class="lbl">CA du mois</div><div class="val">${chf(sum(inMonth))}</div><div class="note">${inMonth.length} facture(s) émise(s)</div></div>
      <div class="card kpi"><div class="lbl">CA de l'année</div><div class="val">${chf(sum(inYear))}</div><div class="note">${inYear.length} facture(s) émise(s)</div></div>
      <div class="card kpi warn"><div class="lbl">Impayées</div><div class="val">${chf(sum(unpaid))}</div><div class="note">${unpaid.length} facture(s) à payer</div></div>
      <div class="card kpi bad"><div class="lbl">En retard</div><div class="val">${chf(sum(late))}</div><div class="note">${late.length} facture(s) échue(s)</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h2>Chiffre d'affaires par mois — ${y}</h2><div class="chart">${chart}</div>
      <div class="legend"><span><i style="background:var(--red)"></i>Payé</span><span><i style="background:#4a4a54"></i>Pas encore payé</span></div></div>
    ${aBox}
    ${qBox}
    ${pBox}
    ${sBox}
    ${lateCard}
    <div class="grid2">
      <div class="card list"><h2>Meilleurs clients</h2>${top.length ? top.map(([n, t]) => `<div class="li"><span>${esc(n)}</span><b class="mono">${chf(t)}</b></div>`).join('') : '<div class="muted">Pas encore de données.</div>'}</div>
      <div class="card list"><h2>Derniers paiements reçus</h2>${lastPaid.length ? lastPaid.map((i) => `<div class="li"><span>${esc(i.number)} <span class="muted">· ${esc(i.clients?.name || '')}</span></span><span><b class="mono">${chf(i.paid_amount ?? i.total)}</b> <span class="muted">${fmtTs(i.paid_at)}</span></span></div>`).join('') : '<div class="muted">Aucun paiement Stripe reçu pour le moment.</div>'}</div>
    </div>
    <div class="hint">Le CA compte les factures émises (finalisées), par date d'émission. Le statut « Payée » est mis à jour automatiquement par Stripe.</div>`;
  const ge = v.querySelector('[data-goexp]'); if (ge) ge.addEventListener('click', () => go('expenses'));
  const gs = v.querySelector('[data-gostock]'); if (gs) gs.addEventListener('click', () => go('stock'));
  const gq = v.querySelector('[data-goquotes]'); if (gq) gq.addEventListener('click', () => go('quotes'));
  v.querySelectorAll('[data-remind]').forEach((b) => b.addEventListener('click', () => openEmailDialog(b.dataset.remind, 'rappel').catch((e) => toast(ipcMsg(e), 'err'))));
};

/* ============================================================
   Clients
   ============================================================ */
const CLIENT_FIELDS = [
  { key: 'name', label: 'Nom / société', required: true, full: true },
  { key: 'contact', label: 'Contact' },
  { key: 'email', label: 'E-mail' },
  { key: 'address', label: 'Adresse', full: true },
  { key: 'postal_code', label: 'NPA' },
  { key: 'city', label: 'Localité' },
  { key: 'country', label: 'Pays', default: 'Suisse' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'pay_term_mode', label: 'Délai de paiement', type: 'select', options: [['', 'Par défaut (réglage général)'], ['eom', 'Fin de mois + N jours'], ['net', 'N jours nets']] },
  { key: 'pay_term_days', label: 'Nombre de jours (si délai particulier)', type: 'number', inputmode: 'numeric', default: '' },
  { key: 'discount_percent', label: 'Remise habituelle (%)', type: 'number', inputmode: 'decimal', default: '' },
  { key: 'pay_mode', label: 'Mode de paiement habituel', type: 'select', options: [['', 'Par défaut (réglage général)'], ['carte', 'Carte en ligne (Stripe)'], ['qrbill', 'QR-facture (virement)'], ['both', 'Les deux']] },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];
const CLIENT_EXTRA = ['pay_term_mode', 'pay_term_days', 'discount_percent', 'pay_mode'];
// N'envoie les nouvelles colonnes que si elles servent (ou existent déjà) : l'appli reste compatible tant que la mise à jour 19 n'est pas faite
function clientPayload(d, c) {
  const out = { ...d };
  const touched = CLIENT_EXTRA.some((k) => (c && k in c) || (d[k] !== null && d[k] !== 0 && d[k] !== ''));
  if (!touched) CLIENT_EXTRA.forEach((k) => delete out[k]);
  else { out.pay_term_days = d.pay_term_mode ? Number(d.pay_term_days || 0) : null; out.discount_percent = Number(d.discount_percent || 0); }
  return out;
}

routes.clients = async (v) => {
  const rows = await must(sb.from('clients').select('*').order('name'));
  const edit = (c) => formModal({
    title: c ? 'Modifier le client' : 'Nouveau client', fields: CLIENT_FIELDS, values: c || {},
    onSave: async (d) => { const row = clientPayload(d, c); if (c) await ok(sb.from('clients').update(row).eq('id', c.id)); else await ok(sb.from('clients').insert(row)); toast('Client enregistré'); go('clients'); },
    onDelete: c ? async () => {
      try { await ok(sb.from('clients').delete().eq('id', c.id)); }
      catch (e) { throw new Error(e.code === '23503' ? 'Ce client a des factures : impossible de le supprimer.' : e.message); }
      go('clients');
    } : null,
  });
  v.innerHTML = pageHead('Clients', '<button class="btn primary" id="add">+ Nouveau client</button>') +
    `<div class="toolbar"><input id="q" placeholder="Rechercher…"></div><div class="card"><table><thead><tr><th>Nom</th><th>Contact</th><th>Localité</th><th>E-mail</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    const list = rows.filter((c) => [c.name, c.contact, c.city, c.email].join(' ').toLowerCase().includes(q));
    $('#tb').innerHTML = list.length ? list.map((c) => `<tr class="row" data-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.contact)}</td><td>${esc([c.postal_code, c.city].filter(Boolean).join(' '))}</td><td class="muted">${esc(c.email)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Aucun client.</td></tr>';
    document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => edit(rows.find((c) => c.id === r.dataset.id))));
  };
  $('#q').addEventListener('input', draw); $('#add').addEventListener('click', () => edit(null)); draw();
};

/* ============================================================
   Produits et prestations
   ============================================================ */
const TYPES = ['Produit', 'Service', 'Objet 3D', 'Modélisation', 'Gravure et découpe laser'];
const PRODUCT_FIELDS = [
  { key: 'type', label: 'Type', list: TYPES, default: 'Service' },
  { key: 'unit_price', label: 'Prix unitaire (CHF)', type: 'number', inputmode: 'decimal', default: '0' },
  { key: 'description', label: 'Description', required: true, full: true },
  { key: 'active', label: 'Actif (proposé dans les factures)', type: 'checkbox', default: true, full: true },
];

routes.products = async (v) => {
  const rows = await must(sb.from('products').select('*').order('description'));
  const edit = (p) => formModal({
    title: p ? 'Modifier' : 'Nouveau produit / prestation', fields: PRODUCT_FIELDS, values: p || {},
    onSave: async (d) => { if (p) await ok(sb.from('products').update(d).eq('id', p.id)); else await ok(sb.from('products').insert(d)); toast('Enregistré'); go('products'); },
    onDelete: p ? async () => { await ok(sb.from('products').delete().eq('id', p.id)); go('products'); } : null,
  });
  v.innerHTML = pageHead('Produits et prestations', '<button class="btn primary" id="add">+ Nouveau</button>') +
    `<div class="card"><table><thead><tr><th>Type</th><th>Description</th><th class="r">Prix unitaire</th><th>État</th></tr></thead><tbody>${rows.length ? rows.map((p) => `<tr class="row" data-id="${p.id}"><td>${esc(p.type)}</td><td><b>${esc(p.description)}</b></td><td class="r mono">${chf(p.unit_price)}</td><td>${p.active ? '<span class="badge green">Actif</span>' : '<span class="badge">Inactif</span>'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Aucun produit ou prestation.</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => edit(rows.find((p) => p.id === r.dataset.id))));
  $('#add').addEventListener('click', () => edit(null));
};

/* ============================================================
   Factures : liste
   ============================================================ */
routes.invoices = async (v) => {
  const icols = 'id,number,issue_date,due_date,status,total,clients(name)';
  let rows;
  try { rows = await must(sb.from('invoices').select(icols + ',kind,invoice_emails(sent_at,kind)').order('created_at', { ascending: false })); }
  catch {
    try { rows = await must(sb.from('invoices').select(icols + ',invoice_emails(sent_at,kind)').order('created_at', { ascending: false })); }
    catch { rows = await must(sb.from('invoices').select(icols).order('created_at', { ascending: false })); }
  }
  v.innerHTML = pageHead('Factures', '<button class="btn primary" id="add">+ Nouvelle facture</button>') + `
    <div class="toolbar"><input id="q" placeholder="Rechercher (numéro, client)…">
      <select id="st"><option value="">Tous les statuts</option><option value="brouillon">Brouillons</option><option value="envoyee">À payer</option><option value="retard">En retard</option><option value="payee">Payées</option><option value="annulee">Annulées</option></select></div>
    <div class="card"><table><thead><tr><th>Numéro</th><th>Client</th><th>Émission</th><th>Échéance</th><th class="r">Total</th><th>Statut</th><th>E-mail</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#st').value;
    const list = rows.filter((i) => (!st || effStatus(i) === st) && [i.number, i.clients?.name].join(' ').toLowerCase().includes(q));
    $('#tb').innerHTML = list.length ? list.map((i) => `<tr class="row" data-id="${i.id}"><td><b>${esc(i.number)}</b>${i.kind === 'acompte' ? ' <span class="badge">Acompte</span>' : ''}</td><td>${esc(i.clients?.name || '—')}</td><td>${fmtShort(i.issue_date)}</td><td>${fmtShort(i.due_date)}</td><td class="r mono">${chf(i.total)}</td><td>${badge(i)}</td><td class="muted">${mailCell(i)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">Aucune facture.</td></tr>';
    document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => go('invoice', r.dataset.id)));
  };
  $('#q').addEventListener('input', draw); $('#st').addEventListener('change', draw);
  $('#add').addEventListener('click', () => go('invoice', null)); draw();
};

/* ============================================================
   Facture : PDF + QR Stripe
   ============================================================ */
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// QR noir classique, très lisible (correction d'erreur H), logo au centre
async function makeQR(text, logoDataUrl) {
  const qr = window.qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), cell = 14, margin = 2, size = (n + margin * 2) * cell;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + margin) * cell, (r + margin) * cell, cell, cell);
  const box = Math.round(size * 0.21), x = Math.round((size - box) / 2);
  g.fillStyle = '#fff'; g.fillRect(x, x, box, box);
  const img = await loadImg(logoDataUrl);
  const p = Math.round(box * 0.07);
  g.drawImage(img, x + p, x + p, box - 2 * p, box - 2 * p);
  return c.toDataURL('image/png');
}

/* ---------- QR-facture suisse : outils ---------- */
const normIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
const validSwissIban = (iban) => {
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(iban)) return false;
  const r = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of r) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
  return rem === 1;
};
const isQrIban = (iban) => { const iid = Number(iban.slice(4, 9)); return iid >= 30000 && iid <= 31999; };
const formatIban = (iban) => iban.replace(/(.{4})/g, '$1 ').trim();
// Référence QR (QRR) : 26 chiffres + chiffre de contrôle (modulo 10 récursif)
const qrrReference = (number) => {
  const digits = String(number || '').replace(/\D/g, '').slice(-26).padStart(26, '0');
  const T = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let c = 0;
  for (const d of digits) c = T[(c + Number(d)) % 10];
  return digits + String((10 - c) % 10);
};
const formatQrr = (ref) => ref.slice(0, ref.length % 5 || 5).replace(/^$/, '') + ' ' + (ref.slice(ref.length % 5 || 5).match(/.{5}/g) || []).join(' ');
const splitStreet = (addr) => {
  const a = String(addr || '').trim();
  const m = a.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:[-\/]\d+[a-zA-Z]?)?)$/);
  return m ? { street: m[1].trim(), no: m[2] } : { street: a, no: '' };
};
const countryCode = (c) => {
  const x = String(c || '').trim().toLowerCase();
  if (!x || ['suisse', 'switzerland', 'schweiz', 'svizzera', 'ch'].includes(x)) return 'CH';
  const map = { liechtenstein: 'LI', france: 'FR', allemagne: 'DE', germany: 'DE', deutschland: 'DE', italie: 'IT', italy: 'IT', autriche: 'AT', austria: 'AT', belgique: 'BE', espagne: 'ES', luxembourg: 'LU' };
  if (map[x]) return map[x];
  return /^[a-z]{2}$/.test(x) ? x.toUpperCase() : 'CH';
};
const fmtAmountSlip = (n) => { const [i, d] = Number(n).toFixed(2).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + d; };

async function makeSwissQR(payload) {
  if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8']) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  const qr = window.qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), cell = 12, size = n * cell;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect(k * cell, r * cell, cell, cell);
  // croix suisse au centre : 7 mm sur 46 mm
  const cs = (size * 7) / 46, x = (size - cs) / 2, u = cs / 19.8;
  g.fillStyle = '#fff'; g.fillRect(x, x, cs, cs);
  g.fillStyle = '#000'; g.fillRect(x + 0.7 * u, x + 0.7 * u, 18.4 * u, 18.4 * u);
  g.fillStyle = '#fff'; g.fillRect(x + 8.3 * u, x + 4 * u, 3.3 * u, 11 * u); g.fillRect(x + 4.4 * u, x + 7.9 * u, 11 * u, 3.3 * u);
  return c.toDataURL('image/png');
}

// Données de la QR-facture (null si l'IBAN ou l'adresse de la société manque)
async function swissBill(inv, client, co) {
  const iban = normIban(co && co.iban);
  if (!validSwissIban(iban) || !co.name || !co.postal_code || !co.city) return null;
  const cred = splitStreet(co.address);
  const total = Number(inv.total || 0);
  const qrr = isQrIban(iban);
  const refRaw = qrr ? qrrReference(inv.number) : '';
  const msg = `Facture ${inv.number || ''}`.trim().slice(0, 140);
  const hasDeb = !!(client && client.name && client.postal_code && client.city);
  const deb = hasDeb ? splitStreet(client.address) : null;
  const lines = [
    'SPC', '0200', '1', iban,
    'S', co.name.slice(0, 70), cred.street.slice(0, 70), cred.no.slice(0, 16), String(co.postal_code).slice(0, 16), co.city.slice(0, 35), countryCode(co.country),
    '', '', '', '', '', '', '',
    total > 0 ? total.toFixed(2) : '', 'CHF',
    ...(hasDeb ? ['S', client.name.slice(0, 70), deb.street.slice(0, 70), deb.no.slice(0, 16), String(client.postal_code).slice(0, 16), client.city.slice(0, 35), countryCode(client.country)] : ['', '', '', '', '', '', '']),
    qrr ? 'QRR' : 'NON', refRaw, msg, 'EPD',
  ];
  const payload = lines.join('\n');
  return {
    qr: await makeSwissQR(payload), payload, ibanFmt: formatIban(iban),
    cred: { name: co.name, street: cred.street, no: cred.no, postal: co.postal_code, city: co.city },
    ref: qrr ? formatQrr(refRaw) : '', msg, amountFmt: total > 0 ? fmtAmountSlip(total) : '',
    deb: hasDeb ? { name: client.name, street: deb.street, no: deb.no, postal: client.postal_code, city: client.city } : null,
  };
}

function qrBillHTML(b) {
  const addr = (a) => [a.name, `${a.street}${a.no ? ' ' + a.no : ''}`.trim(), `${a.postal} ${a.city}`.trim()].filter(Boolean).map(esc).join('<br>');
  const blank = (w, h) => `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" style="display:block"><path fill="none" stroke="#000" stroke-width=".3" d="M0 3V0H3M${w - 3} 0H${w}V3M${w} ${h - 3}V${h}H${w - 3}M3 ${h}H0V${h - 3}"/></svg>`;
  const debHTML = b.deb ? addr(b.deb) : null;
  return `<div class="qrbill"><span class="qb-sc">✂</span>
<div class="qb-r">
  <div class="qb-t">Récépissé</div>
  <div class="qb-b"><div class="qb-h6">Compte / Payable à</div><div class="qb-v8">${esc(b.ibanFmt)}<br>${addr(b.cred)}</div></div>
  ${b.ref ? `<div class="qb-b"><div class="qb-h6">Référence</div><div class="qb-v8">${esc(b.ref)}</div></div>` : ''}
  <div class="qb-b"><div class="qb-h6">Payable par</div>${debHTML ? `<div class="qb-v8">${debHTML}</div>` : blank(52, 20)}</div>
  <div class="qb-ra"><div><div class="qb-h6">Monnaie</div><div class="qb-v8">CHF</div></div><div><div class="qb-h6">Montant</div>${b.amountFmt ? `<div class="qb-v8">${b.amountFmt}</div>` : blank(30, 10)}</div></div>
  <div class="qb-pt">Point de dépôt</div>
</div>
<div class="qb-p">
  <div class="qb-t" style="position:absolute;left:5mm;top:5mm">Section paiement</div>
  <img class="qb-qr" src="${b.qr}" alt="QR-facture">
  <div class="qb-pa"><div><div class="qb-h8">Monnaie</div><div class="qb-v10">CHF</div></div><div><div class="qb-h8">Montant</div>${b.amountFmt ? `<div class="qb-v10">${b.amountFmt}</div>` : blank(40, 15)}</div></div>
  <div class="qb-info">
    <div class="qb-b"><div class="qb-h8">Compte / Payable à</div><div class="qb-v10">${esc(b.ibanFmt)}<br>${addr(b.cred)}</div></div>
    ${b.ref ? `<div class="qb-b"><div class="qb-h8">Référence</div><div class="qb-v10">${esc(b.ref)}</div></div>` : ''}
    <div class="qb-b"><div class="qb-h8">Informations supplémentaires</div><div class="qb-v10">${esc(b.msg)}</div></div>
    <div class="qb-b"><div class="qb-h8">Payable par</div>${debHTML ? `<div class="qb-v10">${debHTML}</div>` : blank(65, 25)}</div>
  </div>
</div></div>`;
}

const QRBILL_CSS = `
.page.qb{display:flex;flex-direction:column;padding-bottom:0;min-height:296.4mm}
.page.qb .band{padding:8mm 16mm 6mm}
.page.qb .parties{margin-top:6mm}
.page.qb table{margin-top:6mm}
.page.qb td{padding:2.2mm 3mm}
.page.qb .tot{margin-top:4mm}
.page.qb .bottom{margin-top:6mm}
.page.qb .qr{width:38mm;height:38mm}
.page.qb .payr{width:46mm}
.page.qb .paycard{padding:4mm}
.qrbill{position:relative;width:210mm;height:105mm;margin:auto -16mm 0 -16mm;border-top:.3mm dashed #000;background:#fff;color:#000;font-family:Arial,'Liberation Sans',Helvetica,sans-serif;page-break-inside:avoid;break-inside:avoid;flex:none}
.qb-sc{position:absolute;top:-3.4mm;left:8mm;font-size:9pt;background:#fff;padding:0 1mm;line-height:1}
.qb-r{position:absolute;left:0;top:0;width:62mm;height:105mm;box-sizing:border-box;padding:5mm;border-right:.3mm dashed #000}
.qb-p{position:absolute;left:62mm;top:0;width:148mm;height:105mm}
.qb-t{font-size:11pt;font-weight:bold;line-height:1.1;margin-bottom:4mm}
.qb-b{margin-bottom:2.6mm}
.qb-h6{font-size:6pt;font-weight:bold;line-height:9pt}
.qb-v8{font-size:8pt;line-height:9pt}
.qb-h8{font-size:8pt;font-weight:bold;line-height:11pt}
.qb-v10{font-size:10pt;line-height:11pt}
.qb-ra{position:absolute;left:5mm;top:68mm;display:flex;gap:6mm}
.qb-pt{position:absolute;right:5mm;top:90mm;font-size:6pt;font-weight:bold}
.qb-qr{position:absolute;left:5mm;top:17mm;width:46mm;height:46mm;image-rendering:pixelated}
.qb-pa{position:absolute;left:5mm;top:68mm;display:flex;gap:8mm}
.qb-info{position:absolute;left:56mm;top:5mm;width:87mm}
.qb-info .qb-b{margin-bottom:3.2mm}
`;

const PAY_MODES = [['carte', 'Carte en ligne (Stripe)'], ['qrbill', 'QR-facture (virement)'], ['both', 'Les deux']];
const payModeLabel = (m) => (PAY_MODES.find((x) => x[0] === (m || 'carte')) || PAY_MODES[0])[1];
const companyHasIban = () => validSwissIban(normIban(state.company && state.company.iban));
const defaultPayMode = () => { const m = (layoutOf(state.company).pay_default) || 'carte'; return m !== 'carte' && !companyHasIban() ? 'carte' : m; };
const LAYOUT_DEFAULTS = {
  pay_default: 'carte', show_payment: true, show_contact: true, show_phone: true, show_email: true, show_website: true,
  show_client_email: true, show_due: true, show_vat: true, show_notes: true, show_conditions: true, show_footer: true,
  title_label: 'FACTURE', pay_button_label: 'Payer en ligne', cards_text: 'Visa · Mastercard · Apple Pay · Google Pay',
  pay_hint: 'Scannez le code QR avec votre téléphone pour payer par carte.', mode_text: 'Paiement en ligne par carte (QR code)',
  thanks_text: '', footer_left: '', footer_right: '',
  mail_invoice_subject: 'Facture {numero} — {societe}',
  mail_invoice_body: "Bonjour,\n\nVeuillez trouver ci-joint la facture {numero} d'un montant de {montant}, à régler avant le {echeance}.\n\n{paiement}\n\nMerci pour votre confiance.\n\nCordialement,\n{contact}\n{societe}",
  mail_reminder_subject: 'Rappel — facture {numero}',
  mail_reminder_body: "Bonjour,\n\nSauf erreur de notre part, la facture {numero} d'un montant de {montant}, échue le {echeance}, n'a pas encore été réglée.\n\n{paiement}\n\nSi le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{contact}\n{societe}",
  mail_quote_subject: 'Devis {numero} — {societe}',
  mail_quote_body: "Bonjour,\n\nVeuillez trouver ci-joint notre devis {numero} d'un montant de {montant}, valable jusqu'au {validite}.\n\n{acceptation}\n\nCordialement,\n{contact}\n{societe}",
  accept_page_url: 'https://daniel151187.github.io/dayan3d-mises-a-jour/accepter.html',
  calc_min: '5', calc_max: '20', calc_default: '10', quote_validity_days: '30', quote_accept_text: 'Bon pour accord — lieu, date et signature du client',
};
const layoutOf = (co) => ({ ...LAYOUT_DEFAULTS, ...((co && co.invoice_layout) || {}) });

function buildInvoiceHTML({ inv, items, client, company, qr, logo, replacesNumber, quoteNumber, bill }) {
  const co = company, L = layoutOf(company);
  const isQuote = !!inv.is_quote;
  const isDelivery = !!inv.is_delivery;
  const isReceipt = !!inv.is_receipt;
  const clientLines = client ? [
    `<div class="r1"><span>Société</span><b>${esc(client.name)}</b></div>`,
    client.contact ? `<div class="r1"><span>Contact</span><div>${esc(client.contact)}</div></div>` : '',
    client.address || client.city ? `<div class="r1"><span>Adresse</span><div>${esc(client.address || '')}<br>${esc([client.postal_code, client.city].filter(Boolean).join(' '))}<br>${esc(client.country || '')}</div></div>` : '',
    client.email && L.show_client_email ? `<div class="r1"><span>E-mail</span><div>${esc(client.email)}</div></div>` : '',
  ].join('') : '<div class="r1"><span>Société</span><b>—</b></div>';

  const hasDisc = items.some((l) => num(l.discount_percent) > 0);
  const lineTot = (l) => Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_percent) / 100) * 100) / 100;
  const subTot = Math.round(items.reduce((a, l) => a + lineTot(l), 0) * 100) / 100;
  const globalPct = num(inv.discount_percent);
  const globalAmt = Math.round(((subTot * globalPct) / 100) * 100) / 100;
  const rows = items.map((l) => `<tr><td>${esc(l.type || '')}</td><td>${esc(l.description)}</td><td class="n">${chf(l.unit_price)}</td><td class="n">${esc(String(num(l.quantity)).replace('.', ','))}</td>${hasDisc ? `<td class="n">${num(l.discount_percent) > 0 ? esc(String(num(l.discount_percent)).replace('.', ',')) + ' %' : ''}</td>` : ''}<td class="n">${chf(lineTot(l))}</td></tr>`).join('');

  const payUrl = esc(inv.stripe_payment_link_url || '');
  const shortUrl = esc((inv.stripe_payment_link_url || '').replace(/^https?:\/\//, ''));
  const paid = inv.status === 'payee';
  const cancelled = inv.status === 'annulee';
  const mode = inv.pay_mode || 'carte';
  const wantCard = mode !== 'qrbill';
  const showBill = !!(bill && mode !== 'carte' && !isQuote && !isDelivery && !paid && !cancelled);
  const pay = cancelled
    ? `<div class="qr ph cancelbox"><div>✖ Facture annulée</div></div>`
    : paid
    ? `<div class="qr ph paidbox"><div>✔ ${isReceipt ? 'Cotisation payée' : 'Facture payée'}<br><span style="font-weight:400;font-size:9pt">${inv.paid_at ? 'le ' + esc(fmtDate(String(inv.paid_at).slice(0, 10))) : ''}</span></div></div>`
    : qr
    ? `<a class="qrl" href="${payUrl}"><img class="qr" src="${qr}" alt="QR"></a><div class="payr"><a class="paybtn" href="${payUrl}">${esc(L.pay_button_label)}</a><div class="cards">${esc(L.cards_text)}</div><div class="scan">${esc(L.pay_hint)}</div><div class="url">${shortUrl}</div></div>`
    : `<div class="qr ph">Le QR de paiement apparaît quand la facture est finalisée</div>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1d;font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.page{width:210mm;min-height:297mm;padding:0 16mm 12mm;position:relative}
.band{background:#0b0b0c;margin:0 -16mm;padding:11mm 16mm 9mm;display:flex;justify-content:space-between;align-items:center;border-bottom:2.5mm solid #e11d2e}
.band small{color:#e11d2e;font-weight:700;letter-spacing:.25em;font-size:8.5pt}
.band h1{margin:1mm 0 1mm;color:#fff;font-size:24pt;font-weight:600;letter-spacing:.5px}
.band .d{color:#b9b9c2;font-size:10pt}
.logo{width:26mm;height:26mm;background:#fff;border-radius:5mm;padding:1.5mm;display:flex;align-items:center;justify-content:center}
.logo img{width:100%;height:100%;object-fit:contain}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:14mm;margin-top:11mm}
.parties h2{font-size:11pt;margin:0 0 3mm;padding-bottom:2mm;border-bottom:.4mm solid #e11d2e;font-weight:600}
.r1{display:flex;gap:4mm;margin-bottom:1.6mm;font-size:9pt}
.r1 span{width:20mm;color:#777;flex:none}
table{width:100%;border-collapse:collapse;margin-top:12mm}
thead th{background:#0b0b0c;color:#fff;font-weight:500;font-size:9pt;padding:3mm 3mm;text-align:left}
thead th.n{text-align:right}
td{padding:3.2mm 3mm;border-bottom:.3mm solid #e7e7ea;vertical-align:top}
td.n{text-align:right;white-space:nowrap}
.tot{display:flex;justify-content:flex-end;margin-top:6mm}
.tot .b{min-width:62mm;background:#0b0b0c;color:#fff;border-radius:2.5mm;padding:3.5mm 5mm;display:flex;justify-content:space-between;align-items:baseline;border-left:1.6mm solid #e11d2e}
.tot .b b{font-size:15pt}
.vat{text-align:right;color:#777;font-size:8pt;margin-top:2mm}
.bottom{display:grid;grid-template-columns:1fr auto;gap:10mm;margin-top:14mm;align-items:end;page-break-inside:avoid}
.cond h2{font-size:11pt;margin:0 0 3mm;font-weight:600}
.cond p{margin:0 0 1.6mm;font-size:9pt}
.cond p b{font-weight:600}
${QRBILL_CSS}
.subs{margin-top:4mm;display:flex;flex-direction:column;align-items:flex-end;font-size:9.5pt;color:#333}
.subs>div{display:flex;justify-content:space-between;gap:12mm;min-width:62mm;padding:.6mm 0}
.thanks{margin-top:8mm;font-size:10pt;color:#333;white-space:pre-wrap}
.notes{margin-top:4mm;font-size:9pt;color:#444;white-space:pre-wrap}
.paycard{display:flex;gap:6mm;border:.35mm solid #d9d9de;border-radius:4mm;padding:5mm;align-items:center}
.qr{width:45mm;height:45mm;display:block}
.qr.ph{display:flex;align-items:center;justify-content:center;text-align:center;border:.4mm dashed #bbb;color:#888;font-size:8pt;padding:4mm}
.payr{width:52mm}
.qrl{display:block}
.paybtn{display:block;text-decoration:none;background:#e11d2e;color:#fff;text-align:center;font-weight:700;padding:3mm;border-radius:6mm;font-size:11pt}
.cards{margin-top:3mm;font-size:8pt;color:#555;text-align:center}
.scan{margin-top:3mm;font-size:7.5pt;color:#777;text-align:center}
.url{margin-top:2.5mm;font-size:7pt;color:#555;text-align:center;word-break:break-all}
.accept{width:82mm;border:.35mm solid #d9d9de;border-radius:4mm;padding:5mm}
.accept .at{font-size:9pt;font-weight:600;margin-bottom:3mm}
.accept .asig{height:26mm;border-bottom:.3mm solid #999}
.cancelbox{border:.5mm solid #e11d2e !important;color:#b91c1c !important;font-weight:700;font-size:12pt !important;background:#fef2f2}
.paidbox{border:.5mm solid #16a34a !important;color:#15803d !important;font-weight:700;font-size:12pt !important;background:#f0fdf4}
.foot{position:absolute;left:16mm;right:16mm;bottom:8mm;border-top:.3mm solid #e7e7ea;padding-top:2.5mm;font-size:7.5pt;color:#888;display:flex;justify-content:space-between}
</style></head><body><div class="page${showBill ? ' qb' : ''}">
<div class="band"><div><small>${esc(isQuote ? 'DEVIS' : isDelivery ? 'BON DE LIVRAISON' : isReceipt ? 'REÇU DE COTISATION' : inv.kind === 'acompte' ? "FACTURE D'ACOMPTE" : L.title_label)}</small><h1>${esc(inv.number)}</h1><div class="d">${isDelivery ? 'Livraison du ' + fmtDate(inv.delivery_date) + ' · facture ' + esc(inv.number) : isReceipt ? 'Payée le ' + fmtDate(String(inv.paid_at).slice(0, 10)) + (inv.receipt_method ? ' · ' + esc(inv.receipt_method) : '') : fmtDate(inv.issue_date) + (inv.due_date && L.show_due ? (isQuote ? ' · valable jusqu\'au ' : ' · échéance ') + fmtDate(inv.due_date) : '')}</div>${replacesNumber ? `<div class="d">Remplace la facture ${esc(replacesNumber)} (annulée)</div>` : ''}${quoteNumber ? `<div class="d">Selon devis ${esc(quoteNumber)}</div>` : ''}</div>
<div class="logo"><img src="${logo}" alt=""></div></div>
<div class="parties">
<div><h2>Émetteur</h2>
<div class="r1"><span>Société</span><b>${esc(co.name)}</b></div>
${inv.contact_name && L.show_contact ? `<div class="r1"><span>Contact</span><div>${esc(inv.contact_name)}</div></div>` : ''}
<div class="r1"><span>Adresse</span><div>${esc(co.address || '')}<br>${esc([co.postal_code, co.city].filter(Boolean).join(' '))}<br>${esc(co.country || '')}</div></div>
${co.phone && L.show_phone ? `<div class="r1"><span>Téléphone</span><div>${esc(co.phone)}</div></div>` : ''}
${L.show_email ? `<div class="r1"><span>E-mail</span><div>${esc(co.email || '')}</div></div>` : ''}
${L.show_website ? `<div class="r1"><span>Site</span><div>${esc(co.website || '')}</div></div>` : ''}</div>
<div><h2>${isReceipt ? 'Membre' : 'Destinataire'}</h2>${clientLines}</div></div>
${isDelivery ? `<table><thead><tr><th style="width:36mm">Type</th><th>Description</th><th class="n" style="width:28mm">Quantité</th><th class="n" style="width:24mm">Livré</th></tr></thead><tbody>${items.map((l) => `<tr><td>${esc(l.type || '')}</td><td>${esc(l.description)}</td><td class="n">${esc(String(num(l.quantity)).replace('.', ','))}</td><td class="n">☐</td></tr>`).join('')}</tbody></table>` : `<table><thead><tr><th style="width:36mm">Type</th><th>Description</th><th class="n" style="width:28mm">Prix unitaire</th><th class="n" style="width:20mm">Quantité</th>${hasDisc ? '<th class="n" style="width:18mm">Remise</th>' : ''}<th class="n" style="width:28mm">Total</th></tr></thead><tbody>${rows}</tbody></table>
${globalPct > 0 ? `<div class="subs"><div><span>Sous-total</span><span>${chf(subTot)}</span></div><div><span>Remise ${esc(String(globalPct).replace('.', ','))} %</span><span>− ${chf(globalAmt)}</span></div></div>` : ''}
<div class="tot"><div class="b"><span>Total</span><b>${chf(inv.total)}</b></div></div>`}
${!isDelivery && L.show_vat && co.vat_note ? `<div class="vat">${esc(co.vat_note)}</div>` : ''}
${!isDelivery && L.thanks_text ? `<div class="thanks">${esc(L.thanks_text)}</div>` : ''}
<div class="bottom"><div class="cond">${!isDelivery && !isReceipt && L.show_conditions ? `<h2>Conditions</h2>
<p><b>Conditions de règlement :</b> ${esc(termsLabel(clientTerms(client || { pay_term_mode: null })))}</p>
${isQuote ? (inv.due_date ? `<p><b>Validité de l'offre :</b> jusqu'au ${esc(fmtDate(inv.due_date))}</p>` : '') : `<p><b>Mode de règlement :</b> ${esc(mode === 'carte' ? L.mode_text : mode === 'qrbill' ? 'Virement bancaire (QR-facture ci-dessous)' : 'Carte en ligne ou virement bancaire (QR-facture ci-dessous)')}</p>
<p><b>Intérêts de retard :</b> ${esc(String(co.late_interest_percent).replace('.', ','))} % par mois</p>`}` : ''}
${isDelivery ? (inv.delivery_note ? `<div class="notes">${esc(inv.delivery_note)}</div>` : '') : (inv.notes && L.show_notes ? `<div class="notes">${esc(inv.notes)}</div>` : '')}</div>
${isQuote || isDelivery ? `<div class="accept"><div class="at">${esc(isDelivery ? 'Marchandise reçue en bon état — lieu, date et signature du client' : L.quote_accept_text)}</div><div class="asig"></div></div>` : ((L.show_payment && wantCard) || paid || cancelled ? `<div class="paycard">${pay}</div>` : '<div></div>')}</div>
${L.show_footer && !showBill ? `<div class="foot"><span>${L.footer_left ? esc(L.footer_left) : `${esc(co.name)} — ${esc(co.address || '')}, ${esc([co.postal_code, co.city].filter(Boolean).join(' '))}`}</span><span>${L.footer_right ? esc(L.footer_right) : `${esc(co.email || '')} · ${esc(co.website || '')}`}</span></div>` : ''}
${showBill ? qrBillHTML(bill) : ''}
</div></body></html>`;
}

async function invoiceContext(inv, items, client) {
  const logo = await window.desk.logo();
  const qr = inv.stripe_payment_link_url && !['payee', 'annulee'].includes(inv.status) ? await makeQR(inv.stripe_payment_link_url, logo) : null;
  let replacesNumber = null;
  if (inv.replaces_invoice_id) {
    try { replacesNumber = (await must(sb.from('invoices').select('number').eq('id', inv.replaces_invoice_id).single())).number; } catch { /* ignoré */ }
  }
  let quoteNumber = null;
  if (inv.quote_id) {
    try { quoteNumber = (await must(sb.from('quotes').select('number').eq('id', inv.quote_id).single())).number; } catch { /* ignoré */ }
  }
  let bill = null;
  try { if (inv.status !== 'payee' && inv.status !== 'annulee' && (inv.pay_mode || 'carte') !== 'carte') bill = await swissBill(inv, client, state.company); } catch { /* ignoré */ }
  return { inv, items, client, company: state.company, qr, logo, replacesNumber, quoteNumber, bill };
}

async function quoteContext(q, items, client) {
  const logo = await window.desk.logo();
  return { inv: { ...q, is_quote: true, due_date: q.valid_until, stripe_payment_link_url: null }, items, client, company: state.company, qr: null, logo };
}

function showPreview(html) {
  const m = modal('Aperçu de la facture', '<iframe class="preview-frame"></iframe>', { wide: true });
  $('iframe', m.el).srcdoc = html;
}

/* ============================================================
   Facture : création / modification / consultation
   ============================================================ */
routes.invoice = async (v, arg) => {
  const id = arg && typeof arg === 'object' ? arg.id : arg;
  const forceEdit = !!(arg && typeof arg === 'object' && arg.edit);
  const [clients, products] = await Promise.all([
    must(sb.from('clients').select('*').order('name')),
    must(sb.from('products').select('*').eq('active', true).order('description')),
  ]);
  let inv = null, items = [], mails = [], replacedBy = [], replaces = null, quoteRef = null;
  if (id) {
    inv = await must(sb.from('invoices').select('*').eq('id', id).single());
    items = await must(sb.from('invoice_items').select('*').eq('invoice_id', id).order('position'));
    try { mails = await must(sb.from('invoice_emails').select('*, profiles(full_name)').eq('invoice_id', id).order('sent_at', { ascending: false })); } catch { mails = []; }
    try {
      const sids = [...new Set(items.filter((l) => l.stock_item_id).map((l) => l.stock_item_id))];
      if (sids.length) {
        const si = await must(sb.from('stock_items').select('id,name,unit').in('id', sids));
        items = items.map((l) => { const x = si.find((y) => y.id === l.stock_item_id); return x ? { ...l, stock_label: `${x.name} — ${fmtQty(l.stock_qty)} ${x.unit}` } : l; });
      }
    } catch { /* ignoré */ }
    try {
      replacedBy = await must(sb.from('invoices').select('id,number').eq('replaces_invoice_id', id));
      if (inv.replaces_invoice_id) replaces = await must(sb.from('invoices').select('id,number').eq('id', inv.replaces_invoice_id).single());
      if (inv.quote_id) quoteRef = await must(sb.from('quotes').select('id,number').eq('id', inv.quote_id).single());
    } catch { /* ignoré */ }
  }
  const editing = !!inv && inv.status === 'envoyee' && forceEdit;
  const editable = !inv || inv.status === 'brouillon' || editing;
  const blank = () => ({ type: 'Service', description: '', unit_price: '', quantity: '1' });
  const d = {
    client_id: inv?.client_id || '',
    contact_name: inv ? inv.contact_name || '' : state.profile.full_name || '',
    issue_date: inv?.issue_date || todayISO(),
    notes: inv?.notes || '',
    pay_mode: inv?.pay_mode || defaultPayMode(),
    discount: inv && Number(inv.discount_percent) > 0 ? String(inv.discount_percent) : '',
    items: items.length ? items.map((l) => ({ type: l.type || '', description: l.description, unit_price: String(l.unit_price), quantity: String(l.quantity), discount_percent: l.discount_percent ? String(l.discount_percent) : '', stock_item_id: l.stock_item_id || null, stock_qty: l.stock_qty ?? null, stock_label: l.stock_label || '' })) : (editable ? [blank()] : []),
  };
  const finalLabel = () => (d.pay_mode === 'qrbill' ? 'Finaliser la facture' : 'Finaliser et créer le lien de paiement');
  const lineTotal = (l) => Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_percent) / 100) * 100) / 100;
  const subtotal = () => d.items.reduce((s, l) => s + lineTotal(l), 0);
  const discAmount = () => Math.round(((subtotal() * num(d.discount)) / 100) * 100) / 100;
  const total = () => Math.round((subtotal() - discAmount()) * 100) / 100;
  const refreshTotals = () => {
    const a = $('#sub'), b = $('#disc'), t = $('#tot');
    if (a) a.textContent = chf(subtotal());
    if (b) b.textContent = discAmount() > 0 ? '− ' + chf(discAmount()) : chf(0);
    if (t) t.textContent = chf(total());
  };
  const clientOf = () => clients.find((c) => c.id === d.client_id) || null;

  const title = inv ? (inv.kind === 'acompte' ? "Facture d'acompte " : 'Facture ') + esc(inv.number) : 'Nouvelle facture';
  const sub = inv ? `${badge(inv)}<span class="muted">Émise le ${fmtDate(inv.issue_date)} · échéance ${fmtDate(inv.due_date)} · paiement : ${esc(payModeLabel(inv.pay_mode))}</span>` : '<span class="muted">Brouillon</span>';
  const acts = editing
    ? `<button class="btn ghost" id="back">← Factures</button><button class="btn" id="prev">Aperçu</button><button class="btn" id="cancelEdit">Annuler</button><button class="btn primary" id="upd">Enregistrer et mettre à jour le lien</button>`
    : editable
    ? `<button class="btn ghost" id="back">← Factures</button><button class="btn" id="prev">Aperçu</button>${inv ? '<button class="btn danger" id="del">Supprimer</button>' : ''}<button class="btn" id="save">Enregistrer le brouillon</button><button class="btn primary" id="final">${finalLabel()}</button>`
    : `<button class="btn ghost" id="back">← Factures</button><button class="btn" id="prev">Aperçu</button>${inv.status === 'envoyee' ? '<button class="btn" id="edit">Modifier la facture</button><button class="btn danger" id="delfinal">Supprimer</button>' : ''}<button class="btn primary" id="pdf">Télécharger le PDF</button><button class="btn" id="print">Imprimer</button><button class="btn" id="dup">Dupliquer</button>${inv.status !== 'annulee' ? '<button class="btn" id="bl">Bon de livraison</button>' : ''}${inv.status === 'envoyee' ? '<button class="btn" id="mail">Envoyer par e-mail</button>' + (effStatus(inv) === 'retard' ? '<button class="btn" id="remind">Envoyer un rappel</button>' : '') + (inv.stripe_payment_link_url ? '<button class="btn" id="copy">Copier le lien de paiement</button><button class="btn" id="open">Ouvrir le lien</button>' : '') + '<button class="btn" id="markpaid">Marquer comme payée</button>' : ''}${inv.status === 'envoyee' || (inv.status === 'payee' && state.isAdmin) ? '<button class="btn danger" id="cancelinv">Annuler la facture</button>' : ''}${inv.status === 'annulee' ? '<button class="btn primary" id="rectify">' + (replacedBy.length ? 'Voir la facture rectificative' : 'Créer une facture rectificative') + '</button>' : ''}`;

  v.innerHTML = pageHead(title, acts, sub) + `
    ${inv?.status === 'annulee' ? `<div class="card" style="margin-bottom:16px;border-color:#5a1119">Facture annulée le <b>${fmtTs(inv.cancelled_at)}</b>${inv.cancel_reason ? ' — motif : ' + esc(inv.cancel_reason) : ''}${inv.refunded ? ' — remboursée sur Stripe' : ''}.${replacedBy.length ? ` Remplacée par <a href="#" data-goto="${replacedBy[0].id}" style="color:#ff6b76">${esc(replacedBy[0].number)}</a>.` : ''}</div>` : ''}
    ${quoteRef ? `<div class="card" style="margin-bottom:16px">Facture ${inv.kind === 'acompte' ? "d'acompte " : ''}issue du devis <a href="#" data-gotoq="${quoteRef.id}" style="color:#ff6b76">${esc(quoteRef.number)}</a>.</div>` : ''}
    ${replaces ? `<div class="card" style="margin-bottom:16px">Cette facture remplace la facture annulée <a href="#" data-goto="${replaces.id}" style="color:#ff6b76">${esc(replaces.number)}</a>.</div>` : ''}
    ${editing ? `<div class="card" style="margin-bottom:16px;border-color:#7a4b08">Tu modifies une facture déjà finalisée. À l'enregistrement, l'ancien lien de paiement et l'ancien QR sont désactivés et un nouveau lien est créé. Pense à renvoyer la facture corrigée au client.</div>` : ''}
    ${inv?.status === 'payee' ? `<div class="card" style="margin-bottom:16px;border-color:#14532d">Payée ${inv.paid_method === 'manuel' ? 'par virement ou en espèces (enregistré à la main)' : 'par carte via Stripe'} le <b>${fmtTs(inv.paid_at)}</b> — ${chf(inv.paid_amount ?? inv.total)}</div>` : ''}
    <div class="grid2">
      <div class="card"><div class="field"><label>Client</label><select id="cl" ${editable ? '' : 'disabled'}><option value="">— Choisir —</option>${clients.map((c) => `<option value="${c.id}" ${c.id === d.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="form" style="grid-template-columns:1fr 1fr"><div class="field"><label>Date d'émission</label><input id="dt" type="date" value="${d.issue_date}" ${editable ? '' : 'disabled'}></div>
        <div class="field"><label>Contact (émetteur)</label><input id="ct" value="${esc(d.contact_name)}" ${editable ? '' : 'disabled'}></div></div>
        <div class="field" style="margin:10px 0 6px"><label>Mode de paiement</label><div class="paymode">${PAY_MODES.map(([k, l]) => { const needIban = k !== 'carte' && !companyHasIban(); return `<label class="pm"><input type="radio" name="pm" value="${k}" ${d.pay_mode === k ? 'checked' : ''} ${(!editable || needIban) ? 'disabled' : ''}> ${esc(l)}</label>`; }).join('')}</div>${companyHasIban() ? '' : '<div class="hint" style="margin-top:6px">Pour proposer la QR-facture, renseigne d\'abord ton IBAN dans Paramètres > Société.</div>'}</div>
        <div class="muted" id="due">Échéance : ${fmtDate(inv?.due_date || dueDateFor(d.issue_date, clientTerms(clients.find((c) => c.id === d.client_id))))}</div></div>
      <div class="card"><div class="field" style="margin:0"><label>Notes (affichées sur la facture)</label><textarea id="nt" ${editable ? '' : 'disabled'}>${esc(d.notes)}</textarea></div></div>
    </div>
    <div class="card"><h2>Lignes</h2><table class="lines"><thead><tr><th style="width:170px">Type</th><th>Description</th><th style="width:130px" class="r">Prix unitaire</th><th style="width:80px" class="r">Quantité</th><th style="width:80px" class="r">Remise %</th><th style="width:120px" class="r">Total</th><th style="width:40px"></th></tr></thead><tbody id="lb"></tbody></table>
      ${editable ? `<div class="toolbar" style="margin:14px 0 0"><button class="btn" id="addl">+ Ligne libre</button><button class="btn" id="calc">Calculateur de prix</button><select id="pick" style="max-width:340px"><option value="">+ Ajouter depuis les produits et prestations…</option>${products.map((p) => `<option value="${p.id}">${esc(p.description)} — ${chf(p.unit_price)}</option>`).join('')}</select></div>` : ''}
      <div class="totals">${editable || num(d.discount) > 0 || d.items.some((l) => num(l.discount_percent) > 0) ? `<div class="trow"><span class="muted">Sous-total</span><span class="mono" id="sub"></span></div><div class="trow"><span class="muted">Remise sur le total <input id="gd" class="gd" inputmode="decimal" placeholder="0" value="${esc(d.discount)}" ${editable ? '' : 'disabled'}> %</span><span class="mono" id="disc"></span></div>` : ''}<div class="totalbox"><span class="muted">Total</span><b id="tot"></b></div></div></div>
    ${mails.length ? `<div class="card list" style="margin-top:16px"><h2>Envois par e-mail</h2>${mails.map((m) => `<div class="li"><span>${m.kind === 'rappel' ? '<span class="badge amber">Rappel</span> envoyé à' : '<span class="badge green">Facture</span> envoyée à'} <b>${esc(m.to_email)}</b></span><span class="muted">${esc(new Date(m.sent_at).toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' }))}${m.profiles?.full_name ? ' · ' + esc(m.profiles.full_name) : ''}</span></div>`).join('')}</div>` : ''}`;

  const lb = $('#lb');
  const drawLines = () => {
    lb.innerHTML = d.items.map((l, i) => editable
      ? `<tr data-i="${i}"><td><input list="types" data-k="type" value="${esc(l.type)}"></td><td><input data-k="description" value="${esc(l.description)}">${l.stock_item_id ? `<div class="hint" style="margin:3px 0 0">📦 ${esc(l.stock_label || 'Matière du stock')} · <a href="#" data-unstock="${i}" style="color:#ff6b76">retirer</a></div>` : ''}</td><td><input data-k="unit_price" class="r" inputmode="decimal" value="${esc(l.unit_price)}"></td><td><input data-k="quantity" class="r" inputmode="decimal" value="${esc(l.quantity)}"></td><td><input data-k="discount_percent" class="r" inputmode="decimal" value="${esc(l.discount_percent ?? '')}"></td><td class="r mono" data-lt>${chf(lineTotal(l))}</td><td><button class="del" data-del="${i}" title="Retirer">✕</button></td></tr>`
      : `<tr><td>${esc(l.type)}</td><td>${esc(l.description)}${l.stock_item_id ? `<div class="hint" style="margin:3px 0 0">📦 ${esc(l.stock_label || 'Matière du stock')}</div>` : ''}</td><td class="r mono">${chf(l.unit_price)}</td><td class="r">${esc(l.quantity)}</td><td class="r">${num(l.discount_percent) > 0 ? esc(String(l.discount_percent).replace('.', ',')) + ' %' : ''}</td><td class="r mono">${chf(lineTotal(l))}</td><td></td></tr>`).join('') +
      (editable ? `<datalist id="types">${TYPES.map((t) => `<option value="${t}">`).join('')}</datalist>` : '');
    refreshTotals();
    if (!editable) return;
    lb.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
      const tr = inp.closest('tr'); const l = d.items[Number(tr.dataset.i)];
      l[inp.dataset.k] = inp.value;
      $('[data-lt]', tr).textContent = chf(lineTotal(l)); refreshTotals();
    }));
    lb.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { d.items.splice(Number(b.dataset.del), 1); if (!d.items.length) d.items.push(blank()); drawLines(); }));
    lb.querySelectorAll('[data-unstock]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const l = d.items[Number(a.dataset.unstock)]; l.stock_item_id = null; l.stock_qty = null; l.stock_label = ''; drawLines(); }));
  };
  drawLines();

  $('#back').addEventListener('click', () => go('invoices'));

  if (editable) {
    $('#cl').addEventListener('change', (e) => {
      d.client_id = e.target.value;
      const c = clientOf();
      if (!editing && c) {
        if (Number(c.discount_percent) > 0) { d.discount = String(c.discount_percent); const g = $('#gd'); if (g) g.value = d.discount; }
        if (c.pay_mode && d.pay_mode !== undefined && (c.pay_mode === 'carte' || companyHasIban())) {
          d.pay_mode = c.pay_mode;
          const r = v.querySelector(`input[name=pm][value=${c.pay_mode}]`); if (r) r.checked = true;
          const fb = $('#final'); if (fb && typeof finalLabel === 'function') fb.textContent = finalLabel();
        }
        const du = $('#due'); if (du) du.textContent = 'Échéance : ' + fmtDate(dueDateFor(d.issue_date, clientTerms(c)));
        refreshTotals();
      }
    });
    $('#ct').addEventListener('input', (e) => { d.contact_name = e.target.value; });
    $('#nt').addEventListener('input', (e) => { d.notes = e.target.value; });
    if ($('#gd')) $('#gd').addEventListener('input', (e) => { d.discount = e.target.value; refreshTotals(); });
    v.querySelectorAll('input[name=pm]').forEach((r) => r.addEventListener('change', () => { d.pay_mode = r.value; const fb = $('#final'); if (fb) fb.textContent = finalLabel(); }));
    $('#dt').addEventListener('change', (e) => { d.issue_date = e.target.value || todayISO(); $('#due').textContent = 'Échéance : ' + fmtDate(dueDateFor(d.issue_date, clientTerms(clientOf()))); });
    $('#addl').addEventListener('click', () => { d.items.push(blank()); drawLines(); });
    $('#calc').addEventListener('click', async () => { const sitems = await loadStockOptions(); openPriceCalculator((line) => {
      const last = d.items[d.items.length - 1];
      if (last && !last.description && !last.unit_price) d.items[d.items.length - 1] = line; else d.items.push(line);
      drawLines();
    }, { stock: sitems }); });
    $('#pick').addEventListener('change', (e) => {
      const p = products.find((x) => x.id === e.target.value);
      if (p) { const last = d.items[d.items.length - 1]; const l = { type: p.type, description: p.description, unit_price: String(p.unit_price), quantity: '1' }; if (last && !last.description && !last.unit_price) d.items[d.items.length - 1] = l; else d.items.push(l); drawLines(); }
      e.target.value = '';
    });

    const lines = () => d.items.filter((l) => l.description.trim()).map((l, i) => ({ type: l.type || null, description: l.description.trim(), unit_price: num(l.unit_price), quantity: num(l.quantity) || 1, position: i, ...(num(l.discount_percent) > 0 ? { discount_percent: num(l.discount_percent) } : {}), ...(l.stock_item_id ? { stock_item_id: l.stock_item_id, stock_qty: num(l.stock_qty) } : {}) }));

    async function save() {
      if (!d.client_id) throw new Error('Choisis un client.');
      const ls = lines();
      const fields = { client_id: d.client_id, contact_name: d.contact_name || null, issue_date: d.issue_date, due_date: dueDateFor(d.issue_date, clientTerms(clientOf())), notes: d.notes || null, pay_mode: d.pay_mode, ...(num(d.discount) > 0 || (inv && Number(inv.discount_percent) > 0) ? { discount_percent: num(d.discount) } : {}) };
      if (!inv) inv = await must(sb.from('invoices').insert(fields).select().single());
      else await ok(sb.from('invoices').update(fields).eq('id', inv.id));
      await ok(sb.from('invoice_items').delete().eq('invoice_id', inv.id));
      if (ls.length) await ok(sb.from('invoice_items').insert(ls.map((l) => ({ ...l, invoice_id: inv.id }))));
      return ls;
    }

    if ($('#save')) $('#save').addEventListener('click', async () => {
      try { await save(); toast('Brouillon enregistré'); go('invoice', inv.id); } catch (e) { toast(e.message || String(e), 'err'); }
    });

    if ($('#final')) $('#final').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      try {
        if (!d.client_id) throw new Error('Choisis un client.');
        if (!lines().length) throw new Error('Ajoute au moins une ligne.');
        const card = d.pay_mode !== 'qrbill' && total() > 0;
        if (card && total() < 0.5) throw new Error('Montant minimum pour un paiement Stripe : 0,50 CHF.');
        if (!confirm(card ? 'Finaliser la facture ? Elle ne sera plus modifiable librement et le lien de paiement Stripe sera créé.' : 'Finaliser la facture ? Elle ne sera plus modifiable librement.')) return;
        btn.setAttribute('disabled', ''); btn.textContent = card ? 'Création du lien de paiement…' : 'Finalisation…';
        await save();
        if (card) {
          const { data, error } = await sb.functions.invoke('create-payment-link', { body: { invoice_id: inv.id } });
          if (error) throw new Error(await fnError(error));
          if (data?.error) throw new Error(data.error);
        }
        await ok(sb.from('invoices').update({ status: 'envoyee' }).eq('id', inv.id));
        const nStock = await applyStock(inv, d.items.filter((l) => l.stock_item_id && num(l.stock_qty) > 0));
        toast((card ? 'Facture finalisée : lien de paiement créé' : 'Facture finalisée') + (nStock ? ` · stock mis à jour (${nStock})` : ''));
        await go('invoice', inv.id);
        openEmailDialog(inv.id).catch((e) => toast(ipcMsg(e), 'err'));
      } catch (e) {
        btn.removeAttribute('disabled'); btn.textContent = finalLabel();
        toast(e.message || String(e), 'err');
      }
    });

    const upd = $('#upd');
    if (upd) {
      $('#cancelEdit').addEventListener('click', () => go('invoice', inv.id));
      upd.addEventListener('click', async () => {
        try {
          if (!d.client_id) throw new Error('Choisis un client.');
          if (!lines().length) throw new Error('Ajoute au moins une ligne.');
          const newCard = d.pay_mode !== 'qrbill', hadLink = !!inv.stripe_payment_link_url;
          if (newCard && total() < 0.5) throw new Error('Montant minimum pour un paiement Stripe : 0,50 CHF.');
          if (!confirm(newCard ? "Enregistrer les modifications ? L'ancien lien de paiement et l'ancien QR seront désactivés et un nouveau lien sera créé." : hadLink ? 'Enregistrer les modifications ? Le lien de paiement par carte sera désactivé : seule la QR-facture restera.' : 'Enregistrer les modifications ?')) return;
          upd.setAttribute('disabled', ''); upd.textContent = 'Mise à jour…';
          await save();
          if (newCard || hadLink) {
            const body = newCard ? { invoice_id: inv.id, regenerate: true } : { invoice_id: inv.id, deactivate: true };
            const { data, error } = await sb.functions.invoke('create-payment-link', { body });
            if (error) throw new Error('Les lignes sont enregistrées, mais le lien de paiement n\'a pas pu être mis à jour : ' + (await fnError(error)) + ' — réessaie.');
            if (data?.error) throw new Error(data.error);
          }
          logActivity('Modification', 'Facture', inv.id, inv.number, newCard ? 'Facture finalisée modifiée, nouveau lien de paiement' : 'Facture finalisée modifiée (QR-facture seulement)');
          toast(newCard ? 'Facture modifiée : nouveau lien de paiement créé' : 'Facture modifiée');
          await go('invoice', inv.id);
          openEmailDialog(inv.id).catch((e) => toast(ipcMsg(e), 'err'));
        } catch (e) {
          upd.removeAttribute('disabled'); upd.textContent = 'Enregistrer et mettre à jour le lien';
          toast(e.message || String(e), 'err');
        }
      });
    }
    $('#prev').addEventListener('click', async () => {
      const draft = { number: inv?.number || '(brouillon)', issue_date: d.issue_date, due_date: dueDateFor(d.issue_date, clientTerms(clientOf())), contact_name: d.contact_name, notes: d.notes, total: total(), discount_percent: num(d.discount), stripe_payment_link_url: null, replaces_invoice_id: inv?.replaces_invoice_id || null, pay_mode: d.pay_mode, kind: inv?.kind || 'facture', quote_id: inv?.quote_id || null };
      showPreview(buildInvoiceHTML(await invoiceContext(draft, lines(), clientOf())));
    });
    const del = $('#del');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Supprimer ce brouillon ?')) return;
      try { await ok(sb.from('invoices').delete().eq('id', inv.id)); go('invoices'); } catch (e) { toast(e.message, 'err'); }
    });
  } else {
    const ctx = () => invoiceContext(inv, items, clientOf());
    $('#prev').addEventListener('click', async () => showPreview(buildInvoiceHTML(await ctx())));
    $('#pdf').addEventListener('click', async () => {
      try {
        const r = await window.desk.savePdf(buildInvoiceHTML(await ctx()), `${inv.number}.pdf`);
        if (r.saved) toast('PDF enregistré');
      } catch (e) { toast(e.message || String(e), 'err'); }
    });
    const blBtn = $('#bl');
    if (blBtn) blBtn.addEventListener('click', () => openDeliveryDialog(inv, items, clientOf()).catch((e) => toast(ipcMsg(e), 'err')));
    const dupBtn = $('#dup');
    if (dupBtn) dupBtn.addEventListener('click', () => duplicateInvoice(inv.id).catch((e) => toast(ipcMsg(e), 'err')));
    const delFinal = $('#delfinal');
    if (delFinal) delFinal.addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement la facture ${inv.number} ?\n\nLe lien de paiement sera désactivé (le client ne pourra plus payer). Une trace de la suppression est gardée dans le journal.`)) return;
      delFinal.setAttribute('disabled', ''); delFinal.textContent = 'Suppression…';
      try {
        const { data, error } = await sb.functions.invoke('delete-invoice', { body: { invoice_id: inv.id } });
        if (error) throw new Error(await fnError(error));
        if (data?.error) throw new Error(data.error);
        toast('Facture supprimée');
        go('invoices');
      } catch (e) {
        delFinal.removeAttribute('disabled'); delFinal.textContent = 'Supprimer';
        toast(e.message || String(e), 'err');
      }
    });
    const editBtn = $('#edit');
    if (editBtn) editBtn.addEventListener('click', () => go('invoice', { id: inv.id, edit: true }));
    $('#print').addEventListener('click', async () => {
      try {
        const r = await window.desk.printHtml(buildInvoiceHTML(await ctx()));
        if (r && r.printed) toast('Impression lancée');
      } catch (e) { toast(ipcMsg(e), 'err'); }
    });
    v.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go('invoice', a.dataset.goto); }));
    v.querySelectorAll('[data-gotoq]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go('quote', a.dataset.gotoq); }));
    const rectifyBtn = $('#rectify');
    if (rectifyBtn) rectifyBtn.addEventListener('click', () => (replacedBy.length ? go('invoice', replacedBy[0].id) : createRectification(inv.id)).catch?.((e) => toast(e.message || String(e), 'err')));
    const cancelBtn = $('#cancelinv');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      const paid = inv.status === 'payee';
      const m = modal(paid ? 'Annuler une facture payée' : 'Annuler la facture', `<form class="form" id="cf2">
        <div class="field full"><label>Motif (facultatif, gardé dans le dossier)</label><textarea name="reason" style="min-height:90px"></textarea></div>
        ${paid && !inv.stripe_payment_intent ? `<div class="hint" style="grid-column:1/-1;margin:0 0 10px">Paiement enregistré à la main : la facture sera seulement marquée annulée. Le remboursement du client est à faire par toi.</div>` : paid ? `<div class="field check full"><input type="checkbox" name="refund" id="rf"><label for="rf">Rembourser aussi le client sur Stripe (${chf(inv.paid_amount ?? inv.total)}, sur sa carte)</label></div>
          <div class="hint" style="grid-column:1/-1;margin:0 0 10px">Sans cette case, la facture est seulement marquée annulée : l'argent reste chez toi et tu le rembourses toi-même.</div>`
          : `<div class="hint" style="grid-column:1/-1;margin:0 0 10px">Le lien de paiement est désactivé. La facture reste dans la liste, marquée « Annulée », et sort du chiffre d'affaires.</div>`}
        ${inv.stock_applied ? '<div class="field check full"><input type="checkbox" name="restock" id="rs" checked><label for="rs">Remettre la matière utilisée en stock</label></div>' : ''}
        <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Retour</button> <button class="btn danger" id="cgo">Annuler la facture</button></div></div></form>`);
      $('#cf2', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements, refund = !!(f.refund && f.refund.checked);
        const msg = refund ? `Annuler la facture ${inv.number} ET rembourser ${chf(inv.paid_amount ?? inv.total)} au client ? Le remboursement ne peut pas être repris.` : `Annuler la facture ${inv.number} ?`;
        if (!confirm(msg)) return;
        const b = $('#cgo', m.el); b.setAttribute('disabled', ''); b.textContent = 'Annulation…';
        try {
          const { data, error } = await sb.functions.invoke('cancel-invoice', { body: { invoice_id: inv.id, reason: f.reason.value.trim(), refund } });
          if (error) throw new Error(await fnError(error));
          if (data?.error) throw new Error(data.error);
          if (f.restock && f.restock.checked) await restockInvoice(inv, items);
          m.close();
          toast(data.refunded ? 'Facture annulée et remboursée' : 'Facture annulée');
          await go('invoice', inv.id);
          if (confirm('Créer maintenant une facture rectificative (copie à corriger) ?')) createRectification(inv.id).catch((e2) => toast(e2.message || String(e2), 'err'));
        } catch (err) {
          b.removeAttribute('disabled'); b.textContent = 'Annuler la facture';
          toast(err.message || String(err), 'err');
        }
      });
    });
    const mp = $('#markpaid');
    if (mp) mp.addEventListener('click', () => {
      const m = modal('Marquer la facture comme payée', `<form class="form" id="mpf">
        <div class="field"><label>Date du paiement</label><input name="date" type="date" value="${todayISO()}" max="${todayISO()}" required></div>
        <div class="field"><label>Montant reçu (CHF)</label><input name="amount" value="${esc(String(inv.total))}" inputmode="decimal"></div>
        <div class="hint" style="grid-column:1/-1;margin:0 0 10px">À utiliser pour un virement bancaire ou un paiement en espèces. ${inv.stripe_payment_link_url ? 'Le lien de paiement par carte sera désactivé. ' : ''}Seul l'administrateur pourra annuler ce paiement ensuite.</div>
        <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Retour</button> <button class="btn primary" id="mpgo">Enregistrer le paiement</button></div></div></form>`);
      $('#mpf', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements, b = $('#mpgo', m.el);
        if (!confirm(`Confirmer : la facture ${inv.number} a bien été payée ?`)) return;
        b.setAttribute('disabled', ''); b.textContent = 'Enregistrement…';
        try {
          const { data, error } = await sb.functions.invoke('mark-invoice-paid', { body: { invoice_id: inv.id, paid_date: f.date.value, amount: num(f.amount.value) } });
          if (error) throw new Error(await fnError(error));
          if (data?.error) throw new Error(data.error);
          m.close(); toast('Paiement enregistré'); go('invoice', inv.id);
        } catch (err) { b.removeAttribute('disabled'); b.textContent = 'Enregistrer le paiement'; toast(err.message || String(err), 'err'); }
      });
    });
    const remindBtn = $('#remind');
    if (remindBtn) remindBtn.addEventListener('click', () => openEmailDialog(inv.id, 'rappel').catch((e) => toast(ipcMsg(e), 'err')));
    const mailBtn = $('#mail');
    if (mailBtn) mailBtn.addEventListener('click', () => openEmailDialog(inv.id).catch((e) => toast(ipcMsg(e), 'err')));
    const copy = $('#copy');
    if (copy) { copy.addEventListener('click', async () => { await navigator.clipboard.writeText(inv.stripe_payment_link_url); toast('Lien copié'); }); $('#open').addEventListener('click', () => window.desk.openExternal(inv.stripe_payment_link_url)); }
  }
};

// Facture rectificative : copie de la facture annulée, en brouillon, à corriger puis à finaliser
async function createRectification(oldId) {
  const old = await must(sb.from('invoices').select('*').eq('id', oldId).single());
  const items = await must(sb.from('invoice_items').select('*').eq('invoice_id', oldId).order('position'));
  const today = todayISO();
  const n = await must(sb.from('invoices').insert({
    client_id: old.client_id, contact_name: old.contact_name || state.profile.full_name || null,
    issue_date: today, due_date: await dueFor(old.client_id, today), notes: old.notes, replaces_invoice_id: old.id, pay_mode: old.pay_mode || 'carte', ...(old.kind === 'acompte' ? { kind: 'acompte', quote_id: old.quote_id } : {}), ...(Number(old.discount_percent) > 0 ? { discount_percent: old.discount_percent } : {}),
  }).select().single());
  if (items.length) await ok(sb.from('invoice_items').insert(items.map((l, i) => ({ invoice_id: n.id, type: l.type, description: l.description, unit_price: l.unit_price, quantity: l.quantity, position: i, ...(Number(l.discount_percent) > 0 ? { discount_percent: l.discount_percent } : {}) }))));
  toast('Facture rectificative créée en brouillon : corrige-la puis finalise-la');
  go('invoice', n.id);
}

/* ============================================================
   Envoi de la facture par e-mail
   ============================================================ */
const ipcMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function buildMailHTML(text, url) {
  const btn = `<a href="${esc(url)}" style="display:inline-block;background:#e11d2e;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:24px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px">Payer en ligne</a>`;
  const body = esc(text).split(esc(url)).join(btn).replace(/\n/g, '<br>');
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div>`;
}

const MAIL_VARS = '{numero} {montant} {echeance} {validite} {client} {contact} {societe} {paiement} {acceptation} {lien_acceptation}';
function fillTemplate(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
function mailTemplate(key) { const L = layoutOf(state.company); return (L[key] && String(L[key]).trim()) ? L[key] : LAYOUT_DEFAULTS[key]; }

function payPart(inv, also) {
  const mode = inv.pay_mode || 'carte';
  const card = inv.stripe_payment_link_url ? `Vous pouvez ${also ? 'aussi ' : ''}la payer directement par carte en ligne :\n${inv.stripe_payment_link_url}` : '';
  const bill = mode !== 'carte' ? 'Le bulletin de versement (QR-facture) se trouve en bas de la facture jointe : il suffit de le scanner avec votre application bancaire.' : '';
  return [card, bill].filter(Boolean).join('\n\n');
}

async function openEmailDialog(invoiceId, kind = 'facture') {
  const isReminder = kind === 'rappel';
  const inv = await must(sb.from('invoices').select('*').eq('id', invoiceId).single());
  const items = await must(sb.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('position'));
  const client = inv.client_id ? await must(sb.from('clients').select('*').eq('id', inv.client_id).single()) : null;
  const st = await window.desk.mailStatus();
  const co = state.company;
  const vars = { numero: inv.number, montant: chf(inv.total), echeance: fmtDate(inv.due_date), validite: '', client: client?.name || '', contact: inv.contact_name || co.name, societe: co.name, paiement: payPart(inv, !isReminder) };
  const body = fillTemplate(mailTemplate(isReminder ? 'mail_reminder_body' : 'mail_invoice_body'), vars);
  const subject0 = fillTemplate(mailTemplate(isReminder ? 'mail_reminder_subject' : 'mail_invoice_subject'), vars);

  const warn = st.configured ? '' : `<div class="card" style="border-color:#5a1119;margin-bottom:14px">L'envoi d'e-mails n'est pas encore configuré sur cet ordinateur.
    <div style="margin-top:10px"><button type="button" class="btn primary" id="cfgmail">Configurer l'envoi</button></div></div>`;
  const m = modal(isReminder ? 'Envoyer un rappel' : 'Envoyer la facture par e-mail', `${warn}<form class="form" id="mailform">
    <div class="field full"><label>À (plusieurs adresses possibles, séparées par une virgule)</label><input name="to" value="${esc(client?.email || '')}" required></div>
    <div class="field full"><label>Objet</label><input name="subject" value="${esc(subject0)}" required></div>
    <div class="field full"><label>Message</label><textarea name="text" style="min-height:240px">${esc(body)}</textarea></div>
    <div class="field full muted">Le PDF de la facture (avec le QR de paiement) sera joint. Expéditeur : ${esc(st.user || '— non configuré —')}</div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Plus tard</button> <button class="btn primary" id="sendbtn" ${st.configured ? '' : 'disabled'}>Envoyer</button></div></div></form>`, { wide: true });

  const cfg = $('#cfgmail', m.el);
  if (cfg) cfg.addEventListener('click', () => { m.close(); go('settings'); });
  $('#mailform', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = $('#sendbtn', m.el);
    const to = f.to.value.trim();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(to)) { toast('Adresse e-mail invalide.', 'err'); return; }
    btn.setAttribute('disabled', ''); btn.textContent = 'Envoi…';
    try {
      const pdfHtml = buildInvoiceHTML(await invoiceContext(inv, items, client));
      await window.desk.sendMail({ to, subject: f.subject.value.trim(), text: f.text.value, html: inv.stripe_payment_link_url ? buildMailHTML(f.text.value, inv.stripe_payment_link_url) : undefined, pdfHtml, filename: `${inv.number}.pdf` });
      try {
        await ok(sb.from('invoice_emails').insert({ invoice_id: inv.id, kind, to_email: to, subject: f.subject.value.trim() }));
      } catch { toast("E-mail envoyé, mais non enregistré dans le suivi (lance 8-suivi-emails.sql).", 'err'); }
      toast('E-mail envoyé à ' + to);
      m.close();
      if (['invoice', 'invoices', 'dashboard'].includes(state.route)) go(state.route, state.arg);
    } catch (err) {
      const msg = ipcMsg(err);
      toast(msg.includes('NOT_CONFIGURED') ? "Envoi non configuré : va dans Paramètres." : msg, 'err');
      btn.removeAttribute('disabled'); btn.textContent = 'Envoyer';
    }
  });
}

/* ============================================================
   Stock de matières
   ============================================================ */
const STOCK_CATS = [['filament', 'Filament'], ['bois', 'Bois / planches'], ['consommable', 'Consommable'], ['piece', 'Pièce / outil']];
const STOCK_UNITS = ['g', 'kg', 'planche', 'pièce', 'm', 'm²', 'ml', 'boîte'];
const catLabel = (c) => (STOCK_CATS.find((x) => x[0] === c) || [c, c])[1];
const fmtQty = (n) => String(Math.round(Number(n || 0) * 100) / 100).replace('.', ',');
const stockLevel = (i) => (Number(i.quantity) <= 0 ? 'out' : (Number(i.min_quantity) > 0 && Number(i.quantity) <= Number(i.min_quantity) ? 'low' : 'ok'));
const stockBadge = (i) => ({ ok: '<span class="badge green">OK</span>', low: '<span class="badge amber">Bas</span>', out: '<span class="badge red">Épuisé</span>' }[stockLevel(i)]);

async function loadStockOptions() {
  try { return await must(sb.from('stock_items').select('id,name,unit,quantity').eq('active', true).order('name')); } catch { return []; }
}

async function addMovement(item, kind, qty, note, cost) {
  const q = Math.abs(num(qty));
  let delta;
  if (kind === 'ajustement') { delta = num(qty) - Number(item.quantity); if (delta === 0) throw new Error('La quantité est déjà celle-ci : rien à corriger.'); }
  else { if (!(q > 0)) throw new Error('Entre une quantité.'); delta = kind === 'entree' ? q : -q; }
  await ok(sb.from('stock_movements').insert({ item_id: item.id, kind, quantity: Math.abs(delta), delta, cost: cost > 0 ? cost : null, note: note || null }));
  if (kind === 'entree' && cost > 0) await ok(sb.from('stock_items').update({ unit_cost: Math.round((cost / q) * 10000) / 10000 }).eq('id', item.id));
}

// Facture finalisée : la matière utilisée sort du stock
async function applyStock(inv, usage) {
  if (!usage.length || inv.stock_applied) return 0;
  try {
    await ok(sb.from('stock_movements').insert(usage.map((u) => ({ item_id: u.stock_item_id, kind: 'sortie', quantity: num(u.stock_qty), delta: -num(u.stock_qty), note: `Facture ${inv.number}`, ref_invoice_id: inv.id }))));
    await ok(sb.from('invoices').update({ stock_applied: true }).eq('id', inv.id));
    return usage.length;
  } catch (e) { toast("Facture finalisée, mais le stock n'a pas pu être mis à jour : " + (e.message || e), 'err'); return 0; }
}
// Facture annulée : on remet la matière en stock (si la case est cochée)
async function restockInvoice(inv, items) {
  const back = items.filter((l) => l.stock_item_id && Number(l.stock_qty) > 0);
  if (!back.length) return;
  try {
    await ok(sb.from('stock_movements').insert(back.map((l) => ({ item_id: l.stock_item_id, kind: 'entree', quantity: Number(l.stock_qty), delta: Number(l.stock_qty), note: `Annulation ${inv.number}`, ref_invoice_id: inv.id }))));
    toast('Matière remise en stock');
  } catch (e) { toast('Stock non remis à jour : ' + (e.message || e), 'err'); }
}

function stockItemForm(item) {
  const isNew = !item;
  const fields = [
    { key: 'name', label: 'Nom (ex. PLA noir 1,75 mm)', required: true, full: true },
    { key: 'category', label: 'Catégorie', type: 'select', options: STOCK_CATS, default: 'filament' },
    { key: 'unit', label: 'Unité', list: STOCK_UNITS, default: 'g' },
    ...(isNew ? [{ key: 'qty', label: 'Quantité de départ', type: 'number', inputmode: 'decimal', default: '0' }] : []),
    { key: 'min_quantity', label: 'Seuil d\'alerte (alerte quand le stock descend à ce niveau)', type: 'number', inputmode: 'decimal', default: '0' },
    { key: 'unit_cost', label: 'Prix par unité (CHF, facultatif)', type: 'number', inputmode: 'decimal', default: '' },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ...(isNew ? [] : [{ key: 'active', label: 'Actif (décoche pour archiver)', type: 'checkbox', full: true }]),
  ];
  formModal({
    title: isNew ? 'Nouvel article' : 'Modifier l\'article', fields,
    values: item ? { ...item, unit_cost: item.unit_cost ?? '' } : {},
    onSave: async (d) => {
      const base = { name: d.name, category: d.category || 'filament', unit: d.unit || 'g', min_quantity: d.min_quantity || 0, unit_cost: d.unit_cost || null, notes: d.notes };
      if (isNew) {
        const it = await must(sb.from('stock_items').insert({ ...base, quantity: 0 }).select().single());
        if (d.qty > 0) await ok(sb.from('stock_movements').insert({ item_id: it.id, kind: 'entree', quantity: d.qty, delta: d.qty, note: 'Stock de départ' }));
      } else {
        await ok(sb.from('stock_items').update({ ...base, active: d.active }).eq('id', item.id));
      }
      toast('Article enregistré'); go('stock');
    },
    onDelete: item && state.isAdmin ? async () => { await ok(sb.from('stock_items').delete().eq('id', item.id)); go('stock'); } : null,
  });
}

async function openStockItem(id) {
  const item = await must(sb.from('stock_items').select('*').eq('id', id).single());
  let mv = [];
  try { mv = await must(sb.from('stock_movements').select('*, profiles(full_name)').eq('item_id', id).order('created_at', { ascending: false }).limit(25)); } catch { mv = []; }
  const kindFr = { entree: ['Entrée', 'green'], sortie: ['Sortie', 'amber'], ajustement: ['Correction', ''] };
  const m = modal(item.name, `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><div class="muted">${esc(catLabel(item.category))} · seuil d'alerte ${esc(fmtQty(item.min_quantity))} ${esc(item.unit)}${item.unit_cost ? ` · ${chf(item.unit_cost)} / ${esc(item.unit)}` : ''}</div>
        <div style="font-size:30px;font-weight:700;margin:6px 0">${esc(fmtQty(item.quantity))} <span class="muted" style="font-size:16px">${esc(item.unit)}</span> ${stockBadge(item)}</div></div>
      <div class="actions"><button class="btn primary" data-act="entree">+ Entrée</button><button class="btn" data-act="sortie">− Sortie</button><button class="btn" data-act="ajustement">Corriger</button><button class="btn" data-act="edit">Modifier</button></div>
    </div>
    <h2 style="margin-top:20px">Historique</h2>
    ${mv.length ? `<table><thead><tr><th>Date</th><th>Mouvement</th><th class="r">Quantité</th><th>Note</th><th>Par</th></tr></thead><tbody>${mv.map((x) => `<tr><td class="muted" style="white-space:nowrap">${esc(new Date(x.created_at).toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' }))}</td><td><span class="badge ${kindFr[x.kind][1]}">${kindFr[x.kind][0]}</span></td><td class="r mono">${Number(x.delta) > 0 ? '+' : ''}${esc(fmtQty(x.delta))} ${esc(item.unit)}</td><td class="muted">${esc(x.note || '')}${x.cost ? ` · payé ${chf(x.cost)}` : ''}</td><td class="muted">${esc(x.profiles?.full_name || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Aucun mouvement.</div>'}`, { wide: true });
  const reopen = async () => { m.close(); await go('stock'); openStockItem(id); };
  m.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'edit') { m.close(); stockItemForm(item); return; }
    const fields = act === 'entree'
      ? [{ key: 'qty', label: `Quantité reçue (${item.unit})`, type: 'number', inputmode: 'decimal', required: true }, { key: 'cost', label: 'Prix payé au total (CHF, facultatif)', type: 'number', inputmode: 'decimal', default: '' }, { key: 'note', label: 'Note (ex. fournisseur)', full: true }, ...(state.isAdmin ? [{ key: 'expense', label: 'Enregistrer aussi comme dépense (si un prix est indiqué)', type: 'checkbox', default: true, full: true }] : [])]
      : act === 'sortie'
        ? [{ key: 'qty', label: `Quantité utilisée (${item.unit})`, type: 'number', inputmode: 'decimal', required: true }, { key: 'note', label: 'Note (ex. pièce imprimée pour…)', full: true }]
        : [{ key: 'qty', label: `Quantité réelle en stock (${item.unit})`, type: 'number', inputmode: 'decimal', required: true, default: String(item.quantity) }, { key: 'note', label: 'Note', full: true, default: 'Inventaire' }];
    formModal({
      title: act === 'entree' ? 'Entrée en stock' : act === 'sortie' ? 'Sortie du stock' : 'Corriger la quantité', fields, values: {},
      onSave: async (d) => {
        if (act === 'sortie' && d.qty > Number(item.quantity) && !confirm(`Il ne reste que ${fmtQty(item.quantity)} ${item.unit} en stock. Enregistrer quand même ?`)) throw new Error('Sortie annulée.');
        await addMovement(item, act, d.qty, d.note, d.cost);
        if (act === 'entree' && d.expense && d.cost > 0) {
          try { await ok(sb.from('expenses').insert({ spent_on: todayISO(), description: `Stock : ${item.name}`, supplier: d.note || null, category: 'matieres', amount: d.cost })); }
          catch (e) { toast("Entrée enregistrée, mais la dépense n'a pas pu l'être : " + (e.message || e), 'err'); }
        }
        toast('Mouvement enregistré'); reopen();
      },
    });
  }));
}

routes.stock = async (v) => {
  let rows;
  try { rows = await must(sb.from('stock_items').select('*').eq('active', true).order('name')); }
  catch (e) { v.innerHTML = pageHead('Stock') + `<div class="empty">Le stock n'est pas encore installé : lance le fichier 15-stock.sql dans Supabase.<br><span class="muted">${esc(e.message || '')}</span></div>`; return; }
  const low = rows.filter((x) => stockLevel(x) !== 'ok');
  const value = rows.reduce((a, x) => a + Number(x.quantity > 0 ? x.quantity : 0) * Number(x.unit_cost || 0), 0);
  v.innerHTML = pageHead('Stock de matières', '<button class="btn primary" id="add">+ Nouvel article</button>') + `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="card kpi"><div class="lbl">Articles</div><div class="val">${rows.length}</div><div class="note">en stock actif</div></div>
      <div class="card kpi ${low.length ? 'warn' : ''}"><div class="lbl">À réapprovisionner</div><div class="val">${low.length}</div><div class="note">bas ou épuisés</div></div>
      <div class="card kpi"><div class="lbl">Valeur du stock</div><div class="val">${chf(value)}</div><div class="note">selon les prix par unité renseignés</div></div></div>
    <div class="toolbar"><input id="q" placeholder="Rechercher…">
      <select id="cat"><option value="">Toutes les catégories</option>${STOCK_CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select id="lv"><option value="">Tous les niveaux</option><option value="low">Bas ou épuisés</option></select></div>
    <div class="card"><table><thead><tr><th>Article</th><th>Catégorie</th><th class="r">Quantité</th><th class="r">Seuil</th><th class="r">Valeur</th><th>État</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), cat = $('#cat').value, lv = $('#lv').value;
    const list = rows.filter((x) => (!cat || x.category === cat) && (!lv || stockLevel(x) !== 'ok') && x.name.toLowerCase().includes(q));
    $('#tb').innerHTML = list.length
      ? list.map((x) => `<tr class="row" data-id="${x.id}"><td><b>${esc(x.name)}</b></td><td class="muted">${esc(catLabel(x.category))}</td><td class="r mono">${esc(fmtQty(x.quantity))} ${esc(x.unit)}</td><td class="r mono muted">${Number(x.min_quantity) > 0 ? esc(fmtQty(x.min_quantity)) + ' ' + esc(x.unit) : '—'}</td><td class="r mono">${x.unit_cost ? chf(Math.max(0, Number(x.quantity)) * Number(x.unit_cost)) : '—'}</td><td>${stockBadge(x)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Aucun article. Clique sur « Nouvel article » pour commencer.</td></tr>';
    document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => openStockItem(r.dataset.id).catch((e) => toast(e.message, 'err'))));
  };
  $('#q').addEventListener('input', draw); $('#cat').addEventListener('change', draw); $('#lv').addEventListener('change', draw);
  $('#add').addEventListener('click', () => stockItemForm(null)); draw();
};

/* ============================================================
   Calculateur de prix : prix de la pièce + supplément (5 à 20 CHF par défaut)
   ============================================================ */
function openPriceCalculator(onAdd, opts = {}) {
  const sopts = opts.stock || [];
  const stockHTML = sopts.length ? `<div class="field"><label>Matière utilisée (facultatif)</label><select name="sitem"><option value="">— aucune —</option>${sopts.map((x) => `<option value="${x.id}">${esc(x.name)} (reste ${esc(fmtQty(x.quantity))} ${esc(x.unit)})</option>`).join('')}</select></div><div class="field"><label>Quantité utilisée au total</label><input name="sqty" inputmode="decimal" placeholder="Ex. : 45"></div>` : '';
  const L = layoutOf(state.company);
  const lo = Math.max(0, num(L.calc_min)), hi = Math.max(lo, num(L.calc_max));
  const def = Math.min(hi, Math.max(lo, num(L.calc_default) || lo));
  const presets = []; for (let x = lo; x < hi; x += 5) presets.push(x); presets.push(hi);
  const round2 = (x) => Math.round(x * 100) / 100;

  const m = modal('Calculateur de prix', `<form class="form" id="calcf">
    <div class="field"><label>Type</label><input name="type" list="ctypes" value="Objet 3D"><datalist id="ctypes">${TYPES.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
    <div class="field"><label>Quantité</label><input name="qty" value="1" inputmode="decimal"></div>
    <div class="field full"><label>Description (elle apparaît sur la ligne)</label><input name="desc" placeholder="Ex. : Impression 3D — support de téléphone" required></div>
    ${stockHTML}
    <div class="field"><label>Prix de la pièce (CHF)</label><input name="piece" inputmode="decimal" placeholder="5.00" required></div>
    <div class="field"><label>Supplément (CHF)</label><input name="supn" inputmode="decimal" value="${def}"></div>
    <div class="field full"><input type="range" name="sup" min="${lo}" max="${hi}" step="1" value="${def}" style="padding:0">
      <div class="toolbar" style="margin:8px 0 0">${presets.map((x) => `<button type="button" class="btn" data-sup="${x}" style="padding:5px 12px">${x} CHF</button>`).join('')}</div></div>
    <div class="card field full" id="cres" style="background:var(--panel2)"></div>
    <div class="field check full"><input type="checkbox" name="save" id="csave"><label for="csave">Enregistrer dans mes produits et prestations (prix par pièce)</label></div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary">Ajouter la ligne</button></div></div></form>`);
  const f = $('#calcf', m.el).elements;
  const calc = () => {
    const piece = num(f.piece.value), sup = num(f.supn.value), qty = num(f.qty.value) || 1;
    const unit = round2(piece + sup), tot = round2(unit * qty);
    $('#cres', m.el).innerHTML = `<div class="muted">Pièce ${chf(piece)} + supplément ${chf(sup)}</div>
      <div style="margin-top:6px;font-size:18px">Prix par pièce : <b>${chf(unit)}</b>${qty !== 1 ? ` &nbsp;·&nbsp; Total (${String(qty).replace('.', ',')} ×) : <b>${chf(tot)}</b>` : ''}</div>
      ${sup < lo || sup > hi ? `<div class="hint">Supplément en dehors de la plage habituelle (${lo} à ${hi} CHF).</div>` : ''}`;
    return { unit };
  };
  f.sup.addEventListener('input', () => { f.supn.value = f.sup.value; calc(); });
  f.supn.addEventListener('input', () => { f.sup.value = num(f.supn.value); calc(); });
  ['piece', 'qty'].forEach((k) => f[k].addEventListener('input', calc));
  m.el.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => { f.supn.value = b.dataset.sup; f.sup.value = b.dataset.sup; calc(); }));
  calc();
  $('#calcf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const piece = num(f.piece.value);
    if (!(piece > 0)) { toast('Entre le prix de la pièce.', 'err'); return; }
    const { unit } = calc();
    const line = { type: f.type.value.trim(), description: f.desc.value.trim(), unit_price: String(unit), quantity: String(num(f.qty.value) || 1) };
    const sid = f.sitem ? f.sitem.value : '';
    if (sid) {
      const sq = num(f.sqty.value);
      if (!(sq > 0)) { toast('Entre la quantité de matière utilisée.', 'err'); return; }
      const si = sopts.find((x) => x.id === sid);
      line.stock_item_id = sid; line.stock_qty = String(sq); line.stock_label = `${si.name} — ${fmtQty(sq)} ${si.unit}`;
    }
    if (f.save.checked) {
      try { await ok(sb.from('products').insert({ type: line.type || 'Produit', description: line.description, unit_price: unit, active: true })); toast('Ajouté aux produits et prestations'); }
      catch (err) { toast('Produit non enregistré : ' + (err.message || err), 'err'); }
    }
    onAdd(line);
    m.close();
  });
}

/* ============================================================
   Devis
   ============================================================ */
const QSTATUS = { brouillon: ['Brouillon', ''], envoye: ['Envoyé', 'amber'], expire: ['Expiré', 'red'], accepte: ['Accepté', 'green'], refuse: ['Refusé', ''] };
const qEff = (q) => (q.status === 'envoye' && q.valid_until && q.valid_until < todayISO() ? 'expire' : q.status);
const qBadge = (q) => { const [l, c] = QSTATUS[qEff(q)] || ['?', '']; return `<span class="badge ${c}">${l}</span>`; };
const addDays = (iso, n) => { const d = parseD(iso); d.setDate(d.getDate() + n); return toISO(d); };
const quoteValidityDays = () => Math.max(1, Math.round(num(layoutOf(state.company).quote_validity_days) || 30));

routes.quotes = async (v) => {
  let rows;
  try {
    rows = await must(sb.from('quotes').select('id,number,issue_date,valid_until,status,total,converted_invoice_id,clients(name)').order('created_at', { ascending: false }));
  } catch (e) {
    v.innerHTML = pageHead('Devis') + `<div class="empty">Les devis ne sont pas encore installés : lance le fichier 10-devis.sql dans Supabase.<br><span class="muted">${esc(e.message || '')}</span></div>`;
    return;
  }
  v.innerHTML = pageHead('Devis', '<button class="btn primary" id="add">+ Nouveau devis</button>') + `
    <div class="toolbar"><input id="q" placeholder="Rechercher (numéro, client)…">
      <select id="st"><option value="">Tous les statuts</option><option value="brouillon">Brouillons</option><option value="envoye">Envoyés</option><option value="accepte">Acceptés</option><option value="tofact">Acceptés, à facturer</option><option value="refuse">Refusés</option><option value="expire">Expirés</option></select></div>
    <div class="card"><table><thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Valable jusqu'au</th><th class="r">Total</th><th>Statut</th><th>Facture</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#st').value;
    const list = rows.filter((x) => (!st || (st === 'tofact' ? x.status === 'accepte' && !x.converted_invoice_id : qEff(x) === st)) && [x.number, x.clients?.name].join(' ').toLowerCase().includes(q));
    $('#tb').innerHTML = list.length
      ? list.map((x) => `<tr class="row" data-id="${x.id}"><td><b>${esc(x.number)}</b></td><td>${esc(x.clients?.name || '—')}</td><td>${fmtShort(x.issue_date)}</td><td>${fmtShort(x.valid_until)}</td><td class="r mono">${chf(x.total)}</td><td>${qBadge(x)}</td><td class="muted">${x.converted_invoice_id ? 'Facturé' : (x.status === 'accepte' ? 'À facturer' : '—')}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">Aucun devis.</td></tr>';
    document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => go('quote', r.dataset.id)));
  };
  $('#q').addEventListener('input', draw); $('#st').addEventListener('change', draw);
  $('#add').addEventListener('click', () => go('quote', null)); draw();
};

// Devis accepté -> facture en brouillon (mêmes lignes), liée au devis
async function openDeliveryDialog(inv, items, client) {
  const m = modal('Bon de livraison', `<form class="form" id="blf">
    <div class="field"><label>Date de livraison</label><input name="date" type="date" value="${todayISO()}" required></div>
    <div class="field"><label>Facture</label><input value="${esc(inv.number)}" disabled></div>
    <div class="field full"><label>Remarque (facultatif, affichée sur le bon)</label><textarea name="note" style="min-height:80px" placeholder="Ex. : retrait à l'atelier, 2 cartons…"></textarea></div>
    <div class="hint" style="grid-column:1/-1;margin:0 0 10px">Le bon reprend les lignes de la facture <b>sans les prix</b>, avec une case « Livré » et un espace de signature pour le client.</div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Fermer</button> <button type="button" class="btn" id="blprev">Aperçu</button> <button type="button" class="btn" id="blprint">Imprimer</button> <button class="btn primary">Télécharger le PDF</button></div></div></form>`);
  const f = $('#blf', m.el).elements;
  const html = async () => buildInvoiceHTML({
    inv: { ...inv, is_delivery: true, delivery_date: f.date.value || todayISO(), delivery_note: f.note.value.trim() },
    items: items.filter((l) => !(l.type === 'Acompte' && Number(l.unit_price) < 0)),
    client, company: state.company, qr: null, logo: await window.desk.logo(), bill: null,
  });
  $('#blprev', m.el).addEventListener('click', async () => showPreview(await html()));
  $('#blprint', m.el).addEventListener('click', async () => { try { const r = await window.desk.printHtml(await html()); if (r && r.printed) toast('Impression lancée'); } catch (e) { toast(ipcMsg(e), 'err'); } });
  $('#blf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await window.desk.savePdf(await html(), `BL-${inv.number}.pdf`); if (r.saved) toast('Bon de livraison enregistré'); } catch (err) { toast(ipcMsg(err), 'err'); }
  });
}

async function duplicateInvoice(id) {
  const inv = await must(sb.from('invoices').select('*').eq('id', id).single());
  const items = await must(sb.from('invoice_items').select('*').eq('invoice_id', id).order('position'));
  const today = todayISO();
  const n = await must(sb.from('invoices').insert({ client_id: inv.client_id, contact_name: inv.contact_name || state.profile.full_name || null, issue_date: today, due_date: await dueFor(inv.client_id, today), notes: inv.notes, ...(inv.pay_mode ? { pay_mode: inv.pay_mode } : {}), ...(Number(inv.discount_percent) > 0 ? { discount_percent: inv.discount_percent } : {}) }).select().single());
  const keep = items.filter((l) => !(l.type === 'Acompte' && Number(l.unit_price) < 0));
  if (keep.length) await ok(sb.from('invoice_items').insert(keep.map((l, i) => ({ invoice_id: n.id, type: l.type, description: l.description, unit_price: l.unit_price, quantity: l.quantity, position: i, ...(Number(l.discount_percent) > 0 ? { discount_percent: l.discount_percent } : {}), ...(l.stock_item_id ? { stock_item_id: l.stock_item_id, stock_qty: l.stock_qty } : {}) }))));
  toast(`Copie créée en brouillon (${n.number}) : vérifie-la puis finalise-la`);
  go('invoice', n.id);
}
async function duplicateQuote(id) {
  const q = await must(sb.from('quotes').select('*').eq('id', id).single());
  const items = await must(sb.from('quote_items').select('*').eq('quote_id', id).order('position'));
  const today = todayISO();
  const n = await must(sb.from('quotes').insert({ client_id: q.client_id, contact_name: q.contact_name || state.profile.full_name || null, issue_date: today, valid_until: addDays(today, quoteValidityDays()), notes: q.notes, ...(Number(q.discount_percent) > 0 ? { discount_percent: q.discount_percent } : {}) }).select().single());
  if (items.length) await ok(sb.from('quote_items').insert(items.map((l, i) => ({ quote_id: n.id, type: l.type, description: l.description, unit_price: l.unit_price, quantity: l.quantity, position: i, ...(Number(l.discount_percent) > 0 ? { discount_percent: l.discount_percent } : {}) }))));
  toast(`Copie créée en brouillon (${n.number})`);
  go('quote', n.id);
}

async function quoteToInvoice(qid) {
  const q = await must(sb.from('quotes').select('*').eq('id', qid).single());
  if (q.converted_invoice_id) { go('invoice', q.converted_invoice_id); return; }
  const items = await must(sb.from('quote_items').select('*').eq('quote_id', qid).order('position'));
  // acomptes déjà facturés pour ce devis
  let deps = [];
  try { deps = (await must(sb.from('invoices').select('id,number,total,paid_amount,status,issue_date').eq('quote_id', qid).eq('kind', 'acompte').order('created_at'))).filter((x) => x.status !== 'annulee'); } catch { deps = []; }
  const paidDeps = deps.filter((x) => x.status === 'payee'), openDeps = deps.filter((x) => x.status !== 'payee');
  if (openDeps.length && !confirm(`Attention : l'acompte ${openDeps.map((x) => x.number).join(', ')} n'est pas encore payé. Il ne sera pas déduit de la facture finale. Continuer ?`)) return;
  const today = todayISO();
  const inv = await must(sb.from('invoices').insert({
    client_id: q.client_id, contact_name: q.contact_name || state.profile.full_name || null,
    issue_date: today, due_date: await dueFor(q.client_id, today), notes: q.notes, quote_id: q.id, pay_mode: defaultPayMode(), ...(Number(q.discount_percent) > 0 ? { discount_percent: q.discount_percent } : {}),
  }).select().single());
  const rows = items.map((l, i) => ({ invoice_id: inv.id, type: l.type, description: l.description, unit_price: l.unit_price, quantity: l.quantity, position: i, ...(Number(l.discount_percent) > 0 ? { discount_percent: l.discount_percent } : {}) }));
  paidDeps.forEach((x, k) => rows.push({ invoice_id: inv.id, type: 'Acompte', description: `Acompte déjà versé — ${x.number} du ${fmtShort(x.issue_date)}`, unit_price: -Number(x.paid_amount ?? x.total), quantity: 1, position: items.length + k }));
  if (rows.length) await ok(sb.from('invoice_items').insert(rows));
  await ok(sb.from('quotes').update({ converted_invoice_id: inv.id }).eq('id', q.id));
  toast(paidDeps.length ? `Facture finale créée en brouillon : ${paidDeps.length} acompte(s) déduit(s)` : 'Facture créée en brouillon à partir du devis : vérifie-la puis finalise-la');
  go('invoice', inv.id);
}

// Facture d'acompte : un pourcentage (ou un montant) du devis accepté
function openDepositDialog(q, engaged) {
  const remaining = Math.round((Number(q.total) - engaged) * 100) / 100;
  if (remaining < 0.5) { toast('Ce devis est déjà entièrement facturé en acomptes.', 'err'); return; }
  const m = modal("Facture d'acompte", `<form class="form" id="df">
    <div class="field"><label>Pourcentage du devis (%)</label><input name="pct" value="30" inputmode="decimal"></div>
    <div class="field"><label>… ou montant fixe (CHF)</label><input name="amt" inputmode="decimal" placeholder="vide = utiliser le pourcentage"></div>
    <div class="card field full" id="dres" style="background:var(--panel2)"></div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary">Créer la facture d'acompte</button></div></div></form>`);
  const f = $('#df', m.el).elements;
  const amountNow = () => { const a = num(f.amt.value); return a > 0 ? Math.round(a * 100) / 100 : Math.round(Number(q.total) * num(f.pct.value)) / 100; };
  const show = () => {
    const a = amountNow();
    $('#dres', m.el).innerHTML = `<div class="muted">Devis ${esc(q.number)} : ${chf(q.total)} · déjà en acomptes : ${chf(engaged)}</div>
      <div style="margin-top:6px;font-size:18px">Acompte : <b>${chf(a)}</b> &nbsp;·&nbsp; reste à facturer ensuite : <b>${chf(remaining - a)}</b></div>
      ${a > remaining + 0.001 ? '<div class="hint" style="color:#ff6b76">Ce montant dépasse ce qui reste à facturer.</div>' : ''}`;
  };
  ['pct', 'amt'].forEach((k) => f[k].addEventListener('input', show)); show();
  $('#df', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = amountNow();
    if (a < 0.5) { toast("Montant trop bas (minimum 0,50 CHF).", 'err'); return; }
    if (a > remaining + 0.001) { toast(`Le montant dépasse ce qui reste à facturer (${chf(remaining)}).`, 'err'); return; }
    try {
      const today = todayISO();
      const pct = num(f.amt.value) > 0 ? null : num(f.pct.value);
      const inv = await must(sb.from('invoices').insert({
        client_id: q.client_id, contact_name: q.contact_name || state.profile.full_name || null,
        issue_date: today, due_date: await dueFor(q.client_id, today), quote_id: q.id, kind: 'acompte', pay_mode: defaultPayMode(),
      }).select().single());
      await ok(sb.from('invoice_items').insert({ invoice_id: inv.id, type: 'Acompte', description: pct ? `Acompte de ${String(pct).replace('.', ',')} % sur devis ${q.number}` : `Acompte sur devis ${q.number}`, unit_price: a, quantity: 1, position: 0 }));
      m.close();
      toast("Facture d'acompte créée en brouillon : vérifie-la puis finalise-la");
      go('invoice', inv.id);
    } catch (err) { toast(/kind/.test(err.message || '') ? "Lance d'abord le fichier 17-acomptes.sql dans Supabase." : (err.message || String(err)), 'err'); }
  });
}

const FILE_MAX = 10 * 1024 * 1024, FILES_MAX = 8;
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
async function removeQuoteFiles(qid) {
  try {
    const fs = await must(sb.from('quote_files').select('path').eq('quote_id', qid));
    if (fs.length) await sb.storage.from('quote-files').remove(fs.map((f) => f.path));
  } catch { /* ignoré */ }
}

async function openQuoteEmailDialog(qid) {
  const q = await must(sb.from('quotes').select('*').eq('id', qid).single());
  const items = await must(sb.from('quote_items').select('*').eq('quote_id', qid).order('position'));
  const client = q.client_id ? await must(sb.from('clients').select('*').eq('id', q.client_id).single()) : null;
  const st = await window.desk.mailStatus();
  const co = state.company;
  // lien d'acceptation en ligne : un code secret unique par devis
  let acceptLink = '';
  try {
    let tok = q.public_token;
    if (!tok) { tok = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); await ok(sb.from('quotes').update({ public_token: tok }).eq('id', q.id)); }
    const base = (layoutOf(state.company).accept_page_url || LAYOUT_DEFAULTS.accept_page_url).trim();
    if (/^https:\/\//.test(base)) acceptLink = `${base}${base.includes('?') ? '&' : '?'}t=${tok}`;
  } catch { acceptLink = ''; }
  const qvars = { numero: q.number, montant: chf(q.total), echeance: '', validite: fmtDate(q.valid_until), client: client?.name || '', contact: q.contact_name || co.name, societe: co.name, paiement: '', lien_acceptation: acceptLink, acceptation: acceptLink ? `Vous pouvez accepter ce devis en un clic, depuis votre téléphone ou votre ordinateur :\n${acceptLink}` : "Pour l'accepter, il vous suffit de répondre à ce message." };
  const body = fillTemplate(mailTemplate('mail_quote_body'), qvars);
  const qsubject0 = fillTemplate(mailTemplate('mail_quote_subject'), qvars);
  let qfiles = [];
  try { qfiles = await must(sb.from('quote_files').select('*').eq('quote_id', qid).order('created_at')); } catch { qfiles = []; }
  const filesHTML = qfiles.length ? `<div class="field full"><label>Pièces jointes à envoyer avec le devis</label>${qfiles.map((f) => `<div class="field check" style="margin:2px 0"><input type="checkbox" data-qf="${f.id}" id="qf_${f.id}" checked><label for="qf_${f.id}">${esc(f.name)} <span class="muted">(${fmtSize(f.size)})</span></label></div>`).join('')}</div>` : '';
  const warn = st.configured ? '' : `<div class="card" style="border-color:#5a1119;margin-bottom:14px">L'envoi d'e-mails n'est pas encore configuré sur cet ordinateur.
    <div style="margin-top:10px"><button type="button" class="btn primary" id="cfgmail">Configurer l'envoi</button></div></div>`;
  const m = modal('Envoyer le devis par e-mail', `${warn}<form class="form" id="mailform">
    <div class="field full"><label>À (plusieurs adresses possibles, séparées par une virgule)</label><input name="to" value="${esc(client?.email || '')}" required></div>
    <div class="field full"><label>Objet</label><input name="subject" value="${esc(qsubject0)}" required></div>
    <div class="field full"><label>Message</label><textarea name="text" style="min-height:220px">${esc(body)}</textarea></div>
    ${filesHTML}
    <div class="field full muted">Le PDF du devis sera joint. Expéditeur : ${esc(st.user || '— non configuré —')}</div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Plus tard</button> <button class="btn primary" id="sendbtn" ${st.configured ? '' : 'disabled'}>Envoyer</button></div></div></form>`, { wide: true });
  const cfg = $('#cfgmail', m.el);
  if (cfg) cfg.addEventListener('click', () => { m.close(); go('settings'); });
  $('#mailform', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = $('#sendbtn', m.el);
    const to = f.to.value.trim();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(to)) { toast('Adresse e-mail invalide.', 'err'); return; }
    btn.setAttribute('disabled', ''); btn.textContent = 'Envoi…';
    try {
      const pdfHtml = buildInvoiceHTML(await quoteContext(q, items, client));
      const chosen = qfiles.filter((x) => { const cb = m.el.querySelector(`[data-qf="${x.id}"]`); return cb && cb.checked; });
      const attachments = [];
      for (const x of chosen) {
        const dl = await sb.storage.from('quote-files').download(x.path);
        if (dl.error) throw new Error(`Fichier « ${x.name} » introuvable : ${dl.error.message}`);
        attachments.push({ filename: x.name, contentType: x.mime || undefined, base64: await blobToBase64(dl.data) });
      }
      await window.desk.sendMail({ to, subject: f.subject.value.trim(), text: f.text.value, pdfHtml, filename: `${q.number}.pdf`, attachments });
      try { await ok(sb.from('quotes').update({ last_sent_at: new Date().toISOString(), sent_to: to, status: q.status === 'brouillon' ? 'envoye' : q.status }).eq('id', q.id)); } catch { /* suivi non enregistré */ }
      toast('Devis envoyé à ' + to);
      m.close();
      if (['quote', 'quotes', 'dashboard'].includes(state.route)) go(state.route, state.arg);
    } catch (err) {
      const msg = ipcMsg(err);
      toast(msg.includes('NOT_CONFIGURED') ? 'Envoi non configuré : va dans Paramètres.' : msg, 'err');
      btn.removeAttribute('disabled'); btn.textContent = 'Envoyer';
    }
  });
}

routes.quote = async (v, arg) => {
  const id = arg && typeof arg === 'object' ? arg.id : arg;
  const forceEdit = !!(arg && typeof arg === 'object' && arg.edit);
  const [clients, products] = await Promise.all([
    must(sb.from('clients').select('*').order('name')),
    must(sb.from('products').select('*').eq('active', true).order('description')),
  ]);
  let q = null, items = [], invRef = null, deposits = [], qfiles = [];
  if (id) {
    q = await must(sb.from('quotes').select('*').eq('id', id).single());
    items = await must(sb.from('quote_items').select('*').eq('quote_id', id).order('position'));
    if (q.converted_invoice_id) { try { invRef = await must(sb.from('invoices').select('id,number').eq('id', q.converted_invoice_id).single()); } catch { /* ignoré */ } }
    try { deposits = await must(sb.from('invoices').select('id,number,total,status,issue_date,paid_amount').eq('quote_id', q.id).eq('kind', 'acompte').order('created_at')); } catch { deposits = []; }
    try { qfiles = await must(sb.from('quote_files').select('*').eq('quote_id', q.id).order('created_at')); } catch { qfiles = []; }
  }
  const engaged = deposits.filter((x) => x.status !== 'annulee').reduce((a, x) => a + Number(x.total), 0);
  const editing = !!q && q.status === 'envoye' && forceEdit;
  const editable = !q || q.status === 'brouillon' || editing;
  const blank = () => ({ type: 'Service', description: '', unit_price: '', quantity: '1' });
  const d = {
    client_id: q?.client_id || '',
    contact_name: q ? q.contact_name || '' : state.profile.full_name || '',
    issue_date: q?.issue_date || todayISO(),
    valid_until: q?.valid_until || addDays(todayISO(), quoteValidityDays()),
    notes: q?.notes || '',
    discount: q && Number(q.discount_percent) > 0 ? String(q.discount_percent) : '',
    items: items.length ? items.map((l) => ({ type: l.type || '', description: l.description, unit_price: String(l.unit_price), quantity: String(l.quantity), discount_percent: l.discount_percent ? String(l.discount_percent) : '' })) : (editable ? [blank()] : []),
  };
  let validTouched = !!q;
  const lineTotal = (l) => Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_percent) / 100) * 100) / 100;
  const subtotal = () => d.items.reduce((s, l) => s + lineTotal(l), 0);
  const discAmount = () => Math.round(((subtotal() * num(d.discount)) / 100) * 100) / 100;
  const total = () => Math.round((subtotal() - discAmount()) * 100) / 100;
  const refreshTotals = () => {
    const a = $('#sub'), b = $('#disc'), t = $('#tot');
    if (a) a.textContent = chf(subtotal());
    if (b) b.textContent = discAmount() > 0 ? '− ' + chf(discAmount()) : chf(0);
    if (t) t.textContent = chf(total());
  };
  const clientOf = () => clients.find((c) => c.id === d.client_id) || null;
  const lines = () => d.items.filter((l) => l.description.trim()).map((l, i) => ({ type: l.type || null, description: l.description.trim(), unit_price: num(l.unit_price), quantity: num(l.quantity) || 1, position: i, ...(num(l.discount_percent) > 0 ? { discount_percent: num(l.discount_percent) } : {}) }));

  const title = q ? `Devis ${esc(q.number)}` : 'Nouveau devis';
  const sub = q
    ? `${qBadge(q)}<span class="muted">Émis le ${fmtDate(q.issue_date)} · valable jusqu'au ${fmtDate(q.valid_until)}${q.last_sent_at ? ` · envoyé le ${fmtTs(q.last_sent_at)} à ${esc(q.sent_to || '')}` : ''}</span>`
    : '<span class="muted">Brouillon</span>';
  const del = '<button class="btn danger" id="del">Supprimer</button>';
  const acts = editing
    ? '<button class="btn ghost" id="back">← Devis</button><button class="btn" id="prev">Aperçu</button><button class="btn" id="cancelEdit">Annuler</button><button class="btn primary" id="upd">Enregistrer les modifications</button>'
    : editable
      ? `<button class="btn ghost" id="back">← Devis</button><button class="btn" id="prev">Aperçu</button>${q ? del : ''}<button class="btn" id="save">Enregistrer le brouillon</button><button class="btn primary" id="final">Finaliser et envoyer</button>`
      : `<button class="btn ghost" id="back">← Devis</button><button class="btn" id="prev">Aperçu</button>${q.status === 'envoye' ? '<button class="btn" id="edit">Modifier</button>' : ''}<button class="btn" id="pdf">Télécharger le PDF</button><button class="btn" id="print">Imprimer</button><button class="btn" id="dup">Dupliquer</button>${q.status === 'envoye' ? `<button class="btn" id="mail">Envoyer par e-mail</button><button class="btn primary" id="accept">Marquer accepté</button><button class="btn" id="refuse">Marquer refusé</button>${del}` : ''}${q.status === 'accepte' ? (q.converted_invoice_id ? '<button class="btn primary" id="seeinv">Voir la facture</button>' : `<button class="btn" id="depo">Facture d'acompte</button><button class="btn primary" id="toinv">${deposits.length ? 'Créer la facture finale' : 'Créer la facture'}</button>${state.isAdmin ? del : ''}`) : ''}${q.status === 'refuse' ? `<button class="btn" id="reopen">Rouvrir</button>${del}` : ''}`;

  v.innerHTML = pageHead(title, acts, sub) + `
    ${q?.accepted_via === 'en ligne' && ['accepte', 'refuse'].includes(q.status) ? `<div class="card" style="margin-bottom:16px;border-color:${q.status === 'accepte' ? '#14532d' : '#5a1119'}">Devis <b>${q.status === 'accepte' ? 'accepté' : 'refusé'} en ligne</b> par le client${q.accepted_by ? ' (<b>' + esc(q.accepted_by) + '</b>)' : ''} le ${fmtTs(q.decided_at)}.</div>` : ''}
    ${q?.public_token && q.status === 'envoye' ? `<div class="card" style="margin-bottom:16px">Lien d'acceptation en ligne envoyé au client : <span class="muted" style="word-break:break-all">${esc(((layoutOf(state.company).accept_page_url) || LAYOUT_DEFAULTS.accept_page_url) + '?t=' + q.public_token)}</span> <button class="btn" id="copyaccept" style="padding:4px 10px;margin-left:6px">Copier</button></div>` : ''}
    ${invRef ? `<div class="card" style="margin-bottom:16px;border-color:#14532d">Devis facturé : <a href="#" data-goinv="${invRef.id}" style="color:#4ade80">${esc(invRef.number)}</a></div>` : ''}
    ${q && (deposits.length || (q.status === 'accepte' && !q.converted_invoice_id)) ? `<div class="card list" style="margin-bottom:16px"><h2>Acomptes</h2>${deposits.length ? deposits.map((dp) => `<div class="li"><span><a href="#" data-goinv="${dp.id}" style="color:#ff6b76">${esc(dp.number)}</a> <span class="muted">· ${fmtShort(dp.issue_date)}</span></span><span>${badge(dp)} <b class="mono">${chf(dp.total)}</b></span></div>`).join('') + `<div class="li"><span class="muted">Déjà facturé en acomptes (hors annulés)</span><b class="mono">${chf(engaged)}</b></div><div class="li"><span class="muted">Reste à facturer</span><b class="mono">${chf(Number(q.total) - engaged)}</b></div>` : '<div class="muted">Aucun acompte pour ce devis. Le bouton « Facture d\'acompte » en crée un (pourcentage ou montant).</div>'}</div>` : ''}
    ${q?.status === 'accepte' && !q.converted_invoice_id ? '<div class="card" style="margin-bottom:16px;border-color:#14532d">Devis accepté : crée une facture d\'acompte si le client verse une avance, ou directement la facture finale.</div>' : ''}
    <div class="grid2">
      <div class="card"><div class="field"><label>Client</label><select id="cl" ${editable ? '' : 'disabled'}><option value="">— Choisir —</option>${clients.map((c) => `<option value="${c.id}" ${c.id === d.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="form" style="grid-template-columns:1fr 1fr 1fr"><div class="field"><label>Date</label><input id="dt" type="date" value="${d.issue_date}" ${editable ? '' : 'disabled'}></div>
        <div class="field"><label>Valable jusqu'au</label><input id="vu" type="date" value="${d.valid_until}" ${editable ? '' : 'disabled'}></div>
        <div class="field"><label>Contact</label><input id="ct" value="${esc(d.contact_name)}" ${editable ? '' : 'disabled'}></div></div></div>
      <div class="card"><div class="field" style="margin:0"><label>Notes (affichées sur le devis)</label><textarea id="nt" ${editable ? '' : 'disabled'}>${esc(d.notes)}</textarea></div></div>
    </div>
    <div class="card"><h2>Lignes</h2><table class="lines"><thead><tr><th style="width:170px">Type</th><th>Description</th><th style="width:130px" class="r">Prix unitaire</th><th style="width:80px" class="r">Quantité</th><th style="width:80px" class="r">Remise %</th><th style="width:120px" class="r">Total</th><th style="width:40px"></th></tr></thead><tbody id="lb"></tbody></table>
      ${editable ? `<div class="toolbar" style="margin:14px 0 0"><button class="btn" id="addl">+ Ligne libre</button><button class="btn" id="calc">Calculateur de prix</button><select id="pick" style="max-width:340px"><option value="">+ Ajouter depuis les produits et prestations…</option>${products.map((p) => `<option value="${p.id}">${esc(p.description)} — ${chf(p.unit_price)}</option>`).join('')}</select></div>` : ''}
      <div class="totals">${editable || num(d.discount) > 0 || d.items.some((l) => num(l.discount_percent) > 0) ? `<div class="trow"><span class="muted">Sous-total</span><span class="mono" id="sub"></span></div><div class="trow"><span class="muted">Remise sur le total <input id="gd" class="gd" inputmode="decimal" placeholder="0" value="${esc(d.discount)}" ${editable ? '' : 'disabled'}> %</span><span class="mono" id="disc"></span></div>` : ''}<div class="totalbox"><span class="muted">Total</span><b id="tot"></b></div></div></div>
    ${q ? `<div class="card" style="margin-top:16px" id="qfcard"><h2>Pièces jointes</h2>${qfiles.length ? `<div class="list">${qfiles.map((f) => `<div class="li"><span>📎 <b>${esc(f.name)}</b> <span class="muted">(${fmtSize(f.size)})</span></span><span><button class="btn" data-qfopen="${f.id}" style="padding:4px 10px">Ouvrir</button> <button class="btn danger" data-qfdel="${f.id}" style="padding:4px 10px">Retirer</button></span></div>`).join('')}</div>` : '<div class="muted">Aucun fichier.</div>'}<div style="margin-top:12px"><input type="file" id="qfinput" multiple style="display:none"><button class="btn" id="qfadd">+ Ajouter un fichier</button> <span class="muted" style="margin-left:8px">Plan, photo, modèle 3D… jusqu'à 10 Mo par fichier. Tu pourras les joindre à l'e-mail du devis.</span></div></div>` : `<div class="card muted" style="margin-top:16px">Enregistre d'abord le brouillon pour pouvoir ajouter des pièces jointes.</div>`}`;

  const lb = $('#lb');
  const drawLines = () => {
    lb.innerHTML = d.items.map((l, i) => editable
      ? `<tr data-i="${i}"><td><input list="types" data-k="type" value="${esc(l.type)}"></td><td><input data-k="description" value="${esc(l.description)}"></td><td><input data-k="unit_price" class="r" inputmode="decimal" value="${esc(l.unit_price)}"></td><td><input data-k="quantity" class="r" inputmode="decimal" value="${esc(l.quantity)}"></td><td><input data-k="discount_percent" class="r" inputmode="decimal" value="${esc(l.discount_percent ?? '')}"></td><td class="r mono" data-lt>${chf(lineTotal(l))}</td><td><button class="del" data-del="${i}" title="Retirer">✕</button></td></tr>`
      : `<tr><td>${esc(l.type)}</td><td>${esc(l.description)}</td><td class="r mono">${chf(l.unit_price)}</td><td class="r">${esc(l.quantity)}</td><td class="r">${num(l.discount_percent) > 0 ? esc(String(l.discount_percent).replace('.', ',')) + ' %' : ''}</td><td class="r mono">${chf(lineTotal(l))}</td><td></td></tr>`).join('') +
      (editable ? `<datalist id="types">${TYPES.map((t) => `<option value="${t}">`).join('')}</datalist>` : '');
    refreshTotals();
    if (!editable) return;
    lb.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
      const tr = inp.closest('tr'); const l = d.items[Number(tr.dataset.i)];
      l[inp.dataset.k] = inp.value;
      $('[data-lt]', tr).textContent = chf(lineTotal(l)); refreshTotals();
    }));
    lb.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { d.items.splice(Number(b.dataset.del), 1); if (!d.items.length) d.items.push(blank()); drawLines(); }));
  };
  drawLines();

  $('#back').addEventListener('click', () => go('quotes'));
  const cpa = $('#copyaccept');
  if (cpa) cpa.addEventListener('click', async () => { await navigator.clipboard.writeText(((layoutOf(state.company).accept_page_url) || LAYOUT_DEFAULTS.accept_page_url) + '?t=' + q.public_token); toast("Lien copié"); });
  const qfadd = $('#qfadd');
  if (qfadd) {
    qfadd.addEventListener('click', () => $('#qfinput').click());
    $('#qfinput').addEventListener('change', async (e) => {
      const list = [...e.target.files];
      if (!list.length) return;
      if (qfiles.length + list.length > FILES_MAX) { toast(`Au plus ${FILES_MAX} fichiers par devis.`, 'err'); return; }
      qfadd.setAttribute('disabled', ''); qfadd.textContent = 'Envoi…';
      try {
        for (const file of list) {
          if (file.size > FILE_MAX) throw new Error(`« ${file.name} » dépasse 10 Mo.`);
          const safe = file.name.replace(/[^\w.\-]+/g, '_');
          const path = `${q.id}/${crypto.randomUUID()}-${safe}`;
          const up = await sb.storage.from('quote-files').upload(path, file, { contentType: file.type || undefined });
          if (up.error) throw new Error(up.error.message);
          await ok(sb.from('quote_files').insert({ quote_id: q.id, name: file.name, path, size: file.size, mime: file.type || null }));
        }
        toast('Fichier ajouté'); go('quote', q.id);
      } catch (err) { toast(/quote_files|bucket|not found/i.test(err.message || '') ? "Lance d'abord le fichier 20-pieces-jointes.sql dans Supabase." : (err.message || String(err)), 'err'); qfadd.removeAttribute('disabled'); qfadd.textContent = '+ Ajouter un fichier'; }
    });
    v.querySelectorAll('[data-qfopen]').forEach((b) => b.addEventListener('click', async () => {
      const f = qfiles.find((x) => x.id === b.dataset.qfopen);
      const r = await sb.storage.from('quote-files').createSignedUrl(f.path, 120);
      if (r.error) { toast(r.error.message, 'err'); return; }
      window.desk.openExternal(r.data.signedUrl);
    }));
    v.querySelectorAll('[data-qfdel]').forEach((b) => b.addEventListener('click', async () => {
      const f = qfiles.find((x) => x.id === b.dataset.qfdel);
      if (!confirm(`Retirer « ${f.name} » ?`)) return;
      try { await sb.storage.from('quote-files').remove([f.path]); await ok(sb.from('quote_files').delete().eq('id', f.id)); go('quote', q.id); } catch (err) { toast(err.message || String(err), 'err'); }
    }));
  }
  v.querySelectorAll('[data-goinv]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go('invoice', a.dataset.goinv); }));
  const fail = (e) => toast(ipcMsg(e), 'err');

  if (editable) {
    $('#cl').addEventListener('change', (e) => {
      d.client_id = e.target.value;
      const c = clientOf();
      if (!editing && c) {
        if (Number(c.discount_percent) > 0) { d.discount = String(c.discount_percent); const g = $('#gd'); if (g) g.value = d.discount; }
        if (c.pay_mode && d.pay_mode !== undefined && (c.pay_mode === 'carte' || companyHasIban())) {
          d.pay_mode = c.pay_mode;
          const r = v.querySelector(`input[name=pm][value=${c.pay_mode}]`); if (r) r.checked = true;
          const fb = $('#final'); if (fb && typeof finalLabel === 'function') fb.textContent = finalLabel();
        }
        const du = $('#due'); if (du) du.textContent = 'Échéance : ' + fmtDate(dueDateFor(d.issue_date, clientTerms(c)));
        refreshTotals();
      }
    });
    $('#ct').addEventListener('input', (e) => { d.contact_name = e.target.value; });
    $('#nt').addEventListener('input', (e) => { d.notes = e.target.value; });
    if ($('#gd')) $('#gd').addEventListener('input', (e) => { d.discount = e.target.value; refreshTotals(); });
    $('#vu').addEventListener('change', (e) => { d.valid_until = e.target.value; validTouched = true; });
    $('#dt').addEventListener('change', (e) => {
      d.issue_date = e.target.value || todayISO();
      if (!validTouched) { d.valid_until = addDays(d.issue_date, quoteValidityDays()); $('#vu').value = d.valid_until; }
    });
    $('#addl').addEventListener('click', () => { d.items.push(blank()); drawLines(); });
    $('#calc').addEventListener('click', () => openPriceCalculator((line) => {
      const last = d.items[d.items.length - 1];
      if (last && !last.description && !last.unit_price) d.items[d.items.length - 1] = line; else d.items.push(line);
      drawLines();
    }));
    $('#pick').addEventListener('change', (e) => {
      const p = products.find((x) => x.id === e.target.value);
      if (p) { const last = d.items[d.items.length - 1]; const l = { type: p.type, description: p.description, unit_price: String(p.unit_price), quantity: '1' }; if (last && !last.description && !last.unit_price) d.items[d.items.length - 1] = l; else d.items.push(l); drawLines(); }
      e.target.value = '';
    });

    async function save() {
      if (!d.client_id) throw new Error('Choisis un client.');
      const ls = lines();
      const fields = { client_id: d.client_id, contact_name: d.contact_name || null, issue_date: d.issue_date, valid_until: d.valid_until || addDays(d.issue_date, quoteValidityDays()), notes: d.notes || null, ...(num(d.discount) > 0 || (q && Number(q.discount_percent) > 0) ? { discount_percent: num(d.discount) } : {}) };
      if (!q) q = await must(sb.from('quotes').insert(fields).select().single());
      else await ok(sb.from('quotes').update(fields).eq('id', q.id));
      await ok(sb.from('quote_items').delete().eq('quote_id', q.id));
      if (ls.length) await ok(sb.from('quote_items').insert(ls.map((l) => ({ ...l, quote_id: q.id }))));
      return ls;
    }
    const sv = $('#save');
    if (sv) sv.addEventListener('click', async () => { try { await save(); toast('Brouillon enregistré'); go('quote', q.id); } catch (e) { toast(e.message || String(e), 'err'); } });
    const fin = $('#final');
    if (fin) fin.addEventListener('click', async () => {
      try {
        if (!d.client_id) throw new Error('Choisis un client.');
        if (!lines().length) throw new Error('Ajoute au moins une ligne.');
        if (!confirm('Finaliser le devis ? Il passera en « Envoyé » et ne pourra plus être modifié librement.')) return;
        await save();
        await ok(sb.from('quotes').update({ status: 'envoye' }).eq('id', q.id));
        toast('Devis finalisé');
        await go('quote', q.id);
        openQuoteEmailDialog(q.id).catch(fail);
      } catch (e) { toast(e.message || String(e), 'err'); }
    });
    const upd = $('#upd');
    if (upd) {
      $('#cancelEdit').addEventListener('click', () => go('quote', q.id));
      upd.addEventListener('click', async () => {
        try {
          if (!d.client_id) throw new Error('Choisis un client.');
          if (!lines().length) throw new Error('Ajoute au moins une ligne.');
          await save();
          logActivity('Modification', 'Devis', q.id, q.number, 'Devis envoyé modifié');
          toast('Devis modifié : pense à le renvoyer au client');
          await go('quote', q.id);
          openQuoteEmailDialog(q.id).catch(fail);
        } catch (e) { toast(e.message || String(e), 'err'); }
      });
    }
    $('#prev').addEventListener('click', async () => {
      const draft = { number: q?.number || '(brouillon)', issue_date: d.issue_date, valid_until: d.valid_until, contact_name: d.contact_name, notes: d.notes, total: total(), discount_percent: num(d.discount), status: 'brouillon' };
      showPreview(buildInvoiceHTML(await quoteContext(draft, lines(), clientOf())));
    });
    const dl = $('#del');
    if (dl) dl.addEventListener('click', async () => {
      if (!confirm('Supprimer ce devis ?')) return;
      try { await removeQuoteFiles(q.id); await ok(sb.from('quotes').delete().eq('id', q.id)); go('quotes'); } catch (e) { toast(e.message || String(e), 'err'); }
    });
  } else {
    const ctx = () => quoteContext(q, items, clientOf());
    $('#prev').addEventListener('click', async () => showPreview(buildInvoiceHTML(await ctx())));
    $('#pdf').addEventListener('click', async () => {
      try { const r = await window.desk.savePdf(buildInvoiceHTML(await ctx()), `${q.number}.pdf`); if (r.saved) toast('PDF enregistré'); } catch (e) { toast(ipcMsg(e), 'err'); }
    });
    $('#print').addEventListener('click', async () => {
      try { const r = await window.desk.printHtml(buildInvoiceHTML(await ctx())); if (r && r.printed) toast('Impression lancée'); } catch (e) { toast(ipcMsg(e), 'err'); }
    });
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#edit', () => go('quote', { id: q.id, edit: true }));
    on('#dup', () => duplicateQuote(q.id).catch(fail));
    on('#mail', () => openQuoteEmailDialog(q.id).catch(fail));
    on('#accept', async () => {
      try {
        if (!confirm(`Marquer le devis ${q.number} comme accepté ?`)) return;
        await ok(sb.from('quotes').update({ status: 'accepte', decided_at: new Date().toISOString() }).eq('id', q.id));
        toast('Devis accepté');
        await go('quote', q.id);
        if (confirm('Créer maintenant la facture à partir de ce devis ?')) quoteToInvoice(q.id).catch(fail);
      } catch (e) { toast(ipcMsg(e), 'err'); }
    });
    on('#refuse', async () => {
      try {
        if (!confirm(`Marquer le devis ${q.number} comme refusé ?`)) return;
        await ok(sb.from('quotes').update({ status: 'refuse', decided_at: new Date().toISOString() }).eq('id', q.id));
        go('quote', q.id);
      } catch (e) { toast(ipcMsg(e), 'err'); }
    });
    on('#reopen', async () => { try { await ok(sb.from('quotes').update({ status: 'envoye', decided_at: null }).eq('id', q.id)); go('quote', q.id); } catch (e) { toast(ipcMsg(e), 'err'); } });
    on('#depo', () => openDepositDialog(q, engaged));
    on('#toinv', () => quoteToInvoice(q.id).catch(fail));
    on('#seeinv', () => go('invoice', q.converted_invoice_id));
    on('#del', async () => {
      if (!confirm(`Supprimer le devis ${q.number} ?`)) return;
      try { await removeQuoteFiles(q.id); await ok(sb.from('quotes').delete().eq('id', q.id)); go('quotes'); } catch (e) { toast(ipcMsg(e), 'err'); }
    });
  }
};

/* ============================================================
   Dépenses et bénéfice (administrateur)
   ============================================================ */
const EXP_CATS = [['matieres', 'Matières (filament, bois…)'], ['machines', 'Machines et outils'], ['logiciel', 'Logiciels et abonnements'], ['local', 'Local et énergie'], ['transport', 'Transport et livraison'], ['frais_paiement', 'Frais de paiement (Stripe, banque)'], ['marketing', 'Publicité et site web'], ['autre', 'Autre']];
const expCatLabel = (c) => (EXP_CATS.find((x) => x[0] === c) || [c, c])[1];
const PERIODS = [['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['year', 'Cette année'], ['lastyear', 'Année dernière'], ['all', 'Tout']];
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function periodRange(key) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const iso = (a, b, c) => toISO(new Date(a, b, c));
  if (key === 'month') return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
  if (key === 'lastmonth') return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
  if (key === 'year') return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
  if (key === 'lastyear') return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
  return { from: '1970-01-01', to: '2999-12-31' };
}

// Lit toutes les lignes d'une table (par paquets de 1000)
async function fetchAll(table, cols, orderCol, mod) {
  let all = [], from = 0;
  for (;;) {
    let q = sb.from(table).select(cols);
    if (mod) q = mod(q);
    const part = await must(q.order(orderCol).range(from, from + 999));
    all = all.concat(part || []);
    if (!part || part.length < 1000) break;
    from += 1000;
  }
  return all;
}
const localDay = (ts) => toISO(new Date(ts));
const paidAmount = (i) => Number(i.paid_amount ?? i.total ?? 0);

function expenseForm(exp) {
  const fields = [
    { key: 'spent_on', label: 'Date', type: 'date', required: true, default: todayISO() },
    { key: 'amount', label: 'Montant (CHF)', type: 'number', inputmode: 'decimal', required: true, default: '' },
    { key: 'description', label: 'Description (ex. Bobine PLA, abonnement…)', required: true, full: true },
    { key: 'supplier', label: 'Fournisseur (facultatif)' },
    { key: 'category', label: 'Catégorie', type: 'select', options: EXP_CATS, default: 'matieres' },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  ];
  formModal({
    title: exp ? 'Modifier la dépense' : 'Nouvelle dépense', fields, values: exp || {},
    onSave: async (d) => {
      if (!(d.amount > 0)) throw new Error('Entre le montant de la dépense.');
      const row = { spent_on: d.spent_on || todayISO(), description: d.description, supplier: d.supplier, category: d.category || 'autre', amount: d.amount, notes: d.notes };
      if (exp) await ok(sb.from('expenses').update(row).eq('id', exp.id)); else await ok(sb.from('expenses').insert(row));
      toast('Dépense enregistrée'); go('expenses');
    },
    onDelete: exp ? async () => { await ok(sb.from('expenses').delete().eq('id', exp.id)); go('expenses'); } : null,
  });
}

routes.expenses = async (v) => {
  if (!state.isAdmin) { v.innerHTML = pageHead('Dépenses et bénéfice') + '<div class="empty">Réservé à l\'administrateur.</div>'; return; }
  let exps;
  try { exps = await fetchAll('expenses', '*', 'spent_on'); }
  catch (e) { v.innerHTML = pageHead('Dépenses et bénéfice') + `<div class="empty">Les dépenses ne sont pas encore installées : lance le fichier 16-depenses.sql dans Supabase.<br><span class="muted">${esc(e.message || '')}</span></div>`; return; }
  const pays = await fetchAll('invoices', 'id,number,total,paid_amount,paid_at,clients(name)', 'created_at', (q) => q.eq('status', 'payee'));
  const key = state.expPeriod || 'year';
  const { from, to } = periodRange(key);
  const inP = (day) => day >= from && day <= to;
  const P = pays.filter((i) => i.paid_at && inP(localDay(i.paid_at)));
  const E = exps.filter((x) => inP(x.spent_on)).sort((a, b) => b.spent_on.localeCompare(a.spent_on));
  const rev = P.reduce((a, i) => a + paidAmount(i), 0);
  const cost = E.reduce((a, x) => a + Number(x.amount), 0);
  const profit = rev - cost;
  const margin = rev > 0 ? Math.round((profit / rev) * 100) : null;

  // graphique par mois
  const now = new Date();
  let months;
  if (key === 'month' || key === 'lastmonth') months = null;
  else if (key === 'all') months = Array.from({ length: 12 }, (_, k) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  else { const y = key === 'year' ? now.getFullYear() : now.getFullYear() - 1; months = Array.from({ length: 12 }, (_, k) => ({ y, m: k })); }
  let chart = '';
  if (months) {
    const mk = (d) => `${d.slice(0, 4)}-${d.slice(5, 7)}`;
    const revBy = {}, costBy = {};
    pays.forEach((i) => { if (i.paid_at) { const k = mk(localDay(i.paid_at)); revBy[k] = (revBy[k] || 0) + paidAmount(i); } });
    exps.forEach((x) => { const k = mk(x.spent_on); costBy[k] = (costBy[k] || 0) + Number(x.amount); });
    const keys = months.map(({ y, m }) => `${y}-${String(m + 1).padStart(2, '0')}`);
    const max = Math.max(1, ...keys.map((k) => Math.max(revBy[k] || 0, costBy[k] || 0)));
    chart = `<div class="card" style="margin-bottom:16px"><h2>Encaissé et dépenses par mois</h2><div class="chart">${keys.map((k, i) => {
      const r = revBy[k] || 0, c = costBy[k] || 0;
      return `<div class="col" title="${MONTHS_FR[months[i].m]} : encaissé ${chf(r)} · dépenses ${chf(c)} · bénéfice ${chf(r - c)}"><div class="pair"><div class="bar2 p" style="height:${(r / max) * 100}%"></div><div class="bar2 u" style="height:${(c / max) * 100}%"></div></div><span>${MONTHS_FR[months[i].m]}</span></div>`;
    }).join('')}</div><div class="legend"><span><i style="background:var(--red)"></i>Encaissé</span><span><i style="background:#4a4a54"></i>Dépenses</span></div></div>`;
  }

  // par catégorie
  const byCat = {};
  E.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const catBox = cats.length
    ? `<div class="card list"><h2>Dépenses par catégorie</h2>${cats.map(([c, t]) => `<div class="li" style="display:block"><div style="display:flex;justify-content:space-between"><span>${esc(expCatLabel(c))}</span><b class="mono">${chf(t)}</b></div><div class="meter"><i style="width:${Math.round((t / cost) * 100)}%"></i></div></div>`).join('')}</div>`
    : '<div class="card list"><h2>Dépenses par catégorie</h2><div class="muted">Aucune dépense sur cette période.</div></div>';

  v.innerHTML = pageHead('Dépenses et bénéfice', `<select id="per" style="width:auto">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn primary" id="add">+ Nouvelle dépense</button>`) + `
    <div class="kpis">
      <div class="card kpi"><div class="lbl">Encaissé</div><div class="val">${chf(rev)}</div><div class="note">${P.length} paiement(s) reçu(s)</div></div>
      <div class="card kpi"><div class="lbl">Dépenses</div><div class="val">${chf(cost)}</div><div class="note">${E.length} dépense(s)</div></div>
      <div class="card kpi ${profit >= 0 ? 'accent' : 'bad'}"><div class="lbl">Bénéfice</div><div class="val">${profit < 0 ? '−' : ''}${chf(Math.abs(profit))}</div><div class="note">encaissé − dépenses</div></div>
      <div class="card kpi"><div class="lbl">Marge</div><div class="val">${margin === null ? '—' : margin + ' %'}</div><div class="note">bénéfice / encaissé</div></div>
    </div>${chart}
    <div class="grid2" style="align-items:start">${catBox}
      <div class="card list"><h2>Derniers paiements reçus</h2>${P.length ? P.sort((a, b) => b.paid_at.localeCompare(a.paid_at)).slice(0, 6).map((i) => `<div class="li"><span>${esc(i.number)} <span class="muted">· ${esc(i.clients?.name || '')}</span></span><b class="mono">${chf(paidAmount(i))}</b></div>`).join('') : '<div class="muted">Aucun paiement sur cette période.</div>'}</div></div>
    <div class="card"><h2>Dépenses de la période</h2><table><thead><tr><th>Date</th><th>Description</th><th>Fournisseur</th><th>Catégorie</th><th class="r">Montant</th></tr></thead><tbody id="tb">${E.length ? E.map((x) => `<tr class="row" data-id="${x.id}"><td class="muted" style="white-space:nowrap">${fmtShort(x.spent_on)}</td><td><b>${esc(x.description)}</b></td><td class="muted">${esc(x.supplier || '')}</td><td class="muted">${esc(expCatLabel(x.category))}</td><td class="r mono">${chf(x.amount)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Aucune dépense. Clique sur « Nouvelle dépense » pour commencer.</td></tr>'}</tbody></table></div>
    <div class="hint">Le bénéfice compte l'argent <b>réellement encaissé</b> (factures payées, à la date du paiement) moins les dépenses saisies, à leur date. Pense à noter aussi les frais Stripe (catégorie « Frais de paiement »). Cette page n'est visible que par l'administrateur.</div>`;
  $('#per').addEventListener('change', (e) => { state.expPeriod = e.target.value; go('expenses'); });
  $('#add').addEventListener('click', () => expenseForm(null));
  document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => expenseForm(exps.find((x) => x.id === r.dataset.id))));
};

/* ============================================================
   Diagnostic (administrateur)
   ============================================================ */
const DB_CHECKS = [
  ['Factures, clients et produits', 'invoices', 'id,number,status,total', '1-schema-facturation.sql', false],
  ['Apparence des factures', 'company_settings', 'invoice_layout', '7-apparence-factures.sql', false],
  ['Suivi des e-mails envoyés', 'invoice_emails', 'id', '8-suivi-emails.sql', false],
  ['Annulation et factures rectificatives', 'invoices', 'cancelled_at,refunded,stripe_refund_id', '9-annulation-factures.sql', false],
  ['Devis', 'quotes', 'id', '10-devis.sql', false],
  ['Adresse des mises à jour', 'company_settings', 'update_url', '11-mises-a-jour.sql', false],
  ['Journal d\'activité', 'activity_log', 'id', '12-journal-activite.sql', true],
  ['IBAN (QR-facture)', 'company_settings', 'iban', '13-qr-facture.sql', false],
  ['Modes de paiement par facture', 'invoices', 'pay_mode,paid_method,paid_by', '14-modes-paiement.sql', false],
  ['Stock de matières', 'stock_items', 'id', '15-stock.sql', false],
  ['Stock lié aux factures', 'invoice_items', 'stock_item_id,stock_qty', '15-stock.sql', false],
  ['Dépenses et bénéfice', 'expenses', 'id', '16-depenses.sql', true],
  ['Acomptes', 'invoices', 'kind', '17-acomptes.sql', false],
  ['Acceptation des devis en ligne', 'quotes', 'public_token,accepted_by,accepted_via', '21-membres-et-acceptation.sql', false],
  ['Membres', 'members', 'id', '21-membres-et-acceptation.sql', true],
  ['Cotisations des membres', 'membership_fees', 'id', '21-membres-et-acceptation.sql', true],
  ['Pièces jointes des devis', 'quote_files', 'id', '20-pieces-jointes.sql', false],
  ['Remises sur les factures', 'invoices', 'discount_percent', '19-facturation-avancee.sql', false],
  ['Conditions par client', 'clients', 'pay_term_mode,pay_term_days,discount_percent,pay_mode', '19-facturation-avancee.sql', false],
  ['Délai de paiement et numérotation', 'company_settings', 'pay_term_mode,pay_term_days,number_prefix_invoice,number_reset,number_digits', '19-facturation-avancee.sql', false],
  ['Gestion des utilisateurs', 'profiles', 'active', '18-utilisateurs.sql', false],
  ['Journal des factures supprimées', 'invoice_deletions', 'id', '6-suppression-factures.sql', true],
];
const FN_CHECKS = [
  ['Création des liens de paiement (Stripe)', 'create-payment-link', {}, '2-create-payment-link.ts'],
  ['Suppression de factures', 'delete-invoice', {}, '5-delete-invoice.ts'],
  ['Annulation de factures', 'cancel-invoice', {}, '9-cancel-invoice.ts'],
  ['Paiement enregistré à la main', 'mark-invoice-paid', {}, '14-mark-invoice-paid.ts'],
  ['Gestion des utilisateurs', 'manage-users', { action: 'ping' }, '18-manage-users.ts'],
  ['Acceptation des devis en ligne', 'quote-public', { action: 'ping' }, '21-quote-public.ts'],
];

async function probeFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return { status: 200, msg: (data && data.error) || '' };
  let status = 0, msg = '';
  try { status = error.context.status; const t = await error.context.text(); try { msg = JSON.parse(t).error || JSON.parse(t).message || t; } catch { msg = t; } } catch { msg = error.message || ''; }
  return { status, msg };
}

async function runDiagnostics() {
  const out = [];
  const add = (group, label, status, detail) => out.push({ group, label, status, detail });
  const cfg = window.DAYAN_CONFIG;

  // ----- Sécurité -----
  try {
    const r = await window.desk.diagHttp({ url: cfg.SUPABASE_URL + '/auth/v1/settings', headers: { apikey: cfg.SUPABASE_KEY } });
    const j = JSON.parse(r.text);
    if (j.disable_signup === true) add('Sécurité', 'Inscriptions fermées', 'ok', 'Personne ne peut se créer un compte tout seul.');
    else add('Sécurité', 'Inscriptions fermées', 'bad', "Les inscriptions sont OUVERTES : n'importe qui peut créer un compte et voir les données. Supabase > Authentication > Sign In / Providers : désactive « Allow new users to sign up ».");
  } catch { add('Sécurité', 'Inscriptions fermées', 'warn', "Vérification impossible (réseau ?). Contrôle à la main : Supabase > Authentication > « Allow new users to sign up » doit être désactivé."); }

  // ----- Base de données -----
  await Promise.all(DB_CHECKS.map(async ([label, table, cols, file, adminOnly]) => {
    if (adminOnly && !state.isAdmin) return;
    try { await must(sb.from(table).select(cols).limit(1)); add('Base de données', label, 'ok', ''); }
    catch (e) { add('Base de données', label, 'bad', `Pas installé : lance le fichier ${file} dans Supabase (SQL Editor).`); }
  }));

  // ----- Fonctions du serveur -----
  await Promise.all(FN_CHECKS.map(async ([label, name, body, file]) => {
    if (name === 'manage-users' && !state.isAdmin) return;
    try {
      const r = await probeFn(name, body);
      if (name === 'quote-public' && r.status === 400) add('Fonctions du serveur', label, 'ok', 'Déployée et publique (« Verify JWT » désactivé).');
      else if (name === 'quote-public' && r.status === 401) add('Fonctions du serveur', label, 'bad', "« quote-public » exige une connexion : désactive « Verify JWT » pour cette fonction, sinon le client ne peut pas répondre.");
      else if (r.status === 404) add('Fonctions du serveur', label, 'bad', `Fonction « ${name} » non déployée : crée-la dans Supabase (Edge Functions) avec le code de ${file}.`);
      else if (/STRIPE_SECRET_KEY/i.test(r.msg)) add('Fonctions du serveur', label, 'bad', 'Le secret STRIPE_SECRET_KEY est manquant (Supabase > Edge Functions > Secrets).');
      else if (r.status === 0) add('Fonctions du serveur', label, 'warn', 'Le serveur ne répond pas (réseau ?).');
      else if (r.status === 401) add('Fonctions du serveur', label, 'warn', `« ${name} » refuse la connexion : vérifie qu'elle est bien déployée avec « Verify JWT » activé.`);
      else add('Fonctions du serveur', label, 'ok', 'Déployée et répond.');
    } catch (e) { add('Fonctions du serveur', label, 'warn', 'Test impossible : ' + (e.message || e)); }
  }));
  try {
    const r = await window.desk.diagHttp({ url: cfg.SUPABASE_URL + '/functions/v1/stripe-webhook', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 404) add('Fonctions du serveur', 'Réception des paiements Stripe', 'bad', 'Fonction « stripe-webhook » non déployée : crée-la avec le code de 3-stripe-webhook.ts.');
    else if (r.status === 401) add('Fonctions du serveur', 'Réception des paiements Stripe', 'bad', "« stripe-webhook » exige une connexion : désactive « Verify JWT » pour cette fonction, sinon Stripe ne peut pas la joindre.");
    else if (/STRIPE_WEBHOOK_SECRET/i.test(r.text)) add('Fonctions du serveur', 'Réception des paiements Stripe', 'bad', 'Le secret STRIPE_WEBHOOK_SECRET est manquant (Supabase > Edge Functions > Secrets).');
    else if (r.status === 400) add('Fonctions du serveur', 'Réception des paiements Stripe', 'ok', 'Déployée, ouverte à Stripe, secret présent.');
    else add('Fonctions du serveur', 'Réception des paiements Stripe', 'warn', `Réponse inattendue (${r.status}).`);
  } catch (e) { add('Fonctions du serveur', 'Réception des paiements Stripe', 'warn', 'Test impossible : ' + (e.message || e)); }

  try {
    const pageUrl = ((layoutOf(state.company).accept_page_url) || LAYOUT_DEFAULTS.accept_page_url).trim();
    const r = await window.desk.diagHttp({ url: pageUrl });
    if (r.status === 200 && /quote-public/.test(r.text + '')) add('Fonctions du serveur', "Page d'acceptation des devis (GitHub Pages)", 'ok', 'La page est en ligne.');
    else if (r.status === 200) add('Fonctions du serveur', "Page d'acceptation des devis (GitHub Pages)", 'warn', "Une page répond à cette adresse, mais ce n'est pas accepter.html.");
    else add('Fonctions du serveur', "Page d'acceptation des devis (GitHub Pages)", 'warn', "La page n'est pas encore publiée : dépose accepter.html dans ton dépôt GitHub et active GitHub Pages (Settings > Pages).");
  } catch (e) { add('Fonctions du serveur', "Page d'acceptation des devis (GitHub Pages)", 'warn', 'Test impossible.'); }

  // ----- Cet ordinateur -----
  try {
    const st = await window.desk.mailStatus();
    if (!st.configured) add('Cet ordinateur', 'Envoi d\'e-mails (Gmail)', 'warn', "Pas configuré sur cet ordinateur : Paramètres > Envoi d'e-mails.");
    else {
      try { await window.desk.mailTest(); add('Cet ordinateur', 'Envoi d\'e-mails (Gmail)', 'ok', `Connexion réussie (${st.user}).`); }
      catch (e) { add('Cet ordinateur', "Envoi d'e-mails (Gmail)", 'bad', ipcMsg(e)); }
    }
  } catch (e) { add('Cet ordinateur', "Envoi d'e-mails (Gmail)", 'warn', 'Test impossible.'); }

  const co = state.company || {};
  if (!co.iban) add('Cet ordinateur', 'IBAN pour la QR-facture', 'warn', "Pas d'IBAN : Paramètres > Société (nécessaire seulement si tu veux la QR-facture).");
  else if (validSwissIban(normIban(co.iban))) add('Cet ordinateur', 'IBAN pour la QR-facture', 'ok', 'IBAN valide' + (isQrIban(normIban(co.iban)) ? ' (QR-IBAN : référence QR automatique).' : ' (IBAN classique : sans référence).'));
  else add('Cet ordinateur', 'IBAN pour la QR-facture', 'bad', "L'IBAN enregistré n'est pas valide : corrige-le dans Paramètres > Société.");
  if (!co.name || !co.address || !co.postal_code || !co.city) add('Cet ordinateur', 'Adresse de la société', 'warn', "Adresse incomplète : Paramètres > Société (elle s'affiche sur les factures et la QR-facture).");
  else add('Cet ordinateur', 'Adresse de la société', 'ok', `${co.name}, ${co.address}, ${co.postal_code} ${co.city}`);

  try {
    const info = state.appInfo || await window.desk.appVersion();
    const base = (co.update_url || DEFAULT_UPDATE_URL).replace(/\/+$/, '');
    const r = await window.desk.diagHttp({ url: base + '/latest.yml' });
    const ver = (/version:\s*([0-9.]+)/.exec(r.text) || [])[1];
    if (r.status === 200 && ver) {
      const cmp = ver.split('.').map(Number).reduce((a, n, i) => a || (n - (Number(info.version.split('.')[i]) || 0)), 0);
      if (cmp > 0) add('Cet ordinateur', 'Mises à jour automatiques', 'warn', `Une version plus récente (${ver}) est publiée ; tu as la ${info.version}. Elle va se télécharger toute seule.`);
      else add('Cet ordinateur', 'Mises à jour automatiques', 'ok', `Version installée : ${info.version}. Dernière version publiée : ${ver}.`);
    } else if (r.status === 404) add('Cet ordinateur', 'Mises à jour automatiques', 'bad', "Le fichier latest.yml est introuvable dans la dernière publication GitHub. Il doit s'appeler exactement latest.yml (sans « (1) » ni « .3 »).");
    else add('Cet ordinateur', 'Mises à jour automatiques', 'warn', `Réponse inattendue du serveur de mises à jour (${r.status || 'aucune réponse'}).`);
  } catch (e) { add('Cet ordinateur', 'Mises à jour automatiques', 'warn', 'Test impossible : ' + (e.message || e)); }
  return out;
}

function renderDiagResult(box, list) {
  const order = ['Sécurité', 'Base de données', 'Fonctions du serveur', 'Cet ordinateur'];
  const n = { bad: 0, warn: 0, ok: 0 };
  list.forEach((x) => { n[x.status] += 1; });
  const badge = { ok: '<span class="badge green">OK</span>', warn: '<span class="badge amber">À vérifier</span>', bad: '<span class="badge red">À corriger</span>' };
  box.innerHTML = `<div style="margin:6px 0 12px;font-size:15px"><b>${n.bad ? `<span style="color:#ff6b76">${n.bad} à corriger</span> · ` : ''}${n.warn ? `<span style="color:#fbbf24">${n.warn} à vérifier</span> · ` : ''}<span style="color:#4ade80">${n.ok} en ordre</span></b></div>
    ${order.map((g) => { const rows = list.filter((x) => x.group === g).sort((a, b) => ({ bad: 0, warn: 1, ok: 2 }[a.status] - { bad: 0, warn: 1, ok: 2 }[b.status])); return rows.length ? `<h3 style="margin:14px 0 6px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">${esc(g)}</h3>${rows.map((x) => `<div class="li" style="display:block;border-bottom:1px solid #1f1f24;padding:8px 0"><div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(x.label)}</span>${badge[x.status]}</div>${x.detail ? `<div class="muted" style="margin-top:3px">${esc(x.detail)}</div>` : ''}</div>`).join('')}` : ''; }).join('')}
    <div style="margin-top:14px"><button class="btn" id="diagcopy">Copier le rapport</button></div>`;
  $('#diagcopy', box).addEventListener('click', async () => {
    const txt = ['Diagnostic Dayan 3D Facturation ' + ((state.appInfo && state.appInfo.version) || ''), new Date().toLocaleString('fr-CH'), ''].concat(list.map((x) => `[${x.status === 'ok' ? 'OK' : x.status === 'warn' ? 'A VERIFIER' : 'A CORRIGER'}] ${x.group} / ${x.label}${x.detail ? ' : ' + x.detail : ''}`)).join('\n');
    await navigator.clipboard.writeText(txt); toast("Rapport copié : colle-le dans la conversation si tu veux de l'aide");
  });
}

/* ============================================================
   Membres et cotisations (administrateur)
   ============================================================ */
const FEE_METHODS = ['Espèces', 'Virement', 'Carte', 'Autre'];
const memberAsClient = (m) => ({ name: m.name, address: m.address, postal_code: m.postal_code, city: m.city, country: 'Suisse', email: m.email });

async function receiptHTML(member, fee) {
  return buildInvoiceHTML({
    inv: { number: fee.receipt_no || `Cotisation ${fee.year}`, issue_date: fee.paid_on, total: Number(fee.amount), status: 'payee', paid_at: fee.paid_on, is_receipt: true, receipt_method: fee.method, notes: fee.note, discount_percent: 0, contact_name: state.profile.full_name || null },
    items: [{ type: 'Cotisation', description: `Cotisation annuelle ${fee.year}`, unit_price: Number(fee.amount), quantity: 1 }],
    client: memberAsClient(member), company: state.company, qr: null, logo: await window.desk.logo(), bill: null,
  });
}

function openSimpleMailDialog({ title, to, subject, body, pdfHtml, filename, note }) {
  const m = modal(title, `<form class="form" id="smf">
    <div class="field full"><label>À</label><input name="to" value="${esc(to || '')}" required></div>
    <div class="field full"><label>Objet</label><input name="subject" value="${esc(subject)}" required></div>
    <div class="field full"><label>Message</label><textarea name="text" style="min-height:180px">${esc(body)}</textarea></div>
    <div class="field full muted">${esc(note || 'Le PDF sera joint.')}</div>
    <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary" id="smgo">Envoyer</button></div></div></form>`, { wide: true });
  $('#smf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, b = $('#smgo', m.el), to2 = f.to.value.trim();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(to2)) { toast('Adresse e-mail invalide.', 'err'); return; }
    b.setAttribute('disabled', ''); b.textContent = 'Envoi…';
    try { await window.desk.sendMail({ to: to2, subject: f.subject.value.trim(), text: f.text.value, pdfHtml, filename }); toast('E-mail envoyé à ' + to2); m.close(); }
    catch (err) { const msg = ipcMsg(err); toast(msg.includes('NOT_CONFIGURED') ? 'Envoi non configuré : Paramètres > Envoi d\'e-mails.' : msg, 'err'); b.removeAttribute('disabled'); b.textContent = 'Envoyer'; }
  });
}

function openReceiptDialog(member, fee) {
  const m = modal('Reçu de cotisation', `<div class="muted" style="margin-bottom:12px">${esc(member.name)} · cotisation ${esc(fee.year)} · <b style="color:var(--text)">${chf(fee.amount)}</b>${fee.receipt_no ? ' · ' + esc(fee.receipt_no) : ''}</div>
    <div class="actions"><button class="btn" id="rcprev">Aperçu</button><button class="btn primary" id="rcpdf">Télécharger le PDF</button><button class="btn" id="rcprint">Imprimer</button><button class="btn" id="rcmail">Envoyer par e-mail</button></div>`);
  $('#rcprev', m.el).addEventListener('click', async () => showPreview(await receiptHTML(member, fee)));
  $('#rcpdf', m.el).addEventListener('click', async () => { try { const r = await window.desk.savePdf(await receiptHTML(member, fee), `Recu-${fee.receipt_no || fee.year}-${member.name.replace(/[^\w]+/g, '_')}.pdf`); if (r.saved) toast('Reçu enregistré'); } catch (e) { toast(ipcMsg(e), 'err'); } });
  $('#rcprint', m.el).addEventListener('click', async () => { try { const r = await window.desk.printHtml(await receiptHTML(member, fee)); if (r && r.printed) toast('Impression lancée'); } catch (e) { toast(ipcMsg(e), 'err'); } });
  $('#rcmail', m.el).addEventListener('click', async () => {
    const co = state.company;
    m.close();
    openSimpleMailDialog({ title: 'Envoyer le reçu', to: member.email, subject: `Reçu de cotisation ${fee.year} — ${co.name}`, body: `Bonjour ${member.name},\n\nVeuillez trouver ci-joint votre reçu pour la cotisation ${fee.year} (${chf(fee.amount)}). Merci pour votre soutien !\n\nCordialement,\n${state.profile.full_name || co.name}\n${co.name}`, pdfHtml: await receiptHTML(member, fee), filename: `Recu-${fee.year}.pdf`, note: 'Le reçu en PDF sera joint.' });
  });
}

function memberForm(mb) {
  const fields = [
    { key: 'name', label: 'Nom et prénom', required: true, full: true },
    { key: 'category', label: 'Catégorie', list: ['Membre', 'Comité', 'Jeune', 'Bienfaiteur'], default: 'Membre' },
    { key: 'status', label: 'Statut', type: 'select', options: [['actif', 'Actif'], ['inactif', 'Inactif']], default: 'actif' },
    { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Téléphone' },
    { key: 'address', label: 'Adresse', full: true }, { key: 'postal_code', label: 'NPA' }, { key: 'city', label: 'Localité' },
    { key: 'joined_on', label: "Membre depuis", type: 'date', default: todayISO() },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  ];
  formModal({
    title: mb ? 'Modifier le membre' : 'Nouveau membre', fields, values: mb || {},
    onSave: async (d) => { const row = { ...d, category: d.category || 'Membre', status: d.status || 'actif' }; if (mb) await ok(sb.from('members').update(row).eq('id', mb.id)); else await ok(sb.from('members').insert(row)); toast('Membre enregistré'); go('members'); },
    onDelete: mb ? async () => { if (!confirm(`Supprimer ${mb.name} et toutes ses cotisations ?`)) throw new Error('Suppression annulée.'); await ok(sb.from('members').delete().eq('id', mb.id)); go('members'); } : null,
  });
}

async function openMember(id) {
  const mb = await must(sb.from('members').select('*').eq('id', id).single());
  const fees = await must(sb.from('membership_fees').select('*').eq('member_id', id).order('year', { ascending: false }));
  const m = modal(mb.name, `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div class="muted">${esc(mb.category)} · ${mb.status === 'actif' ? 'Actif' : 'Inactif'}${mb.joined_on ? ' · membre depuis ' + esc(fmtDate(mb.joined_on)) : ''}<br>${esc([mb.email, mb.phone].filter(Boolean).join(' · '))}<br>${esc([mb.address, [mb.postal_code, mb.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}${mb.notes ? '<br><i>' + esc(mb.notes) + '</i>' : ''}</div>
      <div class="actions"><button class="btn primary" id="mbfee">+ Cotisation</button><button class="btn" id="mbedit">Modifier</button></div></div>
    <h2 style="margin-top:20px">Cotisations</h2>
    ${fees.length ? `<table><thead><tr><th>Année</th><th class="r">Montant</th><th>Payée le</th><th>Moyen</th><th>Reçu</th><th></th></tr></thead><tbody>${fees.map((f) => `<tr><td><b>${esc(f.year)}</b></td><td class="r mono">${chf(f.amount)}</td><td>${f.paid_on ? esc(fmtShort(f.paid_on)) : '<span class="badge amber">À payer</span>'}</td><td class="muted">${esc(f.method || '')}</td><td class="muted">${esc(f.receipt_no || '')}</td><td class="r" style="white-space:nowrap">${f.paid_on ? `<button class="btn" data-rc="${f.id}" style="padding:4px 10px">Reçu</button> ` : ''}<button class="btn danger" data-fd="${f.id}" style="padding:4px 10px">Supprimer</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted">Aucune cotisation enregistrée.</div>'}`, { wide: true });
  const reopen = async () => { m.close(); await go('members'); openMember(id); };
  $('#mbedit', m.el).addEventListener('click', () => { m.close(); memberForm(mb); });
  $('#mbfee', m.el).addEventListener('click', () => {
    formModal({
      title: `Cotisation de ${mb.name}`,
      fields: [
        { key: 'year', label: 'Année', type: 'number', inputmode: 'numeric', required: true, default: String(new Date().getFullYear()) },
        { key: 'amount', label: 'Montant (CHF)', type: 'number', inputmode: 'decimal', required: true, default: String(state.company.membership_fee || '') },
        { key: 'paid_on', label: 'Payée le (vide = à payer)', type: 'date', default: todayISO() },
        { key: 'method', label: 'Moyen de paiement', type: 'select', options: FEE_METHODS, default: 'Espèces' },
        { key: 'note', label: 'Note', full: true },
      ],
      values: {},
      onSave: async (d) => {
        if (!(d.year >= 2000 && d.year <= 2100)) throw new Error('Année invalide.');
        if (!(d.amount >= 0)) throw new Error('Montant invalide.');
        let receipt = null;
        if (d.paid_on) { try { receipt = await must(sb.rpc('next_number', { p_kind: 'CO' })); } catch { receipt = null; } }
        try { await ok(sb.from('membership_fees').insert({ member_id: id, year: d.year, amount: d.amount, paid_on: d.paid_on || null, method: d.paid_on ? d.method : null, receipt_no: receipt, note: d.note })); }
        catch (e) { throw new Error(e.code === '23505' ? `Une cotisation ${d.year} existe déjà pour ${mb.name}.` : e.message); }
        toast('Cotisation enregistrée'); reopen();
      },
    });
  });
  m.el.querySelectorAll('[data-rc]').forEach((b) => b.addEventListener('click', () => { const f = fees.find((x) => x.id === b.dataset.rc); m.close(); openReceiptDialog(mb, f); }));
  m.el.querySelectorAll('[data-fd]').forEach((b) => b.addEventListener('click', async () => {
    const f = fees.find((x) => x.id === b.dataset.fd);
    if (!confirm(`Supprimer la cotisation ${f.year} de ${mb.name} ?`)) return;
    try { await ok(sb.from('membership_fees').delete().eq('id', f.id)); reopen(); } catch (e) { toast(e.message, 'err'); }
  }));
}

routes.members = async (v) => {
  if (!state.isAdmin) { v.innerHTML = pageHead('Membres') + '<div class="empty">Réservé à l\'administrateur.</div>'; return; }
  const year = state.memYear || new Date().getFullYear();
  let members, fees;
  try {
    members = await fetchAll('members', '*', 'name');
    fees = await must(sb.from('membership_fees').select('*').eq('year', year));
  } catch (e) { v.innerHTML = pageHead('Membres') + `<div class="empty">Les membres ne sont pas encore installés : lance le fichier 21-membres-et-acceptation.sql dans Supabase.<br><span class="muted">${esc(e.message || '')}</span></div>`; return; }
  const paidBy = {}; fees.forEach((f) => { if (f.paid_on) paidBy[f.member_id] = f; });
  const actifs = members.filter((x) => x.status === 'actif');
  const nPaid = actifs.filter((x) => paidBy[x.id]).length;
  const cash = fees.filter((f) => f.paid_on).reduce((a, f) => a + Number(f.amount), 0);
  const years = []; for (let y = new Date().getFullYear() + 1; y >= new Date().getFullYear() - 4; y--) years.push(y);
  v.innerHTML = pageHead('Membres et cotisations', `<select id="my" style="width:auto">${years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>Cotisations ${y}</option>`).join('')}</select><button class="btn primary" id="add">+ Nouveau membre</button>`) + `
    <div class="kpis">
      <div class="card kpi"><div class="lbl">Membres actifs</div><div class="val">${actifs.length}</div><div class="note">${members.length - actifs.length} inactif(s)</div></div>
      <div class="card kpi accent"><div class="lbl">Cotisations ${year} payées</div><div class="val">${nPaid} / ${actifs.length}</div><div class="note">membres actifs à jour</div></div>
      <div class="card kpi ${actifs.length - nPaid ? 'warn' : ''}"><div class="lbl">Pas encore payées</div><div class="val">${actifs.length - nPaid}</div><div class="note">membres actifs</div></div>
      <div class="card kpi"><div class="lbl">Cotisations encaissées</div><div class="val">${chf(cash)}</div><div class="note">pour ${year}</div></div></div>
    <div class="toolbar"><input id="q" placeholder="Rechercher un membre…">
      <select id="st"><option value="actif">Actifs</option><option value="inactif">Inactifs</option><option value="">Tous</option></select>
      <select id="fp"><option value="">Cotisation : toutes</option><option value="paid">Payée</option><option value="unpaid">Pas payée</option></select></div>
    <div class="card"><table><thead><tr><th>Nom</th><th>Catégorie</th><th>Contact</th><th>Localité</th><th>Cotisation ${year}</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div class="hint">La cotisation annuelle par défaut se règle dans Paramètres > Numérotation et délais. Les données des membres ne sont visibles que par l'administrateur.</div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#st').value, fp = $('#fp').value;
    const list = members.filter((x) => (!st || x.status === st) && (!fp || (fp === 'paid' ? !!paidBy[x.id] : !paidBy[x.id])) && [x.name, x.email, x.city, x.category].join(' ').toLowerCase().includes(q));
    $('#tb').innerHTML = list.length
      ? list.map((x) => `<tr class="row" data-id="${x.id}"><td><b>${esc(x.name)}</b>${x.status === 'inactif' ? ' <span class="badge">Inactif</span>' : ''}</td><td class="muted">${esc(x.category)}</td><td class="muted">${esc([x.email, x.phone].filter(Boolean).join(' · '))}</td><td class="muted">${esc([x.postal_code, x.city].filter(Boolean).join(' '))}</td><td>${paidBy[x.id] ? `<span class="badge green">Payée</span> <span class="muted">${esc(fmtShort(paidBy[x.id].paid_on))}</span>` : '<span class="badge amber">Pas payée</span>'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Aucun membre. Clique sur « Nouveau membre » pour commencer.</td></tr>';
    document.querySelectorAll('#tb .row').forEach((r) => r.addEventListener('click', () => openMember(r.dataset.id).catch((e) => toast(e.message, 'err'))));
  };
  $('#q').addEventListener('input', draw); $('#st').addEventListener('change', draw); $('#fp').addEventListener('change', draw);
  $('#my').addEventListener('change', (e) => { state.memYear = Number(e.target.value); go('members'); });
  $('#add').addEventListener('click', () => memberForm(null)); draw();
};

/* ============================================================
   Journal d'activité (administrateur)
   ============================================================ */
routes.activity = async (v) => {
  if (!state.isAdmin) { v.innerHTML = pageHead('Journal') + '<div class="empty">Réservé à l\'administrateur.</div>'; return; }
  let limit = 200, rows;
  const load = async () => { rows = await must(sb.from('activity_log').select('*').order('at', { ascending: false }).limit(limit)); };
  try { await load(); } catch (e) {
    v.innerHTML = pageHead('Journal') + `<div class="empty">Le journal n'est pas encore installé : lance le fichier 12-journal-activite.sql dans Supabase.<br><span class="muted">${esc(e.message || '')}</span></div>`;
    return;
  }
  v.innerHTML = pageHead('Journal d\'activité', '', '<span class="muted">Qui a fait quoi, et quand (les 200 derniers événements, du plus récent au plus ancien).</span>') + `
    <div class="toolbar"><input id="q" placeholder="Rechercher (personne, numéro, client…)">
      <select id="ent"><option value="">Tout</option><option>Facture</option><option>Devis</option><option>Client</option><option>Produit</option><option>Utilisateur</option><option>Paramètres</option></select></div>
    <div class="card"><table><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div style="margin-top:14px;text-align:center"><button class="btn" id="more">Afficher plus</button></div>`;
  const tone = (a) => ({ 'Création': 'green', 'Suppression': 'red', 'Statut': 'amber', 'Modification': '', 'E-mail envoyé': '', 'Rappel envoyé': 'amber', 'Facturé': 'green', 'Alerte': 'red' }[a] || '');
  const draw = () => {
    const q = $('#q').value.toLowerCase(), ent = $('#ent').value;
    const list = rows.filter((r) => (!ent || r.entity === ent) && [r.user_name, r.action, r.entity, r.label, r.details].join(' ').toLowerCase().includes(q));
    $('#tb').innerHTML = list.length
      ? list.map((r) => `<tr><td class="muted" style="white-space:nowrap">${esc(new Date(r.at).toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' }))}</td><td>${esc(r.user_name || '—')}</td><td><span class="badge ${tone(r.action)}">${esc(r.action)}</span></td><td><b>${esc(r.entity)}</b> ${esc(r.label || '')}</td><td class="muted">${esc(r.details || '')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Aucun événement.</td></tr>';
  };
  $('#q').addEventListener('input', draw); $('#ent').addEventListener('change', draw);
  $('#more').addEventListener('click', async () => { limit += 200; try { await load(); draw(); } catch (e) { toast(e.message, 'err'); } });
  draw();
};

/* ============================================================
   Apparence des factures (administrateur)
   ============================================================ */
const BLOCKS = [
  ['show_payment', 'Lien et QR de paiement (carte)'], ['show_contact', 'Nom du contact (émetteur)'], ['show_phone', 'Téléphone'],
  ['show_email', 'E-mail de la société'], ['show_website', 'Site internet'], ['show_client_email', 'E-mail du client'],
  ['show_due', "Date d'échéance dans l'en-tête"], ['show_vat', 'Mention TVA'], ['show_notes', 'Notes de la facture'],
  ['show_conditions', 'Bloc « Conditions »'], ['show_footer', 'Pied de page'],
];
const MAIL_TEXTS = [
  ['mail_invoice_subject', 'Facture : objet'], ['mail_invoice_body', 'Facture : message', 'textarea'],
  ['mail_reminder_subject', 'Rappel : objet'], ['mail_reminder_body', 'Rappel : message', 'textarea'],
  ['mail_quote_subject', 'Devis : objet'], ['mail_quote_body', 'Devis : message', 'textarea'],
];
const TEXTS = [
  ['pay_default', 'Mode de paiement proposé par défaut (modifiable sur chaque facture)', 'select'],
  ['title_label', 'Titre de l\'en-tête'], ['pay_button_label', 'Texte du bouton de paiement'], ['cards_text', 'Cartes acceptées (sous le bouton)'],
  ['pay_hint', 'Phrase sous le bouton'], ['mode_text', 'Mode de règlement'],
  ['calc_min', 'Calculateur : supplément minimum (CHF)'], ['calc_max', 'Calculateur : supplément maximum (CHF)'], ['calc_default', 'Calculateur : supplément proposé au départ (CHF)'],
  ['quote_validity_days', 'Devis : validité par défaut (jours)'], ['accept_page_url', "Devis : adresse de la page d'acceptation en ligne"], ['quote_accept_text', 'Devis : texte du bloc d\'acceptation'],
  ['thanks_text', 'Message de remerciement (sous le total)', 'textarea', 'Ex. : Merci pour votre confiance !'],
  ['footer_left', 'Pied de page, à gauche', '', 'Vide = adresse de la société'], ['footer_right', 'Pied de page, à droite', '', 'Vide = e-mail et site'],
];

routes.appearance = async (v) => {
  if (!state.isAdmin) { v.innerHTML = pageHead('Apparence des factures') + '<div class="empty">Réservé à l\'administrateur.</div>'; return; }
  const co = await must(sb.from('company_settings').select('*').eq('id', 1).single());
  state.company = co;
  const logo = await window.desk.logo();
  const sampleQR = await makeQR('https://buy.stripe.com/exemple', logo);
  const hasIban = validSwissIban(normIban(co.iban));
  const sampleBill = await swissBill({ number: 'FA-2026-0001', total: 155 }, { name: 'Exemple SA', address: 'Rue de la Gare 1', postal_code: '2300', city: 'La Chaux-de-Fonds', country: 'Suisse' }, { ...co, iban: hasIban ? co.iban : 'CH9300762011623852957' });
  const L = layoutOf(co);
  const today = todayISO();
  const sample = {
    inv: { number: 'FA-2026-0001', issue_date: today, due_date: dueDateFor(today), contact_name: state.profile.full_name || '', notes: 'Exemple de note affichée sur la facture.', total: 155, status: 'envoyee', stripe_payment_link_url: 'https://buy.stripe.com/exemple' },
    items: [
      { type: 'Objet 3D', description: 'Impression 3D — support sur mesure', unit_price: 85, quantity: 1 },
      { type: 'Gravure et découpe laser', description: 'Découpe laser du logo en bois', unit_price: 70, quantity: 1 },
    ],
    client: { name: 'Exemple SA', contact: 'Marie Dupont', address: 'Rue de la Gare 1', postal_code: '2300', city: 'La Chaux-de-Fonds', country: 'Suisse', email: 'contact@exemple.ch' },
  };

  v.innerHTML = pageHead('Apparence des factures', '<button class="btn ghost" id="reset">Valeurs par défaut</button><button class="btn primary" id="save">Enregistrer</button>', "<span class=\"muted\">L'aperçu se met à jour en direct. Les changements s'appliquent à toutes les factures (PDF, impression, e-mail).${hasIban ? '' : ' <b style=\"color:#fbbf24\">QR-facture : renseigne ton IBAN dans Paramètres > Société (l\'aperçu utilise un IBAN d\'exemple).</b>'}</span>") + `
    <div class="appearance">
      <div class="card">
        <h2>Blocs affichés</h2>
        <div class="toggles">${BLOCKS.map(([k, l]) => `<div class="field check" style="margin:0"><input type="checkbox" id="b_${k}" ${L[k] ? 'checked' : ''}><label for="b_${k}">${esc(l)}</label></div>`).join('')}</div>
        <h2 style="margin-top:22px">Textes</h2>
        ${TEXTS.map(([k, l, type, ph]) => `<div class="field"><label for="t_${k}">${esc(l)}</label>${type === 'textarea'
          ? `<textarea id="t_${k}" placeholder="${esc(ph || '')}">${esc(L[k] ?? '')}</textarea>`
          : type === 'select'
            ? `<select id="t_${k}">${PAY_MODES.map(([v, t]) => `<option value="${v}" ${(L[k] || 'carte') === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
            : `<input id="t_${k}" value="${esc(L[k] ?? '')}" placeholder="${esc(ph || '')}">`}</div>`).join('')}
        <h2 style="margin-top:22px">Modèles d'e-mails</h2>
        <div class="hint" style="margin:-4px 0 12px">Mots à mettre entre accolades, remplacés automatiquement : <b style="color:var(--text)">${esc(MAIL_VARS)}</b>. « {paiement} » devient le lien de paiement ou la phrase sur la QR-facture selon la facture.</div>
        ${MAIL_TEXTS.map(([k, l, type]) => `<div class="field"><label for="t_${k}">${esc(l)}</label>${type === 'textarea' ? `<textarea id="t_${k}" style="min-height:130px">${esc(L[k] ?? LAYOUT_DEFAULTS[k])}</textarea>` : `<input id="t_${k}" value="${esc(L[k] ?? LAYOUT_DEFAULTS[k])}">`}</div>`).join('')}
        <h2 style="margin-top:22px">Conditions</h2>
        <div class="field"><label for="c_late">Intérêts de retard (% par mois)</label><input id="c_late" value="${esc(String(co.late_interest_percent ?? 1))}"></div>
        <div class="field"><label for="c_vat_note">Mention TVA</label><input id="c_vat_note" value="${esc(co.vat_note ?? '')}"></div>
      </div>
      <div><div class="prev-wrap" id="pw"><iframe id="pf" title="Aperçu de la facture"></iframe></div></div>
    </div>`;

  const collect = () => {
    const lay = {};
    BLOCKS.forEach(([k]) => { lay[k] = $('#b_' + k).checked; });
    TEXTS.forEach(([k]) => { lay[k] = $('#t_' + k).value; });
    MAIL_TEXTS.forEach(([k]) => { lay[k] = $('#t_' + k).value; });
    return { lay, comp: { late_interest_percent: num($('#c_late').value), vat_note: $('#c_vat_note').value } };
  };
  const fit = () => {
    const pw = $('#pw'); if (!pw) return;
    const sc = pw.clientWidth / 794;
    $('#pf').style.transform = `scale(${sc})`;
    pw.style.height = Math.round(1123 * sc) + 'px';
  };
  const draw = () => {
    const { lay, comp } = collect();
    $('#pf').srcdoc = buildInvoiceHTML({ ...sample, inv: { ...sample.inv, pay_mode: lay.pay_default || 'carte' }, company: { ...co, ...comp, invoice_layout: lay }, qr: sampleQR, logo, bill: sampleBill });
    fit();
  };
  let timer;
  v.querySelectorAll('input, textarea, select').forEach((el) => el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 150); }));
  window.onresize = fit;
  draw();

  $('#reset').addEventListener('click', () => {
    if (!confirm('Remettre tous les blocs et textes par défaut ?')) return;
    BLOCKS.forEach(([k]) => { $('#b_' + k).checked = LAYOUT_DEFAULTS[k]; });
    TEXTS.forEach(([k]) => { $('#t_' + k).value = LAYOUT_DEFAULTS[k]; });
    MAIL_TEXTS.forEach(([k]) => { $('#t_' + k).value = LAYOUT_DEFAULTS[k]; });
    draw();
  });
  $('#save').addEventListener('click', async () => {
    try {
      const { lay, comp } = collect();
      await ok(sb.from('company_settings').update({ ...comp, invoice_layout: lay }).eq('id', 1));
      state.company = { ...co, ...comp, invoice_layout: lay };
      toast('Apparence enregistrée');
    } catch (e) {
      toast(/invoice_layout/.test(e.message || '') ? "Lance d'abord le fichier 7-apparence-factures.sql dans Supabase." : (e.message || String(e)), 'err');
    }
  });
};

/* ============================================================
   Paramètres
   ============================================================ */
routes.settings = async (v) => {
  const co = await must(sb.from('company_settings').select('*').eq('id', 1).single());
  const users = await must(sb.from('profiles').select('*').order('created_at'));
  state.company = co;
  const F = [
    ['name', 'Société'], ['email', 'E-mail'], ['address', 'Adresse'], ['phone', 'Téléphone'], ['postal_code', 'NPA'], ['website', 'Site internet'],
    ['city', 'Localité'], ['country', 'Pays'], ['iban', 'IBAN (pour la QR-facture suisse)'],
  ];
  v.innerHTML = pageHead('Paramètres') + `
    <div class="card" style="margin-bottom:16px"><h2>Société</h2><form id="cf" class="form">${F.map(([k, l]) => `<div class="field"><label>${l}</label><input name="${k}" value="${esc(co[k])}" ${state.isAdmin ? '' : 'disabled'}></div>`).join('')}
      ${state.isAdmin ? '<div class="form-actions"><span></span><button class="btn primary">Enregistrer</button></div>' : '<div class="hint full" style="grid-column:1/-1">Seul l\'administrateur peut modifier ces informations.</div>'}
      <div class="hint" style="grid-column:1/-1">Les conditions de règlement, la mention TVA et les textes des factures se modifient dans « Apparence ».</div></form></div>
    ${state.isAdmin ? '<div class="card" style="margin-bottom:16px" id="numcard"></div><div class="card" style="margin-bottom:16px" id="diagcard"></div>' : ''}
    <div class="card" style="margin-bottom:16px" id="acctcard"></div>
    <div class="card" style="margin-bottom:16px" id="notifcard"></div>
    <div class="card" style="margin-bottom:16px" id="mailcard"></div>
    <div class="card" style="margin-bottom:16px" id="updcard"></div>
    <div id="delcard"></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0">Utilisateurs</h2>${state.isAdmin ? '<button class="btn primary" id="inviteu">+ Ajouter un collaborateur</button>' : ''}</div>
      <table style="margin-top:12px"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th>${state.isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${users.map((u) => `<tr${u.active === false ? ' style="opacity:.55"' : ''}><td>${esc(u.full_name)}${u.active === false ? ' <span class="badge red">Désactivé</span>' : ''}</td><td class="muted">${esc(u.email)}</td><td>${state.isAdmin && u.id !== state.profile.id ? `<select data-u="${u.id}" style="max-width:180px"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrateur</option><option value="collaborateur" ${u.role === 'collaborateur' ? 'selected' : ''}>Collaborateur</option></select>` : (u.role === 'admin' ? 'Administrateur' : 'Collaborateur')}</td>${state.isAdmin ? `<td class="r" style="white-space:nowrap">${u.id !== state.profile.id ? `<button class="btn" data-pw="${u.id}" style="padding:5px 10px">Mot de passe</button> <button class="btn ${u.active === false ? '' : 'danger'}" data-onoff="${u.id}" data-on="${u.active === false ? '1' : '0'}" style="padding:5px 10px">${u.active === false ? 'Réactiver' : 'Désactiver'}</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>
      <div class="hint">« Ajouter un collaborateur » crée son compte avec un mot de passe temporaire que tu lui transmets ; il le change ensuite dans Paramètres > Mon compte. Un compte désactivé ne peut plus se connecter.</div></div>`;
  async function renderMailCard() {
    const st = await window.desk.mailStatus();
    $('#mailcard').innerHTML = `<h2>Envoi d'e-mails (sur cet ordinateur)</h2>
      <div class="muted" style="margin-bottom:12px">${st.configured ? `Configuré : les factures partent de <b style="color:var(--text)">${esc(st.user)}</b>.` : 'Pas encore configuré sur cet ordinateur.'}</div>
      <form id="mf" class="form">
        <div class="field"><label>Adresse Gmail</label><input name="user" value="${esc(st.user || co.email || '')}" required></div>
        <div class="field"><label>Mot de passe d'application Google (16 caractères)</label><input name="pass" type="password" placeholder="${st.configured ? '•••••••• (laisser vide pour ne pas changer)' : 'xxxx xxxx xxxx xxxx'}" ${st.configured ? '' : 'required'}></div>
        <div class="form-actions">${st.configured ? '<button type="button" class="btn danger" id="mclear">Retirer</button>' : '<span></span>'}<div>${st.configured ? '<button type="button" class="btn" id="mtest">Tester la connexion</button> ' : ''}<button class="btn primary">Enregistrer</button></div></div>
      </form>
      <div class="hint">Ces informations restent sur cet ordinateur, chiffrées par Windows. Pour créer le mot de passe d'application : compte Google → Sécurité → activer la validation en 2 étapes → « Mots de passe des applications » → créer « Dayan 3D Facturation ».</div>`;
    const mf = $('#mf');
    mf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = mf.elements.user.value.trim(), pass = mf.elements.pass.value;
      try {
        if (!pass && !st.configured) throw new Error('Mot de passe requis.');
        if (pass) await window.desk.mailSave(user, pass);
        else if (user !== st.user) throw new Error("Pour changer l'adresse, saisis aussi le mot de passe d'application.");
        await window.desk.mailTest();
        toast('Connexion Gmail réussie, envoi prêt');
      } catch (err) { toast(ipcMsg(err), 'err'); }
      renderMailCard();
    });
    const t = $('#mtest');
    if (t) t.addEventListener('click', async () => { try { await window.desk.mailTest(); toast('Connexion Gmail réussie'); } catch (err) { toast(ipcMsg(err), 'err'); } });
    const c = $('#mclear');
    if (c) c.addEventListener('click', async () => { if (confirm("Retirer l'envoi d'e-mails sur cet ordinateur ?")) { await window.desk.mailClear(); renderMailCard(); } });
  }
  async function renderUpdCard() {
    const info = state.appInfo || await window.desk.appVersion();
    $('#updcard').innerHTML = `<h2>Mises à jour de l'application</h2>
      <div class="muted" style="margin-bottom:12px">Version installée : <b style="color:var(--text)">${esc(info.version)}</b>${info.packaged ? '' : ' (mode développement)'}</div>
      ${state.isAdmin ? `<form id="uf" class="form"><div class="field full"><label>Adresse du serveur de mises à jour (laisser vide = adresse habituelle de Dayan 3D)</label><input name="url" value="${esc(co.update_url || '')}" placeholder="${DEFAULT_UPDATE_URL}"></div>
        <div class="form-actions"><span></span><div><button class="btn primary">Enregistrer l'adresse</button></div></div></form>` : `<div class="muted" style="margin-bottom:10px">L'adresse est réglée par l'administrateur.</div>`}
      <div style="margin-top:10px"><button class="btn" id="updchk">Rechercher une mise à jour</button> <span id="updstatus" class="muted" style="margin-left:10px">${updateStatusText()}</span></div>
      <div class="hint">L'appli cherche toute seule au démarrage puis toutes les 4 heures. Quand une nouvelle version est prête, un bouton « Redémarrer et installer » apparaît en bas du menu.</div>`;
    const uf = $('#uf');
    if (uf) uf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = uf.elements.url.value.trim();
      try {
        if (url && !/^https:\/\//.test(url)) throw new Error('Adresse invalide : elle doit commencer par https://');
        await ok(sb.from('company_settings').update({ update_url: url || null }).eq('id', 1));
        co.update_url = url || null; state.company = { ...state.company, update_url: url || null };
        if (url) await window.desk.updateConfigure(url);
        toast('Adresse enregistrée');
      } catch (err) { toast(/update_url/.test(err.message || '') ? "Lance d'abord le fichier 11-mises-a-jour.sql dans Supabase." : ipcMsg(err), 'err'); }
    });
    $('#updchk').addEventListener('click', async () => {
      try { state.update = { state: 'checking' }; $('#updstatus').innerHTML = updateStatusText(); await window.desk.updateCheck(); }
      catch (err) { state.update = { state: 'error', message: ipcMsg(err) }; $('#updstatus').innerHTML = updateStatusText(); }
    });
  }
  renderUpdCard();
  renderMailCard();
  if (state.isAdmin) {
    try {
      const dels = await must(sb.from('invoice_deletions').select('*').order('deleted_at', { ascending: false }).limit(30));
      $('#delcard').innerHTML = `<div class="card" style="margin-bottom:16px"><h2>Factures supprimées (journal)</h2>${dels.length
        ? `<table><thead><tr><th>Numéro</th><th>Client</th><th class="r">Montant</th><th>Supprimée le</th><th>Par</th></tr></thead><tbody>${dels.map((x) => `<tr><td><b>${esc(x.invoice_number)}</b></td><td>${esc(x.client_name || '—')}</td><td class="r mono">${chf(x.total)}</td><td>${fmtTs(x.deleted_at)}</td><td class="muted">${esc(x.deleted_by_email || '')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="muted">Aucune facture supprimée.</div>'}</div>`;
    } catch { /* journal pas encore installé : on n'affiche rien */ }
  }
  const cf = $('#cf');
  if (state.isAdmin) cf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {}; F.forEach(([k]) => { data[k] = cf.elements[k].value.trim(); });
    if (data.iban) {
      const n = normIban(data.iban);
      if (!validSwissIban(n)) { toast("IBAN invalide : il doit être suisse ou liechtensteinois (CH… ou LI…, 21 caractères) et correct.", 'err'); return; }
      data.iban = n;
    } else data.iban = null;
    try { await ok(sb.from('company_settings').update(data).eq('id', 1)); state.company = { ...co, ...data }; toast('Paramètres enregistrés'); } catch (err) { toast(/iban/i.test(err.message || '') ? "Lance d'abord le fichier 13-qr-facture.sql dans Supabase." : err.message, 'err'); }
  });
  // ----- Numérotation et délais (administrateur) -----
  async function renderNumCard() {
    if (!state.isAdmin) return;
    const c = state.company || co;
    let nextF, nextD;
    try {
      nextF = await must(sb.rpc('peek_next_number', { p_kind: 'FA' }));
      nextD = await must(sb.rpc('peek_next_number', { p_kind: 'DE' }));
    } catch {
      $('#numcard').innerHTML = `<h2>Numérotation et délais de paiement</h2><div class="muted">Pas encore installé : lance le fichier <b>19-facturation-avancee.sql</b> dans Supabase (SQL Editor).</div>`;
      return;
    }
    const lastNum = (str) => parseInt(String(str).split('-').pop(), 10) || 1;
    const initF = parseInt(String(nextF).split('-').pop(), 10) || 1, initD = parseInt(String(nextD).split('-').pop(), 10) || 1;
    const fmtNum = (prefix, reset, digits, n) => `${prefix}-${reset === 'yearly' ? new Date().getFullYear() + '-' : ''}${String(n).padStart(digits, '0')}`;
    const mode = c.pay_term_mode || 'eom', days = c.pay_term_days != null ? c.pay_term_days : 30;
    $('#numcard').innerHTML = `<h2>Numérotation et délais de paiement</h2>
      <form id="nf" class="form">
        <div class="field"><label>Délai de paiement général</label><select name="mode"><option value="eom" ${mode === 'eom' ? 'selected' : ''}>Fin de mois + N jours</option><option value="net" ${mode === 'net' ? 'selected' : ''}>N jours nets</option></select></div>
        <div class="field"><label>Nombre de jours</label><input name="days" inputmode="numeric" value="${esc(days)}"></div>
        <div class="field"><label>Préfixe des factures</label><input name="pf" maxlength="10" value="${esc(c.number_prefix_invoice || 'FA')}"></div>
        <div class="field"><label>Préfixe des devis</label><input name="pq" maxlength="10" value="${esc(c.number_prefix_quote || 'DE')}"></div>
        <div class="field"><label>Remise à zéro du compteur</label><select name="reset"><option value="yearly" ${(c.number_reset || 'yearly') === 'yearly' ? 'selected' : ''}>Chaque année (FA-2026-0001)</option><option value="never" ${c.number_reset === 'never' ? 'selected' : ''}>Jamais (FA-0001)</option></select></div>
        <div class="field"><label>Nombre de chiffres du numéro</label><select name="digits">${[3, 4, 5, 6].map((n) => `<option value="${n}" ${(c.number_digits || 4) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Prochain numéro de facture</label><input name="nf" inputmode="numeric" value="${lastNum(nextF)}"></div>
        <div class="field"><label>Prochain numéro de devis</label><input name="nq" inputmode="numeric" value="${lastNum(nextD)}"></div>
        ${'membership_fee' in c ? `<div class="field"><label>Cotisation annuelle par défaut (CHF)</label><input name="fee" inputmode="decimal" value="${esc(c.membership_fee || 0)}"></div>` : ''}
        <div class="field full muted" id="numprev"></div>
        <div class="form-actions"><span></span><button class="btn primary">Enregistrer</button></div></form>
      <div class="hint">Le délai s'applique aux nouvelles factures (un client peut avoir son propre délai dans sa fiche). Pour continuer la numérotation de tes anciennes factures, mets le numéro suivant ici : par exemple 151. Un numéro déjà utilisé est refusé automatiquement.</div>`;
    const f = $('#nf').elements;
    const prev = () => { $('#numprev').innerHTML = `Exemples : <b style="color:var(--text)">${esc(fmtNum(f.pf.value || 'FA', f.reset.value, Number(f.digits.value), num(f.nf.value) || 1))}</b> · <b style="color:var(--text)">${esc(fmtNum(f.pq.value || 'DE', f.reset.value, Number(f.digits.value), num(f.nq.value) || 1))}</b> · délai : <b style="color:var(--text)">${esc(termsLabel({ mode: f.mode.value, days: num(f.days.value) }))}</b>`; };
    $('#nf').querySelectorAll('input,select').forEach((el) => el.addEventListener('input', prev)); prev();
    $('#nf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok1 = /^[A-Za-z0-9_-]{1,10}$/;
      if (!ok1.test(f.pf.value) || !ok1.test(f.pq.value)) { toast('Préfixes : lettres, chiffres, - ou _ (10 caractères au maximum).', 'err'); return; }
      const dd = Math.round(num(f.days.value));
      if (dd < 0 || dd > 365) { toast('Le délai doit être entre 0 et 365 jours.', 'err'); return; }
      try {
        const row = { pay_term_mode: f.mode.value, pay_term_days: dd, number_prefix_invoice: f.pf.value.trim(), number_prefix_quote: f.pq.value.trim(), number_reset: f.reset.value, number_digits: Number(f.digits.value), ...(f.fee ? { membership_fee: Math.max(0, num(f.fee.value)) } : {}) };
        await ok(sb.from('company_settings').update(row).eq('id', 1));
        state.company = { ...state.company, ...row }; Object.assign(co, row);
        const wantF = Math.round(num(f.nf.value)), wantD = Math.round(num(f.nq.value));
        if (wantF >= 1 && wantF !== initF) await ok(sb.rpc('set_next_number', { p_kind: 'FA', p_next: wantF }));
        if (wantD >= 1 && wantD !== initD) await ok(sb.rpc('set_next_number', { p_kind: 'DE', p_next: wantD }));
        toast('Numérotation et délai enregistrés'); renderNumCard();
      } catch (err) { toast(err.message || String(err), 'err'); }
    });
  }
  renderNumCard();
  // ----- Diagnostic -----
  if (state.isAdmin) {
    $('#diagcard').innerHTML = `<h2>Diagnostic</h2><div class="muted" style="margin-bottom:12px">Vérifie en une minute ce qui est installé et ce qui manque : sécurité, base de données, fonctions du serveur, e-mails, mises à jour. Rien n'est modifié.</div>
      <button class="btn primary" id="diagrun">Lancer le diagnostic</button><div id="diagout" style="margin-top:12px"></div>`;
    $('#diagrun').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.setAttribute('disabled', ''); b.textContent = 'Vérification en cours…';
      try { renderDiagResult($('#diagout'), await runDiagnostics()); } catch (e) { toast(e.message || String(e), 'err'); }
      b.removeAttribute('disabled'); b.textContent = 'Relancer le diagnostic';
    });
  }
  // ----- Mon compte -----
  $('#acctcard').innerHTML = `<h2>Mon compte</h2><div class="muted" style="margin-bottom:12px">Connecté : <b style="color:var(--text)">${esc(state.profile.email)}</b></div>
    <form id="pwf" class="form"><div class="field"><label>Nouveau mot de passe (8 caractères minimum)</label><input name="p1" type="password" autocomplete="new-password" required></div>
      <div class="field"><label>Répète-le</label><input name="p2" type="password" autocomplete="new-password" required></div>
      <div class="form-actions"><span></span><button class="btn primary">Changer mon mot de passe</button></div></form>`;
  $('#pwf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.p1.value.length < 8) { toast('Le mot de passe doit faire au moins 8 caractères.', 'err'); return; }
    if (f.p1.value !== f.p2.value) { toast('Les deux mots de passe ne sont pas identiques.', 'err'); return; }
    const { error } = await sb.auth.updateUser({ password: f.p1.value });
    if (error) { toast(error.message, 'err'); return; }
    e.target.reset(); toast('Mot de passe changé');
  });
  // ----- Notifications -----
  $('#notifcard').innerHTML = `<h2>Notifications Windows</h2>
    <div class="field check" style="margin-bottom:8px"><input type="checkbox" id="notifon" ${localStorage.getItem('dayan_notif') === 'off' ? '' : 'checked'}><label for="notifon">Me prévenir quand un paiement arrive (l'appli doit être ouverte, même réduite)</label></div>
    <button class="btn" id="notiftest">Tester la notification</button><div class="hint">Ce réglage vaut pour cet ordinateur. L'appli vérifie les nouveaux paiements chaque minute.</div>`;
  $('#notifon').addEventListener('change', (e) => { localStorage.setItem('dayan_notif', e.target.checked ? 'on' : 'off'); toast(e.target.checked ? 'Notifications activées' : 'Notifications désactivées'); });
  $('#notiftest').addEventListener('click', () => window.desk.notify('Dayan 3D', 'Les notifications fonctionnent sur cet ordinateur.', null));
  // ----- Utilisateurs (administrateur) -----
  const invokeUsers = async (body) => {
    const { data, error } = await sb.functions.invoke('manage-users', { body });
    if (error) throw new Error(await fnError(error));
    if (data?.error) throw new Error(data.error);
    return data;
  };
  const showCreds = (title, email, password) => {
    const m = modal(title, `<div class="muted" style="margin-bottom:10px">Note-le maintenant : le mot de passe ne sera plus affiché.</div>
      <div class="card" style="background:var(--panel2);margin-bottom:12px"><div class="muted">E-mail</div><div style="font-size:16px"><b>${esc(email)}</b></div><div class="muted" style="margin-top:10px">Mot de passe temporaire</div><div style="font-size:20px;letter-spacing:.5px"><b id="cpw">${esc(password)}</b></div></div>
      <div class="actions"><button class="btn primary" id="cpcopy">Copier le mot de passe</button><button class="btn ghost" data-close>Fermer</button></div>
      <div class="hint">La personne se connecte avec ces informations, puis change son mot de passe dans Paramètres > Mon compte.</div>`);
    $('#cpcopy', m.el).addEventListener('click', async () => { await navigator.clipboard.writeText(password); toast('Mot de passe copié'); });
  };
  const inv = $('#inviteu');
  if (inv) inv.addEventListener('click', () => {
    const m = modal('Ajouter un collaborateur', `<form class="form" id="iu">
      <div class="field"><label>Nom complet</label><input name="full_name" required></div>
      <div class="field"><label>E-mail</label><input name="email" type="email" required></div>
      <div class="field"><label>Mot de passe temporaire (8 caractères minimum)</label><input name="password" value="${genPassword()}" required></div>
      <div class="field"><label>Rôle</label><select name="role"><option value="collaborateur">Collaborateur</option><option value="admin">Administrateur</option></select></div>
      <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary" id="iugo">Créer le compte</button></div></div></form>`);
    $('#iu', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements, b = $('#iugo', m.el);
      b.setAttribute('disabled', ''); b.textContent = 'Création…';
      try {
        await invokeUsers({ action: 'create', full_name: f.full_name.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value });
        const email = f.email.value.trim(), pw = f.password.value;
        m.close(); showCreds('Compte créé', email, pw); go('settings');
      } catch (err) { b.removeAttribute('disabled'); b.textContent = 'Créer le compte'; toast(err.message || String(err), 'err'); }
    });
  });
  document.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => {
    const u = users.find((x) => x.id === b.dataset.pw);
    const m = modal('Nouveau mot de passe', `<form class="form" id="pf2"><div class="field full"><label>Nouveau mot de passe temporaire pour ${esc(u.full_name || u.email)}</label><input name="password" value="${genPassword()}" required></div>
      <div class="form-actions"><span></span><div><button type="button" class="btn ghost" data-close>Annuler</button> <button class="btn primary" id="pfgo">Enregistrer</button></div></div></form>`);
    $('#pf2', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = e.target.elements.password.value, bt = $('#pfgo', m.el);
      bt.setAttribute('disabled', ''); bt.textContent = 'Enregistrement…';
      try { await invokeUsers({ action: 'set_password', user_id: u.id, password: pw }); m.close(); showCreds('Mot de passe changé', u.email, pw); }
      catch (err) { bt.removeAttribute('disabled'); bt.textContent = 'Enregistrer'; toast(err.message || String(err), 'err'); }
    });
  }));
  document.querySelectorAll('[data-onoff]').forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === b.dataset.onoff), enable = b.dataset.on === '1';
    if (!confirm(enable ? `Réactiver le compte de ${u.full_name || u.email} ?` : `Désactiver le compte de ${u.full_name || u.email} ? Cette personne ne pourra plus se connecter.`)) return;
    try { await invokeUsers({ action: enable ? 'enable' : 'disable', user_id: u.id }); toast(enable ? 'Compte réactivé' : 'Compte désactivé'); go('settings'); }
    catch (err) { toast(err.message || String(err), 'err'); }
  }));
  document.querySelectorAll('[data-u]').forEach((s) => s.addEventListener('change', async () => {
    try { await ok(sb.from('profiles').update({ role: s.value }).eq('id', s.dataset.u)); toast('Rôle mis à jour'); } catch (err) { toast(err.message, 'err'); }
  }));
};

/* ============================================================
   Démarrage
   ============================================================ */
async function boot() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin();
    await loadContext();
    renderShell();
    initUpdates();
    startPaymentWatcher();
    renderUpdateBanner();
    go('dashboard');
  } catch (e) {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><h1>Erreur</h1><p>${esc(e.message || e)}</p><button class="btn" id="rl">Se reconnecter</button></div></div>`;
    $('#rl').addEventListener('click', async () => { await sb.auth.signOut(); renderLogin(); });
  }
}
boot();
})();
