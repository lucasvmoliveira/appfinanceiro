(function () {
  "use strict";

  const STORAGE_KEY = "fluxo_financeiro_v1";

  const DEFAULT_CATEGORIES = [
    { id: "salario", label: "Salário / renda fixa", kind: "income" },
    { id: "freelance", label: "Freelance / extras", kind: "income" },
    { id: "investimentos", label: "Investimentos", kind: "income" },
    { id: "moradia", label: "Moradia", kind: "expense" },
    { id: "alimentacao", label: "Alimentação", kind: "expense" },
    { id: "transporte", label: "Transporte", kind: "expense" },
    { id: "saude", label: "Saúde", kind: "expense" },
    { id: "lazer", label: "Lazer", kind: "expense" },
    { id: "servicos", label: "Assinaturas / serviços", kind: "expense" },
    { id: "outros", label: "Outros", kind: "both" },
  ];

  /** @type {{ transactions: Array<object>, openingBalance: number, categories: Array<object> }} */
  let state = loadState();

  function migrateLegacyFinancas() {
    try {
      const legacy = localStorage.getItem("financas");
      if (!legacy) return null;
      const rows = JSON.parse(legacy);
      if (!Array.isArray(rows)) return null;
      const transactions = rows.map((row) => ({
        id: uid(),
        description: String(row.desc || "").trim() || "Lançamento",
        amount: Math.abs(Number(row.valor) || 0),
        kind: row.tipo === "entrada" ? "income" : "expense",
        categoryId: row.tipo === "entrada" ? "salario" : "outros",
        month: row.mes || monthFromDate(),
        status: "realized",
        recurrence: "none",
        createdAt: new Date().toISOString(),
      }));
      localStorage.removeItem("financas");
      return { openingBalance: 0, categories: DEFAULT_CATEGORIES.slice(), transactions };
    } catch {
      return null;
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const migrated = migrateLegacyFinancas();
        if (migrated) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
        return defaultState();
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.transactions)) return defaultState();
      return {
        openingBalance: typeof parsed.openingBalance === "number" ? parsed.openingBalance : 0,
        categories:
          Array.isArray(parsed.categories) && parsed.categories.length
            ? parsed.categories
            : DEFAULT_CATEGORIES.slice(),
        transactions: parsed.transactions,
      };
    } catch {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      openingBalance: 0,
      categories: DEFAULT_CATEGORIES.slice(),
      transactions: [],
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
  }

  function monthFromDate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function compareMonth(a, b) {
    return a.localeCompare(b);
  }

  function addMonths(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthFromDate(d);
  }

  function parseMoneyInput(el) {
    const v = parseFloat(String(el.value).replace(",", "."), 10);
    return Number.isFinite(v) ? v : NaN;
  }

  function formatBRL(n) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(n);
  }

  function categoriesForKind(kind) {
    return state.categories.filter((c) => c.kind === kind || c.kind === "both");
  }

  function appliesToMonth(t, ym) {
    if (t.recurrence === "monthly") return compareMonth(ym, t.month) >= 0;
    return t.month === ym;
  }

  /**
   * Fluxos do mês com recorrência mensal aplicada (template a partir do mês de referência).
   */
  function flowsForMonth(ym) {
    let incomeR = 0;
    let expenseR = 0;
    let incomeP = 0;
    let expenseP = 0;
    state.transactions.forEach((t) => {
      if (!appliesToMonth(t, ym)) return;
      const amt = t.amount;
      if (t.kind === "income") {
        if (t.status === "realized") incomeR += amt;
        else incomeP += amt;
      } else {
        if (t.status === "realized") expenseR += amt;
        else expenseP += amt;
      }
    });
    return {
      incomeR,
      expenseR,
      incomeP,
      expenseP,
      netTotal: incomeR + incomeP - expenseR - expenseP,
      netRealized: incomeR - expenseR,
      netPlanned: incomeP - expenseP,
    };
  }

  function minAnchorMonth() {
    if (!state.transactions.length) return monthFromDate();
    return state.transactions.reduce((best, t) => (compareMonth(t.month, best) < 0 ? t.month : best), state.transactions[0].month);
  }

  /** Saldo no início do mês `ym` (antes dos lançamentos daquele mês). */
  function balanceBeforeMonth(ym) {
    if (!state.transactions.length) return state.openingBalance;
    const m0 = minAnchorMonth();
    let bal = state.openingBalance;
    let m = m0;
    while (compareMonth(m, ym) < 0) {
      bal += flowsForMonth(m).netTotal;
      m = addMonths(m, 1);
    }
    return bal;
  }

  function sortedUniqueMonthsFromData() {
    return [...new Set(state.transactions.map((t) => t.month))].sort(compareMonth);
  }

  function chartMonthRange(back, ahead) {
    const todayYm = monthFromDate();
    let start = addMonths(todayYm, -back);
    const anchor = state.transactions.length ? minAnchorMonth() : start;
    if (compareMonth(anchor, start) < 0) start = anchor;
    const end = addMonths(todayYm, ahead);
    const list = [];
    let m = start;
    while (compareMonth(m, end) <= 0) {
      list.push(m);
      m = addMonths(m, 1);
    }
    return list;
  }

  function projectionSeries(back = 6, ahead = 14) {
    const months = chartMonthRange(back, ahead);
    const labels = [];
    const balances = [];
    if (!months.length) {
      return { labels, balances };
    }
    let bal = balanceBeforeMonth(months[0]);
    months.forEach((ym) => {
      bal += flowsForMonth(ym).netTotal;
      labels.push(ym);
      balances.push(bal);
    });
    return { labels, balances };
  }

  function categoryExpenseTotals(ymFilter) {
    const totals = {};
    const add = (catId, amt) => {
      const key = categoryLabel(catId);
      totals[key] = (totals[key] || 0) + amt;
    };
    if (ymFilter) {
      state.transactions.forEach((t) => {
        if (t.kind !== "expense") return;
        if (!appliesToMonth(t, ymFilter)) return;
        add(t.categoryId, t.amount);
      });
    } else {
      const todayYm = monthFromDate();
      for (let i = 0; i < 12; i++) {
        const ym = addMonths(todayYm, -i);
        state.transactions.forEach((t) => {
          if (t.kind !== "expense") return;
          if (!appliesToMonth(t, ym)) return;
          add(t.categoryId, t.amount);
        });
      }
    }
    return totals;
  }

  function categoryLabel(id) {
    const c = state.categories.find((x) => x.id === id);
    return c ? c.label : id;
  }

  function slugFromLabel(label) {
    let s = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    return s || "categoria";
  }

  function uniqueCategoryId(label, usedIds) {
    let base = slugFromLabel(label);
    let id = base;
    let n = 0;
    while (usedIds.has(id)) {
      id = base + "_" + ++n;
    }
    return id;
  }

  const el = {
    monthFilter: document.getElementById("monthFilter"),
    kpiIncomeR: document.getElementById("kpiIncomeR"),
    kpiExpenseR: document.getElementById("kpiExpenseR"),
    kpiIncomeP: document.getElementById("kpiIncomeP"),
    kpiExpenseP: document.getElementById("kpiExpenseP"),
    kpiNetMonth: document.getElementById("kpiNetMonth"),
    kpiLiquidity: document.getElementById("kpiLiquidity"),
    form: document.getElementById("formLancamento"),
    desc: document.getElementById("desc"),
    amount: document.getElementById("amount"),
    kind: document.getElementById("kind"),
    category: document.getElementById("category"),
    month: document.getElementById("month"),
    status: document.getElementById("status"),
    recurrence: document.getElementById("recurrence"),
    openingInput: document.getElementById("openingBalance"),
    tbody: document.querySelector("#tableTransactions tbody"),
    btnExport: document.getElementById("btnExport"),
    btnImport: document.getElementById("btnImport"),
    fileImport: document.getElementById("fileImport"),
    modalOpening: document.getElementById("modalOpening"),
    btnSaveOpening: document.getElementById("btnSaveOpening"),
    chartFlow: document.getElementById("chartFlow"),
    chartProjection: document.getElementById("chartProjection"),
    chartCategories: document.getElementById("chartCategories"),
    modalCategories: document.getElementById("modalCategories"),
    modalCategoriesBody: document.getElementById("modalCategoriesBody"),
    modalEditTx: document.getElementById("modalEditTx"),
  };

  let chartFlow;
  let chartProjection;
  let chartCategories;

  function populateMonthSelects() {
    const months = sortedUniqueMonthsFromData();
    const cur = monthFromDate();
    const set = new Set([cur, ...months]);
    const sorted = [...set].sort(compareMonth);
    el.monthFilter.innerHTML =
      `<option value="">Todos os períodos</option>` +
      sorted.map((m) => `<option value="${m}">${formatMonthLabel(m)}</option>`).join("");
    el.month.value = cur;
  }

  function formatMonthLabel(ym) {
    const [, mo] = ym.split("-");
    const names = [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ];
    const y = ym.split("-")[0];
    return `${names[parseInt(mo, 10) - 1]} ${y}`;
  }

  function refreshCategoryOptions() {
    const k = el.kind.value;
    const list = categoriesForKind(k);
    el.category.innerHTML = list.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  }

  function renderKpis() {
    const ym = el.monthFilter.value;
    el.openingInput.value = String(state.openingBalance);

    if (!ym) {
      el.kpiIncomeR.textContent = "—";
      el.kpiExpenseR.textContent = "—";
      el.kpiIncomeP.textContent = "—";
      el.kpiExpenseP.textContent = "—";
      el.kpiNetMonth.textContent = "Selecione um mês";
      el.kpiNetMonth.className = "kpi-value";
      el.kpiLiquidity.textContent = "—";
      el.kpiLiquidity.className = "kpi-value";
      return;
    }

    const f = flowsForMonth(ym);
    el.kpiIncomeR.textContent = formatBRL(f.incomeR);
    el.kpiExpenseR.textContent = formatBRL(f.expenseR);
    el.kpiIncomeP.textContent = formatBRL(f.incomeP);
    el.kpiExpenseP.textContent = formatBRL(f.expenseP);

    el.kpiNetMonth.textContent = formatBRL(f.netTotal);
    el.kpiNetMonth.className = "kpi-value " + (f.netTotal >= 0 ? "income" : "expense");

    const endBal = balanceBeforeMonth(addMonths(ym, 1));
    el.kpiLiquidity.textContent = formatBRL(endBal);
    el.kpiLiquidity.className = "kpi-value " + (endBal >= 0 ? "income" : "expense");
  }

  function renderTable() {
    const ym = el.monthFilter.value;
    let rows = [...state.transactions].sort((a, b) => {
      const mc = compareMonth(a.month, b.month);
      if (mc !== 0) return mc;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    if (ym) rows = rows.filter((t) => t.month === ym);

    if (!rows.length) {
      el.tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Nenhum lançamento neste filtro.</td></tr>`;
      return;
    }

    el.tbody.innerHTML = rows
      .map((t) => {
        const signed = t.kind === "income" ? t.amount : -t.amount;
        const moneyClass = t.kind === "income" ? "money-in" : "money-out";
        const statusBadge =
          t.status === "realized"
            ? '<span class="badge badge-realized">Realizado</span>'
            : '<span class="badge badge-planned">Previsto</span>';
        const rec =
          t.recurrence === "monthly"
            ? '<span class="badge badge-planned" title="Repete a cada mês a partir da referência">Mensal</span>'
            : "—";
        return `<tr data-id="${t.id}">
        <td>${formatMonthLabel(t.month)}</td>
        <td>${escapeHtml(t.description)}</td>
        <td><span class="badge ${t.kind === "income" ? "badge-income" : "badge-expense"}">${t.kind === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${escapeHtml(categoryLabel(t.categoryId))}</td>
        <td class="${moneyClass}">${formatBRL(signed)}</td>
        <td>${statusBadge}</td>
        <td>${rec}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-primary js-edit" title="Alterar lançamento">Editar</button>
          <button type="button" class="btn btn-sm btn-ghost js-realize" title="Marcar como pago/recebido" ${t.status === "realized" ? "disabled" : ""}>Realizar</button>
          <button type="button" class="btn btn-sm btn-danger js-delete">Excluir</button>
        </td>
      </tr>`;
      })
      .join("");

    el.tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.getAttribute("data-id");
      tr.querySelector(".js-edit")?.addEventListener("click", () => openEditTxModal(id));
      tr.querySelector(".js-delete")?.addEventListener("click", () => {
        if (confirm("Excluir este lançamento?")) {
          state.transactions = state.transactions.filter((t) => t.id !== id);
          saveState();
          fullRender();
        }
      });
      tr.querySelector(".js-realize")?.addEventListener("click", () => {
        const t = state.transactions.find((x) => x.id === id);
        if (t) {
          t.status = "realized";
          saveState();
          fullRender();
        }
      });
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function kindSelectHtml(selected) {
    const opts = [
      ["income", "Só receitas"],
      ["expense", "Só despesas"],
      ["both", "Receitas e despesas"],
    ];
    const k = ["income", "expense", "both"].includes(selected) ? selected : "both";
    return opts.map(([v, lab]) => `<option value="${v}"${v === k ? " selected" : ""}>${lab}</option>`).join("");
  }

  function renderCategoriesModalRows() {
    const tbody = el.modalCategoriesBody;
    tbody.innerHTML = state.categories
      .map((c) => {
        const kid = c.kind === "income" || c.kind === "expense" || c.kind === "both" ? c.kind : "both";
        return `<tr data-cat-id="${escapeHtml(c.id)}">
        <td><input type="text" class="cat-label" value="${escapeHtml(c.label)}" /></td>
        <td><select class="cat-kind">${kindSelectHtml(kid)}</select></td>
        <td><button type="button" class="btn btn-sm btn-danger cat-remove">Remover</button></td>
      </tr>`;
      })
      .join("");
    tbody.querySelectorAll(".cat-remove").forEach((btn) => {
      btn.addEventListener("click", () => btn.closest("tr")?.remove());
    });
  }

  function appendEmptyCategoryRow() {
    const tr = document.createElement("tr");
    tr.dataset.catId = "";
    tr.innerHTML = `<td><input type="text" class="cat-label" value="" placeholder="Nome da categoria" /></td>
      <td><select class="cat-kind">${kindSelectHtml("expense")}</select></td>
      <td><button type="button" class="btn btn-sm btn-danger cat-remove">Remover</button></td>`;
    tr.querySelector(".cat-remove").addEventListener("click", () => tr.remove());
    el.modalCategoriesBody.appendChild(tr);
  }

  function openCategoriesModal() {
    renderCategoriesModalRows();
    el.modalCategories.classList.add("open");
  }

  function saveCategoriesFromModal() {
    const rows = [...el.modalCategoriesBody.querySelectorAll("tr")];
    const next = [];
    const usedIds = new Set();

    rows.forEach((tr) => {
      const existingId = (tr.dataset.catId || "").trim();
      const label = tr.querySelector(".cat-label")?.value.trim() || "";
      const kindSel = tr.querySelector(".cat-kind");
      const kind = kindSel && ["income", "expense", "both"].includes(kindSel.value) ? kindSel.value : "both";
      if (!label) return;

      let id = existingId;
      if (!id) {
        id = uniqueCategoryId(label, usedIds);
      }
      usedIds.add(id);
      next.push({ id, label, kind });
    });

    const newIdSet = new Set(next.map((c) => c.id));
    const blocked = [];
    state.categories.forEach((old) => {
      if (!newIdSet.has(old.id)) {
        const inUse = state.transactions.some((t) => t.categoryId === old.id);
        if (inUse) blocked.push(old.label);
      }
    });

    if (blocked.length) {
      alert(
        "Você removeu categorias que ainda têm lançamentos:\n· " +
          blocked.join("\n· ") +
          "\n\nAltere a categoria desses lançamentos (Editar) ou recoloque a linha na tabela antes de salvar."
      );
      return;
    }

    state.categories = next;
    saveState();
    el.modalCategories.classList.remove("open");
    fullRender();
  }

  function refreshEditCategorySelect() {
    const kind = document.getElementById("editKind").value;
    const list = categoriesForKind(kind);
    const sel = document.getElementById("editCategory");
    const t = state.transactions.find((x) => x.id === document.getElementById("editTxId").value);
    const current = t?.categoryId || list[0]?.id;
    sel.innerHTML = list.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join("");
    if (list.some((c) => c.id === current)) sel.value = current;
    else if (list.length) sel.value = list[0].id;
  }

  function openEditTxModal(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    document.getElementById("editTxId").value = t.id;
    document.getElementById("editDesc").value = t.description;
    document.getElementById("editAmount").value = String(t.amount);
    document.getElementById("editKind").value = t.kind;
    document.getElementById("editMonth").value = t.month;
    document.getElementById("editStatus").value = t.status;
    document.getElementById("editRecurrence").value = t.recurrence || "none";
    refreshEditCategorySelect();
    const sel = document.getElementById("editCategory");
    if (state.categories.some((c) => c.id === t.categoryId)) sel.value = t.categoryId;
    el.modalEditTx.classList.add("open");
  }

  function saveEditTx() {
    const id = document.getElementById("editTxId").value;
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;

    const description = document.getElementById("editDesc").value.trim();
    const amount = parseFloat(String(document.getElementById("editAmount").value).replace(",", "."), 10);
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      alert("Preencha descrição e um valor válido.");
      return;
    }

    t.description = description;
    t.amount = amount;
    t.kind = document.getElementById("editKind").value;
    t.categoryId = document.getElementById("editCategory").value;
    t.month = document.getElementById("editMonth").value;
    t.status = document.getElementById("editStatus").value;
    t.recurrence = document.getElementById("editRecurrence").value;

    saveState();
    el.modalEditTx.classList.remove("open");
    fullRender();
  }

  function renderCharts() {
    if (typeof Chart === "undefined") return;
    const ym = el.monthFilter.value;
    const palette = {
      text: "#8b9cb3",
      grid: "rgba(45,58,79,0.45)",
    };

    let flowMonths;
    if (ym) {
      flowMonths = [ym];
    } else {
      flowMonths = chartMonthRange(5, 1);
      if (!flowMonths.length) flowMonths = [monthFromDate()];
    }

    const flowLabels = flowMonths.map(formatMonthLabel);
    const flowRealized = flowMonths.map((m) => flowsForMonth(m).netRealized);
    const flowPlanned = flowMonths.map((m) => flowsForMonth(m).netPlanned);

    const ctxF = el.chartFlow.getContext("2d");
    if (chartFlow) chartFlow.destroy();
    chartFlow = new Chart(ctxF, {
      type: "bar",
      data: {
        labels: flowLabels,
        datasets: [
          {
            label: "Realizado (líquido)",
            data: flowRealized,
            backgroundColor: "rgba(59, 130, 246, 0.7)",
            borderRadius: 6,
          },
          {
            label: "Previsto (líquido)",
            data: flowPlanned,
            backgroundColor: "rgba(167, 139, 250, 0.6)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: palette.text } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: palette.text }, grid: { color: palette.grid } },
          y: {
            ticks: {
              color: palette.text,
              callback(v) {
                return formatBRL(v);
              },
            },
            grid: { color: palette.grid },
          },
        },
      },
    });

    const proj = projectionSeries(6, 14);
    const ctxP = el.chartProjection.getContext("2d");
    if (chartProjection) chartProjection.destroy();
    chartProjection = new Chart(ctxP, {
      type: "line",
      data: {
        labels: proj.labels.map(formatMonthLabel),
        datasets: [
          {
            label: "Saldo acumulado",
            data: proj.balances,
            borderColor: "#34d399",
            backgroundColor: "rgba(52, 211, 153, 0.12)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: palette.text } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return formatBRL(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: palette.text, maxRotation: 45 }, grid: { color: palette.grid } },
          y: {
            ticks: {
              color: palette.text,
              callback(v) {
                return formatBRL(v);
              },
            },
            grid: { color: palette.grid },
          },
        },
      },
    });

    const catMap = categoryExpenseTotals(ym || null);
    const catLabels = Object.keys(catMap);
    const catData = catLabels.map((k) => catMap[k]);

    const ctxC = el.chartCategories.getContext("2d");
    if (chartCategories) chartCategories.destroy();
    chartCategories = new Chart(ctxC, {
      type: "doughnut",
      data: {
        labels: catLabels.length ? catLabels : ["Sem despesas"],
        datasets: [
          {
            data: catData.length ? catData : [1],
            backgroundColor: [
              "#f87171",
              "#fb923c",
              "#fbbf24",
              "#a78bfa",
              "#60a5fa",
              "#34d399",
              "#2dd4bf",
              "#94a3b8",
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { color: palette.text, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (!catData.length) return "";
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${formatBRL(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  function fullRender() {
    const saved = el.monthFilter.value;
    populateMonthSelects();
    if (saved) {
      const opt = [...el.monthFilter.options].find((o) => o.value === saved);
      if (opt) el.monthFilter.value = saved;
    }
    refreshCategoryOptions();
    renderKpis();
    renderTable();
    if (typeof Chart !== "undefined") renderCharts();
  }

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const description = el.desc.value.trim();
    const amount = parseMoneyInput(el.amount);
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      alert("Preencha descrição e um valor válido.");
      return;
    }
    const t = {
      id: uid(),
      description,
      amount,
      kind: el.kind.value,
      categoryId: el.category.value,
      month: el.month.value,
      status: el.status.value,
      recurrence: el.recurrence.value,
      createdAt: new Date().toISOString(),
    };
    state.transactions.push(t);
    el.desc.value = "";
    el.amount.value = "";
    saveState();
    el.monthFilter.value = t.month;
    fullRender();
  });

  el.kind.addEventListener("change", refreshCategoryOptions);

  el.monthFilter.addEventListener("change", () => {
    renderKpis();
    renderTable();
    renderCharts();
  });

  document.getElementById("btnOpening").addEventListener("click", () => {
    el.modalOpening.classList.add("open");
    document.getElementById("openingBalanceModal").value = String(state.openingBalance);
  });

  document.getElementById("btnCancelOpening").addEventListener("click", () => {
    el.modalOpening.classList.remove("open");
  });

  el.btnSaveOpening.addEventListener("click", () => {
    const v = parseFloat(String(document.getElementById("openingBalanceModal").value).replace(",", "."), 10);
    state.openingBalance = Number.isFinite(v) ? v : 0;
    saveState();
    el.modalOpening.classList.remove("open");
    fullRender();
  });

  el.modalOpening.addEventListener("click", (e) => {
    if (e.target === el.modalOpening) el.modalOpening.classList.remove("open");
  });

  document.getElementById("btnCategories").addEventListener("click", () => openCategoriesModal());
  document.getElementById("btnAddCategoryRow").addEventListener("click", () => appendEmptyCategoryRow());
  document.getElementById("btnCancelCategories").addEventListener("click", () => el.modalCategories.classList.remove("open"));
  document.getElementById("btnSaveCategories").addEventListener("click", () => saveCategoriesFromModal());
  el.modalCategories.addEventListener("click", (e) => {
    if (e.target === el.modalCategories) el.modalCategories.classList.remove("open");
  });

  document.getElementById("editKind").addEventListener("change", () => refreshEditCategorySelect());
  document.getElementById("btnCancelEditTx").addEventListener("click", () => el.modalEditTx.classList.remove("open"));
  document.getElementById("btnSaveEditTx").addEventListener("click", () => saveEditTx());
  el.modalEditTx.addEventListener("click", (e) => {
    if (e.target === el.modalEditTx) el.modalEditTx.classList.remove("open");
  });

  el.openingInput.addEventListener("change", () => {
    const v = parseFloat(String(el.openingInput.value).replace(",", "."), 10);
    state.openingBalance = Number.isFinite(v) ? v : 0;
    saveState();
    fullRender();
  });

  el.btnExport.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fluxo-backup-${monthFromDate()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  el.btnImport.addEventListener("click", () => el.fileImport.click());

  el.fileImport.addEventListener("change", () => {
    const file = el.fileImport.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.transactions)) throw new Error("invalid");
        state = {
          openingBalance: typeof parsed.openingBalance === "number" ? parsed.openingBalance : 0,
          categories:
            Array.isArray(parsed.categories) && parsed.categories.length
              ? parsed.categories
              : DEFAULT_CATEGORIES.slice(),
          transactions: parsed.transactions,
        };
        saveState();
        fullRender();
      } catch {
        alert("Arquivo inválido.");
      }
      el.fileImport.value = "";
    };
    reader.readAsText(file);
  });

  populateMonthSelects();
  el.monthFilter.value = monthFromDate();
  refreshCategoryOptions();
  fullRender();
})();
