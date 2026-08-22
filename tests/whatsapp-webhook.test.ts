import { describe, expect, it } from "vitest";
import { extractStatuses } from "../src/lib/whatsapp/webhook";
describe("WhatsApp webhook", () => {
  it("extrai status", () => {
    const payload = { entry:[{changes:[{value:{statuses:[{id:"wamid.1",status:"delivered",timestamp:"1787000000"}]}}]}] };
    const out = extractStatuses(payload);
    expect(out[0].id).toBe("wamid.1");
    expect(out[0].status).toBe("delivered");
  });
});
