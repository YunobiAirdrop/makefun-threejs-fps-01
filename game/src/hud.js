// The HUD: every readout the player fights by, drawn from the match's single state. Top centre
// is the clock and the score; the radar shows teammates, the charge, and enemies who just gave
// themselves away by firing; the bottom corners carry health and ammunition. Nothing here owns
// game state — it only renders what rounds.js decided.
import { WEAPONS, GRENADES, ARMOR_PRICE, SHOP, spreadRadians } from './weapons.js';

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const el = {
    hud: $('hud'), timer: $('timer'), scoreLine: $('score-line'),
    pipsUs: $('pips-us'), pipsThem: $('pips-them'), feed: $('feed'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    prompt: $('prompt'), interact: $('interact'), interactLabel: $('interact-label'), interactFill: $('interact-fill'),
    hpNum: $('hp-num'), armorNum: $('armor-num'), hpFill: $('hp-fill'), armorFill: $('armor-fill'),
    kitRow: $('kit-row'), money: $('money'), weaponName: $('weapon-name'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), reloadNote: $('reload-note'),
    banner: $('banner'), bannerBig: $('banner-big'), bannerSub: $('banner-sub'),
    vignette: $('vignette'), dmgArc: $('dmg-arc'), flashblind: $('flashblind'),
    menu: $('menu'), menuCopy: $('menu-copy'), play: $('play'),
    buy: $('buy'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'),
    board: $('board'), scoreBody: $('score-body'),
    radar: $('radar').getContext('2d'),
  };
  let bannerToken = 0;
  let hitToken = 0;
  let msgText = '';
  let msgUntil = 0;
  let pipsCache = '';
  let kitCache = '';

  function banner(big, sub, side) {
    el.bannerBig.textContent = big;
    el.bannerBig.className = `big ${side || ''}`;
    el.bannerSub.textContent = sub || '';
    el.banner.hidden = false;
    const token = ++bannerToken;
    setTimeout(() => { if (token === bannerToken) el.banner.hidden = true; }, 2800);
  }

  function centerMsg(text, seconds = 2.6) {
    msgText = text;
    msgUntil = performance.now() / 1000 + seconds;
  }

  function killfeed(attacker, victim, weaponName, head) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    const aCls = attacker ? (attacker.team === 'jackal' ? 'us' : 'them') : '';
    const vCls = victim.team === 'jackal' ? 'us' : 'them';
    item.innerHTML = '';
    const aSpan = document.createElement('span');
    aSpan.className = aCls;
    aSpan.textContent = attacker ? attacker.name : '—';
    const wSpan = document.createElement('span');
    wSpan.className = 'wpn';
    wSpan.textContent = weaponName;
    const vSpan = document.createElement('span');
    vSpan.className = vCls;
    vSpan.textContent = victim.name;
    item.append(aSpan, wSpan, vSpan);
    if (head) {
      const hSpan = document.createElement('span');
      hSpan.className = 'hs';
      hSpan.textContent = ' ⌖';
      item.append(hSpan);
    }
    el.feed.append(item);
    while (el.feed.children.length > 5) el.feed.firstChild.remove();
    setTimeout(() => item.remove(), 4200);
  }

  function hitmark(head, kill) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('kill', !!kill);
    const token = ++hitToken;
    setTimeout(() => { if (token === hitToken) el.hitmarker.classList.remove('on', 'kill'); }, head ? 130 : 90);
  }

  function renderBuy(player) {
    el.buyMoney.textContent = `$${player.money}`;
    el.buyGrid.innerHTML = '';
    for (const [key, kind, id] of SHOP) {
      const div = document.createElement('div');
      div.className = 'buy-item';
      let name;
      let small;
      let price;
      let owned = false;
      if (kind === 'weapon') {
        const def = WEAPONS[id];
        name = def.name;
        small = `${def.damage} dmg · ${def.rpm} rpm · ${def.mag} rounds`;
        price = def.price;
        owned = player.weapons.primary === id;
      } else if (kind === 'armor') {
        name = 'Kevlar Vest';
        small = 'Body shots −45% · head −30%';
        price = ARMOR_PRICE;
        owned = player.armor >= 100;
      } else {
        const def = GRENADES[id];
        name = def.name;
        small = id === 'frag' ? 'Lethal in 6.5 m' : id === 'flash' ? 'Blinds on sight' : 'Blocks sight 14 s';
        price = def.price;
        owned = player.grenades[id] >= 1;
      }
      if (owned) div.classList.add('owned');
      else if (player.money < price) div.classList.add('poor');
      const keySpan = document.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = key;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = name;
      const sm = document.createElement('small');
      sm.textContent = small;
      nm.append(sm);
      const pr = document.createElement('span');
      pr.className = 'pr';
      pr.textContent = owned ? 'OWNED' : `$${price}`;
      div.append(keySpan, nm, pr);
      el.buyGrid.append(div);
    }
  }

  function renderBoard(match) {
    el.scoreBody.innerHTML = '';
    const rows = [...match.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const a of rows) {
      const tr = document.createElement('tr');
      if (a.isPlayer) tr.className = 'me';
      if (!a.alive) tr.classList.add('dead');
      const tag = a.team === 'jackal' ? '<span class="team-tag us">JACKAL</span>' : '<span class="team-tag them">SENTRY</span>';
      const cells = [a.name + (a.hasCharge ? ' ◆' : ''), '', String(a.kills), String(a.deaths), `$${a.money}`];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i >= 2) td.className = 'n';
        if (i === 1) td.innerHTML = tag;
        else td.textContent = text;
        tr.append(td);
      });
      el.scoreBody.append(tr);
    }
  }

  function drawRadar(match, player) {
    const ctx = el.radar;
    const W = 148;
    const H = 118;
    ctx.clearRect(0, 0, W, H);
    const px = (x) => ((x + 36) / 72) * W;
    const pz = (z) => ((z + 28) / 64) * H;
    // Sites.
    ctx.fillStyle = 'rgba(232,228,218,0.75)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('A', px(-22) - 3, pz(-15) + 3);
    ctx.fillText('B', px(24) - 3, pz(6) + 3);
    // The charge, when it is on the ground.
    if (match.bomb.state === 'dropped' || match.bomb.state === 'planted') {
      ctx.fillStyle = match.bomb.state === 'planted' ? '#e5484d' : '#f2a33c';
      ctx.fillRect(px(match.bomb.x) - 3, pz(match.bomb.z) - 3, 6, 6);
    }
    // Enemies who fired in the last moment give themselves away.
    for (const n of match.noises) {
      if (n.team === player.team || n.radius < 20) continue;
      if (match.now - n.t > 1.2) continue;
      ctx.fillStyle = 'rgba(57,194,176,0.8)';
      ctx.beginPath();
      ctx.arc(px(n.x), pz(n.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Teammates, then the player with a facing tick.
    for (const a of match.actors) {
      if (!a.alive || a === player) continue;
      ctx.fillStyle = a.team === 'jackal' ? '#f2a33c' : 'rgba(57,194,176,0.55)';
      ctx.beginPath();
      ctx.arc(px(a.x), pz(a.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.alive) {
      ctx.fillStyle = '#e8e4da';
      ctx.beginPath();
      ctx.arc(px(player.x), pz(player.z), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8e4da';
      ctx.beginPath();
      ctx.moveTo(px(player.x), pz(player.z));
      ctx.lineTo(px(player.x) - Math.sin(player.yaw) * 8, pz(player.z) - Math.cos(player.yaw) * 8);
      ctx.stroke();
    }
  }

  function update(match, player) {
    const now = match.now;
    // Clock.
    if (match.phase === 'planted') {
      el.timer.textContent = fmtTime(match.bomb.fuseT);
      el.timer.className = 'planted';
    } else if (match.phase === 'buy') {
      el.timer.textContent = `BUY ${fmtTime(match.phaseT)}`;
      el.timer.className = '';
    } else {
      el.timer.textContent = fmtTime(match.phaseT);
      el.timer.className = match.phase === 'live' && match.phaseT < 10 ? 'low' : '';
    }
    el.timer.id = 'timer';
    el.scoreLine.innerHTML = '';
    const us = document.createElement('span');
    us.className = 'us';
    us.textContent = `JACKALS ${match.score.jackal}`;
    const them = document.createElement('span');
    them.className = 'them';
    them.textContent = `${match.score.sentry} SENTRIES`;
    el.scoreLine.append(us, document.createTextNode(' · '), them);

    // Alive pips, rebuilt only when the counts change.
    const usAlive = match.aliveCount('jackal');
    const themAlive = match.aliveCount('sentry');
    const pipKey = `${usAlive}/${themAlive}`;
    if (pipKey !== pipsCache) {
      pipsCache = pipKey;
      const fill = (container, alive, cls) => {
        container.innerHTML = '';
        for (let i = 0; i < 5; i++) {
          const pip = document.createElement('span');
          pip.className = `pip ${cls}${i < alive ? '' : ' dead'}`;
          container.append(pip);
        }
      };
      fill(el.pipsUs, usAlive, 'us');
      fill(el.pipsThem, themAlive, 'them');
    }

    // Vitals.
    el.hpNum.textContent = Math.max(0, Math.ceil(player.health));
    el.hpNum.className = player.health <= 30 ? 'low' : '';
    el.hpNum.id = 'hp-num';
    el.hpFill.style.width = `${Math.max(0, player.health)}%`;
    el.hpFill.className = `fill${player.health <= 30 ? ' low' : ''}`;
    el.hpFill.id = 'hp-fill';
    el.armorNum.textContent = player.armor > 0 ? `⛨ ${Math.ceil(player.armor)}` : '';
    el.armorFill.style.width = `${player.armor}%`;

    // Kit row: what the player carries, rebuilt on change.
    const kitSig = `${player.weapons.primary}|${player.current}|${player.grenades.frag}${player.grenades.flash}${player.grenades.smoke}|${player.armor > 0}|${player.hasCharge}`;
    if (kitSig !== kitCache) {
      kitCache = kitSig;
      el.kitRow.innerHTML = '';
      const add = (label, owned, active) => {
        const span = document.createElement('span');
        span.className = `kit${owned ? ' owned' : ''}${active ? ' active' : ''}`;
        span.textContent = label;
        el.kitRow.append(span);
      };
      if (player.weapons.primary) add(WEAPONS[player.weapons.primary].short, true, player.current === player.weapons.primary);
      add('P9', true, player.current === 'p9');
      add(`Frag ${player.grenades.frag}`, player.grenades.frag > 0, player.current === 'frag');
      add(`Flash ${player.grenades.flash}`, player.grenades.flash > 0, player.current === 'flash');
      add(`Smoke ${player.grenades.smoke}`, player.grenades.smoke > 0, player.current === 'smoke');
      if (player.hasCharge) add('◆ CHARGE', true, false);
    }

    // Weapon & ammunition.
    el.money.textContent = `$${player.money}`;
    const cur = player.current;
    if (WEAPONS[cur]) {
      const def = WEAPONS[cur];
      const ammo = player.ammo[cur];
      el.weaponName.textContent = def.name;
      el.ammoMag.textContent = ammo.mag;
      el.ammoMag.className = ammo.mag === 0 ? 'empty' : '';
      el.ammoMag.id = 'ammo-mag';
      el.ammoReserve.textContent = `/ ${ammo.reserve}`;
      el.reloadNote.textContent = player.reloadT > 0 ? 'Reloading' : ammo.mag === 0 ? 'Press R to reload' : '';
    } else {
      el.weaponName.textContent = GRENADES[cur].name;
      el.ammoMag.textContent = player.grenades[cur];
      el.ammoReserve.textContent = '';
      el.reloadNote.textContent = 'Click to throw';
    }

    // Crosshair: gap tracks the live spread, so the player can feel accuracy.
    if (WEAPONS[cur] && player.alive) {
      const spread = spreadRadians(WEAPONS[cur], player.bloom, player.speedRatio, player.crouched, player.grounded);
      el.crosshair.style.display = '';
      el.crosshair.style.setProperty('--sp', `${Math.min(30, 4 + spread * 620)}px`);
    } else {
      el.crosshair.style.display = 'none';
    }

    // Interaction: an active channel, or the contextual prompt.
    if (player.channel) {
      el.interact.hidden = false;
      el.interactLabel.textContent = player.channel.type === 'plant' ? 'Planting the charge' : 'Defusing';
      el.interactFill.style.width = `${(player.channel.t / player.channel.dur) * 100}%`;
      el.prompt.hidden = true;
    } else {
      el.interact.hidden = true;
      let text = '';
      if (performance.now() / 1000 < msgUntil) text = msgText;
      else if (player.alive && match.phase === 'live' && player.hasCharge && match.siteAt(player.x, player.z)) {
        text = 'Hold <kbd>E</kbd> to plant the charge';
      } else if (player.alive && match.bomb.state === 'dropped') {
        text = 'The charge is down — walk over it to pick it up';
      } else if (player.alive && match.phase === 'buy') {
        text = 'Press <kbd>B</kbd> to buy equipment';
      }
      if (text) {
        el.prompt.innerHTML = text;
        el.prompt.hidden = false;
      } else el.prompt.hidden = true;
    }

    // Damage feedback: a fading vignette plus an arc toward whoever hit you.
    let vig = player.health <= 30 && player.alive ? 0.32 : 0;
    if (player.lastHit && now - player.lastHit.t < 0.9) {
      const age = (now - player.lastHit.t) / 0.9;
      vig = Math.max(vig, 0.85 * (1 - age));
      const dx = player.lastHit.x - player.x;
      const dz = player.lastHit.z - player.z;
      const worldAng = Math.atan2(dx, dz);
      const rel = worldAng - (Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI);
      el.dmgArc.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      el.dmgArc.style.opacity = String(0.9 * (1 - age));
    } else {
      el.dmgArc.style.opacity = '0';
    }
    el.vignette.style.opacity = String(vig);
    el.flashblind.style.opacity = String(player.blindT > 0 ? Math.min(1, player.blindT / 1.6) : 0);

    drawRadar(match, player);
    if (!el.buy.hidden) {
      el.buyTimer.textContent = match.phase === 'buy' ? fmtTime(match.phaseT) : '';
    }
  }

  return {
    el, banner, centerMsg, killfeed, hitmark, renderBuy, renderBoard, update,
    clearBanner() { bannerToken += 1; el.banner.hidden = true; },
    showBuy(open) { el.buy.hidden = !open; },
    showBoard(open, match) { el.board.hidden = !open; if (open) renderBoard(match); },
    showHud(on) { el.hud.hidden = !on; },
    showMatchEnd(match) {
      const title = match.draw ? 'DRAW' : match.winner === 'jackal' ? 'JACKALS WIN THE YARD' : 'SENTRIES HOLD THE YARD';
      el.menuCopy.innerHTML = '';
      el.menuCopy.textContent = `${title} — final score ${match.score.jackal} : ${match.score.sentry} after ${match.round} rounds.`;
      el.play.textContent = 'Play again';
      el.menu.hidden = false;
    },
    hideMenu() { el.menu.hidden = true; },
  };
}
