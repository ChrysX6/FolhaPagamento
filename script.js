// ============================================================
// SCRIPT PRINCIPAL — Controle do Departamento Pessoal
// ============================================================

const MONTH_NAMES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

const CAMPOS_SIM_NAO = ["ADIANTAMENTO","PAGAMENTO","PRO-LABORE","E-SOCIAL","FGTS","DARF PREVIDENCIARIA","ONVIO","E-MAIL ENVIADO","CONSULTA DET","DAE","DISSIDIO"];

const CAMPO_EMPRESA_POR_CONTROLE = {
  FolhaPagamento: "EMPRESAS",
  ProLabore: "EMPRESAS",
  FolhaDomestica: "EMPREGADOR",
  ControleSindical: "EMPRESA",
  EmpregadorWeb: "EMPRESA"
};

const MAX_HISTORICO = 8;

let state = {
  months: [],
  currentMonth: null,
  currentControl: "FolhaPagamento",
  headers: [],
  rows: [],
  editingIndex: null
};

function monthKey(y,m){ return `${y}-${String(m).padStart(2,"0")}`; }
function monthLabel(key){
  const [y,m] = key.split("-");
  return `${MONTH_NAMES[parseInt(m)-1]}/${y}`;
}

function sheetName(monthKey, control){
  return `${monthKey}_${control}`;
}

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", async () => {
  const startKey = monthKey(START_MONTH.year, START_MONTH.month);
  state.months = await loadMonthsRemote();
  if(!state.months.includes(startKey)){
    state.months.unshift(startKey);
    await apiPost("addMonth", { month: startKey });
  }
  state.currentMonth = state.months[state.months.length-1];
  renderMonths();
  bindEvents();
  renderHistorico();
  await loadTable();
});

// A lista de meses agora fica salva numa aba de controle na própria planilha
// (via apiGet("getMonths")), para aparecer igual para todos os usuários.
async function loadMonthsRemote(){
  try{
    const data = await apiGet("getMonths");
    const meses = (data.months && data.months.length) ? data.months : [];
    return [...new Set(meses)]; // segurança extra contra duplicados
  }catch(err){
    console.error(err);
    return [];
  }
}

// ---------- RENDER MESES (com botão de excluir) ----------
function renderMonths(){
  const list = document.getElementById("monthList");
  list.innerHTML = "";
  state.months.forEach(mk => {
    const li = document.createElement("li");
    li.dataset.month = mk;
    if(mk === state.currentMonth) li.classList.add("active");

    const span = document.createElement("span");
    span.className = "mes-nome";
    span.textContent = monthLabel(mk);
    span.addEventListener("click", () => {
      state.currentMonth = mk;
      renderMonths();
      loadTable();
    });

    const btnDel = document.createElement("button");
    btnDel.className = "btn-del-mes";
    btnDel.innerHTML = "🗑️";
    btnDel.title = "Excluir mês";
    btnDel.addEventListener("click", (e) => {
      e.stopPropagation();
      excluirMes(mk);
    });

    li.appendChild(span);
    li.appendChild(btnDel);
    list.appendChild(li);
  });
}

// ---------- EXCLUIR MÊS ----------
async function excluirMes(mk){
  if(state.months.length <= 1){
    alert("Não é possível excluir o único mês existente.");
    return;
  }

  const confirmar1 = confirm(`Tem certeza que deseja excluir ${monthLabel(mk)}?\n\nIsso vai apagar TODAS as 5 abas desse mês na planilha (Folha de Pagamento, Pró-Labore, Folha Doméstica, Controle Sindical e Empregador Web).`);
  if(!confirmar1) return;

  const confirmar2 = confirm(`Última confirmação: excluir ${monthLabel(mk)} permanentemente?\n\nEssa ação NÃO pode ser desfeita.`);
  if(!confirmar2) return;

  showLoading(true);
  try{
    await apiPost("deleteMonth", {
      month: mk,
      controls: Object.values(CONTROLS)
    });

    // O backend (deleteMonth) já remove o mês da lista compartilhada na planilha
    state.months = state.months.filter(m => m !== mk);

    if(state.currentMonth === mk){
      state.currentMonth = state.months[state.months.length-1];
      await loadTable();
    }

    renderMonths();
    alert(`${monthLabel(mk)} excluído com sucesso.`);
  }catch(err){
    alert("Erro ao excluir o mês. Verifique a conexão.");
    console.error(err);
  }
  showLoading(false);
}

