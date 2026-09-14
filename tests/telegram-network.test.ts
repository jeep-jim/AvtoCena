import test from "node:test";
import assert from "node:assert/strict";
import { telegramNetworkError } from "../apps/web/lib/telegram-network";

test("network diagnostics retain nested cause codes without credentials or arbitrary messages", () => {
  const error = {message: "https://api.telegram.org/botSECRET/getMe", cause: {errors: [{code: "ENETUNREACH"}, {code: "ETIMEDOUT", message: "SECRET"}, {code: "SECRET"}]}};
  assert.equal(telegramNetworkError(error), "ENETUNREACH, ETIMEDOUT");
  assert.equal(telegramNetworkError({message: "SECRET", code: "SECRET"}), "NETWORK_ERROR");
  assert.equal(telegramNetworkError(new DOMException("SECRET", "TimeoutError")), "TimeoutError");
  const cyclic: {cause?: unknown} = {};
  cyclic.cause = cyclic;
  assert.equal(telegramNetworkError(cyclic), "NETWORK_ERROR");
});
