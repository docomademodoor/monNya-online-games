const socket = io();
const daifugoRules = window.DaifugoRules;

let myRoomId = '';
let myId = '';
let myPlayerId = localStorage.getItem('daifugo-player-id-v1') || '';
let isHost = false;
let currentHand = [];
let selectedCardIds = new Set();
let pendingSideSelection = null;
let stagedSidePlay = null;
let pendingExchangeSelection = null;
let activeJoinRequest = null;
let latestGameState = null;
let layoutPreviewMode = new URLSearchParams(window.location.search).get('preview');
let previousRoundResult = null;
const layoutPreviewModeGroups = [
  { label: 'ロビー', screens: [{ value: 'home', label: 'トップ' }, { value: 'lobby', label: '待機ロビー' }] },
  { label: '大富豪', screens: [{ value: 'game', label: '大富豪・対戦中' }, { value: 'ranking', label: '大富豪・順位確認' }, { value: 'result', label: '大富豪・対戦結果' }] },
  { label: 'チンチロ', screens: [{ value: 'chinchiro', label: 'チンチロ・対戦中' }, { value: 'chinchiro-ranking', label: 'チンチロ・順位確認' }, { value: 'chinchiro-result', label: 'チンチロ・対戦結果' }] }
];
const layoutPreviewModes = layoutPreviewModeGroups.flatMap(group => group.screens.map(screen => screen.value));
let previousFieldCards = [];
let previousFieldCardsTimer = null;
let turnCountdownInterval = null;
let diceRollAnimationTimer = null;
let diceRollAnimationInterval = null;
let isDiceRollAnimating = false;
let isChinchiroRollPressed = false;
let selectedChinchiroBetAmount = null;
let selectedChinchiroBetRound = null;
let chinchiroAwaitingRollResult = false;
let ignoreNextChinchiroRollClick = false;
let ignoreNextChinchiroRollClickTimer = null;
let animatedChinchiroPlayerId = null;
let animatedDiceResult = null;
let revealedChinchiroRollId = null;
let revealedChinchiroRollTimer = null;
let errorTimer = null;
let roomChatLoadedFor = '';
let roomChatUnreadCount = 0;
const TABLE_SEAT_GAP = 20;
// 大富豪の表示ルール。ゲームロジックではなく、画面構成を変えるときに編集する値。
const DAIFUGO_LAYOUT = Object.freeze({
  maxHandCardsPerRow: 9,
  playerSeatHeight: 112,
  compactPlayerSeatHeight: 88,
  playerSeatWidth: 104,
  compactPlayerSeatWidth: 92,
  playerCardFanWidth: 58
});
// 自分を除く相手プレイヤーの席順。配列の順番は自分から見た時計回り。
// 文字列は「行-列」で、3列3行のCSS Gridへそのまま渡す。
const DAIFUGO_OPPONENT_SEAT_PRESETS = Object.freeze({
  1: ['1-2'],
  2: ['1-1', '1-3'],
  3: ['3-1', '1-2', '3-3'],
  4: ['3-1', '1-1', '1-3', '3-3'],
  5: ['3-1', '1-1', '1-3', '3-3'],
  6: ['3-1', '2-1', '1-2', '2-3', '3-3'],
  7: ['3-1', '2-1', '1-1', '1-2', '1-3', '2-3', '3-3']
});
const CHINCHIRO_ROLL_ANIMATION_MS = 2000;
const CHINCHIRO_RESULT_REVEAL_MS = 2500;
const ROOM_CHAT_MAX_LENGTH = 200;
let chinchiroResultTimer = null;

function clearPreviousFieldCards() {
  if (previousFieldCardsTimer) clearTimeout(previousFieldCardsTimer);
  previousFieldCardsTimer = null;
  previousFieldCards = [];
  document.getElementById('previous-field-card')?.classList.remove('is-recent-clear');
  document.getElementById('field')?.classList.remove('is-recent-clear');
  document.getElementById('field')?.classList.remove('is-large-group');
}

function clearSelectionState() {
  selectedCardIds.clear();
  pendingSideSelection = null;
}

function updateRoomChatUnread() {
  const badge = document.getElementById('room-chat-unread');
  if (!badge) return;
  badge.hidden = roomChatUnreadCount === 0;
  badge.textContent = roomChatUnreadCount > 99 ? '99+' : String(roomChatUnreadCount);
}

function updateRoomChatRecent() {
  const preview = document.getElementById('room-chat-recent');
  const list = document.getElementById('room-chat-messages');
  if (!preview || !list) return;

  preview.replaceChildren();
  [...list.querySelectorAll('.room-chat-message')].slice(-2).forEach(message => {
    const senderName = message.querySelector('.room-chat-message-meta strong')?.textContent || '';
    const messageText = message.querySelector('p')?.textContent || '';
    const item = document.createElement('li');
    item.title = `${senderName}: ${messageText}`;
    const sender = document.createElement('strong');
    sender.textContent = senderName;
    const text = document.createElement('span');
    text.textContent = messageText;
    item.append(sender, text);
    preview.appendChild(item);
  });
}

function updateRoomChatPosition() {
  const root = document.getElementById('room-chat-root');
  const turnControls = document.querySelector('.turn-control-section');
  const chinchiroControls = document.querySelector('#chinchiro-board .chinchiro-controls');
  const handSection = document.querySelector('.hand-section');
  if (!root || root.hidden) return;

  if (!document.body.classList.contains('game-active')) {
    root.style.bottom = '';
    root.style.removeProperty('--room-chat-max-panel-height');
    return;
  }

  const isActionDock = !document.body.classList.contains('chinchiro-mode')
    && turnControls
    && getComputedStyle(turnControls).display !== 'none';
  root.classList.toggle('is-action-dock', !!isActionDock);

  if (isActionDock) {
    const rootControlsHeight = document.querySelector('.room-chat-controls')?.getBoundingClientRect().height || 44;
    root.style.left = '';
    root.style.right = '';
    root.style.bottom = '';
    root.style.setProperty('--room-chat-max-panel-height', `${Math.max(160, Math.floor(window.innerHeight - rootControlsHeight - 24))}px`);
    return;
  }

  root.classList.remove('is-action-dock');
  root.style.left = '';
  root.style.right = '';

  const controlSection = document.body.classList.contains('chinchiro-mode')
    ? chinchiroControls
    : turnControls;
  const anchorTop = controlSection && getComputedStyle(controlSection).display !== 'none'
    ? controlSection.getBoundingClientRect().top
    : handSection?.getBoundingClientRect().top;
  if (anchorTop === undefined) {
    root.style.bottom = '';
    root.style.removeProperty('--room-chat-max-panel-height');
    return;
  }

  const controlsHeight = document.querySelector('.room-chat-controls')?.getBoundingClientRect().height || 48;
  const maxPanelHeight = Math.max(160, Math.floor(anchorTop - controlsHeight - 32));
  root.style.setProperty('--room-chat-max-panel-height', `${maxPanelHeight}px`);
  root.style.bottom = `${Math.max(8, window.innerHeight - anchorTop + 12)}px`;
}

function scheduleRoomChatPosition() {
  window.requestAnimationFrame(updateRoomChatPosition);
}

function setRoomChatOpen(isOpen) {
  const panel = document.getElementById('room-chat-panel');
  const toggle = document.getElementById('room-chat-toggle');
  if (!panel || !toggle) return;

  panel.hidden = !isOpen;
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'チャットを閉じる' : 'チャットを開く');
  toggle.title = isOpen ? 'チャットを閉じる' : 'チャットを開く';
  if (isOpen) {
    roomChatUnreadCount = 0;
    updateRoomChatUnread();
    const messages = document.getElementById('room-chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    document.getElementById('room-chat-input')?.focus({ preventScroll: true });
  }
  scheduleRoomChatPosition();
}

function setRoomChatRoom(roomId) {
  const root = document.getElementById('room-chat-root');
  if (!root) return;
  if (!roomId) {
    root.hidden = true;
    setRoomChatOpen(false);
    roomChatLoadedFor = '';
    roomChatUnreadCount = 0;
    updateRoomChatUnread();
    document.getElementById('room-chat-messages')?.replaceChildren();
    document.getElementById('room-chat-recent')?.replaceChildren();
    document.getElementById('room-chat-status').textContent = '';
    return;
  }

  root.hidden = false;
  if (roomChatLoadedFor === roomId) return;
  setRoomChatOpen(false);
  roomChatLoadedFor = roomId;
  roomChatUnreadCount = 0;
  updateRoomChatUnread();
  document.getElementById('room-chat-room-label').textContent = `ルーム ${roomId}`;
  document.getElementById('room-chat-messages')?.replaceChildren();
  document.getElementById('room-chat-recent')?.replaceChildren();
  document.getElementById('room-chat-status').textContent = '';
  socket.emit('room-chat-history-request', roomId);
  scheduleRoomChatPosition();
}

function appendRoomChatMessage(message) {
  const list = document.getElementById('room-chat-messages');
  if (!list) return;

  const item = document.createElement('li');
  item.className = `room-chat-message${message.senderId === socket.id ? ' is-mine' : ''}`;
  const meta = document.createElement('div');
  meta.className = 'room-chat-message-meta';
  const sender = document.createElement('strong');
  sender.textContent = message.senderName;
  const time = document.createElement('time');
  const timestamp = new Date(Number(message.sentAt) || Date.now());
  time.dateTime = timestamp.toISOString();
  time.textContent = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p');
  text.textContent = message.text;
  meta.append(sender, time);
  item.append(meta, text);
  list.appendChild(item);
  while (list.children.length > 50) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
  updateRoomChatRecent();
}

function updateRoomChatComposer() {
  const input = document.getElementById('room-chat-input');
  const submit = document.getElementById('room-chat-submit');
  const count = document.getElementById('room-chat-count');
  if (!input || !submit || !count) return;
  const characterCount = Array.from(input.value.trim()).length;
  count.textContent = `${characterCount} / ${ROOM_CHAT_MAX_LENGTH}`;
  submit.disabled = characterCount === 0 || characterCount > ROOM_CHAT_MAX_LENGTH;
  document.getElementById('room-chat-status').textContent = '';
}

function submitRoomChat(event) {
  event.preventDefault();
  const input = document.getElementById('room-chat-input');
  const status = document.getElementById('room-chat-status');
  const text = input?.value.trim() || '';
  const characterCount = Array.from(text).length;
  if (!myRoomId || !text || characterCount > ROOM_CHAT_MAX_LENGTH) return;
  socket.emit('room-chat-send', { roomId: myRoomId, text });
  input.value = '';
  updateRoomChatComposer();
  input.focus({ preventScroll: true });
  if (status) status.textContent = '';
}

document.getElementById('room-chat-toggle')?.addEventListener('click', () => {
  setRoomChatOpen(document.getElementById('room-chat-panel').hidden);
});
document.getElementById('room-chat-close')?.addEventListener('click', () => setRoomChatOpen(false));
document.getElementById('room-chat-form')?.addEventListener('submit', submitRoomChat);
document.getElementById('room-chat-input')?.addEventListener('input', updateRoomChatComposer);
document.getElementById('room-chat-input')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('room-chat-form').requestSubmit();
  }
});

socket.on('room-chat-history', ({ roomId, messages = [] } = {}) => {
  if (roomId !== myRoomId || roomChatLoadedFor !== roomId) return;
  const list = document.getElementById('room-chat-messages');
  list.replaceChildren();
  messages.forEach(appendRoomChatMessage);
});

socket.on('room-chat-message', message => {
  if (message.roomId !== myRoomId) return;
  appendRoomChatMessage(message);
  if (document.getElementById('room-chat-panel').hidden && message.senderId !== socket.id) {
    roomChatUnreadCount++;
    updateRoomChatUnread();
  }
});

socket.on('room-chat-error', message => {
  document.getElementById('room-chat-status').textContent = message;
});

window.addEventListener('resize', scheduleRoomChatPosition);
if (typeof ResizeObserver !== 'undefined') {
  const roomChatPositionObserver = new ResizeObserver(scheduleRoomChatPosition);
  ['.turn-control-section', '.chinchiro-controls', '.hand-section'].forEach(selector => {
    const section = document.querySelector(selector);
    if (section) roomChatPositionObserver.observe(section);
  });
}

const RECOVERY_KEY = 'daifugo-room-recovery-v1';
let hasSocketConnected = false;
let roomSyncSocketId = '';

function rejoinActiveRoom() {
  if (!socket.connected || !myRoomId || !myPlayerId || roomSyncSocketId === socket.id) return;

  let recovery = {};
  try {
    recovery = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '{}');
  } catch (error) {
    console.warn('再接続情報の読み込みに失敗しました:', error);
  }

  const playerName = recovery.roomId === myRoomId
    ? recovery.playerName
    : document.getElementById('join-player-name')?.value
      || document.getElementById('create-player-name')?.value;
  if (!playerName) return;

  roomSyncSocketId = socket.id;
  socket.emit('join-room', { roomId: myRoomId, playerName, playerId: myPlayerId });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) rejoinActiveRoom();
});

window.addEventListener('pageshow', rejoinActiveRoom);

const RULE_LABELS = {
  eightCut: '8切り',
  revolution: '革命',
  suitLock: 'マーク縛り',
  spe3: 'スペ3返し',
  staircase: '階段',
  staircaseRevolution: '階段革命',
  elevenBack: 'Jバック',
  numberLock: '数字縛り',
  completeLock: '完縛り',
  fiveSkip: '5飛び',
  sevenPass: '7渡し',
  tenDiscard: '10捨て',
  forbiddenFinish: '禁止上がり',
  miyakoOchi: '都落ち',
  dia3Start: '♢3スタート',
  includeJoker: 'ジョーカー'
};

const RULE_DETAILS = {
  eightCut: '8を含むカードを出すと場が流れ、出した人から再開します。',
  revolution: '4枚以上を同時に出すと、カードの強さが逆転します。',
  suitLock: '同じマークが続くと、場が流れるまで同じマークでしか出せません。',
  spe3: 'ジョーカー1枚の場に♠3を出すと、場を流せます。',
  staircase: '同じマークの連続した数字を3枚以上まとめて出せます。',
  staircaseRevolution: '同じマークの階段を4枚以上出すと、革命が起きます。',
  elevenBack: 'Jを出すと、場が流れるまでカードの強さが反転します。',
  numberLock: '同じ枚数で数字が連続すると、次の数字だけ出せます。',
  completeLock: '数字縛りに加えて、続く出し札は同じマーク構成にします。',
  fiveSkip: '5を出した枚数分、次の人を飛ばします。全員を飛ばすと自分に戻ります。',
  sevenPass: '7を出すと、出した枚数分の手札を次の人へ渡します。',
  tenDiscard: '10を出した枚数分、手札から選んで捨てます。',
  forbiddenFinish: 'ルールで指定された禁止カードで上がると、反則になります。',
  miyakoOchi: '前回の大富豪が次のゲームでトップを取れないと、大貧民に転落します。',
  dia3Start: '初回は♦3を持っている人から始まります。',
  includeJoker: 'ジョーカーを1枚加えてゲームを行います。'
};

