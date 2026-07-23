// Inventario y equipamiento del héroe.
//
// Vive en su propio módulo (no dentro de state.js) para no acoplar el motor
// del juego a esto: solo lee `state.hero.gold` (para reflejar el oro real)
// y no toca nada más del estado de la partida. `resetInventory()` se llama
// desde main.js cada vez que empieza una partida nueva de verdad (no al
// bajar de nivel, donde el inventario debe seguir tal cual lo dejó el
// jugador — igual que ya pasa con la vida o el oro).
//
// Arquitectura (mismos bloques que el prototipo ya probado):
//   1. Config (medidas, huecos de equipo — coordenadas calibradas a mano
//      con tools/ui-calibration/calibrar.html sobre la imagen de fondo real)
//   2. Datos de objetos (plantillas + fábrica de instancias)
//   3. Estado (equipo, inventario, objetos, selección)
//   4. Validación (canPlaceItem, canSwapItems, getValidDestinations)
//   5. Movimiento (moveItem, swapItems — únicas, las usan clic/toque y
//      drag&drop por igual)
//   6. Renderizado
//   7. Interacción (clic/toque + drag&drop)
//   8. Escalado responsive
//   9. Apertura/cierre + arranque
//
// De momento el inventario empieza vacío del todo salvo el oro (que se
// sincroniza desde state.hero.gold cada vez que se abre, usando el mismo
// icono que ya se ve en el HUD). Los 9 tipos de objeto y sus iconos están
// listos para cuando haya objetos de verdad que equipar.

import { state } from './state.js?v=0.21.2';
import { t } from './i18n.js?v=0.21.2';
import { getPassiveOwnedSkills, getOwnedTier, getSkillBonuses } from './skills.js?v=0.21.2';

// --- 1. Config ---------------------------------------------------------

const DEBUG_INVENTORY_UI = false;

const BASE_W = 1920, BASE_H = 2112;   // tamaño real de assets/ui/inventory_screen.jpg

const CURRENT_CHARACTER = { class: 'warrior' };   // de momento fijo; ya listo para cuando haya clases de verdad

// Huecos de equipo, calibrados a mano sobre la imagen real (ver
// tools/ui-calibration/README.md si hay que reajustar alguno).
const EQUIP_SLOTS = [
  { id: 'helmet',     accepts: t => t === 'helmet',     rect: [528,  81, 138, 150] },
  { id: 'amulet',     accepts: t => t === 'amulet',     rect: [742, 274,  85,  88] },
  { id: 'mainHand',   accepts: t => t === 'mainHand',   rect: [205, 341, 123, 319] },
  { id: 'offHand',    accepts: t => t === 'offHand',    rect: [871, 342, 124, 318] },
  { id: 'chest',      accepts: t => t === 'chest',      rect: [525, 395, 142, 186] },
  { id: 'belt',       accepts: t => t === 'belt',       rect: [527, 639, 140,  80] },
  { id: 'gloves',     accepts: t => t === 'gloves',     rect: [233, 759, 123, 148] },
  { id: 'classRelic', accepts: t => t === 'classRelic', rect: [825, 760, 123, 147] },
  { id: 'legs',       accepts: t => t === 'legs',       rect: [526, 778, 141, 193] },
  { id: 'ringLeft',   accepts: t => t === 'ring',       rect: [282,1021,  88,  91] },
  { id: 'ringRight',  accepts: t => t === 'ring',       rect: [818,1021,  87,  91] },
  { id: 'boots',      accepts: t => t === 'boots',      rect: [532,1028, 132, 144] },
];

const CHARSHEET_RECT = [1155, 68, 667, 1135];   // panel vacío a propósito (nombre/nivel/atributos... más adelante)

const INVENTORY_RECT = [57, 1265, 1800, 768];
const INVENTORY_COLS = 18, INVENTORY_ROWS = 8;
const INVENTORY_SLOTS = INVENTORY_COLS * INVENTORY_ROWS;   // 144

// Iconos placeholder (emoji) por tipo, claramente reemplazables por arte de
// verdad más adelante. 'coins' usa el icono real del HUD, no un emoji.
const PLACEHOLDER_ICONS = {
  helmet: '🪖', chest: '🥋', mainHand: '⚔️', offHand: '🛡️', belt: '🎗️',
  gloves: '🧤', legs: '👖', boots: '👢', amulet: '📿', ring: '💍',
  potion: '🧪', coins: { img: './assets/ui/gold_icon.png' }, classRelic: '📖',
};


