import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance Prime Agent adapter contract. */
export interface PrimeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
