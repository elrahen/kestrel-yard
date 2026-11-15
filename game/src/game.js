// Match state machine: buy phase -> live round -> round end -> next round.
// Falcons defend, Vipers attack the spike sites. A round is won by
// elimination, by the spike exploding, or by defusal. First to 5 rounds
// takes the match; economy pays for kills, wins, plants and losses.

import { SITES, SPAWNS, WAYPOINTS } from './world.js';
import { nearestWaypoint } from './bots.js';
import { WEAPONS } from './weapons.js';
import { sfx } from './audio.js';

export const PHASE = {
  BUY: 'buy',
  LIVE: 'live',
  END: 'end',
  MATCH: 'match',
};

export class Game {
  constructor(player, bots, hud, callbacks) {
    this.player = player;
    this.bots = bots;
    this.hud = hud;
    this.cb = callbacks; // { onGrenade, onRoundEnd, onMatchEnd }
    this.phase = PHASE.BUY;
    this.round = 1;
    this.maxRounds = 9;
    this.winTarget = 5;
    this.score = { falcon: 0, viper: 0 };
    this.timeLeft = 15;
    this.buyTime = 15;
    this.roundTime = 100;
    this.site = 'A';
    this.spike = { planted: false, site: null, x: 0, z: 0, timer: 35, carrier: 'viper' };
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.roundEndAt = 0;
    this.lossStreak = { falcon: 0, viper: 0 };
    this.demo = false;
  }

  aliveCount(team) {
    let n = team === 'falcon' && this.player.alive ? 1 : 0;
    for (const b of this.bots) if (b.team === team && b.alive) n++;
    return n;
  }

  startMatch() {
    this.score = { falcon: 0, viper: 0 };
    this.round = 1;
    this.lossStreak = { falcon: 0, viper: 0 };
    this.startRound();
  }

  startRound() {
    this.phase = PHASE.BUY;
    this.timeLeft = this.buyTime;
    this.site = Math.random() < 0.5 ? 'A' : 'B';
    this.spike = { planted: false, site: null, x: 0, z: 0, timer: 35, carrier: 'viper' };
    this.plantProgress = 0;
    this.defuseProgress = 0;
    // respawn everyone
    this.player.reset(SPAWNS.falcon[0]);
    const falconBots = this.bots.filter((b) => b.team === 'falcon');
    const viperBots = this.bots.filter((b) => b.team === 'viper');
    falconBots.forEach((b, i) => { b.money = this.player.money; b.buyWeapon(); b.reset(SPAWNS.falcon[i + 1], b.weaponId); });
    viperBots.forEach((b, i) => { b.buyWeapon(); b.reset(SPAWNS.viper[i], b.weaponId); });
    // Vipers pick a carrier and a plan: push the chosen site
    const carrier = viperBots[Math.floor(Math.random() * viperBots.length)];
    carrier.carrier = true;
    const siteWp = nearestWaypoint(SITES[this.site].x, SITES[this.site].z);
    for (const b of viperBots) {
      if (b === carrier) { b.mission = 'plant'; b.setDestination(siteWp); }
      else if (Math.random() < 0.8) { b.setDestination(siteWp); }
      else { b.setDestination(Math.floor(Math.random() * WAYPOINTS.length)); }
    }
    for (const b of falconBots) {
      // defenders split: two to each site, one mid
      const roll = Math.random();
      const wp = roll < 0.4 ? nearestWaypoint(SITES.A.x, SITES.A.z)
        : roll < 0.8 ? nearestWaypoint(SITES.B.x, SITES.B.z)
        : Math.floor(Math.random() * WAYPOINTS.length);
      b.setDestination(wp);
    }
    this.hud.banner(`ROUND ${this.round}`, `Vipers push site ${this.site} — buy up, then hold`);
    this.hud.hideRoundEnd();
    sfx.roundStart();
  }

  startLive() {
    this.phase = PHASE.LIVE;
    this.timeLeft = this.roundTime;
    this.hud.closeBuy();
    this.hud.hint('Hold the sites. Eliminate the Vipers or defuse the spike.');
  }

  // Called by bots when a plant / defuse completes.
  onPlanted(bot) {
    if (this.spike.planted) return;
    this.spike.planted = true;
    this.spike.site = this.site;
    this.spike.x = bot.pos.x;
    this.spike.z = bot.pos.z;
    this.spike.timer = 35;
    this.timeLeft = 35;
    bot.carrier = false;
    this.hud.banner('SPIKE PLANTED', `Site ${this.site} — defuse it before it blows`);
    sfx.plant();
    // defenders converge on the site
    for (const b of this.bots) {
      if (b.team === 'falcon' && b.alive) {
        b.mission = 'defuse';
        b.setDestination(nearestWaypoint(this.spike.x, this.spike.z));
      }
    }
  }

