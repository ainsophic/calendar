"use strict";

/*
  Ainsophic Event Intelligence — Calendario editable
  Vanilla JS, sin frameworks ni build step. Pensado para servirse como
  sitio estático (ej. nginx). Los datos viven en localStorage del
  navegador; "events.json" es solo la semilla inicial / el respaldo
  de fábrica. Usá "Exportar copia" para sacar un dump periódico.
*/

// ---------- Constantes ----------

const SEED_URL = "events.json";
const STORAGE_KEY = "ainsophic_calendar_data_v1";

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const WEEKDAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const WEEKDAYS_MIN = ["L","M","M","J","V","S","D"];

const DEFAULT_PRIORITIES = ["P0","P1","P2","P3"];
const DEFAULT_ACTIONS = ["GO","PARTNER","WATCH","BLACKOUT","CONDITIONAL"];
const DEFAULT_STATUSES = ["planned","conditional","watch","done"];
const DEFAULT_ENTITIES = ["SAS","Foundation","SAS + Research Labs","Externo"];
const DEFAULT_TYPES = ["Ainsophic","Mendoza","Argentina","Global"];

// ---------- Estado ----------

let data = [];              // dataset de trabajo (array de eventos)
let dataReady = false;

const state = {
  view: "month",           // year | month | day | agenda
  cursor: new Date(),      // fecha de referencia para navegación
  search: "",
  entity: "all",
  type: "all",
  filter: "all",           // all | must | pending | done
  selectedId: null,
  editingId: null          // null = alta nueva, id = edición
};

// ---------- Helpers DOM ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

// ---------- Helpers de fecha (todo en horario local, sin UTC) ----------

function pad2(n) { return String(n).padStart(2, "0"); }

function isoFromParts(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

function isoFromDate(date) {
  return isoFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() { return isoFromDate(new Date()); }

function mondayIndex(date) { return (date.getDay() + 6) % 7; } // Lun=0…Dom=6

function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function addYears(date, delta) {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1);
}

function fmtDate(iso) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(parseISO(iso));
}

function fmtDateLong(date) {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(date);
}

// ---------- Carga / persistencia de datos ----------

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.events)) return parsed.events;
  } catch (err) { /* localStorage corrupto: seguimos con la semilla */ }
  return null;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      events: data
    }));
    showDataStatus();
  } catch (err) {
    showDataError("No se pudo guardar en este navegador (¿modo privado o almacenamiento lleno?). Exportá una copia para no perder los cambios.");
  }
}

