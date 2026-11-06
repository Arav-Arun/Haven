// The side panel: the popup's screens, kept open beside the page you're on (Chrome's side panel).
import { createRoot } from "react-dom/client";
import { App } from "../popup/App";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App surface="panel" />);
