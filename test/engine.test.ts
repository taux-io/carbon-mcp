import Big from "big.js";
import { describe, expect, it } from "vitest";

import { FACTORS } from "../src/data/reviewed";
import { calculate, compare, significantFigures, totalOf, type CalcError, type CalcResult } from "../src/engine";
import type { StoredFactor } from "../src/types";

const NOW = new Date("2026-11-13T00:00:00Z");

function stored(id: string): StoredFactor {
  const f = FACTORS.find((x) => x.id === id);
  if (!f) throw new Error(`no factor ${id}`);
  return { ...f, version: 1, status: "current", retrieved_at: NOW.toISOString(), content_hash: "test" };
}

const ok = (r: CalcResult | CalcError): CalcResult => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r;
};
const err = (r: CalcResult | CalcError): CalcError["error"] => {
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("direct calculation", () => {
  it("12,000 kWh of 2025 industry electricity is exactly 5,592 kgCO2e", () => {
    const r = ok(calculate(stored("tw-electricity-2025-industry-inventory"), { quantity: 12000, quantity_unit: "kWh", year: 2025 }, NOW));
    expect(r.emissions_kg).toBe("5592");
    expect(r.emissions_t).toBe("5.592");
    expect(r.factor.value).toBe("0.466");
    expect(r.factor.version).toBe(1);
    expect(r.factor.source_url).toContain("moeaea.gov.tw");
    expect(r.emissions_gas_basis).toBe("CO2e");
  });

  it("keeps decimal products exact where floating point would not", () => {
    const r = ok(calculate(stored("tw-electricity-2024"), { quantity: 7, quantity_unit: "kWh" }, NOW));
    expect(r.emissions_kg).toBe("3.318");
    expect(7 * 0.474).not.toBe(3.318);
  });

  it("reads 度 as kWh for electricity and as m³ for water", () => {
    const e = ok(calculate(stored("tw-electricity-2024"), { quantity: 100, quantity_unit: "度" }, NOW));
    expect(e.activity.unit).toBe("kWh");
    const w = ok(calculate(stored("twc-water-2025"), { quantity: 200, quantity_unit: "度" }, NOW));
    expect(w.activity.unit).toBe("m3");
    expect(w.emissions_kg).toBe("30.2");
    expect(w.emissions_gas_basis).toBe("CO2");
  });

  it("converts within a dimension and refuses across dimensions", () => {
    const r = ok(calculate(stored("tw-electricity-2024"), { quantity: 2, quantity_unit: "MWh" }, NOW));
    expect(r.emissions_kg).toBe("948");
    expect(err(calculate(stored("tw-electricity-2024"), { quantity: 2, quantity_unit: "公升" }, NOW)).code).toBe("incompatible_unit");
    expect(err(calculate(stored("tw-electricity-2024"), { quantity: 2, quantity_unit: "桶" }, NOW)).code).toBe("unknown_unit");
  });

  it("rejects a year the factor does not apply to and lists the alternatives", () => {
    const e = err(calculate(stored("tw-electricity-2024"), { quantity: 1, quantity_unit: "kWh", year: 2025 }, NOW, [2024, 2025]));
    expect(e.code).toBe("year_mismatch");
    expect(e.details?.available_years).toEqual([2024, 2025]);
  });

  it("rejects negative, non-numeric and non-finite quantities", () => {
    for (const quantity of ["-1", "abc", "1e3", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(err(calculate(stored("tw-electricity-2024"), { quantity, quantity_unit: "kWh" }, NOW)).code).toBe("invalid_quantity");
    }
  });

  it("refuses lookup-only and pending factors", () => {
    const f = { ...stored("tw-electricity-2024"), calculability: "lookup_only" as const };
    expect(err(calculate(f, { quantity: 1, quantity_unit: "kWh" }, NOW)).code).toBe("not_calculable");
  });
});

describe("fuel combustion", () => {
  const diesel = stored("moenv-ghg-2024-stationary-diesel");

  it("requires a user-supplied heating value and never assumes one", () => {
    const e = err(calculate(diesel, { quantity: 500, quantity_unit: "L" }, NOW));
    expect(e.code).toBe("missing_heating_value");
  });

  // 環境部《溫室氣體排放量盤查作業指引 113 年版》第 2-9 頁的算例：
  // 柴油 17.495 公秉、低位熱值 8,500 kcal/L → 46.1353 + 0.0523 + 0.0990 公噸 CO2e。
  it("reproduces the worked diesel example in the MOENV inventory guide", () => {
    const r = ok(
      calculate(diesel, { quantity: "17.495", quantity_unit: "公秉", context: { lower_heating_value: { value: 8500, unit: "kcal/L" } } }, NOW),
    );
    const tonnes = Object.fromEntries(r.breakdown!.map((b) => [b.gas, new Big(b.emissions_kg_co2e).div(1000).toFixed(4)]));
    expect(tonnes).toEqual({ CO2: "46.1353", CH4: "0.0523", N2O: "0.0990" });
    expect(r.user_supplied?.lower_heating_value?.value).toBe("8500");
  });

  // 同一頁的天然氣算例：94.6467 千立方公尺、8,845 kcal/m³ → 196.6294 + 0.0981 + 0.0929。
  it("reproduces the worked natural gas example", () => {
    const r = ok(
      calculate(stored("moenv-ghg-2024-stationary-natural-gas"), { quantity: "94.6467", quantity_unit: "千立方公尺", context: { lower_heating_value: { value: "8845", unit: "kcal/m3" } } }, NOW),
    );
    const tonnes = r.breakdown!.map((b) => new Big(b.emissions_kg_co2e).div(1000).toFixed(4));
    expect(tonnes).toEqual(["196.6294", "0.0981", "0.0929"]);
  });

  it("refuses litres against a per-kilogram heating value", () => {
    const e = err(calculate(diesel, { quantity: 500, quantity_unit: "L", context: { lower_heating_value: { value: 10000, unit: "kcal/kg" } } }, NOW));
    expect(e.code).toBe("incompatible_unit");
  });

  it("does not apply the 2024 announcement to earlier years", () => {
    const e = err(calculate(diesel, { quantity: 1, quantity_unit: "L", year: 2020, context: { lower_heating_value: { value: 8500, unit: "kcal/L" } } }, NOW));
    expect(e.code).toBe("factor_not_effective");
  });
});

describe("refrigerant leakage", () => {
  const r134a = stored("moenv-gwp-2024-hfc-134a");
  const calc = (quantity: number | string, refrigerant?: object, unit = "kg") =>
    calculate(r134a, { quantity, quantity_unit: unit, context: refrigerant ? { refrigerant: refrigerant as never } : undefined }, NOW);

  it("refuses to guess whether the quantity is the charge or the amount leaked", () => {
    const e = err(calc(10));
    expect(e.code).toBe("missing_refrigerant_basis");
    expect(JSON.stringify(e.details)).toContain("residential_commercial_ac");
  });

  it("multiplies a leaked amount by the GWP", () => {
    const r = ok(calc(2, { basis: "leaked_amount" }));
    expect(r.emissions_kg).toBe("2600");
    expect(r.formula).toContain("GWP 1300");
  });

  it("applies the user's leak rate to a charge and never a default", () => {
    const r = ok(calc(40, { basis: "charge", leak_rate_percent: 5, equipment_type: "residential_commercial_ac" }));
    expect(r.emissions_kg).toBe("2600");
    expect(r.activity.converted_quantity).toBe("2");
    expect(r.user_supplied?.refrigerant_leak).toMatchObject({ basis: "charge", leak_rate_percent: "5" });
    expect(r.limitations[0]).toContain("1% 至 10%");
    expect(r.limitations[0]).toContain("在範圍內");
    expect(err(calc(40, { basis: "charge" })).code).toBe("invalid_leak_rate");
  });

  it("flags a leak rate outside the official range for that equipment without rejecting it", () => {
    const r = ok(calc(40, { basis: "charge", leak_rate_percent: 30, equipment_type: "residential_commercial_ac" }));
    expect(r.emissions_kg).toBe("15600");
    expect(r.limitations[0]).toContain("不在這個範圍內");
  });

  it.each([0, 101, "abc", -5])("rejects a leak rate of %s", (rate) => {
    expect(err(calc(40, { basis: "charge", leak_rate_percent: rate })).code).toBe("invalid_leak_rate");
  });

  it("converts grams and refuses litres", () => {
    expect(ok(calc(500, { basis: "leaked_amount" }, "g")).emissions_kg).toBe("650");
    expect(err(calc(1, { basis: "leaked_amount" }, "L")).code).toBe("incompatible_unit");
  });
});

describe("biomass fuels", () => {
  it("reports biogenic CO2 separately and leaves it out of the total", () => {
    const r = ok(
      calculate(stored("moenv-ghg-2024-stationary-biodiesels"), { quantity: 1000, quantity_unit: "L", context: { lower_heating_value: { value: 8000, unit: "kcal/L" } } }, NOW),
    );
    const co2 = r.breakdown!.find((b) => b.gas === "CO2")!;
    expect(co2.excluded_from_total).toBe(true);
    expect(r.biogenic_co2_kg).toBe(co2.emissions_kg);
    const counted = r.breakdown!.filter((b) => b.gas !== "CO2").reduce((sum, b) => sum.plus(b.emissions_kg_co2e), new Big(0));
    expect(r.emissions_kg).toBe(counted.toFixed());
    expect(new Big(r.emissions_kg).lt(co2.emissions_kg)).toBe(true);
  });

  it("still counts fossil CO2 in the total", () => {
    const r = ok(calculate(stored("moenv-ghg-2024-stationary-diesel"), { quantity: 1000, quantity_unit: "L", context: { lower_heating_value: { value: 8500, unit: "kcal/L" } } }, NOW));
    expect(r.biogenic_co2_kg).toBeUndefined();
    expect(r.breakdown!.every((b) => !b.excluded_from_total)).toBe(true);
  });
});

describe("batch totals", () => {
  const elec = () => calculate(stored("tw-electricity-2025-industry-inventory"), { quantity: 12000, quantity_unit: "度" }, NOW);
  const water = (id: string) => calculate(stored(id), { quantity: 200, quantity_unit: "度" }, NOW);

  it("totals items that share a gas basis", () => {
    const t = totalOf([elec(), water("tpe-water-2025")]);
    expect(t.available).toBe(true);
    expect(t.emissions_kg).toBe("5602.04");
  });

  it("withholds the total when CO2 and CO2e are mixed", () => {
    const t = totalOf([elec(), water("twc-water-2025")]);
    expect(t.available).toBe(false);
    expect(t.emissions_kg).toBeUndefined();
  });

  it("withholds the total when any item failed", () => {
    const t = totalOf([elec(), calculate(stored("moenv-ghg-2024-stationary-diesel"), { quantity: 500, quantity_unit: "L" }, NOW)]);
    expect(t.available).toBe(false);
  });

  it("warns when one factor is used twice", () => {
    expect(totalOf([elec(), elec()]).warnings.length).toBeGreaterThan(0);
  });
});

describe("comparison", () => {
  const calc = (id: string, quantity: number) => ok(calculate(stored(id), { quantity, quantity_unit: "kWh" }, NOW));

  it("splits a difference into activity and factor effects that sum to it", () => {
    const c = compare(calc("tw-electricity-2023", 10000), calc("tw-electricity-2024", 9000));
    expect(c.method_changed).toBe(false);
    expect(c.difference_kg).toBe("-674");
    expect(c.decomposition).toMatchObject({ activity_effect_kg: "-494", factor_effect_kg: "-180" });
  });

  it("flags years whose official calculation method differs", () => {
    const c = compare(calc("tw-electricity-2021", 10000), calc("tw-electricity-2022", 10000));
    expect(c.method_changed).toBe(true);
    expect(c.decomposition).toBeNull();
    expect(c.interpretation).toContain("不能直接解讀為實際的減碳成效");
  });

  it("flags the 2025 split as a method change and gives no decomposition", () => {
    const c = compare(calc("tw-electricity-2024", 10000), calc("tw-electricity-2025-industry-inventory", 10000));
    expect(c.method_changed).toBe(true);
    expect(c.decomposition).toBeNull();
  });
});

describe("significant figures", () => {
  it("counts what the source wrote", () => {
    expect(significantFigures("0.530")).toBe(3);
    expect(significantFigures("0.17")).toBe(2);
    expect(significantFigures("0.0665")).toBe(3);
    expect(significantFigures("74100")).toBeNull();
  });
});
