const { createDeck } = require('../utils/deck');
const gameRegistry = require('./gameRegistry');
const {
  createCpuPlayer,
  createHumanPlayer,
  createJoinRequest,
  createRoomState,
  consumeJoinRequest,
  rebindPlayerConnection,
  ROOM_STATUS
} = require('../core/roomState');

class RoomManager {
  constructor() {
    this.rooms = {};
  }

  createRoom(socket, { roomId, playerName, playerId, rules, gameType = 'daifugo' }) {
    if (!roomId || !roomId.trim()) {
      return { success: false, message: 'ルームIDを入力してください' };
    }

    const trimmedId = roomId.trim();
    if (this.rooms[trimmedId]) {
      return { success: false, message: 'そのルームIDは既に使用されています。別のルームIDを指定してください。' };
    }

    const game = gameRegistry.get(gameType);
    if (!game) return { success: false, message: '指定されたゲームは利用できません。' };

    const hostPlayer = createHumanPlayer({
      id: socket.id,
      playerId: playerId || socket.id,
      name: (playerName && playerName.trim()) || 'ホスト'
    });
    const newRoom = createRoomState({
      id: trimmedId,
      hostId: socket.id,
      gameType: game.id,
      maxPlayers: game.maxPlayers,
      rules: game.createRules(rules),
      hostPlayer,
      initialState: game.createInitialState()
    });

    this.rooms[trimmedId] = newRoom;
    return { success: true, room: newRoom };
  }

  joinRoom(socket, { roomId, playerName, playerId }) {
    if (!roomId || !roomId.trim()) {
      return { success: false, message: 'ルームIDを入力してください' };
    }

    const trimmedId = roomId.trim();
    const room = this.rooms[trimmedId];
    if (!room) {
      return { success: false, message: 'ルームが見つかりません。ルームIDを確認するか、新規作成してください。' };
    }

    const existingPlayer = room.players.find(p => p.playerId === (playerId || socket.id));
    if (existingPlayer) {
      rebindPlayerConnection(
        room,
        existingPlayer,
        socket.id,
        (playerName && playerName.trim()) || existingPlayer.name || `プレイヤー${room.players.length + 1}`
      );
      return { success: true, room, playerId: existingPlayer.playerId };
    }

    if (room.status !== ROOM_STATUS.WAITING) {
      return { success: false, message: 'このゲームは現在プレイ中です' };
    }

    if (room.isLocked) {
      return { success: false, message: 'このルームはロックされています' };
    }

    this.resetSeriesForRosterChange(room);

    if (room.players.length >= room.maxPlayers) {
      let cpuIndex = -1;
      for (let index = room.players.length - 1; index >= 0; index--) {
        if (room.players[index].isCpu) {
          cpuIndex = index;
          break;
        }
      }
      if (cpuIndex === -1) {
        return { success: false, message: `部屋が満員です（最大${room.maxPlayers}人まで参加可能）` };
      }
      room.players.splice(cpuIndex, 1);
    }

    const newPlayer = createHumanPlayer({
      id: socket.id,
      playerId: playerId || socket.id,
      name: (playerName && playerName.trim()) || `プレイヤー${room.players.length + 1}`
    });
    room.players.push(newPlayer);

    return { success: true, room, playerId: newPlayer.playerId };
  }

  requestJoin(socket, { roomId, playerName, playerId }) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが見つかりません。' };
    if (room.status !== 'playing' && room.status !== 'finished') {
      return { success: false, message: 'このルームは途中参加の受付状態ではありません。' };
    }
    if (room.isLocked) return { success: false, message: 'このルームはロックされています。' };
    if (room.players.length >= room.maxPlayers) return { success: false, message: 'ルームが満員です。' };

    const stablePlayerId = playerId || socket.id;
    const existingRequest = Object.values(room.joinRequests || {})
      .find(request => request.playerId === stablePlayerId);
    if (existingRequest) return { success: true, request: existingRequest };