// --- 2. Datos de objetos -------------------------------------------------

const TEMPLATES = {
  gold_coins: { name: 'Oro', type: 'coins', stackable: true, stats: {} },
};

let instanceCounter = 0;
function nextInstanceId() { return 'item_instance_' + (++instanceCounter).toString().padStart(3, '0'); }

function createItem(templateId, overrides) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) throw new Error('Plantilla de objeto desconocida: ' + templateId);
  return Object.assign({
    id: templateId,
    instanceId: nextInstanceId(),
    name: tpl.name,
    type: tpl.type,
    icon: PLACEHOLDER_ICONS[tpl.type] || '❔',
    quantity: 1,
    stackable: !!tpl.stackable,
    equipped: false,
    classRequirement: tpl.classRequirement || null,
    stats: Object.assign({}, tpl.stats || {}),
  }, overrides || {});
}


// --- 3. Estado ------------------------------------------------------------

const invState = {
  items: {},
  inventory: new Array(INVENTORY_SLOTS).fill(null),
  equipment: {},
  selected: null,
};
EQUIP_SLOTS.forEach(s => { invState.equipment[s.id] = null; });

export function resetInventory() {
  invState.items = {};
  invState.inventory = new Array(INVENTORY_SLOTS).fill(null);
  invState.equipment = {};
  EQUIP_SLOTS.forEach(s => { invState.equipment[s.id] = null; });
  invState.selected = null;
  instanceCounter = 0;
}

function getItem(instanceId) { return instanceId ? invState.items[instanceId] : null; }

function placeInStateOnly(item, container, slot) {
  item.position = { container, slot };
  item.equipped = (container === 'equipment');
  if (container === 'inventory') invState.inventory[slot] = item.instanceId;
  else invState.equipment[slot] = item.instanceId;
}

function clearFromState(item) {
  if (!item || !item.position) return;
  const { container, slot } = item.position;
  if (container === 'inventory') invState.inventory[slot] = null;
  else invState.equipment[slot] = null;
}

function firstEmptyInventorySlot() {
  return invState.inventory.findIndex(v => v === null);
}

// Refleja el oro real del héroe (state.hero.gold) en un objeto "Oro" del
// inventario. Se llama cada vez que se abre la pantalla, así que siempre
// está al día aunque haya cambiado mientras estaba cerrada.
function syncGoldItem() {
  const gold = state.hero ? state.hero.gold : 0;
  let goldItem = Object.values(invState.items).find(it => it.id === 'gold_coins');
  if (gold <= 0) {
    if (goldItem) { clearFromState(goldItem); delete invState.items[goldItem.instanceId]; }
    return;
  }
  if (!goldItem) {
    const slot = firstEmptyInventorySlot();
    if (slot === -1) return;   // inventario lleno; no debería pasar de momento
    goldItem = createItem('gold_coins', { quantity: gold });
    invState.items[goldItem.instanceId] = goldItem;
    placeInStateOnly(goldItem, 'inventory', slot);
  } else {
    goldItem.quantity = gold;
  }
}


// --- 4. Validación --------------------------------------------------------

function equipSlotConfig(slotId) { return EQUIP_SLOTS.find(s => s.id === slotId); }

function canPlaceItem(item, container, slot) {
  if (!item) return false;
  if (container === 'inventory') return slot >= 0 && slot < INVENTORY_SLOTS;
  if (container === 'equipment') {
    const cfg = equipSlotConfig(slot);
    if (!cfg || !cfg.accepts(item.type)) return false;
    if (slot === 'classRelic') return item.classRequirement === CURRENT_CHARACTER.class;
    return true;
  }
  return false;
}

function canSwapItems(itemA, itemB) {
  if (!itemA || !itemB) return false;
  return canPlaceItem(itemA, itemB.position.container, itemB.position.slot) &&
         canPlaceItem(itemB, itemA.position.container, itemA.position.slot);
}

