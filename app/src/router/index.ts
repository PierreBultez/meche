import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import HomeView from "../views/HomeView.vue";

export const routes: RouteRecordRaw[] = [{ path: "/", name: "home", component: HomeView }];

// Hash history (`#/…`) never asks the WebView to load another URL, so a reload
// always lands on index.html, whatever the platform's asset protocol.
export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
