<script setup lang="ts">
/**
 * The panel a signup nudge is drawn as.
 *
 * A nudge is a proposal, and the library's stock `info` toast is the wrong
 * register for one: a flat coloured bar with a generic (i) is how this app
 * reports that something already happened, so an ask wearing that costume reads
 * as a status message and gets dismissed as one.
 *
 * So this borrows the dialog's chrome instead -- `--modal-background` on
 * `--modal-border` with the menu shadow, the same three values
 * `ModalLoginSignUp` uses -- and pairs it with the mark for whatever is being
 * offered. It is the login dialog's little sibling, which is what it should look
 * like given that pressing the button opens exactly that.
 *
 * The library's own chrome is switched off by the caller (`icon: false`,
 * `closeButton: false`) and its wrapper is flattened by `.nd-toast-nudge`, so
 * what the reader sees is only this component.
 */
defineProps<{
  /** An `@mdi/js` path. The mark of the thing being offered, not a generic alert glyph. */
  iconPath: string;
  title: string;
  message: string;
  actionLabel: string;
  dismissLabel: string;
}>();

const emit = defineEmits<{ action: []; dismiss: [] }>();
</script>

<template>
  <div class="nd-nudge-panel" role="group" :aria-label="title">
    <!-- The badge rides with the title only. Nesting the whole panel inside the
         text column indented the actions past the icon, which left a dead notch
         under the badge and squeezed the message into a narrower measure than
         the card actually has. -->
    <div class="flex items-center gap-2.5">
      <span class="nd-nudge-badge shrink-0" aria-hidden="true">
        <UiBaseIcon :path="iconPath" :size="18" w="w-[18px]" h="h-[18px]" />
      </span>
      <p class="font-semibold text-[15px] leading-snug text-ink">{{ title }}</p>
    </div>

    <p class="mt-2.5 text-sm leading-snug text-ink-muted">{{ message }}</p>

    <!-- Dismiss at one edge, the ask at the other. `justify-between` rather than
         a right-aligned pair: at this width clumping both buttons right leaves a
         puddle of empty card on the left, and the primary still lands where the
         eye finishes reading. DOM order matches reading order, so Tab reaches
         the way out before the commitment. -->
    <div class="mt-4 flex items-center justify-between gap-3">
      <button type="button" class="nd-nudge-dismiss" @click="emit('dismiss')">{{ dismissLabel }}</button>
      <button type="button" class="nd-btn-accent" @click="emit('action')">{{ actionLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.nd-nudge-panel {
  /* Matches the login dialog rather than the toast stack: same fill, same rule,
     same radius. */
  width: min(21rem, calc(100vw - 2rem));
  padding: 1rem;
  border-radius: 0.75rem;
  background: var(--modal-background);
  border: 1px solid var(--modal-border);
  box-shadow: var(--shadow-menu);
}

/*
 * The gutter on a phone.
 *
 * Below 600px the library throws its container full-bleed -- `width: 100vw`
 * with `padding: 0; left: 0; margin: 0` -- so a panel narrower than the screen
 * lands flush against the left edge and every pixel of slack piles up on the
 * right. The width cap above reserves 2rem; this is what splits it evenly
 * instead of donating it all to one side.
 *
 * Matched to the library's own breakpoint rather than a Tailwind one, because
 * the rule being corrected is theirs and the two must switch together.
 */
@media only screen and (max-width: 600px) {
  .nd-nudge-panel {
    /* Wider than the desktop cap on purpose. At 21rem on a 390px phone the panel
       is 86% of the screen, and the leftover lands entirely on the right -- 16px
       one side, 38px the other, which reads as a misalignment rather than as a
       panel anchored left. Letting it take the width the screen offers puts an
       even 1rem down both edges on every common handset. The 24rem ceiling is
       only there so a small tablet, still inside this breakpoint, does not get a
       near-600px slab. */
    width: min(24rem, calc(100vw - 2rem));
    margin-inline: 1rem;
  }
}


.nd-nudge-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Beside a 15px title rather than a whole text block, a 36px badge outweighed
     the words it was introducing. */
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  /* The accent at low mix, the same treatment the app gives an accented tile --
     a solid red square here would out-shout the button that is the actual call
     to action. Scoped rather than shared: the empty-search card wanted a bare
     brand mark in Patreon's own colour, so this is the only badge of its kind. */
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.nd-nudge-dismiss {
  display: inline-flex;
  align-items: center;
  /* Matches `nd-btn-accent`'s h-9, so the two sit on one baseline across the row
     rather than one riding higher than the other. */
  height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
  color: var(--ink-faint);
  border-radius: 0.5rem;
}

.nd-nudge-dismiss:hover {
  color: var(--ink);
  background: var(--surface-hover);
}
</style>