const FIXED_RULE_KEYS = new Set([
  'eightCut',
  'revolution',
  'suitLock',
  'spe3',
  'forbiddenFinish',
  'miyakoOchi',
  'dia3Start',
  'includeJoker'
]);

const SWITCHABLE_RULE_KEYS = [
  'staircase',
  'staircaseRevolution',
  'completeLock',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'tenDiscard',
  'elevenBack'
];

const RULE_DISPLAY_ORDER = [
  'revolution',
  'suitLock',
  'spe3',
  'staircase',
  'staircaseRevolution',
  'forbiddenFinish',
  'miyakoOchi',
  'dia3Start',
  'includeJoker',
  'completeLock',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'tenDiscard',
  'elevenBack',
  'eightCut'
];

const RULE_DISPLAY_ORDER_INDEX = new Map(
  RULE_DISPLAY_ORDER.map((key, index) => [key, index])
);

function sortRulesForDisplay(items) {
  return [...items].sort((left, right) =>
    (RULE_DISPLAY_ORDER_INDEX.get(left.key ?? left) ?? Number.MAX_SAFE_INTEGER)
      - (RULE_DISPLAY_ORDER_INDEX.get(right.key ?? right) ?? Number.MAX_SAFE_INTEGER)
  );
}

function updateLockRuleSelection(ruleKey) {
  const otherRuleKey = ruleKey === 'numberLock' ? 'completeLock' : 'numberLock';
  const selectedRule = document.getElementById(`rule-${ruleKey}`);
  const otherRule = document.getElementById(`rule-${otherRuleKey}`);
  if (selectedRule?.checked && otherRule) otherRule.checked = false;
}

const ROLE_CLASSES = {
  '大富豪': 'role-daifugo',
  '富豪': 'role-fugo',
  '平民': 'role-heimin',
  '貧民': 'role-hinmin',
  '大貧民': 'role-daihinmin'
};

const ROLE_POINTS = {
  '大富豪': 3,
  '富豪': 2,
  '平民': 0,
  '貧民': -1,
  '大貧民': -2
};

const CPU_DIFFICULTY_LABELS = {
  easy: 'かんたん',
  normal: 'ふつう',
  hard: '強い',
  strongest: '最強（記憶）'
};

const GAME_LABELS = {
  daifugo: '大富豪',
  chinchiro: 'チンチロ'
};

function getRoleBadge(role) {
  if (!role) return '';
  return `<span class="role-badge ${ROLE_CLASSES[role] || ''}">${role}</span>`;
}
function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function getOpponentSeatSlot(totalPlayerCount, index) {
  const opponentCount = Math.max(1, totalPlayerCount - 1);
  const preset = DAIFUGO_OPPONENT_SEAT_PRESETS[opponentCount]
    || DAIFUGO_OPPONENT_SEAT_PRESETS[8];
  return preset[Math.min(index, preset.length - 1)];
}

function getLeftTurnOpponentOrder(players, currentPlayerId) {
  const currentPlayerIndex = players.findIndex(player => player.id === currentPlayerId);
  if (currentPlayerIndex < 0) return players.filter(player => player.id !== currentPlayerId);

  return [
    ...players.slice(currentPlayerIndex + 1),
    ...players.slice(0, currentPlayerIndex)
  ];
}

socket.on('connect', () => {
  const isReconnect = hasSocketConnected;
  hasSocketConnected = true;
  myId = socket.id;
  roomSyncSocketId = '';
  console.log('Socket接続成功: ID =', myId);
  if (isLayoutPreviewEnabled()) {
    renderLayoutPreview();
    return;
  }
  if (isReconnect) rejoinActiveRoom();
});

// エラー表示処理（アラートを使わずページ上に表示）
function showError(msg) {
  const isGameVisible = document.getElementById('game-container').style.display !== 'none';
  const targetElement = isGameVisible 
    ? document.getElementById('game-error') 
    : document.getElementById('lobby-error');

  if (!targetElement) return;

  targetElement.innerText = msg;
  targetElement.style.display = 'block';

  if (errorTimer) clearTimeout(errorTimer);

  errorTimer = setTimeout(() => {
    targetElement.style.display = 'none';
  }, 4000);
}

function clearError() {
  const gameError = document.getElementById('game-error');
  const lobbyError = document.getElementById('lobby-error');
  if (gameError) gameError.style.display = 'none';
  if (lobbyError) lobbyError.style.display = 'none';
  if (errorTimer) clearTimeout(errorTimer);
}

function saveRecoveryState() {
  const roomId = (myRoomId || '').trim();
  const playerName = (
    document.getElementById('join-player-name')?.value ||
    document.getElementById('create-player-name')?.value ||
    ''
  ).trim();

  if (!roomId || !playerName) return;

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  localStorage.setItem(RECOVERY_KEY, JSON.stringify({ roomId, playerName, playerId: myPlayerId, savedAt: Date.now() }));
}

function clearRecoveryState() {
  localStorage.removeItem(RECOVERY_KEY);
}

function restoreRecoveryState() {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;

  try {
    const stored = JSON.parse(raw);
    if (!stored.roomId || !stored.playerName) return;

    myPlayerId = stored.playerId || localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);

    const joinNameInput = document.getElementById('join-player-name');
    const createNameInput = document.getElementById('create-player-name');

    if (joinNameInput) joinNameInput.value = stored.playerName;
    if (createNameInput) createNameInput.value = stored.playerName;

    const requestRestoreCheck = () => {
      socket.emit('check-room-exists', stored.roomId);
    };

    if (socket.connected) {
      requestRestoreCheck();
    } else {
      socket.once('connect', requestRestoreCheck);
    }
  } catch (error) {
    console.warn('復帰情報の読み込みに失敗しました:', error);
    clearRecoveryState();
  }
}

socket.on('room-exists', ({ roomId, exists }) => {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;

  try {
    const stored = JSON.parse(raw);
    if (!stored || !stored.roomId || stored.roomId !== roomId) return;

    if (!exists) {
      clearRecoveryState();
      return;
    }

    const shouldRestore = window.confirm('前回の部屋に再入室しますか？\n\n' + stored.roomId);
    if (shouldRestore) {
      socket.emit('join-room', { roomId: stored.roomId, playerName: stored.playerName, playerId: myPlayerId });
    } else {
      clearRecoveryState();
    }
  } catch (error) {
    console.warn('復帰確認に失敗しました:', error);
    clearRecoveryState();
  }
});

socket.on('error', (msg) => {
  console.warn('サーバーエラー受信:', msg);
  showError(msg);
});

function showJoinRequestModal(mode, data) {
  const modal = document.getElementById('join-request-modal');
  const title = document.getElementById('join-request-title');
  const message = document.getElementById('join-request-message');
  const actions = document.getElementById('join-request-actions');
  const notice = document.getElementById('join-request-notice');
  const noticeMessage = document.getElementById('join-request-notice-message');
  const noticeActions = document.getElementById('join-request-notice-actions');
  if (!modal || !title || !message || !actions || !notice || !noticeMessage || !noticeActions) return;

  activeJoinRequest = data;
  title.innerText = mode === 'host' ? '途中参加の申請' : '途中参加を申請しました';
  const requestMessage = mode === 'host'
    ? `${data.playerName} さんが途中参加を希望しています。`
    : data.message;
  message.innerText = requestMessage;
  actions.innerHTML = mode === 'host'
    ? '<button class="primary-btn" type="button" onclick="approveJoinRequest()">許可</button><button class="secondary-btn" type="button" onclick="rejectJoinRequest()">拒否</button>'
    : '<button class="secondary-btn" type="button" onclick="closeJoinRequestModal()">閉じる</button>';

  if (mode === 'host' && document.body.classList.contains('game-active')) {
    noticeMessage.textContent = requestMessage;
    noticeActions.innerHTML = '<button class="primary-btn" type="button" onclick="approveJoinRequest()">許可</button><button class="secondary-btn" type="button" onclick="rejectJoinRequest()">拒否</button>';
    notice.hidden = false;
    modal.style.display = 'none';
    return;
  }

  notice.hidden = true;
  modal.style.display = 'flex';
}

function closeJoinRequestModal() {
  const modal = document.getElementById('join-request-modal');
  const notice = document.getElementById('join-request-notice');
  if (modal) modal.style.display = 'none';
  if (notice) notice.hidden = true;
  activeJoinRequest = null;
}

function approveJoinRequest() {
  if (!activeJoinRequest) return;
  socket.emit('approve-join-request', {
    roomId: activeJoinRequest.roomId,
    requestId: activeJoinRequest.requestId
  });
}

function rejectJoinRequest() {
  if (!activeJoinRequest) return;
  socket.emit('reject-join-request', {
    roomId: activeJoinRequest.roomId,
    requestId: activeJoinRequest.requestId
  });
}

socket.on('join-request-pending', (data) => {
  showJoinRequestModal('requester', data);
});

socket.on('join-request-received', (data) => {
  showJoinRequestModal('host', data);
});

socket.on('join-request-resolved', () => {
  closeJoinRequestModal();
});

socket.on('join-request-result', (data) => {
  showJoinRequestModal('requester', {
    message: data.message || '参加申請の結果を受信しました。'
  });
});

socket.on('turn-timer-paused', ({ roomId }) => {
  if (roomId !== myRoomId) return;
  if (latestGameState) latestGameState.turnDeadlineAt = null;
  renderTurnCountdown(null);
});

socket.on('side-selection-started', ({ roomId, playerId, cards, requirements } = {}) => {
  if (roomId !== myRoomId || !latestGameState || !Array.isArray(cards)) return;
  showStagedSidePlay(playerId, cards, requirements);
});

// タブ切り替え（ルーム作成 / ルーム参加）
function switchTab(tab) {
  clearError();
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const formCreate = document.getElementById('form-create');
  const formJoin = document.getElementById('form-join');

  if (tab === 'create') {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    formCreate.style.display = 'flex';
    formJoin.style.display = 'none';
  } else {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    formJoin.style.display = 'flex';
    formCreate.style.display = 'none';
  }
}

function getSelectedGameType() {
  return document.querySelector('input[name="gameType"]:checked')?.value || 'daifugo';
}

function updateGameSetup() {
  const gameType = getSelectedGameType();
  const rulesSection = document.getElementById('daifugo-rules-section');
  const chinchiroRules = document.getElementById('chinchiro-rules-section');
  if (rulesSection) rulesSection.style.display = gameType === 'daifugo' ? 'block' : 'none';
  if (chinchiroRules) chinchiroRules.style.display = gameType === 'chinchiro' ? 'block' : 'none';
}

// ルーム作成
function createRoom() {
  clearError();
  const name = document.getElementById('create-player-name').value.trim();
  const roomId = document.getElementById('create-room-id').value.trim();
  const gameType = getSelectedGameType();

  if (!name) {
    showError('プレイヤー名を入力してください');
    return;
  }
  if (!/^\d{5}$/.test(roomId)) {
    showError('ルームIDは5桁の数字で入力してください');
    return;
  }

  const daifugoRules = {
    // 常時ON（固定ルール）
    revolution: true,
    suitLock: true,
    spe3: true,
    forbiddenFinish: true,
    miyakoOchi: true,
    dia3Start: true,
    includeJoker: true,
    eightCut: true,
    // 切り替え可能ルール
    staircase: document.getElementById('rule-staircase')?.checked ?? true,
    staircaseRevolution: document.getElementById('rule-staircaseRevolution')?.checked ?? true,
    elevenBack: document.getElementById('rule-elevenBack').checked,
    numberLock: document.getElementById('rule-numberLock')?.checked ?? true,
    completeLock: document.getElementById('rule-completeLock')?.checked ?? false,
    fiveSkip: document.getElementById('rule-fiveSkip').checked,
    sevenPass: document.getElementById('rule-sevenPass')?.checked ?? true,
    tenDiscard: document.getElementById('rule-tenDiscard').checked
  };
  const rules = gameType === 'daifugo' ? daifugoRules : {};

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  myRoomId = roomId;
  console.log('ルーム作成リクエスト送信:', { roomId, playerName: name, playerId: myPlayerId, gameType, rules });
  socket.emit('create-room', { roomId, playerName: name, playerId: myPlayerId, gameType, rules });
}

// ルーム参加
function joinRoom() {
  clearError();
  const name = document.getElementById('join-player-name').value.trim();
  const roomId = document.getElementById('join-room-id').value.trim();

  if (!name) {
    showError('プレイヤー名を入力してください');
    return;
  }
  if (!/^\d{5}$/.test(roomId)) {
    showError('ルームIDは5桁の数字で入力してください');
    return;
  }

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  myRoomId = roomId;
  console.log('ルーム参加リクエスト送信:', { roomId, playerName: name, playerId: myPlayerId });
  socket.emit('join-room', { roomId, playerName: name, playerId: myPlayerId });
}

socket.on('room-joined', (data) => {
  console.log('ルーム入室完了:', data);
  myRoomId = data.room.roomId;
  setRoomChatRoom(myRoomId);
  myPlayerId = data.playerId || myPlayerId;
  isHost = data.isHost;
  saveRecoveryState();
  updateWaitingRoom(data.room);
});

function resetViewportLayout() {
  const gameContainer = document.getElementById('game-container');

  if (gameContainer) {
    gameContainer.style.transform = 'none';
    gameContainer.style.transformOrigin = '';
    gameContainer.style.width = '';
    gameContainer.style.margin = '';
    gameContainer.style.maxWidth = '';
    gameContainer.style.height = '';
  }
  document.body.style.overflow = 'auto';
}

function getRoomIdFromPath() {
  const rawPath = window.location.pathname || '/';
  const value = decodeURIComponent(rawPath.replace(/^\/+|\/+$/g, ''));
  return /^\d{5}$/.test(value) ? value : '';
}

function syncRoomIdInputFromUrl() {
  const roomIdFromPath = getRoomIdFromPath();
  if (!roomIdFromPath) return;

  const createInput = document.getElementById('create-room-id');
  const joinInput = document.getElementById('join-room-id');
  if (createInput) createInput.value = roomIdFromPath;
  if (joinInput) joinInput.value = roomIdFromPath;
}

function sanitizeRoomIdInput(input) {
  const selectionStart = input.selectionStart;
  const sanitized = input.value.replace(/\D/g, '').slice(0, 5);
  if (input.value === sanitized) return;
  input.value = sanitized;
  const cursor = Math.min(selectionStart ?? sanitized.length, sanitized.length);
  input.setSelectionRange(cursor, cursor);
}

function generateRoomId() {
  const input = document.getElementById('create-room-id');
  if (!input) return;
  input.value = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  input.focus();
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }

    showError(successMessage);
    setTimeout(() => {
      clearError();
    }, 1400);
  } catch (error) {
    console.error('コピー失敗:', error);
    showError('コピーに失敗しました');
  }
}

function copyRoomId() {
  const roomId = myRoomId || document.getElementById('display-room-id')?.innerText?.trim() || '';
  if (!roomId) {
    showError('ルームIDが未設定です');
    return;
  }
  copyTextToClipboard(roomId, 'ルームIDをコピーしました');
}

