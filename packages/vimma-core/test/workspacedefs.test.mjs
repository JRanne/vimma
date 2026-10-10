// Spec: docs/specs/m3-workspaces.md (sub-spec 1, m3-workspace-store): the definitions file.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_WORKSPACE_NAME,
  DEFINITIONS_SCHEMA_VERSION,
  DefinitionsError,
  addRuntimeWorkspace,
  canWriteDefinitions,
  closeWorkspaceQuestion,
  emptyDefinitions,
  newWorkspaceLooks,
  planContainers,
  readDefinitions,
  reconcileDefinitions,
  removeWorkspaceDefinition,
  renameWorkspaceDefinition,
  setLastActive,
  withContainer,
} from "../src/workspacedefs.mjs";

const fixture = (/** @type {string} */ name) =>
  readFileSync(new URL(`../../../tests/contract/workspaces/v1/${name}`, import.meta.url), "utf8");

/** A deterministic id minter: ws-1, ws-2, … */
function minter() {
  let n = 0;
  return () => `ws-${++n}`;
}

/** @param {() => unknown} fn */
function defsError(fn) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DefinitionsError);
    return /** @type {DefinitionsError} */ (e);
  }
  throw new Error("expected a DefinitionsError");
}

/**
 * @param {string} name
 * @param {Partial<{ color: string, icon: string, home: string }>} [o]
 */
const cfg = (name, o = {}) => ({ name, color: "gray", icon: "circle", autofill: true, ...o });

describe("contract fixtures, schema v1", () => {
  test("valid.json reads and stays as written", () => {
    const d = readDefinitions(fixture("valid.json"));
    expect(d.workspaces.map((w) => w.name)).toEqual(["work", "shop"]);
    expect(d).toEqual(JSON.parse(fixture("valid.json")));
    expect(DEFINITIONS_SCHEMA_VERSION).toBe(1);
  });

  test("invalid.json fails naming the path", () => {
    const e = defsError(() => readDefinitions(fixture("invalid.json")));
    expect(e.path).toBe("workspaces[1].color");
  });

  test("a newer schema is unsupported, and may not be overwritten", () => {
    const text = fixture("invalid-newer.json");
    expect(defsError(() => readDefinitions(text)).code).toBe("unsupported-schema");
    expect(canWriteDefinitions(text)).toBe(false);
  });
});

describe("readDefinitions", () => {
  test.each([
    [{ schema: 1, lastActive: null }, "workspaces"],
    [{ schema: 1, lastActive: null, workspaces: [{ id: "a b" }] }, "workspaces[0].id"],
    [
      {
        schema: 1,
        lastActive: "x",
        workspaces: [
          {
            id: "x",
            name: "a",
            userContextId: 7,
            color: "gray",
            icon: "circle",
            source: "runtime",
          },
          {
            id: "x",
            name: "b",
            userContextId: 8,
            color: "gray",
            icon: "circle",
            source: "runtime",
          },
        ],
      },
      "workspaces[1].id",
    ],
    [
      {
        schema: 1,
        lastActive: "x",
        workspaces: [
          {
            id: "x",
            name: "a",
            userContextId: 0,
            color: "gray",
            icon: "circle",
            source: "runtime",
          },
        ],
      },
      "workspaces[0].userContextId",
    ],
    [
      {
        schema: 1,
        lastActive: "nope",
        workspaces: [
          {
            id: "x",
            name: "a",
            userContextId: 5,
            color: "gray",
            icon: "circle",
            source: "runtime",
          },
        ],
      },
      "lastActive",
    ],
    [
      {
        schema: 1,
        lastActive: null,
        workspaces: [
          { id: "x", name: "", userContextId: 5, color: "gray", icon: "circle", source: "runtime" },
        ],
      },
      "workspaces[0].name",
    ],
    [
      {
        schema: 1,
        lastActive: null,
        workspaces: [
          { id: "x", name: "a", userContextId: 5, color: "gray", icon: "circle", source: "x" },
        ],
      },
      "workspaces[0].source",
    ],
  ])("rejects %j at %s", (doc, path) => {
    expect(defsError(() => readDefinitions(doc)).path).toBe(path);
  });

  test("text that is not JSON is a syntax error", () => {
    expect(defsError(() => readDefinitions("{")).code).toBe("syntax");
  });
});

describe("canWriteDefinitions", () => {
  test.each([
    [null, true],
    ["not json", true],
    [{ schema: 1 }, true],
    [{ schema: 2 }, false],
    ['{"schema": 9}', false],
  ])("%j → %s", (existing, ok) => {
    expect(canWriteDefinitions(existing)).toBe(ok);
  });
});