function getValidDestinations(item) {
  const dests = [];
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (item.position.container === 'inventory' && item.position.slot === i) continue;
    const occupant = getItem(invState.inventory[i]);
    if (!occupant && canPlaceItem(item, 'inventory', i)) dests.push({ container: 'inventory', slot: i });
    else if (occupant && canSwapItems(item, occupant)) dests.push({ container: 'inventory', slot: i });
  }
  EQUIP_SLOTS.forEach(cfg => {
    if (item.position.container === 'equipment' && item.position.slot === cfg.id) return;
    const occupant = getItem(invState.equipment[cfg.id]);
    if (!occupant && canPlaceItem(item, 'equipment', cfg.id)) dests.push({ container: 'equipment', slot: cfg.id });
    else if (occupant && canSwapItems(item, occupant)) dests.push({ container: 'equipment', slot: cfg.id });
  });
  return dests;
}


// --- 5. Movimiento ---------------------------------------------------------

function moveItem(instanceId, destContainer, destSlot) {
  const item = getItem(instanceId);
  if (!item) return false;
  if (item.position.container === destContainer && item.position.slot === destSlot) return false;

  const destOccupantId = destContainer === 'inventory' ? invState.inventory[destSlot] : invState.equipment[destSlot];
  const destOccupant = getItem(destOccupantId);
  if (destOccupant) return swapItems(item, destOccupant);

  if (!canPlaceItem(item, destContainer, destSlot)) {
    if (DEBUG_INVENTORY_UI) console.log('[inventario] rechazado:', item.name, '->', destContainer, destSlot);
    return false;
  }
  clearFromState(item);
  placeInStateOnly(item, destContainer, destSlot);
  return true;
}

function swapItems(itemA, itemB) {
  if (!canSwapItems(itemA, itemB)) return false;
  const posA = itemA.position, posB = itemB.position;
  clearFromState(itemA);
  clearFromState(itemB);
  placeInStateOnly(itemA, posB.container, posB.slot);
  placeInStateOnly(itemB, posA.container, posA.slot);
  return true;
}


// --- 6. Renderizado ---------------------------------------------------------

let ui = null;                // #invUI
const equipEls = {};
const invEls = [];
let charSheetEl = null;
let built = false;

function pctRect([x, y, w, h]) {
  return {
    left: (x / BASE_W * 100) + '%',
    top: (y / BASE_H * 100) + '%',
    width: (w / BASE_W * 100) + '%',
    height: (h / BASE_H * 100) + '%',
  };
}

function setIcon(iconEl, icon) {
  if (icon && typeof icon === 'object' && icon.img) {
    iconEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = icon.img;
    img.alt = '';
    iconEl.appendChild(img);
  } else {
    iconEl.innerHTML = '';
    iconEl.textContent = icon || '';
  }
}

function buildStaticDOM() {
  ui = document.getElementById('invUI');
  if (!ui || built) return;
  built = true;

  EQUIP_SLOTS.forEach(cfg => {
    const el = document.createElement('div');
    el.className = 'inv-equip-slot';
    el.dataset.container = 'equipment';
    el.dataset.slot = cfg.id;
    Object.assign(el.style, pctRect(cfg.rect));
    if (DEBUG_INVENTORY_UI) {
      el.classList.add('inv-debug');
      const lbl = document.createElement('span');
      lbl.className = 'inv-debug-label';
      lbl.textContent = cfg.id;
      el.appendChild(lbl);
    }
    const icon = document.createElement('div');
    icon.className = 'inv-icon';
    el.appendChild(icon);
    ui.appendChild(el);
    equipEls[cfg.id] = el;
    attachSlotInteraction(el, 'equipment', cfg.id);
  });

  const sheet = document.createElement('div');
  sheet.className = 'inv-charsheet-panel';
  Object.assign(sheet.style, pctRect(CHARSHEET_RECT));
  ui.appendChild(sheet);
  charSheetEl = sheet;

  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  grid.style.gridTemplateColumns = `repeat(${INVENTORY_COLS}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${INVENTORY_ROWS}, 1fr)`;
  Object.assign(grid.style, pctRect(INVENTORY_RECT));
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const el = document.createElement('div');
    el.className = 'inv-slot';
    el.dataset.container = 'inventory';
    el.dataset.slot = String(i);
    if (DEBUG_INVENTORY_UI) {
      el.classList.add('inv-debug');
      const lbl = document.createElement('span');
      lbl.className = 'inv-debug-label';
      lbl.textContent = String(i);
      el.appendChild(lbl);
    }
    const icon = document.createElement('div');
    icon.className = 'inv-icon';
    el.appendChild(icon);
    const qty = document.createElement('div');
    qty.className = 'inv-qty';
    el.appendChild(qty);
    grid.appendChild(el);
    invEls[i] = el;
    attachSlotInteraction(el, 'inventory', i);
  }
  ui.appendChild(grid);
}