function copyRoomShareLink() {
  const roomId = myRoomId || document.getElementById('create-room-id')?.value?.trim() || document.getElementById('join-room-id')?.value?.trim() || '';
  if (!roomId) {
    showError('共有するルームIDがありません');
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = '/' + encodeURIComponent(roomId);
  url.search = '';
  url.hash = '';
  copyTextToClipboard(url.toString(), '共有URLをコピーしました');
}

function resetToLobbyView() {
  const lobbyContainer = document.getElementById('lobby-container');
  const waitingArea = document.getElementById('waiting-area');
  const lobbyFormArea = document.getElementById('lobby-form-area');
  const gameContainer = document.getElementById('game-container');
  const gameFinishedModal = document.getElementById('game-finished-modal');
  const rulesModal = document.getElementById('rules-modal');
  const overallRankingModal = document.getElementById('overall-ranking-modal');

  if (lobbyContainer) lobbyContainer.style.display = 'block';
  if (waitingArea) waitingArea.style.display = 'none';
  if (lobbyFormArea) {
    lobbyFormArea.style.display = 'flex';
    lobbyFormArea.style.flexDirection = 'column';
    lobbyFormArea.style.width = '100%';
  }
  if (gameContainer) gameContainer.style.display = 'none';
  if (gameFinishedModal) gameFinishedModal.style.display = 'none';
  if (rulesModal) rulesModal.style.display = 'none';
  if (overallRankingModal) overallRankingModal.style.display = 'none';
  renderTurnCountdown(null);
  document.body.classList.remove('revolution-mode');
  document.body.classList.remove('game-active');
  document.documentElement.classList.remove('revolution-mode');

  resetViewportLayout();

  clearSelectionState();
  previousRoundResult = null;
  pendingExchangeSelection = null;
  setRoomChatRoom('');
  latestGameState = null;
  clearPreviousFieldCards();
  currentHand = [];
  selectedCardIds.clear();
}

socket.on('room-closed', ({ roomId }) => {
  clearRecoveryState();
  myRoomId = '';
  isHost = false;
  if (getRoomIdFromPath() === roomId) window.history.replaceState({}, '', '/');
  ['create-room-id', 'join-room-id'].forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input?.value.trim() === roomId) input.value = '';
  });
  resetToLobbyView();
  showError('ルームが閉じられました。ロビーに戻りました。');
});

socket.on('room-updated', (roomData) => {
  console.log('ルーム更新通知:', roomData);
  updateWaitingRoom(roomData);
});

function updateWaitingRoom(room) {
  clearPreviousRoundResultIfSeriesChanged(room);
  document.getElementById('lobby-form-area').style.display = 'none';
  document.getElementById('waiting-area').style.display = 'block';

  myRoomId = room.roomId;
  setRoomChatRoom(myRoomId);
  document.getElementById('display-room-id').innerText = room.roomId;
  document.getElementById('display-game-type').innerText = GAME_LABELS[room.gameType] || GAME_LABELS.daifugo;
  document.getElementById('player-count').innerText = room.players.length;
  document.getElementById('room-max-players').innerText = room.maxPlayers || 8;
  const cpuCount = room.players.filter(player => player.isCpu).length;
  document.getElementById('cpu-count').innerText = cpuCount;

  const displayRules = document.getElementById('display-rules');
  displayRules.style.display = room.gameType === 'chinchiro' ? 'none' : 'flex';
  renderRuleBadges('display-rules', room.rules);

  const currentSocketId = socket.id || myId;
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = room.players.map(p => {
    const isMe = p.id === currentSocketId;
    const isRoomHost = p.id === room.hostId;
    return `
      <div class="player-item ${isMe ? 'is-me' : ''} ${p.isCpu ? 'is-cpu' : ''}">
        <span>${escapeHtml(p.name)} ${p.isCpu
          ? room.gameType === 'daifugo' ? `<span class="cpu-tag">${CPU_DIFFICULTY_LABELS[p.difficulty] || 'ふつう'}</span>` : ''
          : getRoleBadge(p.role)} ${isMe ? '<strong>(あなた)</strong>' : ''}</span>
        ${isRoomHost ? '<span class="host-tag">ホスト</span>' : ''}
      </div>
    `;
  }).join('');

  const cpuControls = document.getElementById('cpu-controls');
  const hostControls = document.getElementById('host-controls');
  const guestMsg = document.getElementById('guest-waiting-msg');
  const startBtn = document.getElementById('start-btn');
  const addCpuBtn = document.getElementById('add-cpu-btn');
  const removeCpuBtn = document.getElementById('remove-cpu-btn');
  const roomLockBtn = document.getElementById('room-lock-btn');
  const roomLockStatus = document.getElementById('room-lock-status');
  const cpuDifficultyControl = document.querySelector('.cpu-difficulty-control');
  const cpuActions = document.querySelector('.host-cpu-actions');
  const hasCpuDifficulty = room.gameType === 'daifugo';
  cpuDifficultyControl.style.display = hasCpuDifficulty ? 'flex' : 'none';
  cpuActions.classList.toggle('without-difficulty', !hasCpuDifficulty);

  const amIHost = isHost || (room.hostId === currentSocketId);

  if (amIHost) {
    cpuControls.style.display = 'grid';
    hostControls.style.display = 'grid';
    guestMsg.style.display = 'none';
    addCpuBtn.disabled = room.players.length >= (room.maxPlayers || 8);
    removeCpuBtn.disabled = cpuCount === 0;
    roomLockBtn.dataset.locked = String(!!room.isLocked);
    roomLockBtn.innerText = room.isLocked ? '新規参加ロックを解除' : '新規参加をロック';
    roomLockStatus.style.display = room.isLocked ? 'block' : 'none';
    roomLockStatus.innerText = room.isLocked ? 'ロック中：新しい参加者は入室できません' : '';
    startBtn.disabled = room.players.length < 2;
  } else {
    cpuControls.style.display = 'none';
    hostControls.style.display = 'none';
    guestMsg.style.display = 'block';
  }

  scheduleRoomChatPosition();
}

function addCpuPlayer() {
  if (myRoomId) {
    const difficulty = document.getElementById('cpu-difficulty-select')?.value || 'normal';
    socket.emit('add-cpu-player', { roomId: myRoomId, difficulty });
  }
}

function removeCpuPlayer() {
  if (myRoomId) socket.emit('remove-cpu-player', myRoomId);
}

function toggleRoomLock() {
  if (!myRoomId) return;
  const roomLockBtn = document.getElementById('room-lock-btn');
  socket.emit('set-room-lock', {
    roomId: myRoomId,
    isLocked: roomLockBtn.dataset.locked !== 'true'
  });
}

function renderRuleBadges(elementId, rules) {
  const container = document.getElementById(elementId);
  if (!container || !rules) return;

  const visibleKeys = sortRulesForDisplay(SWITCHABLE_RULE_KEYS.filter(k => rules[k]));
  const badges = visibleKeys.map(k => `<span class="badge">${RULE_LABELS[k] || k}</span>`);

  container.innerHTML = badges.length > 0 ? badges.join('') : '<span class="badge">ルール追加なし</span>';
}

function renderRulesModal(rules, gameType = 'daifugo') {
  const modalBody = document.getElementById('rules-modal-body');
  if (!modalBody) return;

  if (gameType === 'chinchiro') {
    modalBody.innerHTML = `
      <div class="rules-section-group">
        <h3>チンチロの遊び方</h3>
        <div class="rules-modal-item"><strong>サイコロ</strong><span>3個を振り、1ターン最大3回まで挑戦できます。</span></div>
        <div class="rules-modal-item"><strong>確定</strong><span>3回目の前に「この役で確定」を選ぶと次の人へ進みます。</span></div>
        <div class="rules-modal-item"><strong>役の強さ</strong><span>ピンゾロ、シゴロ、ゾロ目、ペア、役なし、ヒフミの順です。</span></div>
        <div class="rules-modal-item"><strong>得点</strong><span>順位に応じて1点から人数分まで加算し、同じ役は同順位です。</span></div>
      </div>
    `;
    return;
  }

  const enabledRules = Object.keys(rules || {})
    .filter(k => rules[k])
    .map(k => ({ key: k, label: RULE_LABELS[k] || k, detail: RULE_DETAILS[k] || 'ルール適用中' }));

  const switchable = sortRulesForDisplay(enabledRules.filter(rule => SWITCHABLE_RULE_KEYS.includes(rule.key)));
  const fixed = sortRulesForDisplay(enabledRules.filter(rule => FIXED_RULE_KEYS.has(rule.key)));

  const renderSection = (title, items) => {
    if (items.length === 0) return '';
    return `
      <div class="rules-section-group">
        <h3>${title}</h3>
        ${items.map(rule => `
          <div class="rules-modal-item">
            <strong>${rule.label}</strong>
            <span>${rule.detail}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  if (enabledRules.length === 0) {
    modalBody.innerHTML = '<div class="rules-modal-item"><strong>有効ルール</strong>このゲームでは追加ルールが有効化されていません。</div>';
    return;
  }

  modalBody.innerHTML = `
    ${renderSection('選択中のルール', switchable)}
    ${renderSection('固定ルール', fixed)}
  `;
}

function closeCurrentRoom() {
  if (!myRoomId) return;

  const confirmClose = window.confirm('ホストがルームを閉じますか？\n\nこのルームに参加している人は全員退出します。');
  if (!confirmClose) return;

  socket.emit('close-room', myRoomId);
}

function toggleRulesModal(forceOpen) {
  const modal = document.getElementById('rules-modal');
  if (!modal) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : modal.style.display === 'none';
  modal.style.display = shouldOpen ? 'flex' : 'none';
}

function startGame() {
  clearError();
  console.log('ゲーム開始リクエスト送信:', myRoomId);
  socket.emit('start-game', myRoomId);
}

function nextRound() {
  document.getElementById('game-finished-modal').style.display = 'none';
  startGame();
}

// ゲーム開始通知
function applyViewportFit() {
  const gameContainer = document.getElementById('game-container');
  if (!gameContainer) return;

  const rootStyle = getComputedStyle(document.documentElement);
  const designWidth = Number.parseFloat(rootStyle.getPropertyValue('--phone-frame-width')) || 432;
  const designHeight = Number.parseFloat(rootStyle.getPropertyValue('--phone-frame-height')) || 768;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const scale = Math.min(viewportWidth / designWidth, viewportHeight / designHeight);
  const scaledWidth = designWidth * scale;
  const scaledHeight = designHeight * scale;
  const root = document.documentElement;
  root.style.setProperty('--phone-frame-scale', String(scale));
  root.style.setProperty('--daifugo-scale', String(scale));
  root.style.setProperty('--daifugo-scaled-width', `${scaledWidth}px`);
  root.style.setProperty('--daifugo-scaled-height', `${scaledHeight}px`);
  root.style.setProperty('--daifugo-scaled-chat-gutter', `${8 * scale}px`);

  const isGameActive = document.body.classList.contains('game-active');
  const isChinchiro = isGameActive && document.body.classList.contains('chinchiro-mode');
  const isActiveDaifugo = document.body.classList.contains('game-active')
    && !isChinchiro;

  if (isActiveDaifugo) {
    gameContainer.style.display = 'block';
    gameContainer.style.width = '';
    gameContainer.style.margin = '';
    document.body.style.overflow = 'hidden';
    return;
  }

  if (!isGameActive || isChinchiro) {
    const frame = isChinchiro ? gameContainer : document.getElementById('lobby-container');
    if (frame) {
      frame.style.transform = '';
      frame.style.width = '';
      frame.style.margin = '';
      if (isChinchiro) frame.style.display = 'block';
    }
    document.body.style.overflow = 'hidden';
    return;
  }

  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  if (gameContainer.style.display === 'none' || isMobile) {
    if (gameContainer) {
      gameContainer.style.transform = 'none';
      gameContainer.style.width = '';
      gameContainer.style.margin = '';
      if (isMobile && document.body.classList.contains('game-active')) {
        gameContainer.style.display = 'flex';
      }
    }
    document.body.style.overflow = isMobile
      && document.body.classList.contains('game-active')
      && !document.body.classList.contains('chinchiro-mode')
      ? 'hidden'
      : 'auto';
    return;
  }

  gameContainer.style.display = 'block';
  const naturalWidth = 820;
  const naturalHeight = 760;
  const maxScaleX = (window.innerWidth - 32) / naturalWidth;
  const maxScaleY = (window.innerHeight - 80) / naturalHeight;
  const legacyScale = Math.min(1, maxScaleX, maxScaleY);

  if (legacyScale < 1) {
    gameContainer.style.transform = `scale(${legacyScale})`;
    gameContainer.style.transformOrigin = 'top center';
    gameContainer.style.width = `${naturalWidth * legacyScale}px`;
    gameContainer.style.margin = '0 auto';
    document.body.style.overflow = 'hidden';
  } else {
    gameContainer.style.transform = 'none';
    gameContainer.style.width = '';
    gameContainer.style.margin = '';
    document.body.style.overflow = 'auto';
  }
}

socket.on('game-started', (data) => {
  console.log('ゲーム開始受信:', data);
  clearPreviousRoundResultIfSeriesChanged(data);
  clearRevealedChinchiroRoll();
  if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
  chinchiroResultTimer = null;
  latestGameState = data;
  stagedSidePlay = null;
  myRoomId = data.roomId;
  setRoomChatRoom(myRoomId);
  document.body.classList.add('game-active');
  clearPreviousFieldCards();
  document.getElementById('lobby-container').style.display = 'none';
  document.getElementById('game-container').style.display = window.matchMedia('(max-width: 640px)').matches
    ? 'flex'
    : 'block';
  document.getElementById('game-finished-modal').style.display = 'none';

  document.getElementById('game-room-id').innerText = data.roomId;
  document.getElementById('game-rules-badges').style.display = data.gameType === 'chinchiro' ? 'none' : 'flex';
  renderRuleBadges('game-rules-badges', data.rules);
  renderRulesModal(data.rules, data.gameType);

  currentHand = data.hand || [];
  clearSelectionState();
  pendingExchangeSelection = null;

  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[socket.id] || 0;
    if (requiredCount > 0) {
      pendingExchangeSelection = { required: requiredCount, selected: new Set() };
    }
  }

  saveRecoveryState();
  updateUI(data);
  updateHand(currentHand);
  applyViewportFit();
  scheduleRoomChatPosition();
});

