// Model names from what the user's machines reported (modelNames.logic.ts).

import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { type ModelEsque } from "../components/chat/providerIconUtils";
import { environmentServerConfigsAtom } from "../state/server";
import { isAldoCloud } from "./api";
import {
  listedModelName,
  modelNameFromId,
  modelNameIndex,
  type ModelNameIndex,
} from "./modelNames.logic";

/**
 * What T3 shows for a model its provider doesn't list (yet): in Aldo, a name
 * read from the id, or the provider's default for a planned thread's
 * "default"; elsewhere the id, as upstream does.
 */
export function unlistedModelLabel(model: string, models: ReadonlyArray<ModelEsque> = []): string {
  if (!isAldoCloud || !model) return model;
  return listedModelName(models, model) ?? modelNameFromId(model);
}

// One index per version of the machines' configs, shared by every row of Home.
const indexes = new WeakMap<object, ModelNameIndex>();

/**
 * The name of the model a conversation runs on ("<instance>/<model>", as
 * Home lists it): as its own machine reported it, else as another of the
 * user's machines did, else read from the id. Null without a model.
 */
export function useAldoModelName(
  environmentId: string | null,
  model: string | null | undefined,
): string | null {
  const configs = useAtomValue(environmentServerConfigsAtom);
  return useMemo(() => {
    if (!model) return null;
    let index = indexes.get(configs);
    if (!index) indexes.set(configs, (index = modelNameIndex(configs)));
    return index.name(environmentId, model);
  }, [configs, environmentId, model]);
}
