import { Schema } from "effect";
import { Snapshot, Correction } from "./domain.ts";
import type { LedgerRow } from "./domain.ts";
import { categories, transactionTypes } from "./taxonomy.ts";

function element(id: string): HTMLElement {
  const value = document.getElementById(id);

  if (!value) throw new Error(`Missing ${id}`);

  return value;
}

function select(id: string): HTMLSelectElement {
  const value = element(id);

  if (!(value instanceof HTMLSelectElement)) throw new Error(`Invalid ${id}`);

  return value;
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

const options = (values: Record<string, string>, selected = "") =>
  Object.entries(values)
    .map(
      ([key, value]) =>
        `<option value="${escape(key)}" ${selected === key ? "selected" : ""}>${escape(value)}</option>`,
    )
    .join("");

let snapshot: Snapshot | undefined;

let visible = 50;

let search = "";

let syncing = false;

let initialized = false;

let lastAutoSyncAttempt = 0;

async function api(path: string, body?: Schema.Json): Promise<Response> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-finance-request": "1",
          },
          body: JSON.stringify(body),
        },
  );

  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Reload to sign in."
        : "Could not complete the request. Try again.",
    );

  return response;
}

function notice(message: string): void {
  element("notice").hidden = !message;
  element("notice").textContent = message;
}

function effective(row: LedgerRow) {
  return row.correction ?? row.classification;
}

function spending(row: LedgerRow): number {
  const movement = effective(row)?.movement;

  return !row.transaction.pending &&
    row.transaction.currency === "USD" &&
    (movement === "expense" || movement === "refund")
    ? -row.transaction.cents
    : 0;
}

function periodRows(): readonly LedgerRow[] {
  return (
    snapshot?.rows.filter(
      (row) =>
        (!select("period").value ||
          row.transaction.date.startsWith(select("period").value)) &&
        (!select("account").value ||
          row.transaction.account === select("account").value),
    ) ?? []
  );
}

function render(): void {
  if (!snapshot) return;
  const rows = periodRows();
  element("spending").textContent = money(
    rows.reduce((sum, row) => sum + spending(row), 0),
  );

  for (const [id, movement] of [
    ["income", "income"],
    ["reimbursements", "reimbursement"],
  ]) {
    if (id)
      element(id).textContent = money(
        rows.reduce(
          (sum, row) =>
            sum +
            (!row.transaction.pending &&
            row.transaction.currency === "USD" &&
            effective(row)?.movement === movement
              ? row.transaction.cents
              : 0),
          0,
        ),
      );
  }

  const totals = new Map<string, number>();

  for (const row of rows) {
    const value = effective(row);

    if (value && spending(row))
      totals.set(
        value.category,
        (totals.get(value.category) ?? 0) + spending(row),
      );
  }

  element("categories").innerHTML =
    [...totals]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([category, cents]) =>
          `<button class="category-card ${select("category").value === category ? "selected" : ""}" data-category="${escape(category)}"><span>${escape(categories[Schema.decodeUnknownSync(Correction.fields.category)(category)])}</span><strong>${money(cents)}</strong></button>`,
      )
      .join("") ||
    '<p class="empty">No classified spending in this period.</p>';
  const pending = rows.filter((r) => r.transaction.pending).length;

  const unknown = rows.filter(
    (r) =>
      !r.transaction.pending &&
      (!effective(r) || effective(r)?.movement === "unknown"),
  ).length;

  element("coverage").textContent =
    `Posted USD transactions only · ${pending} pending · ${unknown} unclassified or unknown movements excluded from totals. Initial history: approximately 90 days.`;

  const filtered = rows.filter((row) => {
    const c = effective(row);

    return (
      (!select("category").value || c?.category === select("category").value) &&
      (!select("movement").value || c?.movement === select("movement").value) &&
      `${row.transaction.description} ${row.transaction.merchant} ${row.correction?.label ?? ""}`
        .toLowerCase()
        .includes(search)
    );
  });

  element("count").textContent = `${filtered.length}`;
  element("transactions").innerHTML =
    filtered
      .slice(0, visible)
      .map((row) => {
        const tx = row.transaction,
          c = effective(row),
          account = snapshot?.accounts.find((a) => a.id === tx.account);

        const category = c
          ? c.movement === "expense" || c.movement === "refund"
            ? categories[c.category]
            : transactionTypes[c.movement]
          : "Classifying…";

        return `<details class="transaction" data-id="${escape(tx.id)}"><summary><span class="tx-date">${escape(tx.date)}</span><span class="tx-name">${escape(row.correction?.label || tx.merchant || tx.description)}<small>${escape(account ? `${account.institution} · ${account.name} ${account.mask}` : "Unknown account")}${tx.pending ? " · Pending" : ""}${row.correction ? " · Edited" : ""}</small></span><span class="tx-category">${escape(category)}</span><span class="tx-amount ${tx.cents > 0 ? "credit" : ""}">${tx.cents > 0 ? "+" : ""}${tx.currency === "USD" ? money(tx.cents) : `${tx.cents / 100} ${escape(tx.currency)}`}</span></summary><div class="editor"><p>${escape(tx.description)}${tx.authorizedDate ? ` · Authorized ${escape(tx.authorizedDate)}` : ""}</p><form><label>Category<select name="category">${options(categories, c?.category ?? "uncategorized")}</select></label><label>Movement<select name="movement">${options(transactionTypes, c?.movement ?? "unknown")}</select></label><label>Display label<input name="label" maxlength="100" value="${escape(row.correction?.label ?? "")}" placeholder="${escape(tx.merchant || tx.description)}" /></label><div class="actions"><button type="submit">Save changes</button>${row.correction ? '<button type="button" class="secondary" data-reset>Use automatic classification</button>' : ""}</div></form><p>${row.classification ? `Jev: ${escape(transactionTypes[row.classification.movement])} · ${escape(categories[row.classification.category])}` : "Automatic classification runs after sync."} · Manual edits are preserved.</p></div></details>`;
      })
      .join("") || '<p class="empty">No transactions match these filters.</p>';
  element("more").hidden = filtered.length <= visible;
  element("sync-status").textContent = snapshot.processing
    ? "Syncing & classifying…"
    : snapshot.unclassified
      ? `${snapshot.unclassified} awaiting classification`
      : "Automatically synced hourly";
  element("connections").innerHTML = snapshot.connections
    .map(
      (c) =>
        `<div class="connection"><strong>${escape(c.name)}</strong><p class="muted">${c.error ? escape(c.error) : c.lastSync ? `Last synced ${escape(new Date(c.lastSync).toLocaleString())}` : "Not synced yet"}</p><ul>${snapshot?.accounts
          .filter((a) => a.item === c.id)
          .map((a) => `<li>${escape(a.name)} · ${escape(a.mask)}</li>`)
          .join("")}</ul></div>`,
    )
    .join("");

  if (snapshot.classificationError) notice(snapshot.classificationError);
}