async function fetchSeed() {
  const res = await fetch(SEED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  return Array.isArray(json.events) ? json.events : (Array.isArray(json) ? json : []);
}

async function loadData() {
  const local = readLocal();
  if (local) {
    data = local;
    dataReady = true;
    showDataStatus();
    return;
  }
  try {
    data = await fetchSeed();
    dataReady = true;
    persist();
  } catch (err) {
    dataReady = false;
    showDataError(
      "No se pudieron cargar los datos iniciales (events.json). " +
      "Si abriste este archivo con doble clic (file://), el navegador bloquea esa carga: " +
      "serví la carpeta con un servidor (nginx, o \"python3 -m http.server\" para probar en local) y volvé a intentar."
    );
  }
}

function showDataError(msg) {
  const box = $("#data-error");
  box.textContent = msg;
  box.classList.add("show");
}

function clearDataError() {
  const box = $("#data-error");
  box.classList.remove("show");
  box.textContent = "";
}

function showDataStatus() {
  const el = $("#data-status");
  if (!el) return;
  el.textContent = `Guardado en este navegador · ${data.length} eventos.`;
}

function uniqueId(title) {
  const base = slugify(title) || "evento";
  const ids = new Set(data.map(e => e.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function addEvent(payload) {
  payload.id = uniqueId(payload.title);
  data.push(payload);
  persist();
  afterMutation();
}

function updateEvent(id, payload) {
  const idx = data.findIndex(e => e.id === id);
  if (idx < 0) return;
  data[idx] = Object.assign({}, data[idx], payload, { id });
  persist();
  afterMutation();
}

function deleteEvent(id) {
  const idx = data.findIndex(e => e.id === id);
  if (idx < 0) return;
  data.splice(idx, 1);
  persist();
  afterMutation();
}

function afterMutation() {
  clearDataError();
  populateFilterOptions();
  render();
}

function exportDump() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), events: data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `ainsophic-calendario-dump-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importDump(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (err) { alert("El archivo no es un JSON válido."); return; }
    const events = Array.isArray(parsed.events) ? parsed.events
      : (Array.isArray(parsed) ? parsed : null);
    if (!events) { alert('El archivo no tiene el formato esperado ({ "events": [...] }).'); return; }
    const ok = confirm(
      `Se van a reemplazar los ${data.length} eventos actuales por ${events.length} eventos del archivo importado. ¿Continuar?`
    );
    if (!ok) return;
    data = events;
    persist();
    afterMutation();
  };
  reader.onerror = () => alert("No se pudo leer el archivo.");
  reader.readAsText(file);
}

async function restoreSeed() {
  const ok = confirm(
    "Esto reemplaza todos los eventos actuales por los datos originales de fábrica (events.json). " +
    "Los cambios no exportados se van a perder. ¿Continuar?"
  );
  if (!ok) return;
  try {
    data = await fetchSeed();
    persist();
    afterMutation();
  } catch (err) {
    alert("No se pudo recargar events.json.");
  }
}

// ---------- Filtros ----------

function isVisible(event) {
  const q = state.search.trim().toLowerCase();
  const haystack = [
    event.title, event.entity, event.type, event.city,
    event.product, event.summary, event.strategy, event.action
  ].join(" ").toLowerCase();

  if (q && !haystack.includes(q)) return false;
  if (state.entity !== "all" && event.entity !== state.entity) return false;
  if (state.type !== "all" && event.type !== state.type) return false;
  if (state.filter === "must" && event.priority !== "P0") return false;
  if (state.filter === "done" && !event.done) return false;
  if (state.filter === "pending" && event.done) return false;
  return true;
}

function eventsOnDate(iso) {
  return data.filter(e => e.date === iso && isVisible(e));
}

function scoreClass(score) {
  const n = Number(score);
  if (n >= 90) return "score-high";
  if (n >= 75) return "score-mid";
  return "score-low";
}

function actionClass(action) {
  return ({
    GO: "action-go", PARTNER: "action-partner", WATCH: "action-watch",
    BLACKOUT: "action-blackout", CONDITIONAL: "action-conditional"
  })[action] || "";
}

function uniqueValues(field) {
  return [...new Set(data.map(e => e[field]).filter(Boolean))].sort();
}

function populateFilterOptions() {
  fillSelect($("#entity"), uniqueValues("entity"), "Todas las entidades");
  fillSelect($("#type"), uniqueValues("type"), "Todos los tipos");

  fillDatalist("dl-entity", [...new Set([...DEFAULT_ENTITIES, ...uniqueValues("entity")])]);
  fillDatalist("dl-type", [...new Set([...DEFAULT_TYPES, ...uniqueValues("type")])]);
  fillDatalist("dl-priority", [...new Set([...DEFAULT_PRIORITIES, ...uniqueValues("priority")])]);
  fillDatalist("dl-action", [...new Set([...DEFAULT_ACTIONS, ...uniqueValues("action")])]);
  fillDatalist("dl-status", [...new Set([...DEFAULT_STATUSES, ...uniqueValues("status")])]);
  fillDatalist("dl-product", uniqueValues("product"));
}

function fillSelect(select, values, allLabel) {
  const current = select.value || "all";
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  select.value = values.includes(current) ? current : "all";
}

function fillDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">`).join("");
}

// ---------- Render dispatch ----------

function render() {
  if (!dataReady) return;
  updateStats();
  $$(".view-panel").forEach(p => p.classList.remove("active"));
  $(`#view-${state.view}`).classList.add("active");

  if (state.view === "year") renderYear();
  else if (state.view === "month") renderMonth();
  else if (state.view === "day") renderDay();
  else renderAgenda();

  renderNavLabel();
}

function updateStats() {
  const total = data.length;
  const p0 = data.filter(e => e.priority === "P0").length;
  const done = data.filter(e => e.done).length;
  const shown = data.filter(isVisible).length;

  $("#stats").innerHTML = total ? `
    <strong>${total}</strong> eventos ·
    <strong>${p0}</strong> P0 ·
    <strong>${shown}</strong> visibles ·
    <strong>${done}/${total}</strong> gestionados ·
    <strong>${total ? Math.round(done / total * 100) : 0}%</strong> completado
  ` : "Todavía no hay eventos cargados.";
}

function renderNavLabel() {
  const label = $("#nav-label");
  if (state.view === "year") {
    label.textContent = String(state.cursor.getFullYear());
  } else if (state.view === "month") {
    label.textContent = `${MONTHS[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`;
  } else if (state.view === "day") {
    label.textContent = fmtDateLong(state.cursor);
  } else {
    label.textContent = "Agenda completa";
  }
}

// ---------- Vista Mes ----------

function renderMonth() {
  const grid = $("#month-grid");
  const year = state.cursor.getFullYear();
  const monthIdx = state.cursor.getMonth();
  const firstOfMonth = new Date(year, monthIdx, 1);
  const firstWeekday = mondayIndex(firstOfMonth);
  const totalDays = new Date(year, monthIdx + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + totalDays) / 7) * 7;
  const today = todayISO();

  let html = WEEKDAYS.map(w => `<div class="weekday-head">${w}</div>`).join("");

  for (let i = 0; i < totalCells; i++) {
    const cellDate = addDays(firstOfMonth, i - firstWeekday);
    const iso = isoFromDate(cellDate);
    const inMonth = cellDate.getMonth() === monthIdx && cellDate.getFullYear() === year;
    const events = eventsOnDate(iso).sort((a, b) => (b.score || 0) - (a.score || 0));
    const visibleChips = events.slice(0, 3);
    const extra = events.length - visibleChips.length;

    html += `
      <div class="day-cell ${inMonth ? "" : "other-month"} ${iso === today ? "today" : ""}" data-iso="${iso}">
        <div class="day-cell-head">
          <button type="button" class="day-num" data-goto-day="${iso}">${cellDate.getDate()}</button>
          <button type="button" class="day-add" data-add-on="${iso}" title="Agregar evento">+</button>
        </div>
        <div class="day-chips">
          ${visibleChips.map(ev => `
            <button type="button" class="event-chip ${actionClass(ev.action)}" data-open="${ev.id}">${escapeHtml(ev.title)}</button>
          `).join("")}
          ${extra > 0 ? `<button type="button" class="day-more" data-goto-day="${iso}">+${extra} más</button>` : ""}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;

  $$("[data-open]", grid).forEach(btn => btn.addEventListener("click", ev => {
    ev.stopPropagation();
    const found = data.find(e => e.id === btn.dataset.open);
    if (found) openDetail(found);
  }));
  $$("[data-add-on]", grid).forEach(btn => btn.addEventListener("click", ev => {
    ev.stopPropagation();
    openForm(null, btn.dataset.addOn);
  }));
  $$("[data-goto-day]", grid).forEach(btn => btn.addEventListener("click", () => {
    state.cursor = parseISO(btn.dataset.gotoDay);
    state.view = "day";
    setActiveTab("day");
    render();
  }));
}

// ---------- Vista Año ----------

function renderYear() {
  const grid = $("#year-grid");
  const year = state.cursor.getFullYear();
  const today = todayISO();
  let html = "";

  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(year, m, 1);
    const firstWeekday = mondayIndex(firstOfMonth);
    const totalDays = new Date(year, m + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + totalDays) / 7) * 7;

    let days = "";
    for (let i = 0; i < totalCells; i++) {
      const cellDate = addDays(firstOfMonth, i - firstWeekday);
      const inMonth = cellDate.getMonth() === m;
      if (!inMonth) { days += `<span class="mini-day blank">·</span>`; continue; }
      const iso = isoFromDate(cellDate);
      const has = eventsOnDate(iso).length > 0;
      days += `<button type="button" class="mini-day ${has ? "has-events" : ""} ${iso === today ? "today" : ""}" data-goto-day="${iso}">${cellDate.getDate()}</button>`;
    }

    html += `
      <div class="mini-month">
        <button type="button" class="mini-month-head" data-goto-month="${m}">${MONTHS_SHORT[m]}</button>
        <div class="mini-grid">
          ${WEEKDAYS_MIN.map(w => `<span class="mini-wd">${w}</span>`).join("")}
          ${days}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;

  $$("[data-goto-day]", grid).forEach(btn => btn.addEventListener("click", () => {
    state.cursor = parseISO(btn.dataset.gotoDay);
    state.view = "day";
    setActiveTab("day");
    render();
  }));
  $$("[data-goto-month]", grid).forEach(btn => btn.addEventListener("click", () => {
    state.cursor = new Date(year, Number(btn.dataset.gotoMonth), 1);
    state.view = "month";
    setActiveTab("month");
    render();
  }));
}

// ---------- Vista Día ----------

function renderDay() {
  const container = $("#day-events");
  const iso = isoFromDate(state.cursor);
  const events = eventsOnDate(iso).sort((a, b) => (b.score || 0) - (a.score || 0));

  const addBtn = `<button type="button" class="btn btn-primary" id="day-add-btn">+ Agregar evento este día</button>`;

  if (!events.length) {
    container.innerHTML = `${addBtn}<div class="empty" style="margin-top:12px">Sin eventos este día con el filtro actual.</div>`;
  } else {
    container.innerHTML = addBtn + '<div style="margin-top:12px" class="day-events-list">' +
      events.map(ev => eventCardHtml(ev)).join("") + "</div>";
  }

  $("#day-add-btn").addEventListener("click", () => openForm(null, iso));
  wireEventCards(container);
}

// ---------- Vista Agenda ----------

function renderAgenda() {
  const container = $("#agenda-groups");
  const visible = data.filter(isVisible).slice().sort((a, b) => a.date.localeCompare(b.date));

  if (!visible.length) {
    container.innerHTML = `<div class="empty">Sin eventos con este filtro.</div>`;
    return;
  }

  const groups = new Map(); // key "YYYY-MM" -> events[]
  visible.forEach(ev => {
    const key = ev.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  });

  let html = "";
  [...groups.keys()].sort().forEach(key => {
    const [y, m] = key.split("-").map(Number);
    const list = groups.get(key);
    html += `
      <section class="month">
        <div class="month-head">
          <h2>${MONTHS[m - 1]} ${y}</h2>
          <span>${list.length} evento${list.length === 1 ? "" : "s"}</span>
        </div>
        <div class="month-events">
          ${list.map(ev => eventCardHtml(ev)).join("")}
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
  wireEventCards(container);
}

// ---------- Tarjeta de evento reutilizable (Día / Agenda) ----------

function eventCardHtml(event) {
  const checked = !!event.done;
  return `
    <article class="event ${checked ? "is-done" : ""}" data-id="${event.id}" tabindex="0">
      <label class="check-wrap" title="Marcar como gestionado">
        <input type="checkbox" data-check="${event.id}" ${checked ? "checked" : ""} aria-label="Marcar ${escapeHtml(event.title)}">
      </label>
      <div class="event-content">
        <div class="event-top">
          <span class="date">${fmtDate(event.date)}</span>
          <span class="score ${scoreClass(event.score)}">${event.score ?? "—"}/100</span>
        </div>
        <button class="event-title" type="button" data-open="${event.id}">${escapeHtml(event.title)}</button>
        <div class="event-meta">${escapeHtml(event.city || "")} · ${escapeHtml(event.entity || "")} · ${escapeHtml(event.product || "")}</div>
        <div class="chips">
          <span class="chip">${escapeHtml(event.priority || "")}</span>
          <span class="chip ${actionClass(event.action)}">${escapeHtml(event.action || "")}</span>
          <span class="chip">${escapeHtml(event.type || "")}</span>
        </div>
      </div>
      <button class="open-event" type="button" data-open="${event.id}" aria-label="Ver detalles">→</button>
    </article>
  `;
}

function wireEventCards(root) {
  $$("[data-check]", root).forEach(cb => {
    cb.addEventListener("click", ev => ev.stopPropagation());
    cb.addEventListener("change", ev => {
      updateEvent(cb.dataset.check, { done: ev.target.checked });
    });
  });
  $$("[data-open]", root).forEach(btn => btn.addEventListener("click", () => {
    const found = data.find(e => e.id === btn.dataset.open);
    if (found) openDetail(found);
  }));
}

// ---------- Panel de detalle ----------

function openDetail(event) {
  state.selectedId = event.id;

  $("#detail").innerHTML = `
    <div class="detail-kicker">${escapeHtml(event.action || "")} · ${escapeHtml(event.priority || "")} · ${event.score ?? "—"}/100</div>
    <h2>${escapeHtml(event.title)}</h2>
    <p class="detail-date">${fmtDate(event.date)} · ${escapeHtml(event.city || "")}</p>

    <div class="detail-grid">
      <div><span class="label">Entidad</span><strong>${escapeHtml(event.entity || "—")}</strong></div>
      <div><span class="label">Producto / tema</span><strong>${escapeHtml(event.product || "—")}</strong></div>
    </div>

    ${event.summary ? `<section class="detail-section"><h3>Qué es</h3><p>${escapeHtml(event.summary)}</p></section>` : ""}
    ${event.strategy ? `<section class="detail-section"><h3>Por qué importa</h3><p>${escapeHtml(event.strategy)}</p></section>` : ""}
    ${event.tasks && event.tasks.length ? `
      <section class="detail-section">
        <h3>Qué debemos hacer</h3>
        <ul>${event.tasks.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      </section>` : ""}

    <section class="detail-section">
      <h3>Estado</h3>
      <label class="inline-check">
        <input id="detail-check" type="checkbox" ${event.done ? "checked" : ""}>
        Marcar como gestionado
      </label>
    </section>

    ${event.source ? `
      <section class="detail-section">
        <h3>Fuente</h3>
        <a href="${escapeHtml(event.source)}" target="_blank" rel="noopener noreferrer">Abrir fuente</a>
      </section>` : ""}
  `;

  $("#detail-check").addEventListener("change", ev => {
    updateEvent(event.id, { done: ev.target.checked });
  });

  $("#panel").classList.add("open");
  document.body.classList.add("locked");
}

function closePanel() {
  $("#panel").classList.remove("open");
  document.body.classList.remove("locked");
  state.selectedId = null;
}

// ---------- Modal alta / edición ----------

function openForm(eventOrNull, prefillDate) {
  state.editingId = eventOrNull ? eventOrNull.id : null;
  const ev = eventOrNull || {};

  $("#modal-title").textContent = eventOrNull ? "Editar evento" : "Nuevo evento";
  $("#f-title").value = ev.title || "";
  $("#f-date").value = ev.date || prefillDate || todayISO();
  $("#f-priority").value = ev.priority || "";
  $("#f-entity").value = ev.entity || "";
  $("#f-type").value = ev.type || "";
  $("#f-action").value = ev.action || "";
  $("#f-score").value = ev.score ?? "";
  $("#f-city").value = ev.city || "";
  $("#f-product").value = ev.product || "";
  $("#f-status").value = ev.status || "";
  $("#f-source").value = ev.source || "";
  $("#f-summary").value = ev.summary || "";
  $("#f-strategy").value = ev.strategy || "";
  $("#f-tasks").value = (ev.tasks || []).join("\n");
  $("#f-done").checked = !!ev.done;

  $("#modal").classList.add("open");
  document.body.classList.add("locked");
  $("#f-title").focus();
}

function closeForm() {
  $("#modal").classList.remove("open");
  document.body.classList.remove("locked");
  state.editingId = null;
}

function handleFormSubmit(ev) {
  ev.preventDefault();
  const payload = {
    title: $("#f-title").value.trim(),
    date: $("#f-date").value,
    priority: $("#f-priority").value.trim(),
    entity: $("#f-entity").value.trim(),
    type: $("#f-type").value.trim(),
    action: $("#f-action").value.trim(),
    score: $("#f-score").value === "" ? null : Number($("#f-score").value),
    city: $("#f-city").value.trim(),
    product: $("#f-product").value.trim(),
    status: $("#f-status").value.trim(),
    source: $("#f-source").value.trim(),
    summary: $("#f-summary").value.trim(),
    strategy: $("#f-strategy").value.trim(),
    tasks: $("#f-tasks").value.split("\n").map(t => t.trim()).filter(Boolean),
    done: $("#f-done").checked
  };

  if (!payload.title || !payload.date) return;

  if (state.editingId) {
    updateEvent(state.editingId, payload);
  } else {
    addEvent(payload);
  }

  closeForm();
  // Llevar la vista al evento recién guardado
  state.cursor = parseISO(payload.date);
  render();
}

// ---------- Navegación entre vistas ----------

function setActiveTab(view) {
  $$(".view-tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}

function setupViewTabs() {
  $$(".view-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      setActiveTab(state.view);
      render();
    });
  });
}

function setupNav() {
  $("#nav-prev").addEventListener("click", () => {
    if (state.view === "year") state.cursor = addYears(state.cursor, -1);
    else if (state.view === "month") state.cursor = addMonths(state.cursor, -1);
    else if (state.view === "day") state.cursor = addDays(state.cursor, -1);
    render();
  });
  $("#nav-next").addEventListener("click", () => {
    if (state.view === "year") state.cursor = addYears(state.cursor, 1);
    else if (state.view === "month") state.cursor = addMonths(state.cursor, 1);
    else if (state.view === "day") state.cursor = addDays(state.cursor, 1);
    render();
  });
  $("#nav-today").addEventListener("click", () => {
    state.cursor = new Date();
    render();
  });
}

// ---------- Filtros de la barra superior ----------

function setupFilters() {
  $("#search").addEventListener("input", ev => { state.search = ev.target.value; render(); });
  $("#entity").addEventListener("change", ev => { state.entity = ev.target.value; render(); });
  $("#type").addEventListener("change", ev => { state.type = ev.target.value; render(); });

  $$(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      $$(".filter-btn").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });

  $("#reset").addEventListener("click", () => {
    state.filter = "all";
    state.search = "";
    state.entity = "all";
    state.type = "all";
    $("#search").value = "";
    $("#entity").value = "all";
    $("#type").value = "all";
    $$(".filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === "all"));
    render();
  });
}

// ---------- Panel de detalle / modal: wiring ----------

function setupPanel() {
  $("#close-panel").addEventListener("click", closePanel);
  $("#panel").addEventListener("click", ev => { if (ev.target.id === "panel") closePanel(); });

  $("#edit-event").addEventListener("click", () => {
    const found = data.find(e => e.id === state.selectedId);
    if (!found) return;
    closePanel();
    openForm(found);
  });

  $("#delete-event").addEventListener("click", () => {
    const found = data.find(e => e.id === state.selectedId);
    if (!found) return;
    if (confirm(`¿Eliminar "${found.title}"? Esta acción no se puede deshacer.`)) {
      deleteEvent(found.id);
      closePanel();
    }
  });

  document.addEventListener("keydown", ev => {
    if (ev.key !== "Escape") return;
    if ($("#modal").classList.contains("open")) closeForm();
    else if ($("#panel").classList.contains("open")) closePanel();
  });
}

function setupModal() {
  $("#event-form").addEventListener("submit", handleFormSubmit);
  $("#form-cancel").addEventListener("click", closeForm);
  $("#modal").addEventListener("click", ev => { if (ev.target.id === "modal") closeForm(); });
}

function setupDataActions() {
  $("#btn-new").addEventListener("click", () => openForm(null, isoFromDate(state.cursor)));
  $("#btn-export").addEventListener("click", exportDump);
  $("#btn-restore").addEventListener("click", restoreSeed);

  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", ev => {
    const file = ev.target.files[0];
    if (file) importDump(file);
    ev.target.value = "";
  });
}

// ---------- Init ----------

async function init() {
  setupViewTabs();
  setupNav();
  setupFilters();
  setupPanel();
  setupModal();
  setupDataActions();

  await loadData();
  if (dataReady) {
    populateFilterOptions();
    render();
  }
}

document.addEventListener("DOMContentLoaded", init);