function bindEvents(){
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.currentControl = btn.dataset.control;
      loadTable();
    });
  });

  document.getElementById("addRowBtn").addEventListener("click", ()=>openRowModal());
  document.getElementById("cancelRowBtn").addEventListener("click", closeRowModal);
  document.getElementById("saveRowBtn").addEventListener("click", saveRow);

  document.getElementById("addMonthBtn").addEventListener("click", ()=>{
    document.getElementById("monthModal").classList.remove("hidden");
  });
  document.getElementById("cancelMonthBtn").addEventListener("click", ()=>{
    document.getElementById("monthModal").classList.add("hidden");
  });
  document.getElementById("confirmMonthBtn").addEventListener("click", createNextMonth);

  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);

  document.getElementById("searchInput").addEventListener("input", (e)=>{
    filterTable(e.target.value.toLowerCase());
  });
}

// ---------- API CALLS (Google Apps Script) ----------
async function apiGet(action, params={}){
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(action, payload={}){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

function showLoading(v){
  document.getElementById("loadingIndicator").style.display = v ? "inline" : "none";
}

// ---------- LOAD TABLE ----------
async function loadTable(){
  showLoading(true);
  const sheet = sheetName(state.currentMonth, state.currentControl);
  try{
    const data = await apiGet("getData", { sheet });
    state.headers = data.headers || [];
    state.rows = data.rows || [];
  }catch(err){
    console.error(err);
    state.headers = [];
    state.rows = [];
  }
  renderTable();
  showLoading(false);
}

// ---------- RENDER TABELA (EDIÇÃO DIRETA NA CÉLULA) ----------
function renderTable(){
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  head.innerHTML = "";
  body.innerHTML = "";

  state.headers.forEach(h=>{
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  const thActions = document.createElement("th");
  thActions.textContent = "Ações";
  head.appendChild(thActions);

  state.rows.forEach((row, idx)=>{
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = idx;
    state.headers.forEach(h=>{
      const td = document.createElement("td");
      criarCelulaEditavel(td, row, idx, h);
      tr.appendChild(td);
    });
    const tdAct = document.createElement("td");
    tdAct.className = "row-actions";
    tdAct.innerHTML = `<button onclick="deleteRow(${idx})" class="btn-excluir" title="Excluir">🗑️ Excluir</button>`;
    tr.appendChild(tdAct);
    body.appendChild(tr);
  });
}

function criarCelulaEditavel(td, row, idx, campo){
  const ehSimNao = CAMPOS_SIM_NAO.includes(campo);
  td.classList.add("celula-editavel");

  function pintarValor(valor){
    if(ehSimNao){
      td.classList.add("campo-sim-nao");
      const v = (valor || "").toString().trim().toLowerCase();
      td.innerHTML = (v === "ok" || v === "sim")
        ? '<span class="badge-sim">✔ OK</span>'
        : (v === "" ? '<span class="badge-vazio">—</span>' : `<span class="badge-nao">${valor}</span>`);
    } else {
      td.textContent = valor || "";
    }
  }

  pintarValor(row[campo]);

  td.addEventListener("click", function entrarEdicao(){
    if(td.querySelector("input, select")) return;

    const valorOriginal = row[campo] || "";
    td.innerHTML = "";

    let input;
    if(ehSimNao){
      input = document.createElement("select");
      ["", "OK", "Não"].forEach(opt=>{
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt === "" ? "(vazio)" : opt;
        if(opt.toLowerCase() === valorOriginal.toString().toLowerCase()) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = valorOriginal;
    }

    td.appendChild(input);
    input.focus();
    if(input.select) input.select();

    async function confirmarEdicao(){
      const novoValor = input.value;
      if(novoValor === valorOriginal){
        pintarValor(valorOriginal);
        return;
      }
      row[campo] = novoValor;
      pintarValor(novoValor);
      await salvarLinhaCompleta(idx, row);
      registrarHistorico(row);
    }

    input.addEventListener("blur", confirmarEdicao);
    input.addEventListener("keydown", (e)=>{
      if(e.key === "Enter"){ e.preventDefault(); input.blur(); }
      if(e.key === "Escape"){ pintarValor(valorOriginal); }
    });
  });
}

async function salvarLinhaCompleta(idx, rowObj){
  const sheet = sheetName(state.currentMonth, state.currentControl);
  showLoading(true);
  try{
    await apiPost("updateRow", { sheet, index: idx, row: rowObj });
  }catch(err){
    alert("Erro ao salvar alteração. Verifique a conexão.");
    console.error(err);
  }
  showLoading(false);
}

function filterTable(term){
  document.querySelectorAll("#tableBody tr").forEach(tr=>{
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(term) ? "" : "none";
  });
}

// ============================================================
// 🕘 HISTÓRICO DE ÚLTIMAS EMPRESAS
// ============================================================

function loadHistoricoLocal(){
  const saved = localStorage.getItem("dp_historico");
  return saved ? JSON.parse(saved) : [];
}
function saveHistoricoLocal(historico){
  localStorage.setItem("dp_historico", JSON.stringify(historico));
}

function registrarHistorico(rowObj){
  const campoEmpresa = CAMPO_EMPRESA_POR_CONTROLE[state.currentControl];
  const nomeEmpresa = (rowObj[campoEmpresa] || "").toString().trim();
  if(!nomeEmpresa) return;

  let historico = loadHistoricoLocal();

  const novoItem = {
    empresa: nomeEmpresa,
    controle: state.currentControl,
    mes: state.currentMonth,
    data: new Date().toISOString()
  };

  historico = historico.filter(item =>
    !(item.empresa === novoItem.empresa && item.controle === novoItem.controle && item.mes === novoItem.mes)
  );

  historico.unshift(novoItem);
  if(historico.length > MAX_HISTORICO) historico = historico.slice(0, MAX_HISTORICO);

  saveHistoricoLocal(historico);
  renderHistorico();
}

const NOMES_CONTROLE_AMIGAVEL = {
  FolhaPagamento: "Folha de Pagamento",
  ProLabore: "Pró-Labore",
  FolhaDomestica: "Folha Doméstica",
  ControleSindical: "Controle Sindical",
  EmpregadorWeb: "Empregador Web"
};

function renderHistorico(){
  const lista = document.getElementById("historicoList");
  if(!lista) return;
  lista.innerHTML = "";

  const historico = loadHistoricoLocal();

  if(historico.length === 0){
    const vazio = document.createElement("li");
    vazio.className = "historico-vazio";
    vazio.textContent = "Nenhum registro recente";
    lista.appendChild(vazio);
    return;
  }

  historico.forEach(item => {
    const li = document.createElement("li");
    li.className = "historico-item";
    li.innerHTML = `
      <span class="historico-empresa">${item.empresa}</span>
      <span class="historico-meta">${NOMES_CONTROLE_AMIGAVEL[item.controle] || item.controle} · ${monthLabel(item.mes)}</span>
    `;
    li.addEventListener("click", () => irParaEmpresa(item));
    lista.appendChild(li);
  });
}

async function irParaEmpresa(item){
  let precisaRecarregar = false;

  if(!state.months.includes(item.mes)){
    return; // mês foi excluído, não faz nada
  }

  if(state.currentMonth !== item.mes){
    state.currentMonth = item.mes;
    renderMonths();
    precisaRecarregar = true;
  }
  if(state.currentControl !== item.controle){
    document.querySelectorAll(".tab-btn").forEach(b=>{
      b.classList.toggle("active", b.dataset.control === item.controle);
    });
    state.currentControl = item.controle;
    precisaRecarregar = true;
  }

  if(precisaRecarregar){
    await loadTable();
  }

  destacarLinhaPorEmpresa(item.empresa);
}

function destacarLinhaPorEmpresa(nomeEmpresa){
  const campoEmpresa = CAMPO_EMPRESA_POR_CONTROLE[state.currentControl];
  const idx = state.rows.findIndex(r => (r[campoEmpresa] || "").toString().trim() === nomeEmpresa);
  if(idx === -1) return;

  const tr = document.querySelector(`#tableBody tr[data-row-index="${idx}"]`);
  if(tr){
    tr.scrollIntoView({ behavior:"smooth", block:"center" });
    tr.classList.add("linha-destacada");
    setTimeout(() => tr.classList.remove("linha-destacada"), 2000);
  }
}

// ---------- MODAL DE ADIÇÃO ----------
function openRowModal(){
  document.getElementById("modalTitle").textContent = "Adicionar Registro";
  const fieldsDiv = document.getElementById("modalFields");
  fieldsDiv.innerHTML = "";

  const headers = state.headers.length ? state.headers : [];
  headers.forEach(h=>{
    const label = document.createElement("label");
    label.textContent = h;
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.field = h;
    input.value = "";
    label.appendChild(input);
    fieldsDiv.appendChild(label);
  });

  document.getElementById("rowModal").classList.remove("hidden");
}

function closeRowModal(){
  document.getElementById("rowModal").classList.add("hidden");
}

async function saveRow(){
  const inputs = document.querySelectorAll("#modalFields input");
  const rowObj = {};
  inputs.forEach(inp => rowObj[inp.dataset.field] = inp.value);

  const sheet = sheetName(state.currentMonth, state.currentControl);
  showLoading(true);
  try{
    await apiPost("addRow", { sheet, row: rowObj });
    closeRowModal();
    await loadTable();
    registrarHistorico(rowObj);
  }catch(err){
    alert("Erro ao salvar. Verifique a conexão com o Google Sheets.");
  }
  showLoading(false);
}

async function deleteRow(idx){
  if(!confirm("Deseja realmente excluir este registro?")) return;
  const sheet = sheetName(state.currentMonth, state.currentControl);
  showLoading(true);
  try{
    await apiPost("deleteRow", { sheet, index: idx });
    await loadTable();
  }catch(err){
    alert("Erro ao excluir.");
  }
  showLoading(false);
}

// ---------- NOVO MÊS ----------
async function createNextMonth(){
  const last = state.months[state.months.length-1];
  const [y,m] = last.split("-").map(Number);
  let ny = y, nm = m+1;
  if(nm > 12){ nm = 1; ny++; }
  const newKey = monthKey(ny, nm);

  if(state.months.includes(newKey)){
    alert("Este mês já existe.");
    document.getElementById("monthModal").classList.add("hidden");
    return;
  }

  showLoading(true);
  try{
    // Registra o mês na aba de controle compartilhada — é isso que faz
    // ele aparecer para todos os usuários, não só para quem criou.
    await apiPost("addMonth", { month: newKey });

    for(const control of Object.values(CONTROLS)){
      const baseSheet = sheetName(last, control);
      const newSheet = sheetName(newKey, control);
      await apiPost("createMonthSheet", { baseSheet, newSheet });
    }
    state.months.push(newKey);
    state.currentMonth = newKey;
    renderMonths();
    await loadTable();
  }catch(err){
    alert("Erro ao criar novo mês na planilha.");
  }
  document.getElementById("monthModal").classList.add("hidden");
  showLoading(false);
}

// ---------- EXPORTAÇÃO ----------
function exportCsv(){
  if(!state.rows.length){ alert("Nenhum dado para exportar."); return; }
  let csv = state.headers.join(";") + "\n";
  state.rows.forEach(row=>{
    csv += state.headers.map(h => `"${(row[h]||"").toString().replace(/"/g,'""')}"`).join(";") + "\n";
  });
  const blob = new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${sheetName(state.currentMonth, state.currentControl)}.csv`;
  link.click();
}

function exportPdf(){
  if(!state.rows.length){ alert("Nenhum dado para exportar."); return; }
  const scriptJsPdf = document.createElement("script");
  scriptJsPdf.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  scriptJsPdf.onload = () => {
    const scriptAutoTable = document.createElement("script");
    scriptAutoTable.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
    scriptAutoTable.onload = generatePdf;
    document.body.appendChild(scriptAutoTable);
  };
  document.body.appendChild(scriptJsPdf);
}

function generatePdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape" });
  doc.setFontSize(14);
  doc.text(`Relatório — ${state.currentControl} — ${monthLabel(state.currentMonth)}`, 14, 15);
  doc.autoTable({
    startY: 22,
    head: [state.headers],
    body: state.rows.map(r => state.headers.map(h => r[h] || "")),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [11,37,69] }
  });
  doc.save(`${sheetName(state.currentMonth, state.currentControl)}.pdf`);
}
