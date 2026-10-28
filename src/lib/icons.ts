/**
 * App icon set — Phosphor (regular weight) for every icon, including the ones
 * Vuetify draws itself (select carets, chip close, checkboxes, tab arrows).
 *
 * Vuetify renders a component passed as `icon` / `prepend-icon` through its
 * VComponentIcon; the Phosphor SVG sizes itself to `1em`, so the `size` prop on
 * v-icon / v-btn keeps working unchanged.
 */
import { markRaw, type Component } from 'vue';
import { aliases as mdiAliases } from 'vuetify/iconsets/mdi-svg';
import type { IconAliases } from 'vuetify';
import {
  PhArrowCounterClockwise,
  PhCaretDown,
  PhCaretLeft,
  PhCaretRight,
  PhCaretUp,
  PhCheck,
  PhCheckCircle,
  PhCheckSquare,
  PhCoffee,
  PhCube,
  PhDotsSix,
  PhDownloadSimple,
  PhFolderOpen,
  PhInfo,
  PhMagicWand,
  PhMagnifyingGlassMinus,
  PhMinusSquare,
  PhMoon,
  PhPaperclip,
  PhPause,
  PhPersonSimpleWalk,
  PhPlay,
  PhRadioButton,
  PhCircle,
  PhRepeat,
  PhRobot,
  PhSkipBack,
  PhSkipForward,
  PhSlidersHorizontal,
  PhSquare,
  PhStop,
  PhSun,
  PhTrash,
  PhUploadSimple,
  PhVideoCamera,
  PhWarning,
  PhX,
  PhXCircle,
} from '@phosphor-icons/vue';

// Vuetify's `IconValue` isn't re-exported from the package root; this is it.
type IconValue = IconAliases[string];

// Components end up inside reactive Vuetify state; keep Vue from proxying them.
// Phosphor's components satisfy Vuetify's JSXComponent at runtime; their
// DefineComponent typing just doesn't line up with it structurally.
const icon = (c: Component) => markRaw(c) as unknown as IconValue;

export const icons = {
  play: icon(PhPlay),
  pause: icon(PhPause),
  stop: icon(PhStop),
  skipBack: icon(PhSkipBack),
  skipForward: icon(PhSkipForward),
  loop: icon(PhRepeat),
  caretLeft: icon(PhCaretLeft),
  caretRight: icon(PhCaretRight),
  caretUp: icon(PhCaretUp),
  caretDown: icon(PhCaretDown),
  folderOpen: icon(PhFolderOpen),
  walk: icon(PhPersonSimpleWalk),
  video: icon(PhVideoCamera),
  cube: icon(PhCube),
  sliders: icon(PhSlidersHorizontal),
  download: icon(PhDownloadSimple),
  upload: icon(PhUploadSimple),
  close: icon(PhX),
  sun: icon(PhSun),
  moon: icon(PhMoon),
  coffee: icon(PhCoffee),
  robot: icon(PhRobot),
  reset: icon(PhArrowCounterClockwise),
  trash: icon(PhTrash),
  zoomOut: icon(PhMagnifyingGlassMinus),
  dragHandle: icon(PhDotsSix),
  magicWand: icon(PhMagicWand),
} as const;

/** Vuetify's internal icons, redrawn in Phosphor; anything unlisted keeps the MDI fallback. */
export const vuetifyAliases: IconAliases = {
  ...mdiAliases,
  collapse: icon(PhCaretUp),
  expand: icon(PhCaretDown),
  dropdown: icon(PhCaretDown),
  subgroup: icon(PhCaretDown),
  prev: icon(PhCaretLeft),
  next: icon(PhCaretRight),
  complete: icon(PhCheck),
  close: icon(PhX),
  cancel: icon(PhXCircle),
  clear: icon(PhXCircle),
  delete: icon(PhXCircle),
  success: icon(PhCheckCircle),
  info: icon(PhInfo),
  warning: icon(PhWarning),
  error: icon(PhXCircle),
  checkboxOn: icon(PhCheckSquare),
  checkboxOff: icon(PhSquare),
  checkboxIndeterminate: icon(PhMinusSquare),
  radioOn: icon(PhRadioButton),
  radioOff: icon(PhCircle),
  file: icon(PhPaperclip),
  upload: icon(PhUploadSimple),
};
