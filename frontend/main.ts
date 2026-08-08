import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { appState } from "./state";
import "./styles/global.css";

const app = createApp(App);
app.config.errorHandler = (error, _instance, info) => {
  console.error("[CFTun-UI]", info, error);
  const message = error instanceof Error ? error.message : String(error);
  appState.notify(`应用错误: ${message}`, "error");
};
router.onError((error) => {
  console.error("[Router]", error);
  appState.notify(`路由错误: ${error.message}`, "error");
});
app.use(router).mount("#app");
