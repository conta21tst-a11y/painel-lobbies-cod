const SUPABASE_URL = 'https://pvutnqjbkkmbhhlycbci.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Lc1gwDHdoAGS8Itbg6bZ6A_9Dc0Blqb';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let profile = null;
let availability = [];
let lobbies = [];
let members = [];
let profiles = [];

function showMessage(text, isError = false) {
  const notice = $('#notice');
  notice.textContent = text;
  notice.style.display = 'block';
  notice.style.borderColor = isError ? '#9d3a3a' : '#276d52';
  notice.style.background = isError ? '#351b20' : '#112b22';
  notice.style.color = isError ? '#ffd0d0' : '#a8f4c9';
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { notice.style.display = 'none'; }, 5000);
}

function localDateTime(time) {
  const now = new Date();
  const [hour, minute] = time.split(':').map(Number);
  now.setHours(hour, minute, 0, 0);
  return now;
}

function statusFor(item) {
  if (!item || item.cancelled_at) return 'offline';
  const now = Date.now();
  const scheduled = new Date(item.scheduled_at).getTime();
  const confirmed = item.confirmed_at && new Date(item.confirmed_at).getTime();
  if (confirmed && now - confirmed < 30 * 60 * 1000) return 'online';
  if (now < scheduled) return 'scheduled';
  if (now <= scheduled + 30 * 60 * 1000) return 'late';
  return 'offline';
}

