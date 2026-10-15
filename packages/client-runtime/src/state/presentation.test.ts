import type { ServerConfig } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { createEnvironmentPresentationAtoms } from "./presentation.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-2");

function environmentEntry(environmentId: EnvironmentId) {
  return {
    target: new PrimaryConnectionTarget({
      environmentId,
      label: environmentId,
      httpBaseUrl: `https://${environmentId}.example.test`,
      wsBaseUrl: `wss://${environmentId}.example.test`,
    }),
    profile: Option.none(),
    enabled: true,
  };
}

const DORMANT_STATE: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  phase: "blocked",
  attempt: 1,
  lastFailure: new ConnectionBlockedError({ reason: "dormant", detail: "Asleep." }),
};

function makeHarness() {
  const entry = environmentEntry(ENVIRONMENT_ID);
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([[ENVIRONMENT_ID, entry]]),
  });
  const stateAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(AsyncResult.success<SupervisorConnectionState, never>(AVAILABLE_CONNECTION_STATE)),
  );
  const serverConfigAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ServerConfig | null>(null),
  );
  const atoms = createEnvironmentPresentationAtoms({
    catalogValueAtom,
    stateAtom,
    serverConfigValueAtom: serverConfigAtom,
  });
  const registry = AtomRegistry.make();
  registry.mount(atoms.presentationsAtom);
  return { registry, entry, catalogValueAtom, stateAtom, serverConfigAtom, ...atoms };
}

describe("environment presentations", () => {
  it("keeps a presentation while what it presents is unchanged", () => {
    const harness = makeHarness();
    const presentations = harness.registry.get(harness.presentationsAtom);
    const presentation = harness.registry.get(harness.presentationAtom(ENVIRONMENT_ID));

    // An asleep environment presents as available, as it did before it tried.
    harness.registry.set(harness.stateAtom(ENVIRONMENT_ID), AsyncResult.success(DORMANT_STATE));
    expect(harness.registry.get(harness.presentationAtom(ENVIRONMENT_ID))).toBe(presentation);
    expect(harness.registry.get(harness.presentationsAtom)).toBe(presentations);

    // Another environment joining the catalog leaves this one's presentation as it was.
    harness.registry.set(harness.catalogValueAtom, {
      isReady: true,
      entries: new Map([
        [ENVIRONMENT_ID, harness.entry],
        [OTHER_ENVIRONMENT_ID, environmentEntry(OTHER_ENVIRONMENT_ID)],
      ]),
    });
    expect(harness.registry.get(harness.presentationsAtom).get(ENVIRONMENT_ID)).toBe(presentation);
  });

  it("presents a connection that changes", () => {
    const harness = makeHarness();
    const presentation = harness.registry.get(harness.presentationAtom(ENVIRONMENT_ID));

    harness.registry.set(
      harness.stateAtom(ENVIRONMENT_ID),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, desired: true, phase: "connecting" }),
    );

    const next = harness.registry.get(harness.presentationAtom(ENVIRONMENT_ID));
    expect(next).not.toBe(presentation);
    expect(next?.connection.phase).toBe("connecting");
  });
});