// ゲーム状態更新
socket.on('state-updated', (data) => {
  const oldFieldCards = latestGameState?.fieldCards || [];
  const previousRollId = latestGameState?.chinchiroHistory?.at(-1)?.id || 0;
  const latestChinchiroRoll = data.chinchiroHistory?.at(-1);
  const didRollChinchiroDice = data.gameType === 'chinchiro'
    && latestChinchiroRoll
    && latestChinchiroRoll.id > previousRollId;
  const animatedPlayer = data.players.find(player => player.id === animatedChinchiroPlayerId);
  const didConfirmAnimatedRoll = data.gameType === 'chinchiro'
    && isDiceRollAnimating
    && !didRollChinchiroDice
    && animatedPlayer?.chinchiroFinished;
  const newFieldCards = data.fieldCards || [];
  const clearedFieldCards = data.clearedFieldCards || [];
  const fieldChanged = oldFieldCards.length !== newFieldCards.length
    || oldFieldCards.some((card, index) => card.id !== newFieldCards[index]?.id);

  if (newFieldCards.length > 0) {
    clearPreviousFieldCards();
    if (oldFieldCards.length > 0 && fieldChanged) {
      previousFieldCards = [...oldFieldCards];
    }
  } else {
    const cardsToShow = clearedFieldCards.length > 0 ? clearedFieldCards : oldFieldCards;
    if (cardsToShow.length > 0) {
      if (previousFieldCardsTimer) clearTimeout(previousFieldCardsTimer);
      previousFieldCards = [...cardsToShow];
      previousFieldCardsTimer = setTimeout(() => {
        previousFieldCardsTimer = null;
        if ((latestGameState?.fieldCards || []).length > 0) return;
        previousFieldCards = [];
        const fieldEl = document.getElementById('field');
        if (fieldEl) {
          fieldEl.innerHTML = '<span style="color: #bbb;">（場は流れています。好きなカードを出せます）</span>';
          fieldEl.classList.remove('is-recent-clear');
          fieldEl.classList.remove('is-large-group');
        }
        const previousFieldEl = document.getElementById('previous-field-card');
        if (previousFieldEl) {
          previousFieldEl.innerHTML = '';
          previousFieldEl.style.display = 'none';
          previousFieldEl.classList.remove('is-recent-clear');
        }
      }, 1800);
    } else if (!previousFieldCardsTimer) {
      previousFieldCards = [];
    }
  }

  if (didRollChinchiroDice) {
    const latestRoll = data.chinchiroHistory?.at(-1);
    const currentSocketId = socket.id || myId;
    if (chinchiroAwaitingRollResult && latestRoll?.playerId === currentSocketId) {
      chinchiroAwaitingRollResult = false;
      isChinchiroRollPressed = false;
      if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
      animatedDiceResult = [...latestRoll.dice];
      finishChinchiroDiceAnimation(data);
    } else {
      startChinchiroDiceAnimation(latestRoll?.dice, latestRoll?.playerId);
    }
  }

  latestGameState = data;
  stagedSidePlay = null;
  if (didConfirmAnimatedRoll) finishChinchiroDiceAnimation(data);
  clearSelectionState();
  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[socket.id] || 0;
    if (requiredCount > 0 && (!pendingExchangeSelection || pendingExchangeSelection.required !== requiredCount)) {
      pendingExchangeSelection = { required: requiredCount, selected: new Set() };
    }
    if (requiredCount === 0) {
      pendingExchangeSelection = null;
    }
  } else {
    pendingExchangeSelection = null;
  }
  updateUI(data);
  updateHand(currentHand);
  applyViewportFit();
  scheduleRoomChatPosition();
});

// 手札更新
socket.on('hand-updated', (hand) => {
  currentHand = hand;
  clearSelectionState();
  updateHand(hand);
});

