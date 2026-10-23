import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import NotesView from "../views/NotesView.vue";

export const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/notes" },
  // One route for the list with or without an open note, so the list is never rebuilt
  // when another note is opened.
  { path: "/notes/:noteId?", name: "notes", component: NotesView },
  { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
  { path: "/welcome", name: "welcome", component: () => import("../views/WelcomeView.vue") },
];

// Hash history (`#/…`) never asks the WebView to load another URL, so a reload
// always lands on index.html, whatever the platform's asset protocol.
export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
