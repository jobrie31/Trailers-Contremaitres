// src/App.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";
import Login from "./Login";

import PageTrailers from "./PageTrailers";
import PageEquipements from "./PageEquipements";
import PageReglagesAdmin from "./PageReglagesAdmin"; // ✅ NEW

import "./AppShell.css";

export default function App() {
  const [user, setUser] = useState(undefined);
  const [route, setRoute] = useState("trailers"); // "trailers" | "equipements" | "reglages"

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u || null));
  }, []);

  if (user === undefined) return <div style={{ padding: 20 }}>Chargement…</div>;
  if (!user) return <Login />;

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">Trailers Contremaîtres</div>

          <nav className="tabs">
            <button
              className={`tabBtn ${route === "trailers" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("trailers")}
              type="button"
            >
              Trailers
            </button>

            <button
              className={`tabBtn ${route === "equipements" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("equipements")}
              type="button"
            >
              Équipements
            </button>

            {/* ✅ NEW: Réglages */}
            <button
              className={`tabBtn ${route === "reglages" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("reglages")}
              type="button"
            >
              Réglages
            </button>
          </nav>

          <div className="topRight">
            <div className="userPill">{user.email}</div>
            <button className="logoutBtn" onClick={() => signOut(auth)} type="button">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {route === "trailers" ? (
          <PageTrailers />
        ) : route === "equipements" ? (
          <PageEquipements />
        ) : (
          <PageReglagesAdmin />
        )}
      </main>
    </div>
  );
}
