<script setup lang="ts">
// Temporary phase 0 screen: shows the Mèche colors in both themes. Replaced in phase 1.
import ThemeSwitcher from "../components/ThemeSwitcher.vue";
import { NOTE_COLORS } from "../theme/note-colors";

const labels: Record<(typeof NOTE_COLORS)[number], string> = {
  violet: "Violet",
  rose: "Rose",
  corail: "Corail",
  orange: "Orange",
  citron: "Citron",
  pomme: "Pomme",
  turquoise: "Turquoise",
  bleu: "Bleu",
};
</script>

<template>
  <main class="min-h-screen bg-bg text-text">
    <div class="mx-auto max-w-3xl space-y-10 px-6 py-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-4xl font-semibold text-brand">mèche</h1>
          <p class="mt-1 text-muted">Les fondations sont posées. Les notes arrivent en phase 1.</p>
        </div>
        <ThemeSwitcher />
      </header>

      <section aria-labelledby="note-colors" class="space-y-3">
        <h2 id="note-colors" class="text-sm font-semibold text-muted">Couleurs des notes</h2>
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <li
            v-for="(color, index) in NOTE_COLORS"
            :key="color"
            :data-note-color="color"
            class="rounded-card p-3"
            :class="index === 0 ? 'bg-note-card-selected ring-2 ring-note' : 'bg-note-card'"
          >
            <p class="font-semibold text-note-on-card">{{ labels[color] }}</p>
            <p class="text-sm text-note-on-card">
              {{ index === 0 ? "Note sélectionnée" : "Aperçu de la note…" }}
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="note-titles" class="space-y-3">
        <h2 id="note-titles" class="text-sm font-semibold text-muted">Titres dans l'éditeur</h2>
        <ul class="flex flex-wrap gap-x-6 gap-y-1">
          <li
            v-for="color in NOTE_COLORS"
            :key="color"
            :data-note-color="color"
            class="text-[26px] font-semibold text-note"
          >
            {{ labels[color] }}
          </li>
        </ul>
      </section>

      <section aria-labelledby="code-colors" class="space-y-3">
        <h2 id="code-colors" class="text-sm font-semibold text-muted">Coloration du code</h2>
        <pre
          class="overflow-x-auto rounded-card bg-code-bg p-4 font-mono text-sm text-code-text"
        ><code><span class="text-code-comment">// Allumer la mèche d'une note</span>
<span class="text-code-keyword">function</span> <span class="text-code-function">allumer</span>(<span class="text-code-type">Note</span> <span class="text-code-variable">$note</span>, <span class="text-code-type">int</span> <span class="text-code-variable">$heures</span> = <span class="text-code-number">24</span>): <span class="text-code-type">bool</span>
{
    <span class="text-code-keyword">return</span> <span class="text-code-variable">$note</span>-&gt;<span class="text-code-function">meche</span>(<span class="text-code-string">'allumée'</span>, <span class="text-code-variable">$heures</span>);
}</code></pre>
      </section>
    </div>
  </main>
</template>