function formatGameActionMessage(message) {
  return String(message || '')
    .replace(/【([^】]+)】/g, '$1 ')
    .replace(/[！!]+/g, '')
    .replace(/[。]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderTurnCountdown(deadlineAt) {
  const timer = document.getElementById('turn-timer');
  if (!timer) return;
  if (turnCountdownInterval) clearInterval(turnCountdownInterval);
  turnCountdownInterval = null;

  if (!deadlineAt) {
    timer.style.display = 'none';
    timer.classList.remove('is-urgent');
    timer.textContent = '';
    return;
  }

  const update = () => {
    const seconds = Math.max(0, Math.ceil((Number(deadlineAt) - Date.now()) / 1000));
    timer.textContent = `残り ${seconds}秒`;
    timer.classList.toggle('is-urgent', seconds <= 5);
    timer.style.display = 'inline-flex';
  };

  update();
  turnCountdownInterval = setInterval(update, 250);
}

function updateUI(data) {
  if (data.gameType === 'chinchiro') {
    document.body.classList.add('chinchiro-mode');
    document.getElementById('game-status-banner').style.display = 'none';
    document.getElementById('game-action-message').textContent = '';
    updateChinchiroUI(data);
    return;
  }

  document.body.classList.remove('chinchiro-mode');
  document.getElementById('chinchiro-board').style.display = 'none';
  document.querySelector('.table-stage').style.display = '';
  document.querySelector('.turn-control-section').style.display = '';
  document.querySelector('.hand-section').style.display = '';
  const currentSocketId = socket.id || myId;
  const isMyTurn = data.turnPlayerId === currentSocketId;
  const canAct = !!pendingExchangeSelection
    || !!pendingSideSelection
    || (data.status === 'playing' && isMyTurn);
  document.body.classList.toggle('has-three-row-hand', canAct && currentHand.length > 18);
  const turnInfo = document.getElementById('turn-info');
  const turnDetail = document.getElementById('turn-detail');
  const turnControl = document.querySelector('.turn-control-section');
  renderTurnCountdown(data.turnDeadlineAt);

  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[currentSocketId] || 0;
    turnInfo.innerText = 'カード交換';
    turnDetail.innerText = requiredCount > 0
      ? `${requiredCount}枚選んで確定してください`
      : '交換完了を待っています';
    turnControl.classList.add('is-exchanging');
    turnControl.classList.remove('is-my-turn');
  } else if (isMyTurn) {
    turnInfo.innerText = 'あなたの番';
    turnDetail.innerText = 'カードを選んで出すか、パスしてください';
    turnControl.classList.add('is-my-turn');
    turnControl.classList.remove('is-exchanging');
  } else {
    turnInfo.innerText = `${data.turnPlayerName || '相手'}の番`;
    turnDetail.innerText = '次のプレイを待っています';
    turnControl.classList.remove('is-my-turn', 'is-exchanging');
  }

  const statusBanner = document.getElementById('game-status-banner');
  const statusTags = document.getElementById('game-status-tags');
  const actionMessage = document.getElementById('game-action-message');
  statusTags.replaceChildren();

  const addStatusTag = (text, type = '') => {
    const tag = document.createElement('span');
    tag.className = `game-status-tag${type ? ` ${type}` : ''}`;
    tag.textContent = text;
    statusTags.appendChild(tag);
  };

  const body = document.body;
  const root = document.documentElement;

  if (data.status === 'waiting-exchange') {
    addStatusTag('カード交換中');
    statusBanner.classList.remove('revolution');
    body.classList.remove('revolution-mode');
    root.classList.remove('revolution-mode');
  } else if (data.isRevolution) {
    addStatusTag('革命中', 'is-revolution');
    statusBanner.classList.add('revolution');
    body.classList.add('revolution-mode');
    root.classList.add('revolution-mode');
  } else {
    statusBanner.classList.remove('revolution');
    body.classList.remove('revolution-mode');
    root.classList.remove('revolution-mode');
  }
  if (data.isElevenBack) {
    addStatusTag('Jバック中');
  }
  if (data.lockedSuit) {
    addStatusTag(`${data.lockedSuit}マーク縛り`);
  }
  if (data.lockedNumber) {
    const lockedNumbers = Array.isArray(data.lockedNumber) ? data.lockedNumber : [data.lockedNumber];
    if (data.rules?.completeLock) {
      const lockedSuits = (data.lockedNumberSuits || []).join('・');
      addStatusTag(`完縛り ${lockedNumbers.join(' → ')}${lockedSuits ? ` ${lockedSuits}` : ''}`);
    } else {
      addStatusTag(`数字縛り ${lockedNumbers.join(' → ')}`);
    }
  }

  const currentStagedPlay = stagedSidePlay?.playerId === data.turnPlayerId ? stagedSidePlay : null;
  if (currentStagedPlay) {
    actionMessage.innerText = `${data.turnPlayerName || 'プレイヤー'}がカード選択中です`;
  } else {
    actionMessage.innerText = formatGameActionMessage(data.actionMessage);
  }
  const hasStatus = statusTags.childElementCount > 0;
  const hasAction = actionMessage.innerText.length > 0;
  statusBanner.style.display = hasStatus ? 'flex' : 'none';
  actionMessage.style.display = hasAction ? 'block' : 'none';

  // 場のカード表示
  const fieldEl = document.getElementById('field');
  const previousFieldEl = document.getElementById('previous-field-card');
  const displayedFieldCards = currentStagedPlay?.cards?.length > 0
    ? currentStagedPlay.cards
    : data.fieldCards?.length > 0 ? data.fieldCards : previousFieldCards;
  fieldEl.classList.toggle('is-large-group', displayedFieldCards.length > 4);
  if (currentStagedPlay?.cards?.length > 0) {
    fieldEl.innerHTML = currentStagedPlay.cards.map(card => renderCard(card, false)).join('');
    fieldEl.classList.remove('is-recent-clear');
    if (previousFieldEl) previousFieldEl.style.display = 'none';
  } else if (data.fieldCards && data.fieldCards.length > 0) {
    fieldEl.innerHTML = data.fieldCards.map(c => renderCard(c, false)).join('');
    fieldEl.classList.remove('is-recent-clear');
    if (previousFieldEl) {
      previousFieldEl.innerHTML = previousFieldCards.map(card => renderCard(card, false)).join('');
      previousFieldEl.style.display = previousFieldCards.length > 0 ? 'flex' : 'none';
      previousFieldEl.classList.remove('is-recent-clear');
    }
  } else {
    fieldEl.innerHTML = previousFieldCards.length > 0
      ? previousFieldCards.map(card => renderCard(card, false)).join('')
      : '<span style="color: #bbb;">（場は流れています。好きなカードを出せます）</span>';
    fieldEl.classList.toggle('is-recent-clear', previousFieldCards.length > 0);
    if (previousFieldEl) {
      previousFieldEl.innerHTML = '';
      previousFieldEl.style.display = 'none';
      previousFieldEl.classList.remove('is-recent-clear');
    }
  }

  // 他プレイヤー情報
  const othersEl = document.getElementById('other-players');
  const seatOrder = getLeftTurnOpponentOrder(data.players, currentSocketId);
  const seatLayoutPlayerCount = Math.max(1, data.players.length - 1);
  const tableStage = document.querySelector('.table-stage');
  const fieldSection = document.querySelector('.field-section');
  const isMobileTable = window.matchMedia('(max-width: 640px)').matches
    || (document.body.classList.contains('game-active') && !document.body.classList.contains('chinchiro-mode'));
  const hasManyPlayers = seatLayoutPlayerCount >= 7;
  document.body.classList.toggle('has-many-players', hasManyPlayers);
  const seatCardHeight = isMobileTable
    ? (hasManyPlayers ? DAIFUGO_LAYOUT.compactPlayerSeatHeight : DAIFUGO_LAYOUT.playerSeatHeight)
    : 122;

  if (tableStage) {
    if (isMobileTable) {
      tableStage.style.height = '';
    } else {
      tableStage.style.height = '';
      const baseHeight = tableStage.clientHeight || 360;
      const fieldHeight = fieldSection?.offsetHeight || 120;
      const neededHeight = fieldHeight + 2 * (seatCardHeight + TABLE_SEAT_GAP);
      tableStage.style.height = `${Math.max(baseHeight, neededHeight)}px`;
    }
  }

  const stageWidth = tableStage?.clientWidth || 760;

  othersEl.innerHTML = seatOrder.map((p, index) => {
    const isTurn = p.id === data.turnPlayerId;
    const stagedCardCount = stagedSidePlay?.playerId === p.id ? stagedSidePlay.cards.length : 0;
    const totalCardCount = Math.max(0, p.cardCount - stagedCardCount);
    const seatGap = isMobileTable ? 5 : 12;
    const seatCardWidth = Math.min(
      isMobileTable
        ? (hasManyPlayers ? DAIFUGO_LAYOUT.compactPlayerSeatWidth : DAIFUGO_LAYOUT.playerSeatWidth)
        : 112,
      stageWidth
    );
    const preferredSpacing = isTurn
      ? totalCardCount > 12 ? 3.2 : totalCardCount > 6 ? 4 : 4.5
      : totalCardCount > 12 ? 1.3 : 1.7;
    const stackMaxWidth = isMobileTable ? Math.max(40, seatCardWidth - 12) : 96;
    const stackWidth = Math.min(stackMaxWidth, Math.max(62, 42 + totalCardCount * 2.2));
    const miniCardWidth = isMobileTable ? (hasManyPlayers ? 22 : 28) : 36;
    const miniCardHeight = isMobileTable ? (hasManyPlayers ? 28 : 36) : 48;
    const stackHeight = miniCardHeight;
    const cardSpacing = isMobileTable ? preferredSpacing * 2 : preferredSpacing;
    const spacing = Math.min(
      cardSpacing,
      Math.max(0, (stackWidth - miniCardWidth) / Math.max(totalCardCount - 1, 1))
    );
    const fanWidth = miniCardWidth + Math.max(0, totalCardCount - 1) * spacing;
    const fanStart = Math.max(0, (stackWidth - fanWidth) / 2);
    const stackCards = Array.from({ length: totalCardCount }, (_, idx) => {
      const fanAngle = isMobileTable ? 24 : 48;
      const angle = -fanAngle / 2 + (idx * (fanAngle / Math.max(totalCardCount - 1, 1)));
      const left = fanStart + idx * spacing;
      const top = Math.round((stackHeight - miniCardHeight) / 2) - 4;
      return `
        <span class="mini-card" style="left:${left}px; top:${top}px; z-index:${totalCardCount - idx}; transform: rotate(${angle}deg);"></span>
      `;
    }).join('');
    const countBadge = `<span class="count-stack-total">${totalCardCount}</span>`;
    const winnerText = p.isWinner ? `<span class="winner-text">🎉 ${p.rank}位</span>` : '';
    const seatSlot = getOpponentSeatSlot(data.players.length, index);

    return `
      <div class="other-player-card ${isTurn ? 'active-turn' : ''}" data-seat="${index}" data-seat-slot="${seatSlot}">
        <div class="player-name-row">
          <strong>${escapeHtml(p.name)}</strong>
        </div>
        <div class="count-stack" style="--stack-width:${stackWidth}px;" aria-label="${p.cardCount}枚残り">
          ${stackCards}
          ${countBadge}
        </div>
        ${winnerText || getRoleBadge(p.role)}
      </div>
    `;
  }).join('');

  const selfPlayer = data.players.find(player => player.id === currentSocketId);
  const selfPlayerCard = document.getElementById('self-player-card');
  if (selfPlayer && selfPlayerCard) {
    const stagedCardCount = stagedSidePlay?.playerId === currentSocketId ? stagedSidePlay.cards.length : 0;
    const selfCardCount = Math.max(0, (Number(selfPlayer.cardCount) || currentHand.length) - stagedCardCount);
    const selfStackWidth = Math.min(DAIFUGO_LAYOUT.playerCardFanWidth, Math.max(28, 20 + selfCardCount * 2));
    const miniCardWidth = 20;
    const miniCardHeight = 20;
    const stackHeight = 24;
    const spacing = Math.min(2.8, Math.max(0, (selfStackWidth - miniCardWidth) / Math.max(selfCardCount - 1, 1)));
    const fanWidth = miniCardWidth + Math.max(0, selfCardCount - 1) * spacing;
    const fanStart = Math.max(0, (selfStackWidth - fanWidth) / 2);
    const stackCards = Array.from({ length: selfCardCount }, (_, index) => {
      const angle = -12 + index * (24 / Math.max(selfCardCount - 1, 1));
      const left = fanStart + index * spacing;
      const top = Math.round((stackHeight - miniCardHeight) / 2) - 4;
      return `<span class="mini-card" style="left:${left}px; top:${top}px; z-index:${selfCardCount - index}; transform: rotate(${angle}deg);"></span>`;
    }).join('');
    const winnerText = selfPlayer.isWinner ? `<span class="winner-text">${selfPlayer.rank}位</span>` : '';
    selfPlayerCard.className = `other-player-card self-player-card${isMyTurn ? ' active-turn' : ''}`;
    selfPlayerCard.style.display = 'flex';
    selfPlayerCard.innerHTML = `
      <div class="player-name-row"><strong>${escapeHtml(selfPlayer.name)}</strong></div>
      <div class="count-stack" style="--stack-width:${selfStackWidth}px;" aria-label="手札${selfCardCount}枚">
        ${stackCards}
        <span class="count-stack-total">${selfCardCount}</span>
      </div>
      ${winnerText || getRoleBadge(selfPlayer.role)}
    `;
  } else if (selfPlayerCard) {
    selfPlayerCard.style.display = 'none';
  }

  if (data.status === 'finished') {
    showGameFinished(data);
  }

  updatePlayButton();
}

function updateChinchiroUI(data) {
  const currentSocketId = socket.id || myId;
  const phase = data.chinchiroPhase || 'betting';
  const isMyTurn = data.status === 'playing' && phase === 'rolling' && data.turnPlayerId === currentSocketId;
  const currentPlayer = data.players.find(player => player.id === data.turnPlayerId);
  const myPlayer = data.players.find(player => player.id === currentSocketId);
  const currentRound = data.status === 'finished'
    ? data.completedRounds
    : (data.completedRounds || 0) + 1;
  const isMyBetTurn = data.status === 'playing' && phase === 'betting'
    && currentSocketId !== data.chinchiroParentId && myPlayer?.chinchiroBet == null;
  if (!isMyBetTurn) {
    selectedChinchiroBetAmount = null;
    selectedChinchiroBetRound = null;
  } else if (selectedChinchiroBetRound !== currentRound || selectedChinchiroBetAmount === null) {
    selectedChinchiroBetRound = currentRound;
    selectedChinchiroBetAmount = Math.min(10, Math.max(0, myPlayer.soshies || 0));
  } else {
    selectedChinchiroBetAmount = Math.min(selectedChinchiroBetAmount, Math.max(0, myPlayer.soshies || 0));
  }
  const roundHistory = (data.chinchiroHistory || [])
    .filter(entry => entry.round === currentRound);
  const latestRoll = roundHistory.at(-1);
  const latestRollPlayer = latestRoll
    ? data.players.find(player => player.id === latestRoll.playerId)
    : null;
  const animatedPlayer = isDiceRollAnimating && animatedChinchiroPlayerId
    ? data.players.find(player => player.id === animatedChinchiroPlayerId)
    : null;
  const activePlayerRoll = currentPlayer
    ? [...roundHistory].reverse().find(entry => entry.playerId === currentPlayer.id)
    : null;
  const revealedRoll = !animatedPlayer && revealedChinchiroRollId !== null
    ? roundHistory.find(entry => entry.id === revealedChinchiroRollId)
    : null;
  const revealedPlayer = revealedRoll
    ? data.players.find(player => player.id === revealedRoll.playerId)
    : null;
  const isShowingPreviousResult = !!revealedRoll
    && !!revealedPlayer
    && revealedPlayer.id !== currentPlayer?.id
    && !activePlayerRoll;
  const displayedPlayer = animatedPlayer
    || (isShowingPreviousResult ? revealedPlayer : currentPlayer)
    || latestRollPlayer;
  const displayedRoll = [...roundHistory].reverse()
    .find(entry => entry.playerId === displayedPlayer?.id && (!isShowingPreviousResult || entry.id === revealedRoll.id));
  const board = document.getElementById('chinchiro-board');
  const rollButton = document.getElementById('chinchiro-roll-btn');
  const betControls = document.getElementById('chinchiro-bet-controls');
  const betAmount = document.getElementById('chinchiro-bet-amount');
  const betButton = document.getElementById('chinchiro-bet-btn');
  rollButton.textContent = isChinchiroRollPressed
    ? '振っています…'
    : chinchiroAwaitingRollResult
      ? '目を確定中…'
      : 'サイコロを振る';
  const dice = animatedDiceResult || displayedRoll?.dice || displayedPlayer?.dice || [];
  const visibleRollsUsed = displayedRoll?.rollNumber || displayedPlayer?.rollsUsed || 0;
  const currentRollsUsed = currentPlayer?.rollsUsed || 0;

  document.querySelector('.table-stage').style.display = 'none';
  document.querySelector('.turn-control-section').style.display = 'none';
  document.querySelector('.hand-section').style.display = 'none';
  board.style.display = 'block';
  document.getElementById('chinchiro-round').textContent = data.status === 'finished'
    ? `${data.completedRounds || 0} ラウンド終了`
    : `${(data.completedRounds || 0) + 1} ラウンド目`;
  document.getElementById('chinchiro-history-open').textContent = `履歴 (${data.chinchiroHistory?.length || 0})`;
  const parent = data.players.find(player => player.id === data.chinchiroParentId);
  const myBetIsPlaced = myPlayer?.chinchiroBet != null;
  document.getElementById('chinchiro-turn-status').textContent = data.status === 'finished'
    ? 'ラウンド終了。ソシー残高で順位が決まりました。'
    : phase === 'betting'
      ? isMyBetTurn
        ? '賭けるソシーを選んでください。'
        : myBetIsPlaced
          ? '賭け額を確定しました。ほかの子を待っています。'
          : `${parent?.name || '親'}が親です。子の賭けを待っています。`
      : isMyTurn
        ? `${currentSocketId === data.chinchiroParentId ? '親' : 'あなた'}の番です。最大3回まで振れます。`
        : `${currentPlayer?.name || '相手'}の番です`;
  document.getElementById('chinchiro-dice').innerHTML = Array.from({ length: 3 }, (_, index) => {
    const face = dice[index] || '·';
    return `<span class="chinchiro-die${dice.length ? ' has-result' : ''}" aria-label="${face}の目">${face}</span>`;
  }).join('');
  if (!isDiceRollAnimating) renderBowlDice(dice);
  document.getElementById('chinchiro-hand-label').textContent = isShowingPreviousResult
    ? `${displayedPlayer.name}の前の結果：${displayedRoll.label}`
    : displayedRoll?.label || displayedPlayer?.chinchiroHand?.label || 'サイコロを振ってください';
  document.getElementById('chinchiro-roll-count').textContent = isShowingPreviousResult
    ? `前の結果 ${visibleRollsUsed} / 3 回`
    : `${visibleRollsUsed} / 3 回`;
  betControls.hidden = !isMyBetTurn;
  betAmount.value = `${(selectedChinchiroBetAmount || 0).toLocaleString()} S`;
  betAmount.textContent = betAmount.value;
  updateChinchiroBetButton();
  rollButton.hidden = phase !== 'rolling';
  rollButton.disabled = !isMyTurn || currentRollsUsed >= 3 || isDiceRollAnimating || isShowingPreviousResult;

  const turnOrder = new Map((data.chinchiroTurnOrder || []).map((playerId, index) => [playerId, index]));
  const sortedPlayers = [...data.players].sort((left, right) => {
    if (data.status === 'finished' && left.rank && right.rank) return left.rank - right.rank;
    if (data.status !== 'finished' && phase === 'rolling') {
      return (turnOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (turnOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    }
    if (left.id === data.chinchiroParentId) return -1;
    if (right.id === data.chinchiroParentId) return 1;
    return left.name.localeCompare(right.name, 'ja');
  });
  document.getElementById('chinchiro-player-list').innerHTML = sortedPlayers.map(player => {
    const isRolling = isDiceRollAnimating && player.id === animatedChinchiroPlayerId;
    const status = isRolling
      ? '振っています…'
      : data.status === 'finished'
      ? `${player.rank}位`
      : phase === 'betting'
        ? player.id === data.chinchiroParentId
          ? '親'
          : player.chinchiroBet != null ? '賭け済み' : '賭け待ち'
        : player.chinchiroFinished
          ? '確定'
          : `${player.rollsUsed}/3回`;
    const role = isRolling ? '振っています…' : player.chinchiroHand?.label || '—';
    const roleLabel = player.id === data.chinchiroParentId ? '親' : role;
    const betLabel = player.id === data.chinchiroParentId
      ? '—'
      : player.chinchiroBet == null ? '—' : player.chinchiroBet.toLocaleString();
    const delta = Number(player.soshiesDelta) || 0;
    const deltaLabel = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
    return `
      <div class="chinchiro-player-row ${phase === 'rolling' && player.id === currentPlayer?.id ? 'is-turn' : ''} ${player.id === currentSocketId ? 'is-me' : ''}">
        <span class="chinchiro-player-name"><strong>${escapeHtml(player.name)}</strong>${player.id === currentSocketId ? '<small>あなた</small>' : ''}</span>
        <span class="chinchiro-player-role">${escapeHtml(roleLabel)}</span>
        <span class="chinchiro-player-bet">${betLabel}<small>賭け</small></span>
        <span class="chinchiro-player-delta">${deltaLabel}<small>今回</small></span>
        <span class="chinchiro-player-soshies">${(player.soshies || 0).toLocaleString()}<small>ソシー</small></span>
        <span class="chinchiro-player-status">${status}</span>
      </div>
    `;
  }).join('');

  renderChinchiroHistory(data.chinchiroHistory || [], isDiceRollAnimating);

  if (data.status === 'finished') toggleChinchiroHistory(false);
  if (data.status === 'finished' && !isDiceRollAnimating) {
    if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
    chinchiroResultTimer = setTimeout(() => {
      chinchiroResultTimer = null;
      if (latestGameState?.gameType === 'chinchiro' && latestGameState.status === 'finished') {
        showGameFinished(latestGameState);
      }
    }, CHINCHIRO_RESULT_REVEAL_MS);
  } else if (chinchiroResultTimer) {
    clearTimeout(chinchiroResultTimer);
    chinchiroResultTimer = null;
  }
}

function pressChinchiroRoll(event) {
  const isKeyboardEvent = event?.type === 'keydown';
  if (isKeyboardEvent && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
  if (isKeyboardEvent && event.repeat) return;
  event?.preventDefault?.();

  if (event?.type === 'pointerdown' && event.currentTarget?.setPointerCapture) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  const currentSocketId = socket.id || myId;
  const currentPlayer = latestGameState?.players?.find(player => player.id === currentSocketId);
  if (!myRoomId || !latestGameState || latestGameState.status !== 'playing'
    || latestGameState.turnPlayerId !== currentSocketId
    || currentPlayer?.rollsUsed >= 3
    || isDiceRollAnimating
    || revealedChinchiroRollId !== null
    || chinchiroAwaitingRollResult) return;

  isChinchiroRollPressed = true;
  startChinchiroDiceAnimation(null, currentSocketId, true);
  updateChinchiroUI(latestGameState);
}

function releaseChinchiroRoll(event) {
  const isKeyboardEvent = event?.type === 'keyup';
  if (isKeyboardEvent && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
  event?.preventDefault?.();
  if (!isChinchiroRollPressed || !myRoomId) return;

  isChinchiroRollPressed = false;
  chinchiroAwaitingRollResult = true;
  updateChinchiroUI(latestGameState);
  if (diceRollAnimationInterval) clearInterval(diceRollAnimationInterval);
  diceRollAnimationInterval = null;
  document.getElementById('chinchiro-bowl')?.classList.remove('is-shaking');

  ignoreNextChinchiroRollClick = true;
  if (ignoreNextChinchiroRollClickTimer) clearTimeout(ignoreNextChinchiroRollClickTimer);
  ignoreNextChinchiroRollClickTimer = setTimeout(() => {
    ignoreNextChinchiroRollClick = false;
    ignoreNextChinchiroRollClickTimer = null;
  }, 500);

  if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
  diceRollAnimationTimer = setTimeout(() => {
    if (!chinchiroAwaitingRollResult) return;
    chinchiroAwaitingRollResult = false;
    finishChinchiroDiceAnimation(latestGameState);
    if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
    showError('出目を受信できませんでした。もう一度お試しください。');
  }, 8000);

  socket.emit('roll-chinchiro', myRoomId);
}

function cancelChinchiroRoll() {
  if (!isChinchiroRollPressed) return;
  isChinchiroRollPressed = false;
  finishChinchiroDiceAnimation(latestGameState);
  if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
}

window.addEventListener('blur', cancelChinchiroRoll);

function rollChinchiro(event) {
  if (ignoreNextChinchiroRollClick) {
    ignoreNextChinchiroRollClick = false;
    if (ignoreNextChinchiroRollClickTimer) clearTimeout(ignoreNextChinchiroRollClickTimer);
    ignoreNextChinchiroRollClickTimer = null;
    return;
  }
  if (isChinchiroRollPressed) return;

  pressChinchiroRoll({ type: 'keydown', key: 'Enter', preventDefault() {} });
  releaseChinchiroRoll({ type: 'keyup', key: 'Enter', preventDefault() {} });
}

function renderBowlDice(dice = []) {
  const pipSlots = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };
  document.querySelectorAll('.bowl-die').forEach((die, index) => {
    const face = dice[index];
    die.classList.toggle('is-empty', !pipSlots[face]);
    die.setAttribute('aria-label', pipSlots[face] ? `${face}の目` : 'サイコロ');
    if (!pipSlots[face]) {
      die.innerHTML = '<span class="bowl-die-placeholder">?</span>';
      return;
    }
    const activeSlots = new Set(pipSlots[face]);
    die.innerHTML = Array.from({ length: 9 }, (_, slot) =>
      `<i class="bowl-die-pip${activeSlots.has(slot) ? ' is-visible' : ''}"></i>`
    ).join('');
  });
}

function renderChinchiroHistory(history, isRolling) {
  const list = document.getElementById('chinchiro-history-list');
  const visibleHistory = [...history].slice(-12);
  if (isRolling && visibleHistory.length > 0) visibleHistory.pop();
  if (visibleHistory.length === 0) {
    list.innerHTML = '<p class="chinchiro-history-empty">サイコロを振ると履歴が表示されます</p>';
    return;
  }

  list.innerHTML = visibleHistory.reverse().map(entry => `
    <div class="chinchiro-history-row">
      <span class="chinchiro-history-round">R${entry.round}</span>
      <strong class="chinchiro-history-player">${escapeHtml(entry.playerName)}</strong>
      <span class="chinchiro-history-dice">${entry.dice.map(face => `<i>${face}</i>`).join('')}</span>
      <span class="chinchiro-history-result"><strong>${escapeHtml(entry.label)}</strong><small>${entry.rollNumber}回目${entry.confirmed ? ' · 確定' : ''}</small></span>
    </div>
  `).join('');
}

function toggleChinchiroHistory(forceOpen) {
  const modal = document.getElementById('chinchiro-history-modal');
  if (!modal) return;

  const shouldOpen = forceOpen ?? modal.style.display !== 'flex';
  if (!shouldOpen) {
    modal.style.display = 'none';
    return;
  }

  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  renderChinchiroHistory(latestGameState?.chinchiroHistory || [], false);
  modal.style.display = 'flex';
}

function clearRevealedChinchiroRoll() {
  if (revealedChinchiroRollTimer) clearTimeout(revealedChinchiroRollTimer);
  revealedChinchiroRollTimer = null;
  revealedChinchiroRollId = null;
}

function finishChinchiroDiceAnimation(data = latestGameState) {
  if (diceRollAnimationInterval) clearInterval(diceRollAnimationInterval);
  if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
  diceRollAnimationInterval = null;
  diceRollAnimationTimer = null;
  document.querySelector('.chinchiro-dice-panel')?.classList.remove('is-rolling');
  document.getElementById('chinchiro-bowl')?.classList.remove('is-shaking');

  const animatedPlayerId = animatedChinchiroPlayerId;
  const currentRound = data?.status === 'finished'
    ? data.completedRounds
    : (data?.completedRounds || 0) + 1;
  const lastRoll = [...(data?.chinchiroHistory || [])].reverse()
    .find(entry => entry.round === currentRound && entry.playerId === animatedPlayerId);
  renderBowlDice(animatedDiceResult || lastRoll?.dice || []);
  animatedDiceResult = null;
  animatedChinchiroPlayerId = null;
  isDiceRollAnimating = false;

  if (data?.status === 'playing' && lastRoll && data.turnPlayerId !== animatedPlayerId) {
    clearRevealedChinchiroRoll();
    revealedChinchiroRollId = lastRoll.id;
    revealedChinchiroRollTimer = setTimeout(() => {
      clearRevealedChinchiroRoll();
      if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
    }, CHINCHIRO_RESULT_REVEAL_MS);
  }
}

function startChinchiroDiceAnimation(finalDice = null, playerId = null, waitForServerResult = false) {
  clearRevealedChinchiroRoll();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isDiceRollAnimating) {
    if (Array.isArray(finalDice)) animatedDiceResult = [...finalDice];
    if (playerId) animatedChinchiroPlayerId = playerId;
    if (reducedMotion && Array.isArray(finalDice)) renderBowlDice(finalDice);
    return;
  }
  const dicePanel = document.querySelector('.chinchiro-dice-panel');
  const bowl = document.getElementById('chinchiro-bowl');
  if (!dicePanel || !bowl) return;

  isDiceRollAnimating = true;
  animatedChinchiroPlayerId = playerId || latestGameState?.turnPlayerId || null;
  animatedDiceResult = Array.isArray(finalDice) ? [...finalDice] : null;
  dicePanel.classList.add('is-rolling');
  bowl.classList.remove('is-shaking');
  void bowl.offsetWidth;
  bowl.classList.add('is-shaking');

  if (!reducedMotion) {
    renderBowlDice(Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1));
    diceRollAnimationInterval = setInterval(() => {
      renderBowlDice(Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1));
    }, 90);
  }
  if (!waitForServerResult) {
    diceRollAnimationTimer = setTimeout(() => {
      const data = latestGameState;
      finishChinchiroDiceAnimation(data);
      if (data?.gameType === 'chinchiro') updateUI(data);
    }, CHINCHIRO_ROLL_ANIMATION_MS);
  }
}

function placeChinchiroBet() {
  if (!myRoomId || latestGameState?.chinchiroPhase !== 'betting') return;
  updateChinchiroBetButton();
  if (document.getElementById('chinchiro-bet-btn').disabled) return;
  socket.emit('place-chinchiro-bet', { roomId: myRoomId, amount: selectedChinchiroBetAmount });
}

function adjustChinchiroBet(step) {
  if (latestGameState?.chinchiroPhase !== 'betting' || selectedChinchiroBetAmount === null) return;
  const currentSocketId = socket.id || myId;
  const player = latestGameState.players.find(candidate => candidate.id === currentSocketId);
  const nextAmount = selectedChinchiroBetAmount + Number(step);
  if (!Number.isSafeInteger(nextAmount) || nextAmount < 0 || nextAmount > (player?.soshies || 0)) return;
  selectedChinchiroBetAmount = nextAmount;
  updateChinchiroBetButton();
}

function updateChinchiroBetButton() {
  const amountOutput = document.getElementById('chinchiro-bet-amount');
  const button = document.getElementById('chinchiro-bet-btn');
  const currentSocketId = socket.id || myId;
  const player = latestGameState?.players?.find(candidate => candidate.id === currentSocketId);
  const amount = Number(selectedChinchiroBetAmount);
  const canBet = latestGameState?.gameType === 'chinchiro'
    && latestGameState.status === 'playing'
    && latestGameState.chinchiroPhase === 'betting'
    && currentSocketId !== latestGameState.chinchiroParentId
    && player?.chinchiroBet == null;
  const balance = Math.max(0, Number(player?.soshies) || 0);
  if (amountOutput) {
    amountOutput.value = `${(Number.isSafeInteger(amount) ? amount : 0).toLocaleString()} S`;
    amountOutput.textContent = amountOutput.value;
  }
  if (button) {
    button.disabled = !canBet || !Number.isSafeInteger(amount)
      || amount < 0 || amount > balance;
  }
  document.querySelectorAll('.chinchiro-bet-adjustments [data-bet-step]').forEach(stepButton => {
    const nextAmount = amount + Number(stepButton.dataset.betStep);
    stepButton.disabled = !canBet || !Number.isSafeInteger(nextAmount)
      || nextAmount < 0 || nextAmount > balance;
  });
}

function isValidPlayClient(playedCards, fieldCards, rules = {}, state = {}) {
  const hasDiamondThree = (currentHand || []).some(c => c.id === '♦3');
  if (state.mustPlayDiamondThree && hasDiamondThree && !playedCards.some(c => c.id === '♦3')) {
    return { valid: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
  }
  return daifugoRules.isValidPlay(playedCards, fieldCards, rules, state);
}

/**
 * 手札の各カードが「現在選択可能か」を判定する
 */
function isCardSelectable(card) {
  if (!latestGameState || latestGameState.status !== 'playing') return false;

  const currentSocketId = socket.id || myId;
  const isMyTurn = latestGameState.turnPlayerId === currentSocketId;
  const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));
  const hasDiamondThree = currentHand.some(c => c.id === '♦3');
  if (latestGameState.mustPlayDiamondThree && hasDiamondThree
    && !selectedCards.some(c => c.id === '♦3') && card.id !== '♦3') {
    return false;
  }

  return daifugoRules.isCardSelectable(
    card,
    currentHand,
    selectedCards,
    latestGameState.fieldCards || [],
    latestGameState.rules || {},
    latestGameState,
    isMyTurn
  );
}