describe("reconcileDefinitions", () => {
  test("nothing at all gives one runtime workspace, main (gray circle), active", () => {
    const { definitions, changed } = reconcileDefinitions(emptyDefinitions(), [], minter());
    expect(changed).toBe(true);
    expect(definitions).toEqual({
      schema: 1,
      lastActive: "ws-1",
      workspaces: [
        {
          id: "ws-1",
          name: DEFAULT_WORKSPACE_NAME,
          userContextId: null,
          color: "gray",
          icon: "circle",
          source: "runtime",
        },
      ],
    });
    expect(DEFAULT_WORKSPACE_NAME).toBe("main");
  });

  test("a second run with the same input changes nothing (idempotent)", () => {
    const once = reconcileDefinitions(emptyDefinitions(), [cfg("work")], minter()).definitions;
    const twice = reconcileDefinitions(once, [cfg("work")], minter());
    expect(twice.changed).toBe(false);
    expect(twice.definitions).toBe(once);
  });

  test("config workspaces match by name, keep their id and take colour, icon and home", () => {
    const first = reconcileDefinitions(
      emptyDefinitions(),
      [cfg("work"), cfg("admin")],
      minter(),
    ).definitions;
    const next = withContainer(first, "ws-1", 9);
    const { definitions } = reconcileDefinitions(
      next,
      [cfg("admin", { color: "red" }), cfg("work", { icon: "briefcase", home: "https://a.b/" })],
      minter(),
    );
    expect(definitions.workspaces).toEqual([
      expect.objectContaining({ id: "ws-2", name: "admin", color: "red", source: "config" }),
      expect.objectContaining({
        id: "ws-1",
        name: "work",
        icon: "briefcase",
        home: "https://a.b/",
        userContextId: 9,
      }),
    ]);
  });

  test("config first in file order, then runtime ones; a removed config one becomes runtime", () => {
    let d = reconcileDefinitions(
      emptyDefinitions(),
      [cfg("work"), cfg("admin")],
      minter(),
    ).definitions;
    d = addRuntimeWorkspace(d, { id: "ws-9", name: "shop", color: "pink", icon: "cart" });
    const { definitions, changed } = reconcileDefinitions(d, [cfg("personal")], minter());
    expect(changed).toBe(true);
    expect(definitions.workspaces.map((w) => [w.name, w.source])).toEqual([
      ["personal", "config"],
      ["work", "runtime"],
      ["admin", "runtime"],
      ["shop", "runtime"],
    ]);
  });

  test("a runtime workspace named like a new config entry becomes that config workspace", () => {
    const d = addRuntimeWorkspace(emptyDefinitions(), {
      id: "ws-7",
      name: "work",
      color: "gray",
      icon: "circle",
    });
    const { definitions } = reconcileDefinitions(d, [cfg("work", { color: "blue" })], minter());
    expect(definitions.workspaces).toEqual([
      expect.objectContaining({ id: "ws-7", source: "config", color: "blue" }),
    ]);
  });

  test("a dropped home is removed; lastActive falls back to the first workspace", () => {
    let d = reconcileDefinitions(
      emptyDefinitions(),
      [cfg("a", { home: "about:blank" }), cfg("b")],
      minter(),
    ).definitions;
    d = setLastActive(d, "ws-2");
    expect(d.lastActive).toBe("ws-2");
    const { definitions } = reconcileDefinitions(d, [cfg("a")], minter());
    expect(definitions.workspaces[0]).not.toHaveProperty("home");
    expect(definitions.lastActive).toBe("ws-2");
    const gone = removeWorkspaceDefinition(definitions, "ws-2").definitions;
    expect(gone.lastActive).toBe("ws-1");
  });
});

describe("planContainers", () => {
  const defs = {
    schema: 1,
    lastActive: "a",
    workspaces: [
      { id: "a", name: "a", userContextId: 6, color: "gray", icon: "circle", source: "runtime" },
      { id: "b", name: "b", userContextId: 7, color: "red", icon: "circle", source: "runtime" },
      { id: "c", name: "c", userContextId: 8, color: "gray", icon: "circle", source: "runtime" },
      { id: "d", name: "d", userContextId: null, color: "gray", icon: "circle", source: "runtime" },
    ],
  };
  const identities = [
    { userContextId: 1, l10nId: "user-context-personal", color: "blue", icon: "fingerprint" },
    { userContextId: 6, name: "a", color: "gray", icon: "circle" },
    { userContextId: 7, name: "b", color: "gray", icon: "circle" },
    { userContextId: 8, name: "someone else's", color: "gray", icon: "circle" },
  ];

  test("adopts by stored id and name, updates drifted looks, creates for missing or reused", () => {
    expect(planContainers(/** @type {any} */ (defs), identities)).toEqual({
      adopt: ["a", "b"],
      update: ["b"],
      create: ["c", "d"],
    });
  });

  test("never matches Firefox's default containers by name", () => {
    const d = {
      schema: 1,
      lastActive: "p",
      workspaces: [
        {
          id: "p",
          name: "personal",
          userContextId: null,
          color: "blue",
          icon: "fingerprint",
          source: "config",
        },
      ],
    };
    expect(planContainers(/** @type {any} */ (d), identities).create).toEqual(["p"]);
  });
});