function renderEquipment() {
  EQUIP_SLOTS.forEach(cfg => {
    const el = equipEls[cfg.id];
    const item = getItem(invState.equipment[cfg.id]);
    setIcon(el.querySelector('.inv-icon'), item ? item.icon : '');
    el.title = item ? item.name : '';
    el.classList.toggle('inv-selected', !!item && invState.selected === item.instanceId);
  });
}

function renderInventory() {
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const el = invEls[i];
    const item = getItem(invState.inventory[i]);
    setIcon(el.querySelector('.inv-icon'), item ? item.icon : '');
    el.querySelector('.inv-qty').textContent = (item && item.quantity > 1) ? item.quantity : '';
    el.title = item ? item.name : '';
    el.classList.toggle('inv-selected', !!item && invState.selected === item.instanceId);
  }
}

function renderAll() { renderEquipment(); renderInventory(); renderCharSheet(); }

// Hoja de personaje: de momento solo las estadísticas reales que ya existen
// en state.hero, agrupadas en Ataque y Defensa (en ese orden). Cada stat es
// una fila más en una lista que crece hacia abajo sola — para añadir una
// nueva estadística en el futuro solo hace falta una línea más aquí, no hay
// que tocar ninguna coordenada.
function statRow(label, value, boosted) {
  return `<div class="inv-stat-row"><span class="inv-stat-label">${label}</span> ` +
         `<span class="inv-stat-value${boosted ? ' inv-stat-boosted' : ''}">${value}</span></div>`;
}
function pct(v) { return Math.round((v || 0) * 100) + '%'; }

function renderCharSheet() {
  if (!charSheetEl) return;
  const h = state.hero;
  if (!h) { charSheetEl.innerHTML = ''; return; }
  const resist = h.resist || {};
  const bonus = getSkillBonuses();   // qué parte de crítico/armadura/esquiva viene de habilidades

  const attackRows = [
    statRow(t('stat.damage'), h.atk ?? 0),
    statRow(t('stat.crit'), pct(h.critChance), bonus.crit > 0),
  ].join('');

  const defenseRows = [
    statRow(t('stat.armor'), pct(h.armor), bonus.armor > 0),
    statRow(t('stat.dodge'), pct(h.dodgeChance), bonus.dodge > 0),
    h.hasShield ? statRow(t('stat.block'), pct(h.blockChance)) : '',
    statRow(t('stat.resist.fire'), pct(resist.fire)),
    statRow(t('stat.resist.cold'), pct(resist.cold)),
    statRow(t('stat.resist.nature'), pct(resist.nature)),
    statRow(t('stat.resist.shadow'), pct(resist.shadow)),
    statRow(t('stat.resist.holy'), pct(resist.holy)),
  ].join('');

  // Habilidades PASIVAS compradas en la tienda (sistema temporal de
  // pruebas, ver js/skills.js): de momento solo se listan por nombre y
  // tier, sin desglosar el número exacto que aportan (eso llegará con el
  // sistema de habilidades definitivo).
  const passives = getPassiveOwnedSkills();
  const passiveRows = passives.length
    ? passives.map(s => statRow(t(`skill.${s.id}.name`), '★'.repeat(getOwnedTier(s.id)))).join('')
    : `<div class="inv-stat-row inv-stat-empty">${t('stat.group.skillsEmpty')}</div>`;

  charSheetEl.innerHTML =
    `<div class="inv-stat-group"><h3 class="inv-stat-heading">${t('stat.group.attack')}</h3>${attackRows}</div>` +
    `<div class="inv-stat-group"><h3 class="inv-stat-heading">${t('stat.group.defense')}</h3>${defenseRows}</div>` +
    `<div class="inv-stat-group"><h3 class="inv-stat-heading">${t('stat.group.skills')}</h3>${passiveRows}</div>`;
}