function renderCard(card, isClickable = true, isSelected = false, isSelectable = true) {
  const isJoker = card.id === 'JOKER';
  const isRed = card.suit === '♥' || card.suit === '♦';

  let classes = ['card'];
  if (isClickable) classes.push('hand-card');
  if (isJoker) classes.push('joker');
  if (isRed) classes.push('red');
  if (isSelected) classes.push('selected');
  if (isClickable && !isSelectable && !isSelected) classes.push('disabled');

  const clickAttr = isClickable ? `onclick="handleCardClick('${card.id}')"` : '';
  const display = isJoker
    ? '<span class="card-joker-label">JOKER</span>'
    : `
      <span class="card-corner">
        <span class="card-corner-suit">${escapeHtml(card.suit)}</span>
        <strong class="card-corner-rank">${escapeHtml(card.num)}</strong>
      </span>
      <span class="card-center-suit" aria-hidden="true">${escapeHtml(card.suit)}</span>
    `;

  return `<div class="${classes.join(' ')}" ${clickAttr}>${display}</div>`;
}

// カードクリック処理
function handleCardClick(cardId) {
  clearError();

  if (pendingExchangeSelection) {
    const card = currentHand.find(c => c.id === cardId);
    if (!card) return;

    if (pendingExchangeSelection.selected.has(cardId)) {
      pendingExchangeSelection.selected.delete(cardId);
    } else if (pendingExchangeSelection.selected.size < pendingExchangeSelection.required) {
      pendingExchangeSelection.selected.add(cardId);
    } else {
      showError(`交換は${pendingExchangeSelection.required}枚までです`);
      return;
    }

    updateHand(currentHand);
    updatePlayButton();
    return;
  }

  if (pendingSideSelection) {
    const card = currentHand.find(c => c.id === cardId);
    if (!card || pendingSideSelection.playedCardIds.has(cardId)) return;

    const passSet = pendingSideSelection.passSelected;
    const discardSet = pendingSideSelection.discardSelected;
    const inPass = passSet.has(cardId);
    const inDiscard = discardSet.has(cardId);

    if (inPass || inDiscard) {
      passSet.delete(cardId);
      discardSet.delete(cardId);
    } else {
      const isPassStage = pendingSideSelection.required.pass > 0 && passSet.size < pendingSideSelection.required.pass;
      const isDiscardStage = pendingSideSelection.required.discard > 0 && discardSet.size < pendingSideSelection.required.discard;

      if (isPassStage && pendingSideSelection.required.pass > 0) {
        if (passSet.size >= pendingSideSelection.required.pass) {
          showError(`7渡しは${pendingSideSelection.required.pass}枚までです`);
          return;
        }
        passSet.add(cardId);
      } else if (isDiscardStage && pendingSideSelection.required.discard > 0) {
        if (discardSet.size >= pendingSideSelection.required.discard) {
          showError(`10捨ては${pendingSideSelection.required.discard}枚までです`);
          return;
        }
        discardSet.add(cardId);
      } else if (pendingSideSelection.required.pass > 0) {
        passSet.add(cardId);
      } else if (pendingSideSelection.required.discard > 0) {
        discardSet.add(cardId);
      }
    }

    updateHand(currentHand);
    updatePlayButton();
    return;
  }

  const currentSocketId = socket.id || myId;
  if (!latestGameState || latestGameState.turnPlayerId !== currentSocketId) {
    showError('あなたのターンではありません！');
    return;
  }

  const card = currentHand.find(c => c.id === cardId);
  if (!card) return;

  if (selectedCardIds.has(cardId)) {
    selectedCardIds.delete(cardId);
    updatePlayButton();
    updateHand(currentHand);
    return;
  }

  if (isCardSelectable(card)) {
    selectedCardIds.add(cardId);
    updatePlayButton();
    updateHand(currentHand);
  } else {
    const fieldCards = latestGameState.fieldCards || [];
    const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));

    if (selectedCards.length > 0) {
      const baseCard = selectedCards.find(c => c.id !== 'JOKER');
      if (baseCard && card.num !== baseCard.num && card.id !== 'JOKER') {
        showError(`複数枚出す場合は、同じ数字（${baseCard.num}）のカードを選択してください`);
        return;
      }
    }

    if (fieldCards.length > 1) {
      showError(`場が${fieldCards.length}枚出しのため、より強い${fieldCards.length}枚の組み合わせを選択してください`);
    } else if (fieldCards.length === 1) {
      showError('場に出ているカードより強いカードを選択してください');
    } else {
      showError('そのカードは現在選択できません');
    }
  }
}

function updatePlayButton() {
  const playBtn = document.getElementById('play-btn');
  const passBtn = document.getElementById('pass-btn');
  if (!playBtn) return;

  const currentSocketId = socket.id || myId;
  const isMyTurn = !!latestGameState && latestGameState.turnPlayerId === currentSocketId;
  const isHandSelection = !!latestGameState && (latestGameState.isHandSelection || latestGameState.isHandShuffling);

  if (pendingExchangeSelection) {
    const count = pendingExchangeSelection.selected.size;
    const required = pendingExchangeSelection.required;
    playBtn.innerText = `交換確定 (${count}/${required}枚)`;
    playBtn.disabled = count !== required;
    passBtn.disabled = true;
    passBtn.style.visibility = 'hidden';
    return;
  }

  if (pendingSideSelection) {
    const passNeeded = pendingSideSelection.required.pass;
    const discardNeeded = pendingSideSelection.required.discard;
    const passCount = pendingSideSelection.passSelected.size;
    const discardCount = pendingSideSelection.discardSelected.size;
    const totalOk = passCount >= passNeeded && discardCount >= discardNeeded;
    playBtn.innerText = passNeeded > 0 && discardNeeded > 0
      ? `交換を確定 (${passCount}/${passNeeded} + ${discardCount}/${discardNeeded})`
      : passNeeded > 0
        ? `渡すカード確定 (${passCount}/${passNeeded})`
        : `捨てカード確定 (${discardCount}/${discardNeeded})`;
    playBtn.disabled = !totalOk;
    passBtn.disabled = true;
    passBtn.style.visibility = 'hidden';
    return;
  }

  const count = selectedCardIds.size;
  playBtn.innerText = `出す (${count}枚)`;
  passBtn.classList.remove('is-lead-pass');
  passBtn.innerText = 'パスする';
  passBtn.removeAttribute('title');

  if (!latestGameState || !isMyTurn || count === 0) {
    playBtn.disabled = true;
  } else {
    const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));
    const fieldCards = latestGameState.fieldCards || [];
    const rules = latestGameState.rules || {};

    if (fieldCards.length > 0 && selectedCards.length !== fieldCards.length) {
      playBtn.disabled = true;
    } else {
      const validation = isValidPlayClient(selectedCards, fieldCards, rules, latestGameState);
      playBtn.disabled = !validation.valid;
    }
  }

  if (count > 0) {
    passBtn.disabled = true;
    passBtn.style.visibility = 'visible';
    return;
  }

  if (!latestGameState || !isMyTurn || isHandSelection) {
    passBtn.style.visibility = 'hidden';
    passBtn.disabled = true;
  } else {
    passBtn.style.visibility = 'visible';
    passBtn.disabled = false;
  }
}

