import { createApp } from "vue";
import App from "./App.vue";
import { answerSessionQueries } from "./push.ts";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";

createApp(App).mount("#app");
answerSessionQueries();