function updateValidSlotHighlights() {
  const allEls = [...Object.values(equipEls), ...invEls];
  allEls.forEach(el => el.classList.remove('inv-valid-target'));
  if (!invState.selected) return;
  const item = getItem(invState.selected);
  if (!item) return;
  getValidDestinations(item).forEach(({ container, slot }) => {
    const el = container === 'inventory' ? invEls[slot] : equipEls[slot];
    if (el) el.classList.add('inv-valid-target');
  });
}


// --- 7. Interacción (clic/toque + drag&drop) -------------------------------

function selectItem(instanceId) {
  invState.selected = instanceId;
  renderAll();
  updateValidSlotHighlights();
}

function cancelSelection() {
  invState.selected = null;
  renderAll();
  updateValidSlotHighlights();
}

function handleSlotActivate(container, slot) {
  const occupantId = container === 'inventory' ? invState.inventory[slot] : invState.equipment[slot];
  if (!invState.selected) {
    if (occupantId) selectItem(occupantId);
    return;
  }
  if (invState.selected === occupantId) { cancelSelection(); return; }
  const moved = moveItem(invState.selected, container, slot);
  cancelSelection();
  return moved;
}

function attachSlotInteraction(el, container, slot) {
  el.addEventListener('click', () => handleSlotActivate(container, slot));

  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', e => {
    const occupantId = container === 'inventory' ? invState.inventory[slot] : invState.equipment[slot];
    if (!occupantId) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', occupantId);
    e.dataTransfer.effectAllowed = 'move';
    selectItem(occupantId);
  });
  el.addEventListener('dragend', () => {
    document.querySelectorAll('.inv-drag-over').forEach(n => n.classList.remove('inv-drag-over'));
  });
  el.addEventListener('dragover', e => {
    if (!invState.selected) return;
    const item = getItem(invState.selected);
    const wouldWork = getValidDestinations(item).some(d => d.container === container && d.slot === slot);
    if (wouldWork) { e.preventDefault(); el.classList.add('inv-drag-over'); }
  });
  el.addEventListener('dragleave', () => el.classList.remove('inv-drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('inv-drag-over');
    const instanceId = e.dataTransfer.getData('text/plain') || invState.selected;
    if (!instanceId) return;
    moveItem(instanceId, container, slot);
    cancelSelection();
  });
}


// --- 8. Escalado responsive --------------------------------------------

let scalerEl = null, veilEl = null, uiEl = null;

function applyScale() {
  if (!veilEl || !veilEl.classList.contains('show')) return;
  const pad = 32;   // 16px de padding de .veil por cada lado
  const availableWidth = Math.max(50, veilEl.clientWidth - pad);
  const availableHeight = Math.max(50, veilEl.clientHeight - pad);
  const scale = Math.min(availableWidth / BASE_W, availableHeight / BASE_H);
  scalerEl.style.width = (BASE_W * scale) + 'px';
  scalerEl.style.height = (BASE_H * scale) + 'px';
  uiEl.style.transform = 'scale(' + scale + ')';
}
window.addEventListener('resize', applyScale);
window.addEventListener('orientationchange', applyScale);


// --- 9. Apertura/cierre + arranque --------------------------------------

export function initInventory() {
  veilEl = document.getElementById('inventoryVeil');
  scalerEl = document.getElementById('invScaler');
  uiEl = document.getElementById('invUI');
  if (!veilEl) return;   // el HTML no está montado (no debería pasar)
  buildStaticDOM();

  document.getElementById('invCloseBtn').addEventListener('click', closeInventory);
  veilEl.addEventListener('click', e => { if (e.target === veilEl) closeInventory(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isInventoryOpen()) closeInventory(); });
}

export function isInventoryOpen() {
  return !!veilEl && veilEl.classList.contains('show');
}

export function openInventory() {
  if (!veilEl) return;
  syncGoldItem();
  cancelSelection();
  veilEl.classList.add('show');
  applyScale();
  renderAll();
}

export function closeInventory() {
  if (!veilEl) return;
  veilEl.classList.remove('show');
  cancelSelection();
}

// Si cambia el idioma mientras el inventario está abierto, las etiquetas de
// las estadísticas (Ataque/Defensa/Daño...) deben refrescarse también.
export function refreshInventoryTexts() {
  if (isInventoryOpen()) renderCharSheet();
}
