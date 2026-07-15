// Capa DOM: cartas de evento, HUD, registro y banner de fin.
// Lee de `state` y escribe en el HTML. No dibuja en el canvas ni decide reglas.
// Para evitar dependencias circulares, recibe por inyección qué hacer
// "después de elegir" (el turno enemigo) y "al reiniciar" (nueva partida).

import { state } from './state.js';

let afterChoice = () => {};
let restart = () => {};
export function bindAfterChoice(fn) { afterChoice = fn; }
export function bindRestart(fn) { restart = fn; }

const $ = id => document.getElementById(id);

export function log(html) { $('log').innerHTML = html; }

export function syncHUD() {
  const { hero, foe } = state;
  $('hpHero').style.width = Math.max(0, hero.hp / hero.maxHp * 100) + '%';
  $('hpFoe').style.width = foe.alive ? Math.max(0, foe.hp / foe.maxHp * 100) + '%' : '0%';
  $('gold').textContent = hero.gold;
}

export function hideVeil() { $('veil').classList.remove('show'); }

// Abre la carta de un punto de evento (bloquea el mapa hasta elegir).
export function openEvent(trig) {
  state.busy = true;
  const ev = state.events[trig.id];
  const card = $('card');
  card.innerHTML =
    `<div class="kicker">${ev.kicker}</div>
     <h2>${ev.title}</h2>
     <p>${ev.text}</p>
     <div class="choices"></div>`;
  const box = card.querySelector('.choices');
  ev.choices.forEach(ch => {
    const b = document.createElement('button');
    b.className = 'choice';
    const tc = ch.effect.hp > 0 ? 'heal' : ch.effect.hp < 0 ? 'dmg' : ch.effect.gold ? 'gold' : '';
    b.innerHTML = `<span>${ch.label}</span><span class="tag ${tc}">${ch.tag}</span>`;
    b.onclick = () => resolveChoice(trig, ch);
    box.appendChild(b);
  });
  $('veil').classList.add('show');
}

function resolveChoice(trig, ch) {
  const { hero } = state;
  if (ch.effect.hp) hero.hp = Math.min(hero.maxHp, hero.hp + ch.effect.hp);
  if (ch.effect.gold) hero.gold = Math.max(0, hero.gold + ch.effect.gold);
  trig.used = true;
  hideVeil();
  syncHUD();
  log(ch.result);
  state.busy = false;
  if (hero.hp <= 0) return gameOver('lose');
  afterChoice(); // tras decidir, actúa el enemigo
}

export function gameOver(kind) {
  state.busy = true;
  const win = kind === 'win';
  $('card').innerHTML =
    `<div class="banner">
       <div class="kicker">${win ? 'Victoria' : 'Derrota'}</div>
       <h2>${win ? 'Acechador abatido' : 'Has caído'}</h2>
       <p>${win
        ? `Sales de la sala con <b>${state.hero.gold} ◆</b> y la respiración entera.`
        : 'La oscuridad se cierra. La sala guarda sus secretos.'}</p>
       <button class="again" id="again">Otra incursión</button>
     </div>`;
  $('veil').classList.add('show');
  $('again').onclick = restart;
}