describe("runtime workspaces", () => {
  test("names are unique and valid", () => {
    const d = addRuntimeWorkspace(emptyDefinitions(), {
      id: "x",
      name: "a",
      color: "gray",
      icon: "circle",
    });
    expect(
      defsError(() => addRuntimeWorkspace(d, { id: "y", name: "a", color: "gray", icon: "circle" }))
        .code,
    ).toBe("duplicate-name");
    expect(
      defsError(() => addRuntimeWorkspace(d, { id: "x", name: "b", color: "gray", icon: "circle" }))
        .code,
    ).toBe("duplicate-id");
    expect(
      defsError(() => addRuntimeWorkspace(d, { id: "y", name: "b", color: "blu", icon: "circle" }))
        .code,
    ).toBe("bad-color");
  });

  test("removal: only runtime ones, never the last; returns the removed definition", () => {
    const main = reconcileDefinitions(emptyDefinitions(), [], minter()).definitions;
    expect(defsError(() => removeWorkspaceDefinition(main, "ws-1")).code).toBe("last-workspace");
    let d = reconcileDefinitions(emptyDefinitions(), [cfg("work")], minter()).definitions;
    d = withContainer(
      addRuntimeWorkspace(d, { id: "r", name: "r", color: "gray", icon: "circle" }),
      "r",
      12,
    );
    expect(defsError(() => removeWorkspaceDefinition(d, "ws-1")).code).toBe("config-workspace");
    expect(defsError(() => removeWorkspaceDefinition(d, "zz")).code).toBe("unknown-workspace");
    const { definitions, removed } = removeWorkspaceDefinition(d, "r");
    expect(removed.userContextId).toBe(12);
    expect(definitions.workspaces.map((w) => w.id)).toEqual(["ws-1"]);
  });
});

// Sub-spec 4a (m3-workspace-lifecycle): rename, the close question, a new workspace's looks.
describe("workspace lifecycle", () => {
  const twoKinds = () => {
    const d = reconcileDefinitions(emptyDefinitions(), [cfg("work")], minter()).definitions;
    return withContainer(
      addRuntimeWorkspace(d, { id: "r", name: "shop", color: "gray", icon: "circle" }),
      "r",
      12,
    );
  };

  test("rename: a runtime workspace takes a valid, unused name", () => {
    const d = twoKinds();
    const renamed = renameWorkspaceDefinition(d, "r", "market");
    expect(renamed.workspaces.map((w) => w.name)).toEqual(["work", "market"]);
    expect(renamed.workspaces[1]?.userContextId).toBe(12);
    expect(renameWorkspaceDefinition(d, "r", "shop")).toBe(d);
    expect(defsError(() => renameWorkspaceDefinition(d, "r", "work")).code).toBe("duplicate-name");
    expect(defsError(() => renameWorkspaceDefinition(d, "r", "")).code).toBe("bad-name");
    expect(defsError(() => renameWorkspaceDefinition(d, "r", "x".repeat(33))).code).toBe(
      "bad-name",
    );
    expect(defsError(() => renameWorkspaceDefinition(d, "zz", "a")).code).toBe("unknown-workspace");
  });

  test("rename: a config workspace is renamed in config.toml, not here", () => {
    const e = defsError(() => renameWorkspaceDefinition(twoKinds(), "ws-1", "job"));
    expect(e.code).toBe("config-workspace");
    expect(e.message).toContain("config.toml");
  });

  test("the close question says what goes: data for runtime ones, tabs only for config", () => {
    const [work, shop] = twoKinds().workspaces;
    expect(closeWorkspaceQuestion(/** @type {any} */ (shop), 4)).toBe(
      'Close "shop" (4 tabs) and delete its cookies and site data? y/N',
    );
    expect(closeWorkspaceQuestion(/** @type {any} */ (shop), 1)).toBe(
      'Close "shop" (1 tab) and delete its cookies and site data? y/N',
    );
    expect(closeWorkspaceQuestion(/** @type {any} */ (work), 2)).toBe(
      'Close the 2 tabs of "work"? It stays, as it is in config.toml. y/N',
    );
  });

  test("a new workspace takes the first colour no workspace uses, and a circle", () => {
    const d = twoKinds(); // both gray
    expect(newWorkspaceLooks(d)).toEqual({ color: "blue", icon: "circle" });
    const blue = addRuntimeWorkspace(d, { id: "b", name: "b", color: "blue", icon: "circle" });
    expect(newWorkspaceLooks(blue).color).toBe("green");
    expect(newWorkspaceLooks(emptyDefinitions()).color).toBe("blue");
  });
});