    const request = createJoinRequest({
      socketId: socket.id,
      playerId: stablePlayerId,
      playerName: (playerName && playerName.trim()) || `プレイヤー${room.players.length + 1}`
    });
    room.joinRequests[request.requestId] = request;
    return { success: true, request, hostId: room.hostId };
  }

  approveJoinRequest(socketId, roomId, requestId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが見つかりません。' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみ許可できます。' };
    const request = room.joinRequests?.[requestId];
    if (!request) return { success: false, message: '参加申請が見つかりません。' };
    if (room.players.length >= room.maxPlayers) return { success: false, message: 'ルームが満員です。' };

    const player = {
      ...createHumanPlayer({
        id: request.socketId,
        playerId: request.playerId,
        name: request.playerName
      }),
      role: '平民',
      isLateJoiner: true
    };
    room.players.push(player);
    consumeJoinRequest(room, requestId);
    room.actionMessage = `${player.name}が途中参加しました`;
    return { success: true, room, player };
  }

  rejectJoinRequest(socketId, roomId, requestId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが見つかりません。' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみ拒否できます。' };
    const request = room.joinRequests?.[requestId];
    if (!request) return { success: false, message: '参加申請が見つかりません。' };
    consumeJoinRequest(room, requestId);
    return { success: true, room, request };
  }

  addCpuPlayer(socketId, roomId, difficulty = 'normal') {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみCPUを追加できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はCPUを変更できません' };
    }
    if (room.players.length >= room.maxPlayers) return { success: false, message: `参加人数は最大${room.maxPlayers}人です` };

    this.resetSeriesForRosterChange(room);

    const cpuNumber = room.nextCpuNumber++;
    const cpuId = `cpu-${room.id}-${cpuNumber}`;
    const cpuDifficulty = ['easy', 'normal', 'hard', 'strongest'].includes(difficulty) ? difficulty : 'normal';
    room.players.push({
      ...createCpuPlayer({ id: cpuId, name: `CPU ${cpuNumber}`, difficulty: cpuDifficulty })
    });
    room.actionMessage = `CPU ${cpuNumber}が参加しました`;
    return { success: true, room };
  }

  removeCpuPlayer(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみCPUを削除できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はCPUを変更できません' };
    }

    const cpuIndex = room.players.findLastIndex(player => player.isCpu);
    if (cpuIndex === -1) return { success: false, message: '削除できるCPUがいません' };

    this.resetSeriesForRosterChange(room);
    const [removedCpu] = room.players.splice(cpuIndex, 1);
    room.actionMessage = `${removedCpu.name}が退出しました`;
    return { success: true, room };
  }

  resetSeriesForRosterChange(room) {
    if (!room.completedRounds) return;

    room.completedRounds = 0;
    room.previousRoles = null;
    room.winners = [];
    room.players.forEach(player => {
      player.totalPoints = 0;
      player.rank = null;
      player.role = null;
      player.previousRole = null;
      if (room.gameType === 'chinchiro') {
        player.soshies = 1000;
        player.soshiesDelta = 0;
        player.chinchiroBet = null;
      }
    });
  }

  setRoomLock(socketId, roomId, isLocked) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみロックを変更できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はロックを変更できません' };
    }

    room.isLocked = !!isLocked;
    room.actionMessage = room.isLocked ? 'ルームをロックしました' : 'ルームのロックを解除しました';
    return { success: true, room };
  }

  startGame(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };

    if (room.hostId !== socketId) {
      return { success: false, message: 'ルーム作成者（ホスト）のみがゲームを開始できます' };
    }

    if (room.players.length < 2) {
      return { success: false, message: 'ゲームを開始するには2人以上のプレイヤーが必要です' };
    }

    return gameRegistry.get(room.gameType).engine.startRound(this, room);
  }

  getEngine(gameType = 'daifugo') {
    return gameRegistry.get(gameType)?.engine || null;
  }

  getEngineForRoom(roomId) {
    return this.getEngine(this.rooms[roomId]?.gameType);
  }

  performGameAction(socketId, roomId, action, payload) {
    const room = this.rooms[roomId];
    const engine = this.getEngineForRoom(roomId);
    const handler = engine?.actions?.[action] || engine?.[action];
    if (!room || typeof handler !== 'function') {
      return { success: false, message: 'このゲーム操作は利用できません' };
    }
    return handler(room, socketId, payload);
  }

  selectStartingPlayer(room) {
    return this.getEngine(room.gameType)?.selectStartingPlayer?.(room);
  }

  buildExchangePlan(room) {
    return this.getEngine(room.gameType)?.buildExchangePlan?.(room) || [];
  }

  handleCardExchange(room, selections = {}) {
    return this.getEngine(room.gameType)?.handleCardExchange?.(room, selections);
  }

  getNextTurnIndex(room, currentIndex, skipCount = 1) {
    return this.getEngine(room.gameType)?.getNextTurnIndex?.(room, currentIndex, skipCount);
  }

  submitExchangeCards(socketId, { roomId, cards }) {
    const engine = this.getEngineForRoom(roomId);
    if (!engine?.submitExchangeCards) return { success: false, message: 'カード交換は利用できません' };
    return engine.submitExchangeCards(this, socketId, { roomId, cards });
  }

  getSideSelectionRequirements(room, player, playedCards) {
    return this.getEngine(room.gameType)?.getSideSelectionRequirements?.(room, player, playedCards);
  }

  playCards(socketId, { roomId, cards, discardCards = [], passedCards = [] }) {
    const engine = this.getEngineForRoom(roomId);
    if (!engine?.playCards) return { success: false, message: 'カードプレイは利用できません' };
    return engine.playCards(this, socketId, { roomId, cards, discardCards, passedCards });
  }

  passTurn(socketId, roomId) {
    const engine = this.getEngineForRoom(roomId);
    if (!engine?.passTurn) return { success: false, message: 'パスは利用できません' };
    return engine.passTurn(this, socketId, roomId);
  }

  getNextAvailableRank(room) {
    return this.getEngine(room.gameType)?.getNextAvailableRank?.(room);
  }

  getLastAvailableRank(room) {
    return this.getEngine(room.gameType)?.getLastAvailableRank?.(room);
  }

  checkGameCompletion(room) {
    return this.getEngine(room.gameType)?.checkGameCompletion?.(room);
  }

  assignRoles(room) {
    return this.getEngine(room.gameType)?.assignRoles?.(room);
  }

  getPublicState(room) {
    const game = gameRegistry.get(room.gameType);
    return {
      roomId: room.id,
      hostId: room.hostId,
      gameType: room.gameType,
      maxPlayers: room.maxPlayers,
      status: room.status,
      turnPlayerId: room.players[room.turnIndex]?.id,
      turnPlayerName: room.players[room.turnIndex]?.name,
      turnDeadlineAt: room.turnDeadlineAt || null,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isCpu: !!p.isCpu,
        difficulty: p.difficulty || null,
        totalPoints: p.totalPoints || 0,
        isWinner: p.isWinner || false,
        rank: p.rank || null,
        role: p.role || null,
        ...game.engine.getPublicPlayerState(p)
      })),
      rules: room.rules,
      isLocked: !!room.isLocked,
      completedRounds: room.completedRounds || 0,
      actionMessage: room.actionMessage,
      winners: room.winners.map(w => ({ name: w.name, rank: w.rank, role: w.role })),
      ...game.engine.getPublicState(room)
    };
  }

  closeRoom(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) {
      return { success: false, message: 'ルームが存在しません' };
    }

    if (room.hostId !== socketId) {
      return { success: false, message: 'ルーム作成者のみが閉じられます' };
    }

    delete this.rooms[roomId];
    return { success: true, roomId };
  }

  leaveRoom(socketId, playerId = null) {
    for (const roomId in this.rooms) {
      const room = this.rooms[roomId];
      const playerIdx = room.players.findIndex(p => p.id === socketId || (playerId && p.playerId === playerId));
      if (playerIdx !== -1) {
        const leavingPlayer = room.players[playerIdx];

        if (playerId && leavingPlayer.playerId === playerId) {
          leavingPlayer.connected = false;
          leavingPlayer.id = socketId;
          room.actionMessage = `${leavingPlayer.name} が再接続待ちです`;
          return room;
        }

        room.players.splice(playerIdx, 1);

        if (room.players.length === 0) {
          delete this.rooms[roomId];
          return null;
        }

        if (room.hostId === socketId) {
          room.hostId = room.players[0].id;
        }

        if (room.turnIndex >= room.players.length) {
          room.turnIndex = 0;
        }

        room.actionMessage = `${leavingPlayer.name} が退出しました`;
        return room;
      }
    }
    return null;
  }
}

module.exports = new RoomManager();

