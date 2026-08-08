import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory("/"),
  routes: [
    { path: "/", name: "overview", component: () => import("./views/OverviewView.vue") },
    { path: "/mappings", name: "mappings", component: () => import("./views/MappingsView.vue") },
    { path: "/connector", name: "connector", component: () => import("./views/ConnectorView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/about", name: "about", component: () => import("./views/AboutView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