function updateHand(hand) {
  const handEl = document.getElementById('hand');
  if (!handEl) return;

  const handSection = handEl.closest('.hand-section');
  const currentSocketId = socket.id || myId;
  const visibleHand = pendingSideSelection
    ? hand.filter(card => !pendingSideSelection.playedCardIds.has(card.id))
    : hand;
  const canAct = !!latestGameState && (
    !!pendingExchangeSelection
    || !!pendingSideSelection
    || (latestGameState.status === 'playing' && latestGameState.turnPlayerId === currentSocketId)
  );
  document.body.classList.toggle('has-three-row-hand', canAct && visibleHand.length > 18);
  handSection?.classList.toggle('is-my-turn', canAct);
  handSection?.classList.toggle('is-waiting', !!latestGameState && !canAct);
  handEl.classList.toggle('is-multi-row', canAct && visibleHand.length > 13);

  if (visibleHand.length === 0) {
    handEl.innerHTML = '<div style="color: #2ecc71; font-weight: bold; font-size: 18px;">あがり！おめでとうございます！</div>';
  } else {
    const renderedCards = visibleHand.map(c => {
      const isSelected = (pendingExchangeSelection && pendingExchangeSelection.selected.has(c.id))
        || (pendingSideSelection && (
          pendingSideSelection.passSelected.has(c.id) || pendingSideSelection.discardSelected.has(c.id)
        ))
        || selectedCardIds.has(c.id);

      const selectable = pendingExchangeSelection
        ? pendingExchangeSelection.selected.size < pendingExchangeSelection.required || pendingExchangeSelection.selected.has(c.id)
        : pendingSideSelection
          ? (!pendingSideSelection.playedCardIds.has(c.id)
            && !pendingSideSelection.passSelected.has(c.id)
            && !pendingSideSelection.discardSelected.has(c.id))
            || pendingSideSelection.passSelected.has(c.id)
            || pendingSideSelection.discardSelected.has(c.id)
          : isCardSelectable(c);

      return renderCard(c, true, isSelected, selectable);
    });
    const cardsPerRow = DAIFUGO_LAYOUT.maxHandCardsPerRow;
    const rowSizes = Array.from({ length: Math.ceil(renderedCards.length / cardsPerRow) }, (_, rowIndex) => (
      Math.min(cardsPerRow, renderedCards.length - rowIndex * cardsPerRow)
    ));
    let cardOffset = 0;
    handEl.innerHTML = rowSizes.map(rowSize => {
      const rowCards = renderedCards.slice(cardOffset, cardOffset + rowSize);
      cardOffset += rowSize;
      return `<div class="hand-row">${rowCards.join('')}</div>`;
    }).join('');
  }
  updatePlayButton();
}

function beginSideSelection(cardsToPlay) {
  const remainingCount = currentHand.length - cardsToPlay.length;
  const rules = latestGameState?.rules || {};
  const passCount = rules.sevenPass === false ? 0 : Math.min(cardsToPlay.filter(c => c.num === 7).length, remainingCount);
  const discardCount = Math.min(
    rules.tenDiscard === false ? 0 : cardsToPlay.filter(c => c.num === 10).length,
    remainingCount - passCount
  );

  if (passCount === 0 && discardCount === 0) {
    return { discardCards: [], passedCards: [] };
  }

  selectedCardIds = new Set(cardsToPlay.map(c => c.id));
  pendingSideSelection = {
    required: { pass: passCount, discard: discardCount },
    passSelected: new Set(),
    discardSelected: new Set(),
    playedCardIds: new Set(cardsToPlay.map(c => c.id)),
    target: passCount > 0 ? 'pass' : 'discard'
  };

  showStagedSidePlay(socket.id || myId, cardsToPlay, pendingSideSelection.required);
  return null;
}

function showStagedSidePlay(playerId, cards, requirements = { pass: 0, discard: 0 }) {
  stagedSidePlay = { playerId, cards, requirements };
  if (!latestGameState) return;
  updateUI(latestGameState);
  updateHand(currentHand);
}

function finalizeSideSelection() {
  if (!pendingSideSelection) {
    return { discardCards: [], passedCards: [] };
  }

  const passCards = currentHand.filter(c => pendingSideSelection.passSelected.has(c.id));
  const discardCards = currentHand.filter(c => pendingSideSelection.discardSelected.has(c.id));

  if (pendingSideSelection.required.pass > 0 && passCards.length !== pendingSideSelection.required.pass) {
    showError(`7渡しは${pendingSideSelection.required.pass}枚選んでください`);
    return null;
  }
  if (pendingSideSelection.required.discard > 0 && discardCards.length !== pendingSideSelection.required.discard) {
    showError(`10捨ては${pendingSideSelection.required.discard}枚選んでください`);
    return null;
  }

  const cardsToPlay = currentHand.filter(c => pendingSideSelection.playedCardIds.has(c.id));
  selectedCardIds = new Set(cardsToPlay.map(c => c.id));
  pendingSideSelection = null;
  return { discardCards: discardCards.map(c => c.id), passedCards: passCards.map(c => c.id), cardsToPlay };
}

function submitPlayCards() {
  clearError();

  if (pendingExchangeSelection) {
    const cards = currentHand.filter(c => pendingExchangeSelection.selected.has(c.id));
    socket.emit('exchange-cards', {
      roomId: myRoomId,
      cards
    });
    return;
  }

  if (pendingSideSelection) {
    const completed = finalizeSideSelection();
    if (!completed) return;

    socket.emit('play-cards', {
      roomId: myRoomId,
      cards: completed.cardsToPlay,
      discardCards: completed.discardCards,
      passedCards: completed.passedCards
    });
    return;
  }

  if (selectedCardIds.size === 0) {
    showError('出すカードを選択してください');
    return;
  }

  const cardsToPlay = currentHand.filter(c => selectedCardIds.has(c.id));
  const extraSelection = beginSideSelection(cardsToPlay);
  if (extraSelection === null) {
    socket.emit('pause-turn-timer', {
      roomId: myRoomId,
      cards: cardsToPlay.map(card => card.id)
    });
    renderTurnCountdown(null);
    return;
  }

  socket.emit('play-cards', {
    roomId: myRoomId,
    cards: cardsToPlay,
    discardCards: extraSelection.discardCards,
    passedCards: extraSelection.passedCards
  });
}

// パス
function passTurn() {
  clearError();

  if (!latestGameState) return;
  const currentSocketId = socket.id || myId;
  const isMyTurn = latestGameState.turnPlayerId === currentSocketId;
  const isHandSelection = !!(latestGameState.isHandSelection || latestGameState.isHandShuffling);

  if (selectedCardIds.size > 0) {
    showError('カード選択中はパスできません');
    return;
  }

  if (!isMyTurn || isHandSelection) {
    showError('自分のターン中だけパスできます');
    return;
  }

  selectedCardIds.clear();
  updateHand(currentHand);
  socket.emit('pass-turn', myRoomId);
}

function clearPreviousRoundResultIfSeriesChanged(data) {
  if (!previousRoundResult || !data) return;
  const previousIds = previousRoundResult.players.map(player => player.id).sort();
  const currentIds = (data.players || []).map(player => player.id).sort();
  const roomChanged = data.roomId && data.roomId !== previousRoundResult.roomId;
  const roundReset = Number.isFinite(Number(data.completedRounds))
    && Number(data.completedRounds) < previousRoundResult.completedRounds;

  if (roomChanged || data.gameType !== previousRoundResult.gameType || roundReset
    || previousIds.join('|') !== currentIds.join('|')) {
    previousRoundResult = null;
  }
}

function createPreviousRoundResultSnapshot(data) {
  return {
    roomId: data.roomId,
    gameType: data.gameType,
    hostId: data.hostId,
    completedRounds: Number(data.completedRounds) || 0,
    chinchiroParentId: data.chinchiroParentId,
    chinchiroTurnOrder: [...(data.chinchiroTurnOrder || [])],
    players: (data.players || []).map(player => ({
      id: player.id,
      name: player.name,
      rank: player.rank,
      role: player.role,
      cardCount: player.cardCount,
      totalPoints: player.totalPoints,
      soshies: player.soshies,
      soshiesDelta: player.soshiesDelta,
      chinchiroHand: player.chinchiroHand ? { ...player.chinchiroHand } : null
    }))
  };
}

