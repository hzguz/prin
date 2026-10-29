import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const windowRole = new URLSearchParams(window.location.search).get("window");
document.body.dataset.window = windowRole === "overlay" ? "overlay" : "main";
document.body.dataset.platform = /Macintosh|Mac OS X/.test(navigator.userAgent)
  ? "macos"
  : "other";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
