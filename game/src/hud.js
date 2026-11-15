// HUD: health, armour, ammo, money, round timer, score, killfeed, buy menu
// and round banners. All DOM, updated from game state once per frame —
// the crosshair gap tracks the player's live spread.

import { WEAPONS, BUY_ORDER, ARMOR_PRICE } from './weapons.js';
import { sfx } from './audio.js';

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['health', 'health-num', 'armor', 'armor-num', 'ammo-mag', 'ammo-res', 'weapon-name',
      'money', 'timer', 'score-f', 'score-v', 'round-label', 'killfeed', 'crosshair', 'hitmarker',
      'banner', 'banner-sub', 'buy-menu', 'buy-list', 'spike-status', 'alive-f', 'alive-v',
      'damage-flash', 'menu', 'round-end', 'end-title', 'end-sub', 'hint', 'plant-bar', 'plant-fill',
      'demo-tag', 'errlog']) {
      this.el[id] = document.getElementById(id);
    }
    this.buyOpen = false;
    this.lastHitAt = 0;
  }

  update(game, player, now) {
    const e = this.el;
    e['health-num'].textContent = Math.ceil(player.health);
    e.health.style.width = `${Math.max(0, player.health)}%`;
    e['armor-num'].textContent = Math.ceil(player.armor);
    e.armor.style.width = `${Math.max(0, player.armor)}%`;
    const def = player.def;
    e['ammo-mag'].textContent = player.ammo.mag;
    e['ammo-res'].textContent = player.ammo.reserve;
    e['weapon-name'].textContent = def.name + (player.reloading ? ' — reloading' : '');
    e.money.textContent = `$${player.money}`;
    e['score-f'].textContent = game.score.falcon;
    e['score-v'].textContent = game.score.viper;
    e['round-label'].textContent = `ROUND ${game.round} / ${game.maxRounds}`;
    e['alive-f'].textContent = `${game.aliveCount('falcon')} alive`;
    e['alive-v'].textContent = `${game.aliveCount('viper')} alive`;
    // timer
    const t = Math.max(0, Math.ceil(game.timeLeft));
    e.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    e.timer.classList.toggle('urgent', t <= 15 && game.phase === 'live');
    // spike status
    if (game.spike.planted) {
      e['spike-status'].textContent = `SPIKE PLANTED — ${game.spike.site} — ${Math.ceil(game.spike.timer)}s`;
      e['spike-status'].className = 'spike planted';
    } else if (game.spike.carrier === 'viper') {
      e['spike-status'].textContent = 'SPIKE IN PLAY';
      e['spike-status'].className = 'spike';
    } else {
      e['spike-status'].textContent = '';
      e['spike-status'].className = 'spike';
    }
    // crosshair gap follows spread
    const gap = 3 + player.currentSpread() * 900;
    e.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    // hitmarker fade
    if (now - this.lastHitAt > 0.12) e.hitmarker.classList.remove('on');
    // damage flash fade
    e['damage-flash'].style.opacity = player.health < 100 && now - player.lastDamageAt < 0.25 ? '0.45' : '0';
    // plant/defuse progress bar
    const prog = game.plantProgress ?? game.defuseProgress ?? 0;
    if (prog > 0) {
      e['plant-bar'].style.display = 'block';
      e['plant-fill'].style.width = `${prog * 100}%`;
    } else {
      e['plant-bar'].style.display = 'none';
    }
  }

  hit(head) {
    this.lastHitAt = performance.now() / 1000;
    this.el.hitmarker.classList.add('on');
    if (head) this.el.hitmarker.classList.add('head');
    else this.el.hitmarker.classList.remove('head');
  }

  killfeed(text, team) {
    const div = document.createElement('div');
    div.className = `feed-item ${team}`;
    div.textContent = text;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  banner(title, sub = '') {
    this.el.banner.textContent = title;
    this.el['banner-sub'].textContent = sub;
    this.el.banner.classList.add('show');
    this.el['banner-sub'].classList.add('show');
    setTimeout(() => {
      this.el.banner.classList.remove('show');
      this.el['banner-sub'].classList.remove('show');
    }, 2600);
  }

  showMenu(show) {
    this.el.menu.style.display = show ? 'flex' : 'none';
  }

  showRoundEnd(title, sub) {
    this.el['end-title'].textContent = title;
    this.el['end-sub'].textContent = sub;
    this.el['round-end'].style.display = 'flex';
  }

  hideRoundEnd() {
    this.el['round-end'].style.display = 'none';
  }

  // Buy menu: rebuilt each time it opens so prices and ownership are current.
  // Rows are clickable (tap on touch, click on desktop) — same as keys 1-7.
  openBuy(player) {
    this.buyOpen = true;
    const list = this.el['buy-list'];
    list.innerHTML = '';
    BUY_ORDER.forEach((id, i) => {
      const def = WEAPONS[id];
      const owned = id === 'frag' ? player.grenades > 0 : !!player.weapons[id];
      const row = document.createElement('div');
      row.className = 'buy-row' + (owned ? ' owned' : '') + (player.money < def.price ? ' poor' : '');
      row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${def.name}</span><span class="buy-price">${def.price === 0 ? 'FREE' : '$' + def.price}</span><span class="buy-state">${owned ? 'OWNED' : ''}</span>`;
      row.addEventListener('click', () => {
        if (player.buy(id)) sfx.buy(); else sfx.denied();
        this.openBuy(player);
      });
      list.appendChild(row);
    });
    const armor = document.createElement('div');
    armor.className = 'buy-row' + (player.armor >= 100 ? ' owned' : '') + (player.money < ARMOR_PRICE ? ' poor' : '');
    armor.innerHTML = `<span class="buy-key">7</span><span class="buy-name">Kevlar Vest</span><span class="buy-price">$${ARMOR_PRICE}</span><span class="buy-state">${player.armor >= 100 ? 'OWNED' : ''}</span>`;
    armor.addEventListener('click', () => {
      if (player.buyArmor()) sfx.buy(); else sfx.denied();
      this.openBuy(player);
    });
    list.appendChild(armor);
    this.el['buy-menu'].style.display = 'block';
  }

  closeBuy() {
    this.buyOpen = false;
    this.el['buy-menu'].style.display = 'none';
  }

  hint(text) {
    this.el.hint.textContent = text;
  }
}
