import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DonationNotice } from "./components/DonationNotice";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DonationNotice />
    <App />
  </React.StrictMode>
);
