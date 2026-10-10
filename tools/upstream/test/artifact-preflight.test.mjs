import { describe, expect, it } from "vitest";
import { preflight } from "../artifact-preflight.mjs";

const rev = "b".repeat(40);
const now = new Date("2026-10-13T12:00:00Z");
/** @param {number} status @param {unknown} body */
const answer = (status, body) => async () => ({ status, json: async () => body });

describe("artifact preflight", () => {
  it("yes when Mozilla's release build of the revision is indexed and not expired", async () => {
    const r = await preflight(
      rev,
      answer(200, { taskId: "T", expires: "2027-10-13T00:00:00Z" }),
      now,
    );
    expect(r).toEqual({
      artifacts: "yes",
      note: `Mozilla's linux64 build of ${rev.slice(0, 12)} is indexed until 2027-10-13`,
    });
  });

  it("no on a 404: the suites cannot run on an artifact build, the full build can", async () => {
    const r = await preflight(rev, answer(404, { code: "ResourceNotFound" }), now);
    expect(r.artifacts).toBe("no");
    expect(r.note).toMatch(/not in the Taskcluster index/);
  });

  it("no when the indexed build has expired", async () => {
    const r = await preflight(
      rev,
      answer(200, { taskId: "T", expires: "2026-01-01T00:00:00Z" }),
      now,
    );
    expect(r.artifacts).toBe("no");
    expect(r.note).toMatch(/expired/);
  });

  it("unknown when there is no revision or Taskcluster does not answer", async () => {
    expect((await preflight(null, answer(200, {}), now)).artifacts).toBe("unknown");
    const down = async () => {
      throw new Error("ETIMEDOUT");
    };
    expect(await preflight(rev, down, now)).toEqual({
      artifacts: "unknown",
      note: "Taskcluster index unreachable: ETIMEDOUT",
    });
    expect((await preflight(rev, answer(500, {}), now)).artifacts).toBe("unknown");
  });
});
