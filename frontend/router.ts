import { createRouter, createWebHistory } from "vue-router";
import OverviewView from "./views/OverviewView.vue";
import MappingsView from "./views/MappingsView.vue";
import ConnectorView from "./views/ConnectorView.vue";
import SettingsView from "./views/SettingsView.vue";
import AboutView from "./views/AboutView.vue";

export const router = createRouter({
  history: createWebHistory("/"),
  routes: [
    { path: "/", name: "overview", component: OverviewView },
    { path: "/mappings", name: "mappings", component: MappingsView },
    { path: "/connector", name: "connector", component: ConnectorView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/about", name: "about", component: AboutView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
