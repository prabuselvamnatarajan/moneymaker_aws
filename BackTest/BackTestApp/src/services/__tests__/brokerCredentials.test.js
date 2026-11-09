import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isDummyCredential,
  validateUpstoxCredentials,
} from "../broker.js";

describe("Broker Credentials Validation & Integrity", () => {
  describe("isDummyCredential", () => {
    it("returns true for dummy placeholders", () => {
      assert.equal(isDummyCredential("dummy_client_id_admin"), true);
      assert.equal(isDummyCredential("dummy_client_secret_admin"), true);
      assert.equal(isDummyCredential("dummy_client_id_standard"), true);
      assert.equal(isDummyCredential("dummy"), true);
      assert.equal(isDummyCredential("DUMMY_SECRET"), true);
      assert.equal(isDummyCredential(""), false); // empty string is missing, not explicitly dummy
      assert.equal(isDummyCredential(null), false);
    });

    it("returns false for legitimate credentials", () => {
      assert.equal(isDummyCredential("50b489f2-22c5-4824-9da5-9b815aab9667"), false);
      assert.equal(isDummyCredential("d51apkeb3c"), false);
      assert.equal(isDummyCredential("custom-upstox-api-key"), false);
    });
  });

  describe("validateUpstoxCredentials", () => {
    it("accepts valid non-dummy Upstox credentials", () => {
      assert.doesNotThrow(() => {
        validateUpstoxCredentials({
          client_id: "50b489f2-22c5-4824-9da5-9b815aab9667",
          client_secret: "d51apkeb3c",
          redirect_uri: "http://localhost/logedin",
        });
      });
    });

    it("rejects dummy client_id with explicit error message", () => {
      assert.throws(
        () => {
          validateUpstoxCredentials({
            client_id: "dummy_client_id_admin",
            client_secret: "valid-secret-12345",
            redirect_uri: "http://localhost/logedin",
          });
        },
        /Upstox credential "client_id" contains an invalid dummy placeholder\./
      );
    });

    it("rejects dummy client_secret with explicit error message", () => {
      assert.throws(
        () => {
          validateUpstoxCredentials({
            client_id: "valid-client-id-12345",
            client_secret: "dummy_client_secret_admin",
            redirect_uri: "http://localhost/logedin",
          });
        },
        /Upstox credential "client_secret" contains an invalid dummy placeholder\./
      );
    });

    it("rejects missing required fields", () => {
      assert.throws(
        () => {
          validateUpstoxCredentials({
            client_id: "valid-client-id",
            redirect_uri: "http://localhost/logedin",
          });
        },
        /Upstox credential "client_secret" is required\./
      );
    });

    it("allows omitting client_secret when allowPartialSecret is true", () => {
      assert.doesNotThrow(() => {
        validateUpstoxCredentials(
          {
            client_id: "valid-client-id",
            redirect_uri: "http://localhost/logedin",
          },
          { allowPartialSecret: true }
        );
      });
    });

    it("still rejects dummy client_secret even when allowPartialSecret is true", () => {
      assert.throws(
        () => {
          validateUpstoxCredentials(
            {
              client_id: "valid-client-id",
              client_secret: "dummy_client_secret_admin",
              redirect_uri: "http://localhost/logedin",
            },
            { allowPartialSecret: true }
          );
        },
        /Upstox credential "client_secret" contains an invalid dummy placeholder\./
      );
    });
  });
});
