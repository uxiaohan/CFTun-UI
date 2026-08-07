import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles/global.css";

const app = createApp(App);
app.config.errorHandler = (error, _instance, info) => console.error("[CFTun-UI]", info, error);
router.onError((error) => console.error("[Router]", error));
app.use(router).mount("#app");
