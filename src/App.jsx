// src/App.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import Login from "./Login";

import PageTrailers from "./PageTrailers";
import PageEquipements from "./PageEquipements";
import PageReglagesAdmin from "./PageReglagesAdmin";
import PageHistorique from "./PageHistorique"; // ✅ NEW

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import "./AppShell.css";

export default function App() {
  const [user, setUser] = useState(undefined);
  const [route, setRoute] = useState("trailers"); // "trailers" | "equipements" | "historique" | "reglages"

  // ✅ admin + alert
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAlertCount, setAdminAlertCount] = useState(0);

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

  // ✅ Listener notifs admin non traitées -> fait clignoter le menu
  useEffect(() => {
    setAdminAlertCount(0);

    if (!user?.uid) return;
    if (!isAdmin) return;

    const qN = query(
      collection(db, "notifications"),
      where("targetRole", "==", "admin"),
      where("done", "==", false)
    );

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

  if (user === undefined) return <div style={{ padding: 20 }}>Chargement…</div>;
  if (!user) return <Login />;

  const topbarIsAlert = isAdmin && adminAlertCount > 0;

  return (
    <div className="appShell">
      <header className={`topbar ${topbarIsAlert ? "topbarAlert" : ""}`}>
        <div className="topbarInner">
          <div className="brand">
            Trailers Contremaîtres
            {topbarIsAlert ? (
              <span className="topbarAlertPill" title="Notifications à traiter">
                {adminAlertCount}
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
