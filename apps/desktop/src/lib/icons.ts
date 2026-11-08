import { ICONS } from '@uwusuite/design';
import type { LucideIcon } from 'lucide-react';
import { Clapperboard, Download, House, Image, Monitor, Music, Usb } from 'lucide-react';
import type { Kind, Place } from './api';

/** Which suite icon a kind of file gets. */
export const KIND_ICON: Record<Kind, LucideIcon> = {
  folder: ICONS.folder,
  image: ICONS.imageFile,
  video: ICONS.videoFile,
  audio: ICONS.audioFile,
  archive: ICONS.archiveFile,
  code: ICONS.codeFile,
  document: ICONS.document,
  spreadsheet: ICONS.spreadsheet,
  text: ICONS.document,
  other: ICONS.file,
};

export const KIND_LABEL: Record<Kind, string> = {
  folder: 'Ordner',
  image: 'Bild',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archiv',
  code: 'Quelltext',
  document: 'Dokument',
  spreadsheet: 'Tabelle',
  text: 'Text',
  other: 'Datei',
};

/**
 * The colour behind a tile's icon, one per kind, from the account palette so the grid reads at
 * a glance without becoming a rainbow. Folders get the suite's pink.
 */
export const KIND_TINT: Record<Kind, string> = {
  folder: 'bg-pink-tint text-pink-ink',
  image: 'bg-avatar-violet text-avatar-violet-ink',
  video: 'bg-avatar-coral text-avatar-coral-ink',
  audio: 'bg-avatar-amber text-avatar-amber-ink',
  archive: 'bg-avatar-amber text-avatar-amber-ink',
  code: 'bg-avatar-sky text-avatar-sky-ink',
  document: 'bg-avatar-mint text-avatar-mint-ink',
  spreadsheet: 'bg-avatar-mint text-avatar-mint-ink',
  text: 'bg-elevated text-muted',
  other: 'bg-elevated text-muted',
};

// The vocabulary has no meanings for these sidebar places yet; they go into the
// package (`ICONS`) once a second app needs them (docs/icons.md).
export const PLACE_ICON: Record<Place['icon'], LucideIcon> = {
  home: House,
  desktop: Monitor,
  documents: ICONS.document,
  downloads: Download,
  pictures: Image,
  music: Music,
  videos: Clapperboard,
};

export const REMOVABLE_ICON = Usb;
