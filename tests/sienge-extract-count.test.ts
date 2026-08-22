import { describe, expect, it } from "vitest";
import { extractCount } from "../src/lib/sienge/client";

describe("extractCount (defensivo, sem assumir schema do Sienge)", () => {
  it("array direto usa o length", () => expect(extractCount([1, 2, 3])).toBe(3));
  it("resultSetMetadata.count tem prioridade", () => expect(extractCount({ resultSetMetadata: { count: 42 }, results: [{}] })).toBe(42));
  it("results[] usa o length", () => expect(extractCount({ results: [{}, {}] })).toBe(2));
  it("data[] usa o length", () => expect(extractCount({ data: [{}] })).toBe(1));
  it("formato desconhecido retorna null", () => expect(extractCount({ foo: "bar" })).toBeNull());
});