function timeOnly(dateValue) {
  return new Date(dateValue).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function currentTimeValue() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function onlineCountdown(item) {
  if (!item?.confirmed_at) return '';
  const remaining = Math.max(0, (new Date(item.confirmed_at).getTime() + 30 * 60 * 1000) - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

async function ensureAnonymousUser() {
  const { data: { session } } = await db.auth.getSession();
  if (session) return session.user;
  const { data, error } = await db.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

async function loadData() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [profileResult, availabilityResult, lobbyResult, memberResult] = await Promise.all([
    db.from('profiles').select('*').order('gamer_tag'),
    db.from('availability').select('*').gte('scheduled_at', start.toISOString()).order('scheduled_at'),
    db.from('lobbies').select('*').order('created_at', { ascending: true }),
    db.from('lobby_members').select('*')
  ]);
  const error = profileResult.error || availabilityResult.error || lobbyResult.error || memberResult.error;
  if (error) throw error;
  profiles = profileResult.data;
  availability = availabilityResult.data;
  lobbies = lobbyResult.data;
  members = memberResult.data;
  profile = profiles.find((item) => item.user_id === currentUser.id) || null;
  render();
}

function todayAvailability(userId) {
  return availability.find((item) => item.user_id === userId && !item.cancelled_at) || null;
}

function ownAvailabilityRecord() {
  return availability.find((item) => item.user_id === currentUser.id) || null;
}

function playerName(userId) {
  return profiles.find((item) => item.user_id === userId)?.gamer_tag || 'Jogador';
}

function playerMeta(userId) {
  const item = profiles.find((profileItem) => profileItem.user_id === userId);
  return item ? `${item.platform} • ${item.uses_mic ? 'com mic' : 'sem mic'}` : '';
}

function activeLobbyFor(userId) {
  return lobbies.find((lobby) => ['open', 'closed'].includes(lobby.status)
    && members.some((member) => member.lobby_id === lobby.id && member.user_id === userId));
}

function renderProfile() {
  const saved = Boolean(profile);
  $('#profileForm').classList.toggle('hidden', saved);
  $('#actions').classList.toggle('hidden', !saved);
  $('#profileBox').classList.toggle('hidden', !saved);
  $('#createLobby').classList.toggle('hidden', !saved);
  if (!saved) return;
  const ownLobby = activeLobbyFor(currentUser.id);
  const ownAvailability = todayAvailability(currentUser.id);
  const playerState = ownLobby ? 'EM LOBBY' : (statusFor(ownAvailability) === 'online' ? 'ONLINE' : 'OFFLINE');
  $('#profileBox').innerHTML = `<div class="profile-head"><b>${escapeHtml(profile.gamer_tag)} <span class="pill">LOGADO • ${playerState}</span></b><button id="signOutProfile" class="leave small">SAIR</button></div><small>${escapeHtml(profile.platform)} • ${escapeHtml(profile.favorite_mode)} • ${profile.uses_mic ? 'com mic' : 'sem mic'}</small>${ownLobby ? '<small>Você está em um lobby. Saia dele antes de encerrar seu perfil.</small>' : ''}`;
  $('#currentMode').value = profile.favorite_mode;
  $('#today').value = ownAvailability
    ? timeOnly(ownAvailability.scheduled_at)
    : (profile.default_play_time ? profile.default_play_time.slice(0, 5) : currentTimeValue());
  $('#signOutProfile').addEventListener('click', () => signOutProfile().catch((error) => showMessage(error.message, true)));
}

function renderOnline() {
  const onlinePlayers = profiles.map((item) => ({ profile: item, availability: todayAvailability(item.user_id), lobby: activeLobbyFor(item.user_id) }))
    .filter(({ availability: item, lobby }) => statusFor(item) === 'online' || lobby);
  $('#onlineCount').textContent = `${onlinePlayers.length} online`;
  $('#onlineList').innerHTML = onlinePlayers.length ? onlinePlayers.map(({ profile: item, availability: itemAvailability, lobby }) => `
    <div class="slot"><span class="status confirmed">${lobby ? 'EM LOBBY' : 'ONLINE'}</span><strong>${escapeHtml(item.gamer_tag)}</strong>
      <p>${escapeHtml(lobby ? lobby.game_mode : item.favorite_mode)} • ${item.uses_mic ? 'com mic' : 'sem mic'} • ${lobby ? 'jogando em squad' : `online por mais <span class="online-countdown" data-confirmed-at="${itemAvailability.confirmed_at}">${onlineCountdown(itemAvailability)}</span>`}</p></div>`).join('')
    : '<div class="empty">Ninguém confirmou presença agora.</div>';
}

function renderSchedule() {
  const entries = profiles.map((item) => ({ profile: item, availability: todayAvailability(item.user_id), lobby: activeLobbyFor(item.user_id) }))
    .filter(({ availability: item, lobby }) => !lobby && ['scheduled', 'late'].includes(statusFor(item)))
    .sort((first, second) => new Date(first.availability.scheduled_at) - new Date(second.availability.scheduled_at));
  $('#scheduleList').innerHTML = entries.length ? entries.map(({ profile: item, availability: itemAvailability }) => {
    const state = statusFor(itemAvailability);
    const label = state === 'late' ? 'TOLERÂNCIA' : 'PREVISTO';
    const detail = state === 'late'
      ? `Aguardando até ${timeOnly(new Date(new Date(itemAvailability.scheduled_at).getTime() + 30 * 60 * 1000))}.`
      : `Previsto para hoje às ${timeOnly(itemAvailability.scheduled_at)}.`;
    return `<div class="slot"><span class="status ${state === 'late' ? 'late' : 'scheduled'}">${label}</span><strong>${escapeHtml(item.gamer_tag)}</strong><p>${escapeHtml(item.favorite_mode)} • ${detail}</p></div>`;
  }).join('') : '<div class="empty">Nenhum jogador programado para hoje.</div>';
}

function renderLobbies() {
  const now = Date.now();
  const open = lobbies.filter((item) => item.status === 'open' && new Date(item.expires_at).getTime() > now);
  const closed = lobbies.filter((item) => item.status === 'closed');
  $('#lobbyList').innerHTML = open.length ? open.map((item) => {
    const lobbyMembers = members.filter((member) => member.lobby_id === item.id);
    const alreadyInside = lobbyMembers.some((member) => member.user_id === currentUser.id);
    const isLeader = item.leader_id === currentUser.id;
    const canJoin = profile && !alreadyInside;
    const leaderName = playerName(item.leader_id);
    return `<div class="lobby live"><div class="lobby-top"><h3>${escapeHtml(item.game_mode)}</h3><span class="count">${lobbyMembers.length}/4</span></div>
      <div class="meta">Expira às ${timeOnly(item.expires_at)}</div>
      ${isLeader
        ? `<div class="player"><b>Jogador 1 — LÍDER</b><span>${escapeHtml(leaderName)}<br><span class="member-meta">${escapeHtml(playerMeta(item.leader_id))}</span></span></div>`
        : `<div class="leader-box"><small>LÍDER DO GRUPO — ADICIONE NO JOGO</small><span class="leader-id">${escapeHtml(leaderName)}</span><span class="member-meta">${escapeHtml(playerMeta(item.leader_id))}</span></div>`}
      ${lobbyMembers.filter((member) => member.user_id !== item.leader_id).map((member, index) => `<div class="player"><b>Jogador ${index + 2}</b><span>${escapeHtml(playerName(member.user_id))}<br><span class="member-meta">${escapeHtml(playerMeta(member.user_id))}</span></span></div>`).join('')}
      ${Array.from({ length: Math.max(0, 4 - lobbyMembers.length) }, (_, index) => `<div class="player vacancy"><span>Jogador ${lobbyMembers.length + index + 1}</span><span>Vaga aberta</span></div>`).join('')}
      ${canJoin ? `<button class="online small join-lobby" data-id="${item.id}">ENTRAR NESTE LOBBY</button>` : ''}
      ${alreadyInside ? `<button class="leave small leave-lobby" data-id="${item.id}">SAIR DESTE LOBBY</button>` : ''}
      ${isLeader ? '<div class="info">Você é o líder: abra o grupo/party no jogo para os outros jogadores entrarem pelo seu ID. O lobby fecha automaticamente no quarto jogador.</div>' : ''}
      ${alreadyInside && !isLeader ? `<div class="info">Adicione <b>${escapeHtml(leaderName)}</b> no jogo e entre no grupo aberto pelo líder.</div>` : ''}
      ${canJoin ? `<div class="info">Ao entrar, adicione <b>${escapeHtml(leaderName)}</b> no jogo para participar do grupo.</div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">Ainda não há lobby aberto.</div>';
  document.querySelectorAll('.join-lobby').forEach((button) => {
    button.addEventListener('click', () => joinLobby(button.dataset.id));
  });
  $('#closedList').innerHTML = closed.length ? closed.map((item) => {
    const lobbyMembers = members.filter((member) => member.lobby_id === item.id);
    return `<div class="lobby"><div class="lobby-top"><h3>${escapeHtml(item.game_mode)}</h3><span class="count">4/4</span></div>
      <div class="meta">Squad fechado às ${timeOnly(item.closed_at || item.created_at)}</div>
      ${lobbyMembers.map((member, index) => `<div class="player"><b>Jogador ${index + 1}${member.user_id === item.leader_id ? ' — LÍDER' : ''}</b><span>${escapeHtml(playerName(member.user_id))}</span></div>`).join('')}
      ${lobbyMembers.some((member) => member.user_id === currentUser.id) ? `<button class="leave small leave-lobby" data-id="${item.id}">SAIR DESTE SQUAD</button>` : ''}
    </div>`;
  }).join('') : '<div class="empty">Nenhum lobby fechado no momento.</div>';
  document.querySelectorAll('.leave-lobby').forEach((button) => {
    button.addEventListener('click', () => leaveLobby(button.dataset.id));
  });
}

function render() {
  renderProfile();
  renderOnline();
  renderSchedule();
  renderLobbies();
}

async function saveProfile(event) {
  event.preventDefault();
  const payload = {
    user_id: currentUser.id,
    gamer_tag: $('#id').value.trim(),
    platform: $('#platform').value,
    favorite_mode: $('#mode').value,
    default_play_time: $('#habit').value,
    uses_mic: $('#mic').checked,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('profiles').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  showMessage('Perfil salvo neste aparelho. Agora programe sua presença ou entre para jogar.');
  await loadData();
}

async function scheduleToday(confirmNow = false) {
  if (!profile) return;
  if (activeLobbyFor(currentUser.id)) {
    showMessage('Você já está em um lobby. Saia dele antes de programar outro horário.', true);
    return;
  }
  const planned = localDateTime($('#today').value);
  const isCurrentTime = Math.abs(Date.now() - planned.getTime()) < 90 * 1000;
  if (!confirmNow && isCurrentTime) {
    const playNow = window.confirm('Este é o horário atual. Quer entrar para jogar agora?');
    if (!playNow) {
      showMessage('Escolha um horário posterior antes de programar sua presença.');
      return;
    }
    confirmNow = true;
  }
  const own = ownAvailabilityRecord();
  const payload = { user_id: currentUser.id, scheduled_at: planned.toISOString(), confirmed_at: (confirmNow || isCurrentTime) ? new Date().toISOString() : null, cancelled_at: null };
  let result;
  if (own) result = await db.from('availability').update(payload).eq('id', own.id);
  else result = await db.from('availability').insert(payload);
  if (result.error) throw result.error;
  showMessage(confirmNow ? 'Você está online agora. A presença se encerra em 30 minutos se não houver nova confirmação.' : `Presença programada para ${$('#today').value}.`);
  await loadData();
}

async function clearToday() {
  if (activeLobbyFor(currentUser.id)) {
    showMessage('Você está em um lobby. Saia dele antes de cancelar sua presença.', true);
    return;
  }
  const own = ownAvailabilityRecord();
  if (!own) return;
  const { error } = await db.from('availability').update({ cancelled_at: new Date().toISOString(), confirmed_at: null }).eq('id', own.id);
  if (error) throw error;
  showMessage('Sua disponibilidade de hoje foi removida.');
  await loadData();
}

async function createLobby() {
  const own = todayAvailability(currentUser.id);
  if (statusFor(own) !== 'online') {
    showMessage('Confirme “Estou pronto agora” antes de criar um lobby.', true);
    return;
  }
  const { error } = await db.rpc('create_lobby', { _game_mode: profile.favorite_mode });
  if (error) throw error;
  showMessage(`Lobby de ${profile.favorite_mode} criado. Os outros jogadores já conseguem vê-lo.`);
  await loadData();
}

async function joinLobby(lobbyId) {
  const own = todayAvailability(currentUser.id);
  if (statusFor(own) !== 'online') {
    showMessage('Confirme “Estou pronto agora” antes de entrar no lobby.', true);
    return;
  }
  const { error } = await db.rpc('join_lobby', { _lobby_id: lobbyId });
  if (error) throw error;
  showMessage('Você entrou no lobby. Quando chegar a 4 jogadores, ele será fechado automaticamente.');
  await loadData();
}

async function leaveLobby(lobbyId) {
  const { error } = await db.rpc('leave_lobby', { _lobby_id: lobbyId });
  if (error) throw error;
  const own = todayAvailability(currentUser.id);
  const now = new Date().toISOString();
  const reset = { user_id: currentUser.id, scheduled_at: now, confirmed_at: now, cancelled_at: null };
  const resetResult = own
    ? await db.from('availability').update(reset).eq('id', own.id)
    : await db.from('availability').insert(reset);
  if (resetResult.error) throw resetResult.error;
  showMessage('Você saiu do squad e permanece online por mais 30 minutos.');
  await loadData();
}

async function signOutProfile() {
  if (activeLobbyFor(currentUser.id)) {
    showMessage('Saia primeiro do lobby para encerrar seu perfil neste navegador.', true);
    return;
  }
  const own = todayAvailability(currentUser.id);
  if (own) {
    const { error } = await db.from('availability')
      .update({ cancelled_at: new Date().toISOString(), confirmed_at: null })
      .eq('id', own.id);
    if (error) throw error;
  }
  const { error } = await db.auth.signOut();
  if (error) throw error;
  window.location.reload();
}

async function changeMode() {
  const { error } = await db.from('profiles')
    .update({ favorite_mode: $('#currentMode').value, updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);
  if (error) throw error;
  await loadData();
}

function subscribeRealtime() {
  db.channel('squad-agora-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobbies' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_members' }, loadData)
    .subscribe();
}

async function start() {
  try {
    $('#habit').value = currentTimeValue();
    currentUser = await ensureAnonymousUser();
    await loadData();
    subscribeRealtime();
    $('#profileForm').addEventListener('submit', (event) => saveProfile(event).catch((error) => showMessage(error.message, true)));
    $('#schedule').addEventListener('click', () => scheduleToday(false).catch((error) => showMessage(error.message, true)));
    $('#ready').addEventListener('click', () => scheduleToday(true).catch((error) => showMessage(error.message, true)));
    $('#clearToday').addEventListener('click', () => clearToday().catch((error) => showMessage(error.message, true)));
    $('#createLobby').addEventListener('click', () => createLobby().catch((error) => showMessage(error.message, true)));
    $('#currentMode').addEventListener('change', () => changeMode().catch((error) => showMessage(error.message, true)));
    setInterval(() => {
      $('#clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const countdowns = document.querySelectorAll('.online-countdown');
      let expired = false;
      countdowns.forEach((element) => {
        const remaining = onlineCountdown({ confirmed_at: element.dataset.confirmedAt });
        element.textContent = remaining;
        if (remaining === '0:00') expired = true;
      });
      if (expired) render();
    }, 1000);
    $('#clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    showMessage(`Não foi possível conectar: ${error.message}`, true);
  }
}

start();
