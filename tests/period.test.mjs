// Período do dashboard (api/_lib/period.js): fuso de Goiânia, datas inválidas e limite de intervalo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { range } from "../api/_lib/period.js";

test("dates are local midnights in Goiânia (UTC-3), end exclusive", () => {
  const r = range({ de: "2026-10-01", ate: "2026-10-05" });
  assert.equal(r.from.toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-10-06T03:00:00.000Z");
  assert.equal(r.days, 5);
  assert.equal(r.prevFrom.toISOString(), "2026-09-26T03:00:00.000Z");
  assert.equal(r.prevTo.toISOString(), r.from.toISOString());
});

test("impossible or reversed dates fall back to the default 30 days instead of throwing", () => {
  for (const q of [{ de: "2026-13-45", ate: "2026-10-05" }, { de: "2026-02-30", ate: "2026-10-05" }, { de: "2026-10-09", ate: "2026-10-05" }, { de: "x", ate: "y" }]) {
    const r = range(q);
    assert.ok(Number.isFinite(r.from.getTime()), JSON.stringify(q));
    assert.equal(r.days, 30, JSON.stringify(q));
  }
});

test("caps the interval at 400 days", () => {
  assert.equal(range({ de: "2020-01-01", ate: "2026-10-05" }).days, 400);
});