  onDefused(bot) {
    if (!this.spike.planted) return;
    this.endRound('falcon', `Spike defused by ${bot.name}`);
  }

  explode() {
    this.cb.onGrenade?.(null, { x: this.spike.x, y: 0.5, z: this.spike.z }, 160, 8, null);
    this.endRound('viper', 'Spike detonated');
  }

  // A kill: credit the shooter, pay them, feed the HUD, check the round.
  onKill(victim, killer) {
    const team = victim.team;
    if (killer) {
      killer.kills = (killer.kills || 0) + 1;
      if (killer === this.player) {
        this.player.money += 300;
        sfx.kill();
      } else if (killer.team === 'falcon' && killer.money !== undefined) {
        killer.money += 300;
      }
    }
    const vName = victim.name || 'You';
    const kName = killer ? (killer.name || 'You') : 'the yard';
    this.hud.killfeed(`${kName}  ✕  ${vName}`, killer ? killer.team : team);
    if (victim === this.player) sfx.hurt();
    // spike carrier drops the spike where they fell
    if (victim.carrier) {
      victim.carrier = false;
      this.spike.x = victim.pos.x;
      this.spike.z = victim.pos.z;
    }
    this.checkRoundEnd();
  }

  checkRoundEnd() {
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.BUY) return;
    const f = this.aliveCount('falcon');
    const v = this.aliveCount('viper');
    if (v === 0) this.endRound('falcon', 'Vipers eliminated');
    else if (f === 0) this.endRound(this.spike.planted ? 'viper' : 'viper', 'Falcons eliminated');
  }

  endRound(winner, reason) {
    if (this.phase === PHASE.END || this.phase === PHASE.MATCH) return;
    this.phase = PHASE.END;
    this.roundEndAt = 0;
    this.score[winner] += 1;
    const loser = winner === 'falcon' ? 'viper' : 'falcon';
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] += 1;
    // economy
    const winPay = 3250;
    const lossPay = 1900 + Math.min(2, this.lossStreak[loser] - 1) * 500;
    this.player.money += winner === 'falcon' ? winPay : lossPay;
    for (const b of this.bots) b.money += b.team === winner ? winPay : lossPay;
    const title = winner === 'falcon' ? 'FALCONS WIN THE ROUND' : 'VIPERS WIN THE ROUND';
    this.hud.showRoundEnd(title, `${reason} — ${this.score.falcon} : ${this.score.viper}`);
    if (winner === 'falcon') sfx.roundWin(); else sfx.roundLose();
    this.cb.onRoundEnd?.(winner, reason);
  }

  endMatch() {
    this.phase = PHASE.MATCH;
    const winner = this.score.falcon >= this.winTarget ? 'falcon' : 'viper';
    const title = winner === 'falcon' ? 'FALCONS TAKE THE MATCH' : 'VIPERS TAKE THE MATCH';
    this.hud.showRoundEnd(title, `Final score ${this.score.falcon} : ${this.score.viper} — press R to play again`);
    this.cb.onMatchEnd?.(winner);
  }

  update(dt, now) {
    if (this.phase === PHASE.BUY) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.startLive();
    } else if (this.phase === PHASE.LIVE) {
      if (this.spike.planted) {
        this.spike.timer -= dt;
        this.timeLeft = this.spike.timer;
        if (this.spike.timer <= 0) this.explode();
      } else {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          // time out: defenders win if the spike was never planted
          this.endRound('falcon', 'Time expired — spike never planted');
        }
      }
      // plant/defuse progress shown in the HUD bar
      const carrier = this.bots.find((b) => b.carrier && b.alive);
      this.plantProgress = carrier && carrier.state === 'plant' ? carrier.plantProgress : 0;
      const defuser = this.bots.find((b) => b.state === 'defuse' && b.alive && b.defuseProgress > 0);
      this.defuseProgress = defuser ? defuser.defuseProgress : 0;
    } else if (this.phase === PHASE.END) {
      this.roundEndAt += dt;
      if (this.roundEndAt > 4) {
        if (this.score.falcon >= this.winTarget || this.score.viper >= this.winTarget || this.round >= this.maxRounds) {
          this.endMatch();
        } else {
          this.round += 1;
          this.startRound();
        }
      }
    }
  }
}
