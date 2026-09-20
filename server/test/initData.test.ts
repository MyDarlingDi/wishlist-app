import { describe, expect, it } from "vitest";
import { InitDataError, validateInitData } from "../src/auth/initData.js";
import { BOT_TOKEN, buildInitData } from "./helpers.js";

const user = { id: 42, first_name: "Аня", username: "anya" };

describe("validateInitData", () => {
  it("accepts correctly signed data and returns the user", () => {
    const r = validateInitData(buildInitData(user, { extra: { start_param: "wishlist_7" } }), BOT_TOKEN, { maxAgeSec: 3600 });
    expect(r.user).toMatchObject(user);
    expect(r.startParam).toBe("wishlist_7");
  });

  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof InitDataError) return e.reason;
      throw e;
    }
    return "accepted";
  };

  it("rejects data signed with another bot token", () => {
    expect(reason(() => validateInitData(buildInitData(user, { token: "999:other-token-abcdefghijklmnop" }), BOT_TOKEN))).toBe("bad_hash");
  });

  it("rejects any tampered field (user id swap)", () => {
    const p = new URLSearchParams(buildInitData(user));
    p.set("user", JSON.stringify({ ...user, id: 1 }));
    expect(reason(() => validateInitData(p.toString(), BOT_TOKEN))).toBe("bad_hash");
  });

  it("rejects a missing hash, empty input and non-hex hash", () => {
    const p = new URLSearchParams(buildInitData(user));
    p.delete("hash");
    expect(reason(() => validateInitData(p.toString(), BOT_TOKEN))).toBe("no_hash");
    expect(reason(() => validateInitData("", BOT_TOKEN))).toBe("missing");
    p.set("hash", "zzzz");
    expect(reason(() => validateInitData(p.toString(), BOT_TOKEN))).toBe("bad_hash");
  });

  it("rejects expired data but only when a max age is given", () => {
    const old = buildInitData(user, { authDate: Math.floor(Date.now() / 1000) - 7200 });
    expect(reason(() => validateInitData(old, BOT_TOKEN, { maxAgeSec: 3600 }))).toBe("expired");
    expect(reason(() => validateInitData(old, BOT_TOKEN))).toBe("accepted");
  });
});
