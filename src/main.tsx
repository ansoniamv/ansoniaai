// Must stay first: captures invite/reset link params before supabase-js consumes them.
import "./lib/authLinkParams";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
