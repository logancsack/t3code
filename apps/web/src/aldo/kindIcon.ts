// Each kind of thing an agent makes as an icon on its tint: the thumbnails of
// a turn's results and the Library (AldoMadeCards.tsx), and a share's card in
// Home's replies (AldoShareCard.tsx).

import {
  FileArchiveIcon,
  FileAudioIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  GlobeIcon,
  ImageIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";

import type { AldoMadeKind } from "./made.logic";

export const ALDO_KIND_ICON: Record<AldoMadeKind, { icon: LucideIcon; tint: string }> = {
  sheet: { icon: FileSpreadsheetIcon, tint: "bg-emerald-500/15 text-emerald-500" },
  document: { icon: FileTextIcon, tint: "bg-sky-500/15 text-sky-500" },
  deck: { icon: PresentationIcon, tint: "bg-orange-500/15 text-orange-500" },
  pdf: { icon: FileTextIcon, tint: "bg-rose-500/15 text-rose-500" },
  image: { icon: ImageIcon, tint: "bg-violet-500/15 text-violet-500" },
  page: { icon: GlobeIcon, tint: "bg-cyan-500/15 text-cyan-500" },
  video: { icon: FileVideoIcon, tint: "bg-fuchsia-500/15 text-fuchsia-500" },
  audio: { icon: FileAudioIcon, tint: "bg-amber-500/15 text-amber-500" },
  archive: { icon: FileArchiveIcon, tint: "bg-zinc-500/15 text-zinc-500" },
};
