import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateChinchiro, rollDice } = require('../src/game/chinchiro/rules.js');
const chinchiroEngine = require('../src/game/chinchiro/engine.js');

describe('チンチロ役判定', () => {
  it('役の強さをピンゾロ、シゴロ、ゾロ目、役なし、ヒフミの順に判定する', () => {
    const hands = [
      evaluateChinchiro([1, 1, 1]),
      evaluateChinchiro([6, 4, 5]),
      evaluateChinchiro([3, 3, 3]),
      evaluateChinchiro([2, 2, 6]),
      evaluateChinchiro([2, 4, 6]),
      evaluateChinchiro([3, 1, 2])
    ];

    expect(hands.map(hand => hand.type)).toEqual([
      'pinzoro', 'shigoro', 'triple', 'pair', 'no-hand', 'hifumi'
    ]);
    expect(hands.map(hand => hand.strength)).toEqual([...hands]
      .map(hand => hand.strength)
      .sort((left, right) => right - left));
  });

  it('ペアは残り1個の目で比較し、入力配列を変更しない', () => {
    const dice = [5, 2, 2];

    expect(evaluateChinchiro(dice)).toMatchObject({ type: 'pair', label: '5の目' });
    expect(dice).toEqual([5, 2, 2]);
  });

  it('役なし同士は出目にかかわらず同じ強さになる', () => {
    const first = evaluateChinchiro([1, 4, 5]);
    const second = evaluateChinchiro([2, 4, 6]);

    expect(first).toMatchObject({ type: 'no-hand', label: '役なし' });
    expect(second).toMatchObject({ type: 'no-hand', label: '役なし' });
    expect(first.strength).toBe(second.strength);
  });

  it('役なし同士は親勝ちでソシーを精算する', () => {
    const players = [
      {
        id: 'first',
        name: 'A',
        chinchiroHand: evaluateChinchiro([1, 4, 5]),
        chinchiroFinished: true,
        soshies: 100,
        soshiesDelta: 0
      },
      {
        id: 'second',
        name: 'B',
        chinchiroHand: evaluateChinchiro([2, 4, 6]),
        chinchiroFinished: false,
        soshies: 100,
        soshiesDelta: 0
      }
    ];
    const room = {
      players,
      turnIndex: 1,
      completedRounds: 0,
      status: 'playing',
      winners: [],
      chinchiroParentId: 'first',
      chinchiroBets: { second: 10 },
      chinchiroTurnOrder: ['first', 'second']
    };

    chinchiroEngine.finishTurn(room, players[1]);

    expect(players.map(player => player.soshies)).toEqual([110, 90]);
    expect(players.map(player => player.soshiesDelta)).toEqual([10, -10]);
    expect(players.map(player => player.rank)).toEqual([1, 2]);
    expect(room.winners.map(player => player.id)).toEqual(['first']);
  });

  it('ペアの役名は残り1個の出目を表示する', () => {
    expect(evaluateChinchiro([3, 6, 3])).toMatchObject({
      type: 'pair',
      label: '6の目'
    });
  });

  it('無効な出目を拒否し、サイコロを3個振る', () => {
    expect(() => evaluateChinchiro([1, 2])).toThrow(RangeError);
    expect(rollDice(() => 0.5)).toEqual([4, 4, 4]);
  });
});