function renderRoundResultList(listElement, data) {
  if (!data?.players?.length) {
    listElement.innerHTML = '<p class="previous-result-empty">前回の結果はありません</p>';
    return;
  }

  const currentSocketId = socket.id || myId;
  let sortedPlayers;
  if (data.gameType === 'chinchiro') {
    const parent = data.players.find(player => player.id === data.chinchiroParentId);
    const turnOrder = new Map((data.chinchiroTurnOrder || []).map((playerId, index) => [playerId, index]));
    const children = data.players
      .filter(player => player.id !== data.chinchiroParentId)
      .sort((left, right) =>
        (turnOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (turnOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    sortedPlayers = parent ? [parent, ...children] : children;
  } else {
    sortedPlayers = [...data.players].sort((left, right) => {
      if (left.rank && right.rank) return left.rank - right.rank;
      if (left.rank) return -1;
      if (right.rank) return 1;
      return left.cardCount - right.cardCount;
    });
  }

  listElement.innerHTML = sortedPlayers.map((player, index) => {
    const rankTitle = data.gameType === 'chinchiro' && player.id === data.chinchiroParentId
      ? '親'
      : player.rank ? `${player.rank}位` : `${index + 1}位`;
    const points = data.gameType === 'chinchiro'
      ? (player.soshiesDelta || 0)
      : (ROLE_POINTS[player.role] ?? 0);
    const pointsLabel = points > 0 ? `+${points}` : String(points);
    const isMe = player.id === currentSocketId;

    return `
      <div class="ranking-item rank-${player.rank || index + 1}${isMe ? ' is-me' : ''}${data.gameType === 'chinchiro' ? ' is-chinchiro' : ''}">
        <span class="ranking-place">${rankTitle}</span>
        <span class="ranking-player"><strong>${escapeHtml(player.name)}</strong></span>
        ${data.gameType === 'chinchiro'
          ? `<span class="ranking-role"><span class="chinchiro-result-badge">${escapeHtml(player.chinchiroHand?.label || player.role || '—')}</span></span>`
          : `<span class="ranking-role">${getRoleBadge(player.role)}</span>`}
        <span class="ranking-result-meta"><strong>${pointsLabel}</strong><small>${data.gameType === 'chinchiro' ? 'S' : 'pt'}</small></span>
      </div>
    `;
  }).join('');
}

// ゲーム終了表示
function renderOverallRanking(listElement, roundsElement, data) {
  const currentSocketId = socket.id || myId;
  const isChinchiro = data.gameType === 'chinchiro';
  const scoreFor = player => isChinchiro ? (player.soshies || 0) : (player.totalPoints || 0);
  const players = [...(data.players || [])].sort((a, b) =>
    scoreFor(b) - scoreFor(a)
    || (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER)
    || a.name.localeCompare(b.name, 'ja')
  );

  roundsElement.innerText = data.completedRounds
    ? `${data.completedRounds}戦・${isChinchiro ? 'ソシー' : 'ポイント'}累計`
    : '1戦目 · 対局中';
  listElement.replaceChildren();

  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `overall-ranking-item ${isChinchiro ? 'is-chinchiro' : ''} ${player.id === currentSocketId ? 'is-me' : ''}`;

    const rank = document.createElement('span');
    rank.className = 'overall-rank-number';
    rank.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'overall-player-name';
    name.textContent = player.name;

    const points = document.createElement('strong');
    points.className = 'overall-points';
    points.append(document.createTextNode(String(scoreFor(player))));
    const unit = document.createElement('small');
    unit.textContent = isChinchiro ? 'S' : 'pt';
    points.appendChild(unit);

    row.append(rank, name, points);
    listElement.appendChild(row);
  });
}

function toggleOverallRanking(forceOpen) {
  const modal = document.getElementById('overall-ranking-modal');
  const shouldOpen = forceOpen ?? modal.style.display !== 'flex';
  if (!shouldOpen) {
    modal.style.display = 'none';
    return;
  }
  if (!latestGameState) return;

  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  renderOverallRanking(
    document.getElementById('live-overall-ranking-list'),
    document.getElementById('live-overall-ranking-rounds'),
    latestGameState
  );
  renderRoundResultList(
    document.getElementById('live-previous-result-list'),
    previousRoundResult?.gameType === latestGameState.gameType ? previousRoundResult : null
  );
  modal.style.display = 'flex';
}

function returnToRoomLobby() {
  const room = latestGameState;
  if (!room) {
    myRoomId = '';
    isHost = false;
    clearRecoveryState();
    resetToLobbyView();
    return;
  }

  document.getElementById('lobby-container').style.display = 'block';
  document.getElementById('game-container').style.display = 'none';
  document.getElementById('game-finished-modal').style.display = 'none';
  document.getElementById('rules-modal').style.display = 'none';
  document.getElementById('overall-ranking-modal').style.display = 'none';
  document.body.classList.remove('game-active', 'revolution-mode', 'chinchiro-mode');
  document.documentElement.classList.remove('revolution-mode');
  renderTurnCountdown(null);
  resetViewportLayout();
  clearSelectionState();
  pendingExchangeSelection = null;
  currentHand = [];
  updateWaitingRoom(room);
}

function leaveGame() {
  if (!myRoomId || !window.confirm('このルームから退出しますか？')) return;
  socket.emit('leave-room', myRoomId);
}

socket.on('room-left', ({ roomId } = {}) => {
  if (!roomId || roomId !== myRoomId) return;
  clearRecoveryState();
  myRoomId = '';
  isHost = false;
  if (getRoomIdFromPath() === roomId) window.history.replaceState({}, '', '/');
  resetToLobbyView();
});

function showGameFinished(data) {
  const modal = document.getElementById('game-finished-modal');
  document.getElementById('overall-ranking-modal').style.display = 'none';
  previousRoundResult = createPreviousRoundResultSnapshot(data);
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  const rankingList = document.getElementById('ranking-list');
  const overallRankingList = document.getElementById('overall-ranking-list');
  const overallRankingRounds = document.getElementById('overall-ranking-rounds');
  const nextGameBtn = document.getElementById('next-game-btn');
  const guestNextHint = document.getElementById('guest-next-hint');
  const currentSocketId = socket.id || myId;
  document.querySelector('.result-summary').textContent = data.gameType === 'chinchiro'
    ? '今回のソシー増減と残高'
    : '今回の順位と役職ポイント';
  renderRoundResultList(rankingList, data);

  renderOverallRanking(overallRankingList, overallRankingRounds, data);

  const amIHost = isHost || (data.hostId === currentSocketId);

  if (amIHost) {
    nextGameBtn.style.display = 'inline-block';
    nextGameBtn.innerText = data.gameType === 'chinchiro'
      ? '次のラウンドを開始'
      : '次のゲームを開始（カード交換あり）';
    guestNextHint.style.display = 'none';
  } else {
    nextGameBtn.style.display = 'none';
    guestNextHint.style.display = 'block';
  }

  modal.style.display = 'flex';
}

// 開発用プレビュー。通常対局の状態やルームには接続せず、同じ描画関数へ固定サンプルを渡す。
function isLayoutPreviewEnabled() {
  return layoutPreviewModes.includes(layoutPreviewMode);
}

function createLayoutPreviewState() {
  const previewPlayerId = socket.id || myId || 'layout-preview-player';
  const players = [
    { id: previewPlayerId, name: 'あなた', role: '大富豪', rank: 1, cardCount: 18, totalPoints: 8 },
    { id: 'preview-player-2', name: 'みかん', role: '富豪', rank: 2, cardCount: 12, totalPoints: 5 },
    { id: 'preview-player-3', name: 'こはく', role: '平民', rank: 3, cardCount: 9, totalPoints: 2 },
    { id: 'preview-player-4', name: 'しらたま', role: '平民', rank: 4, cardCount: 6, totalPoints: 1 },
    { id: 'preview-player-5', name: 'くろまめ', role: '貧民', rank: 5, cardCount: 4, totalPoints: -2 },
    { id: 'preview-player-6', name: 'ゆず', role: '大貧民', rank: 6, cardCount: 2, totalPoints: -4 }
  ];
  if (layoutPreviewMode === 'game' || layoutPreviewMode === 'ranking' || layoutPreviewMode === 'result') {
    players.push(
      { id: 'preview-player-7', name: 'あずき', role: '平民', rank: 7, cardCount: 1, totalPoints: -5 },
      { id: 'preview-player-8', name: 'もなか', role: '平民', rank: 8, cardCount: 0, totalPoints: -6 }
    );
  }
  const hand = Array.from({ length: 27 }, (_, index) => ({
    id: `preview-card-${index}`,
    suit: ['♠', '♥', '♦', '♣'][index % 4],
    num: index % 13 + 1
  }));
  const status = layoutPreviewMode === 'result' ? 'finished' : 'playing';

  return {
    roomId: 'PREVIEW',
    hostId: previewPlayerId,
    gameType: 'daifugo',
    status,
    players,
    hand,
    turnPlayerId: previewPlayerId,
    turnPlayerName: 'あなた',
    fieldCards: [{ id: 'preview-field-card', suit: '♥', num: 8 }],
    actionMessage: 'みかん が ♥8 を出しました',
    rules: { staircase: true, fiveSkip: true, sevenPass: true, tenDiscard: true, jackBack: true },
    completedRounds: 4,
    roundNumber: 5,
    isRevolution: false,
    isElevenBack: false,
    lockedSuit: null,
    lockedNumber: null
  };
}

function createLayoutChinchiroPreviewState() {
  const previewPlayerId = socket.id || myId || 'layout-preview-player';
  const playerIds = [previewPlayerId, 'preview-chinchiro-2', 'preview-chinchiro-3', 'preview-chinchiro-4', 'preview-chinchiro-5', 'preview-chinchiro-6'];
  const players = [
    { id: playerIds[0], name: 'あなた', rank: 1, soshies: 1360, soshiesDelta: 120, chinchiroBet: null, rollsUsed: 1, chinchiroHand: { label: 'シゴロ' }, dice: [4, 5, 6] },
    { id: playerIds[1], name: 'みかん', rank: 2, soshies: 1120, soshiesDelta: 40, chinchiroBet: 100, rollsUsed: 2, chinchiroHand: { label: '目なし' }, dice: [2, 4, 1] },
    { id: playerIds[2], name: 'こはく', rank: 3, soshies: 980, soshiesDelta: -20, chinchiroBet: 50, rollsUsed: 1, chinchiroHand: { label: 'ワンツー' }, dice: [1, 2, 5] },
    { id: playerIds[3], name: 'しらたま', rank: 4, soshies: 840, soshiesDelta: -40, chinchiroBet: 100, rollsUsed: 3, chinchiroHand: { label: '目なし' }, dice: [2, 3, 5] },
    { id: playerIds[4], name: 'くろまめ', rank: 5, soshies: 720, soshiesDelta: -50, chinchiroBet: 50, rollsUsed: 2, chinchiroHand: { label: 'ヒフミ' }, dice: [1, 2, 3] },
    { id: playerIds[5], name: 'ゆず', rank: 6, soshies: 640, soshiesDelta: -50, chinchiroBet: 50, rollsUsed: 2, chinchiroHand: { label: '目なし' }, dice: [2, 4, 6] }
  ];
  playerIds.push('preview-chinchiro-7', 'preview-chinchiro-8');
  players.push(
    { id: playerIds[6], name: 'あずき', rank: 7, soshies: 520, soshiesDelta: -60, chinchiroBet: 50, rollsUsed: 3, chinchiroHand: { label: '目なし' }, dice: [2, 4, 6] },
    { id: playerIds[7], name: 'もなか', rank: 8, soshies: 480, soshiesDelta: -80, chinchiroBet: 50, rollsUsed: 3, chinchiroHand: { label: 'ワンツー' }, dice: [1, 2, 4] }
  );
  const round = 5;
  const chinchiroHistory = [
    { id: 1, round, playerId: playerIds[1], playerName: 'みかん', dice: [2, 4, 1], label: '目なし', rollNumber: 2, confirmed: true },
    { id: 2, round, playerId: playerIds[0], playerName: 'あなた', dice: [4, 5, 6], label: 'シゴロ', rollNumber: 1, confirmed: true }
  ];

  return {
    roomId: 'PREVIEW',
    hostId: previewPlayerId,
    gameType: 'chinchiro',
    status: layoutPreviewMode === 'chinchiro-result' ? 'finished' : 'playing',
    players,
    turnPlayerId: previewPlayerId,
    chinchiroParentId: previewPlayerId,
    chinchiroPhase: 'rolling',
    chinchiroTurnOrder: playerIds,
    chinchiroHistory,
    completedRounds: layoutPreviewMode === 'chinchiro-result' ? round : round - 1
  };
}

function renderLayoutPreviewLobby() {
  const players = [
    ['あなた', '大富豪'], ['みかん', '富豪'], ['こはく', '平民'], ['しらたま', '平民'],
    ['くろまめ', '貧民'], ['ゆず', '大貧民'], ['あずき', '平民'], ['もなか', '平民']
  ];
  document.getElementById('display-room-id').textContent = '48216';
  document.getElementById('display-game-type').textContent = '大富豪';
  document.getElementById('player-count').textContent = String(players.length);
  document.getElementById('room-max-players').textContent = '8';
  document.getElementById('cpu-count').textContent = '0';
  document.getElementById('display-rules').style.display = 'flex';
  renderRuleBadges('display-rules', { staircase: true, fiveSkip: true, sevenPass: true, tenDiscard: true, jackBack: true });
  document.getElementById('players-list').innerHTML = players.map(([name, role], index) => `
    <div class="player-item ${index === 0 ? 'is-me' : ''}">
      <span>${name} ${getRoleBadge(role)} ${index === 0 ? '<strong>(あなた)</strong>' : ''}</span>
      ${index === 0 ? '<span class="host-tag">ホスト</span>' : ''}
    </div>
  `).join('');
  document.getElementById('cpu-controls').style.display = 'grid';
  document.getElementById('host-controls').style.display = 'grid';
  document.getElementById('guest-waiting-msg').style.display = 'none';
  document.getElementById('start-btn').disabled = false;
  document.getElementById('add-cpu-btn').disabled = true;
  document.getElementById('remove-cpu-btn').disabled = true;
  document.getElementById('cpu-difficulty-select').value = 'normal';
  document.getElementById('room-lock-status').style.display = 'none';
  document.getElementById('room-lock-btn').dataset.locked = 'false';
  document.getElementById('room-lock-btn').textContent = '新規参加をロック';
}

function renderLayoutPreview() {
  if (!isLayoutPreviewEnabled()) return;

  const gameContainer = document.getElementById('game-container');
  const lobbyContainer = document.getElementById('lobby-container');
  const lobbyFormArea = document.getElementById('lobby-form-area');
  const waitingArea = document.getElementById('waiting-area');
  const isLobbyPreview = layoutPreviewMode === 'home' || layoutPreviewMode === 'lobby';
  const isChinchiroPreview = layoutPreviewMode === 'chinchiro'
    || layoutPreviewMode === 'chinchiro-ranking'
    || layoutPreviewMode === 'chinchiro-result';
  if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
  chinchiroResultTimer = null;

  myRoomId = '';
  isHost = true;
  document.body.classList.add('layout-preview');
  document.body.classList.remove('revolution-mode');
  document.documentElement.classList.remove('revolution-mode');
  document.getElementById('room-chat-root').hidden = true;
  ['game-finished-modal', 'rules-modal', 'overall-ranking-modal', 'chinchiro-history-modal'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });

  if (isLobbyPreview) {
    document.body.classList.remove('game-active', 'chinchiro-mode');
    lobbyContainer.style.display = 'block';
    gameContainer.style.display = 'none';
    waitingArea.style.display = layoutPreviewMode === 'lobby' ? 'block' : 'none';
    lobbyFormArea.style.display = layoutPreviewMode === 'home' ? 'flex' : 'none';
    lobbyFormArea.style.flexDirection = 'column';
    lobbyFormArea.style.width = '100%';
    document.getElementById('form-create').style.display = 'block';
    document.getElementById('form-join').style.display = 'none';
    if (layoutPreviewMode === 'lobby') renderLayoutPreviewLobby();
    applyViewportFit();
    renderLayoutPreviewToolbar();
    return;
  }

  document.body.classList.add('game-active');
  document.body.classList.toggle('chinchiro-mode', isChinchiroPreview);
  lobbyContainer.style.display = 'none';
  gameContainer.style.display = 'block';
  document.getElementById('game-room-id').textContent = 'PREVIEW';
  document.getElementById('game-rules-badges').style.display = 'none';
  clearPreviousFieldCards();
  clearSelectionState();
  if (isChinchiroPreview) {
    const previewState = createLayoutChinchiroPreviewState();
    latestGameState = previewState;
    if (['chinchiro', 'chinchiro-ranking'].includes(layoutPreviewMode)
      && previousRoundResult?.gameType !== previewState.gameType) {
      previousRoundResult = createPreviousRoundResultSnapshot({
        ...previewState,
        status: 'finished',
        completedRounds: previewState.completedRounds || 1
      });
    }
    renderRulesModal(previewState.rules, previewState.gameType);
    updateUI(previewState);
    if (layoutPreviewMode === 'chinchiro-result') {
      if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
      chinchiroResultTimer = null;
      showGameFinished(previewState);
    }
  } else {
    const previewState = createLayoutPreviewState();
    latestGameState = previewState;
    currentHand = previewState.hand;
    if (['game', 'ranking'].includes(layoutPreviewMode)
      && previousRoundResult?.gameType !== previewState.gameType) {
      previousRoundResult = createPreviousRoundResultSnapshot({ ...previewState, status: 'finished' });
    }
    renderRulesModal(previewState.rules, previewState.gameType);
    updateUI(previewState);
    updateHand(currentHand);
    if (layoutPreviewMode === 'result') showGameFinished(previewState);
  }
  applyViewportFit();
  if (layoutPreviewMode === 'ranking' || layoutPreviewMode === 'chinchiro-ranking') {
    toggleOverallRanking(true);
  }
  renderLayoutPreviewToolbar();
}

function setLayoutPreviewMode(mode) {
  if (!layoutPreviewModes.includes(mode)) return;
  layoutPreviewMode = mode;
  const url = new URL(window.location.href);
  url.searchParams.set('preview', mode);
  window.history.replaceState({}, '', url);
  renderLayoutPreview();
}

function renderLayoutPreviewToolbar() {
  let toolbar = document.getElementById('layout-preview-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('nav');
    toolbar.id = 'layout-preview-toolbar';
    toolbar.className = 'layout-preview-toolbar';
    toolbar.setAttribute('aria-label', '画面プレビュー');
    toolbar.innerHTML = `
      <button class="layout-preview-drag-handle" type="button" aria-label="プレビュー操作バーをドラッグ" title="ドラッグして移動">⠿</button>
      <strong>レイアウト確認</strong>
      <select class="layout-preview-mode-select" data-preview-mode-select aria-label="プレビュー画面">
        ${layoutPreviewModeGroups.map(group => `
          <optgroup label="${group.label}">
            ${group.screens.map(screen => `<option value="${screen.value}">${screen.label}</option>`).join('')}
          </optgroup>
        `).join('')}
      </select>
      <span class="layout-preview-css-status" role="status">CSS監視中</span>
      <a href="/" title="プレビューを終了">終了</a>
    `;
    const dragHandle = toolbar.querySelector('.layout-preview-drag-handle');
    let dragOffset = null;
    dragHandle.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const rect = toolbar.getBoundingClientRect();
      dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      toolbar.style.left = `${rect.left}px`;
      toolbar.style.top = `${rect.top}px`;
      toolbar.style.transform = 'none';
      dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    dragHandle.addEventListener('pointermove', event => {
      if (!dragOffset) return;
      const rect = toolbar.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - dragOffset.x));
      const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - dragOffset.y));
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${top}px`;
    });
    const stopDragging = () => { dragOffset = null; };
    dragHandle.addEventListener('pointerup', stopDragging);
    dragHandle.addEventListener('pointercancel', stopDragging);
    toolbar.addEventListener('change', event => {
      const select = event.target.closest('[data-preview-mode-select]');
      if (select) setLayoutPreviewMode(select.value);
    });
    document.body.appendChild(toolbar);
  }
  toolbar.querySelector('[data-preview-mode-select]').value = layoutPreviewMode;
}

function watchPreviewStylesheet() {
  const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"][href*="/css/"]')];
  const status = document.querySelector('.layout-preview-css-status');
  if (stylesheets.length === 0 || !status) return;

  let lastVersion = null;
  const checkForCssUpdate = async () => {
    try {
      const response = await fetch('/__dev/css-version', { cache: 'no-store' });
      if (!response.ok) throw new Error('CSS version check failed');
      const { version: currentVersion } = await response.json();
      if (lastVersion !== null && currentVersion !== lastVersion) {
        stylesheets.forEach(stylesheet => {
          const nextStylesheet = new URL(stylesheet.href);
          nextStylesheet.searchParams.set('preview-reload', Date.now());
          stylesheet.href = nextStylesheet.href;
        });
        status.textContent = 'CSSを反映しました';
        window.setTimeout(() => { status.textContent = 'CSS監視中'; }, 1500);
      }
      lastVersion = currentVersion;
    } catch {
      status.textContent = 'CSS監視を再接続中';
    }
  };

  checkForCssUpdate();
  window.setInterval(checkForCssUpdate, 700);
}

// Enterキーでの送信対応
document.addEventListener('DOMContentLoaded', () => {
  ['create-room-id', 'join-room-id'].forEach(id => {
    const input = document.getElementById(id);
    input?.addEventListener('input', () => sanitizeRoomIdInput(input));
  });

  const createInputs = ['create-player-name', 'create-room-id'];
  updateGameSetup();
  createInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createRoom();
      });
    }
  });

  const joinInputs = ['join-player-name', 'join-room-id'];
  joinInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinRoom();
      });
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!myRoomId) return;

    saveRecoveryState();
    const message = '部屋に入っている状態です。閉じると再開時に復帰できます。';
    event.preventDefault();
    event.returnValue = message;
    return message;
  });

  window.addEventListener('resize', applyViewportFit);
  window.visualViewport?.addEventListener('resize', applyViewportFit);
  window.addEventListener('load', () => {
    syncRoomIdInputFromUrl();
  });
  if (isLayoutPreviewEnabled()) {
    renderLayoutPreview();
    watchPreviewStylesheet();
  } else {
    restoreRecoveryState();
  }
  applyViewportFit();
});
