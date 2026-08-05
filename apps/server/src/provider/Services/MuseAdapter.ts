/**
 * MuseAdapter — shape type for the Muse Code provider adapter.
 *
 * Muse instances are created by {@link ../Drivers/MuseDriver} and retain
 * their adapter as a captured closure. This module is the public naming
 * anchor for that per-instance shape.
 *
 * @module MuseAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface MuseAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