async function load(): Promise<void> {
  snapshot = Schema.decodeUnknownSync(Snapshot)(
    await (await api("/api/ledger")).json(),
  );

  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const period = initialized ? select("period").value : currentMonth,
    account = select("account").value;

  const months = [
    ...new Set([
      currentMonth,
      ...snapshot.rows.map((r) => r.transaction.date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();

  select("period").innerHTML =
    '<option value="">All available history</option>' +
    options(
      Object.fromEntries(
        months.map((m) => [
          m,
          new Date(`${m}-02`).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
        ]),
      ),
      period,
    );
  select("account").innerHTML =
    '<option value="">All accounts</option>' +
    options(
      Object.fromEntries(
        snapshot.accounts.map((a) => [
          a.id,
          `${a.institution} · ${a.name} ${a.mask}`,
        ]),
      ),
      account,
    );
  render();
  initialized = true;

  const latest = snapshot.connections.flatMap((c) =>
    c.lastSync ? [Date.parse(c.lastSync)] : [],
  );

  element("freshness").textContent =
    syncing || snapshot.processing
      ? "Syncing accounts & organizing transactions…"
      : latest.length
        ? `Updated ${new Date(Math.min(...latest)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · Syncs hourly`
        : "Waiting for first automatic sync";
}

function report(error: Error): void {
  notice(
    error instanceof Error ? error.message : "Something went wrong. Try again.",
  );
}

select("category").innerHTML += options(categories);

select("movement").innerHTML += options(transactionTypes);

for (const id of ["period", "account", "category", "movement"])
  select(id).addEventListener("change", () => {
    visible = 50;
    render();
  });

element("search").addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement) {
    search = event.target.value.toLowerCase();
    visible = 50;
    render();
  }
});

element("categories").addEventListener("click", (event) => {
  if (event.target instanceof Element) {
    const button = event.target.closest<HTMLButtonElement>(
      "button[data-category]",
    );

    if (button) {
      select("category").value = button.dataset.category ?? "";
      visible = 50;
      render();
      element("transactions").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }
});

element("clear").addEventListener("click", () => {
  select("category").value = "";
  select("movement").value = "";
  search = "";
  const input = element("search");

  if (input instanceof HTMLInputElement) input.value = "";
  visible = 50;
  render();
});

element("more").addEventListener("click", () => {
  visible += 50;
  render();
});

element("transactions").addEventListener("submit", (event) => {
  event.preventDefault();

  if (!(event.target instanceof HTMLFormElement)) return;

  const form = event.target,
    id = form.closest<HTMLElement>("[data-id]")?.dataset.id;

  if (!id) return;

  const data = new FormData(form);

  const correction = Schema.decodeUnknownSync(Correction)({
    category: data.get("category"),
    movement: data.get("movement"),
    label: data.get("label"),
  });

  for (const button of form.querySelectorAll("button")) button.disabled = true;
  void api("/api/correct", { id, correction })
    .then(() => load())
    .then(() => notice("Changes saved."))
    .catch((error) => {
      for (const button of form.querySelectorAll("button"))
        button.disabled = false;
      report(error);
    });
});

element("transactions").addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-reset]")) {
    const id = event.target.closest<HTMLElement>("[data-id]")?.dataset.id;

    if (!id) return;

    void api("/api/correct", { id, correction: null })
      .then(() => load())
      .then(() => notice("Automatic classification restored."))
      .catch(report);
  }
});

async function refresh(): Promise<void> {
  // Keep unsaved inline edits and open dropdowns intact during background refresh.
  if (
    syncing ||
    document.hidden ||
    document.querySelector(".transaction[open]") ||
    document.activeElement instanceof HTMLSelectElement
  )
    return;

  await load();

  const stale =
    snapshot?.connections.length === 0 ||
    snapshot?.connections.some(
      (c) => !c.lastSync || Date.now() - Date.parse(c.lastSync) > 3600000,
    );

  if (
    !stale ||
    snapshot?.processing ||
    Date.now() - lastAutoSyncAttempt < 900000
  )
    return;

  syncing = true;
  lastAutoSyncAttempt = Date.now();
  element("freshness").textContent =
    "Syncing accounts & organizing transactions…";

  try {
    await api("/api/sync", {});
  } finally {
    syncing = false;
  }

  if (!document.querySelector(".transaction[open]")) await load();
}

void refresh().catch(report);

setInterval(() => {
  void refresh().catch(report);
}, 60000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh().catch(report);
});
