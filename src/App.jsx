// src/App.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import Login from "./Login";

import PageTrailers from "./PageTrailers";
import PageEquipements from "./PageEquipements";
import PageReglagesAdmin from "./PageReglagesAdmin";
import PageHistorique from "./PageHistorique"; // ✅ NEW

import { collection, doc, onSnapshot, query, where } from "firebase/firestore";

import "./AppShell.css";

export default function App() {
  const [user, setUser] = useState(undefined);
  const [route, setRoute] = useState("trailers"); // "trailers" | "equipements" | "historique" | "reglages"

  // ✅ admin + alert admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAlertCount, setAdminAlertCount] = useState(0);

  // ✅ alert "à répondre" (travailleur) — envoyé par PanelReparations via window.dispatchEvent(...)
  const [turnAlertCount, setTurnAlertCount] = useState(0);

  // Auth
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u || null));
  }, []);

  // ✅ Lire isAdmin depuis Firestore: users/{uid}.isAdmin
  useEffect(() => {
    setIsAdmin(false);
    setAdminAlertCount(0);

    if (!user?.uid) return;

    const uRef = doc(db, "users", user.uid);
    return onSnapshot(
      uRef,
      (snap) => {
        const data = snap.data() || {};
        setIsAdmin(!!data.isAdmin);
      },
      () => {
        // si erreur, on reste non-admin
        setIsAdmin(false);
      }
    );
  }, [user?.uid]);

  // ✅ Listener notifs admin non traitées -> fait clignoter le menu (admin)
  useEffect(() => {
    setAdminAlertCount(0);

    if (!user?.uid) return;
    if (!isAdmin) return;

    const qN = query(collection(db, "notifications"), where("targetRole", "==", "admin"), where("done", "==", false));

    return onSnapshot(
      qN,
      (snap) => {
        setAdminAlertCount(snap.size || 0);
      },
      (err) => {
        console.error("notifications snapshot:", err);
        setAdminAlertCount(0);
      }
    );
  }, [user?.uid, isAdmin]);

  // ✅ Listener "à répondre" (travailleur) -> fait clignoter la bande du menu (topbar)
  // PanelReparations doit dispatcher: window.dispatchEvent(new CustomEvent("app_turn_alert", { detail: { count } }))
  useEffect(() => {
    function onTurnAlert(e) {
      const c = Number(e?.detail?.count || 0);
      setTurnAlertCount(Number.isFinite(c) ? c : 0);
    }
    window.addEventListener("app_turn_alert", onTurnAlert);
    return () => window.removeEventListener("app_turn_alert", onTurnAlert);
  }, []);

  if (user === undefined) return <div style={{ padding: 20 }}>Chargement…</div>;
  if (!user) return <Login />;

  // ✅ Bande blanche du menu flash si:
  // - admin a des notifications à traiter
  // - OU travailleur a des actions "à répondre"
  const topbarIsAlert = (isAdmin && adminAlertCount > 0) || turnAlertCount > 0;

  return (
    <div className="appShell">
      <header className={`topbar ${topbarIsAlert ? "topbarAlert" : ""}`}>
        <div className="topbarInner">
          <div className="brand">
            Trailers Contremaîtres

            {/* ✅ Badge admin (comme avant) */}
            {isAdmin && adminAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Notifications à traiter">
                {adminAlertCount}
              </span>
            ) : null}

            {/* ✅ Badge travailleur (nouveau) */}
            {!isAdmin && turnAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Actions à répondre">
                À répondre: {turnAlertCount}
              </span>
            ) : null}

            {/* ✅ Si admin ET aussi des actions à répondre (rare), on peut l’afficher aussi */}
            {isAdmin && turnAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Actions à répondre (travailleur)">
                À répondre: {turnAlertCount}
              </span>
            ) : null}
          </div>

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

            {/* ✅ NEW: Historique */}
            <button
              className={`tabBtn ${route === "historique" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("historique")}
              type="button"
            >
              Historique
            </button>

            {/* ✅ Réglages */}
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
        ) : route === "historique" ? (
          <PageHistorique />
        ) : (
          <PageReglagesAdmin />
        )}
      </main>
    </div>
  );
}
