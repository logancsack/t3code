// Settings → Connections' catalog: what can be connected, as tiles in two
// columns by kind, each with its logo, a line on what agents get from it and
// its Connect. One that connects with a form (a token, an API key) takes the
// whole row while the form is open.

import type { ReactNode } from "react";

import { SettingsGroup } from "../components/settings/SettingsGroup";
import { useSettingsSearchTarget } from "../components/settings/settingsLayout";
import { cn } from "../lib/utils";
import { AldoBrandTile } from "./AldoBrandTile";

export function AldoConnectionTile(props: {
  readonly id?: string;
  /** Its logo's id (AldoBrandTile); an unknown one shows the name's initial. */
  readonly brand: string;
  readonly name: string;
  readonly what: ReactNode;
  readonly status?: ReactNode;
  readonly control: ReactNode;
  /** A form under it, open: the tile takes the whole row. */
  readonly children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(props.id);
  return (
    <div
      {...(props.id ? { id: props.id, tabIndex: -1 } : {})}
      ref={targetRef}
      data-slot="connection-tile"
      className={cn(
        "flex min-w-0 flex-col gap-3 px-3 py-2.5 outline-none sm:px-4",
        props.children ? "col-span-full" : null,
      )}
    >
      <div className="flex items-center gap-3">
        <AldoBrandTile id={props.brand} name={props.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground text-sm">{props.name}</p>
          <p className="line-clamp-2 text-muted-foreground text-xs">{props.what}</p>
          {props.status ? (
            <div className="pt-0.5 text-muted-foreground text-xs">{props.status}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{props.control}</div>
      </div>
      {props.children}
    </div>
  );
}

/**
 * Tiles in two columns where there's room, one on a phone. Every tile draws
 * its right and bottom edge, and the card clips the outer ones; a last tile
 * alone in its row spans it.
 */
export function AldoConnectionGrid(props: { readonly children: ReactNode }) {
  return (
    <SettingsGroup divided={false} className="@container overflow-hidden">
      <div className="-mr-px -mb-px grid grid-flow-row-dense grid-cols-1 @min-[34rem]:grid-cols-2 [&>*]:border-border/50 [&>*]:border-r [&>*]:border-b @min-[34rem]:[&>*:last-child:nth-child(odd)]:col-span-full">
        {props.children}
      </div>
    </SettingsGroup>
  );
}
