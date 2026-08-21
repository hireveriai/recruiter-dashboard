import assert from "node:assert/strict";
import test from "node:test";
import { formatMinorAmount, resolveCurrencyFromCountry } from "../lib/pricing/currency.ts";

test("checkout formatting matches the pricing page", () => {
  assert.equal(formatMinorAmount(1499900, "INR"), "₹14,999");
  assert.equal(formatMinorAmount(119900, "USD"), "$1,199");
  assert.equal(formatMinorAmount(15900, "GBP"), "£159");
  assert.equal(formatMinorAmount(109900, "EUR"), "€1,099");
});

test("fractional tax amounts keep their decimals", () => {
  assert.equal(formatMinorAmount(269982, "INR"), "₹2,699.82");
});

test("non-INR never uses Indian lakh grouping", () => {
  assert.equal(formatMinorAmount(12999900, "USD"), "$129,999");
  assert.equal(formatMinorAmount(12999900, "GBP"), "£129,999");
});

test("an unknown currency falls back rather than throwing", () => {
  assert.ok(formatMinorAmount(10000, "JPY").length > 0);
  assert.ok(formatMinorAmount(10000, "").length > 0);
});

test("country mapping matches the landing app", () => {
  assert.equal(resolveCurrencyFromCountry("GB"), "GBP");
  assert.equal(resolveCurrencyFromCountry("DE"), "EUR");
  assert.equal(resolveCurrencyFromCountry("CH"), "USD");
  assert.equal(resolveCurrencyFromCountry("IN"), "INR");
});
