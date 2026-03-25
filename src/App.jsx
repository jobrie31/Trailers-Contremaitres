import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import Login from "./Login";

import PageTrailers from "./PageTrailers";
import PageEquipements from "./PageEquipements";
import PageReglagesAdmin from "./PageReglagesAdmin";
import PageHistorique from "./PageHistorique";
import PageReparations from "./PageReparations";

import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import "./AppShell.css";

/* =========================
   Même logique que PanelReparations
   pour garder les flashs globaux
   ========================= */
function computeTurnInfo(r, isAdmin) {
  const status = (r?.status || "").toString().trim().toLowerCase();
  const adminActionType = (r?.adminActionType || "").toString().trim().toLowerCase();
  const hasFollowUp = !!(r?.followUpText || "").toString().trim();

  const isActionStyro =
    adminActionType.includes("styro") ||
    adminActionType.includes("to_styro") ||
    adminActionType.includes("envoyer") ||
    adminActionType.includes("send");

  const isActionPorter =
    adminActionType.includes("porter") ||
    adminActionType.includes("aller") ||
    adminActionType.includes("répar") ||
    adminActionType.includes("repar") ||
    adminActionType.includes("réparateur") ||
    adminActionType.includes("reparateur") ||
    adminActionType.includes("repair") ||
    adminActionType.includes("shop");

  if (!isAdmin) {
    if (hasFollowUp && status === "jete") {
      return { needsMe: true, label: "À répondre: suivi", kind: "followup" };
    }

    if (adminActionType) {
      if (isActionStyro && !r?.toStyroAt) {
        return { needsMe: true, label: "À répondre: envoyer à Styro", kind: "styro_send" };
      }

      if (isActionStyro && !!r?.styroRenvoyeAt && !r?.remisTrailerAt) {
        return { needsMe: true, label: "À répondre: chercher & remis trailer", kind: "styro_pickup_return" };
      }

      if (isActionPorter && !r?.porterAt) {
        return { needsMe: true, label: "À répondre: aller le faire réparer", kind: "porter" };
      }
    }

    if (r?.pretAt && !r?.remisTrailerAt) {
      return { needsMe: true, label: "À répondre: chercher & remis trailer", kind: "pickup_return" };
    }

    return { needsMe: false, label: "", kind: "" };
  }

  if (status === "brise" && !adminActionType) {
    return { needsMe: true, label: "À répondre: décider action", kind: "admin_decide" };
  }

  if (r?.toStyroAt && !r?.styroRecuAt) {
    return { needsMe: true, label: "À répondre: réception Styro", kind: "admin_styro_receive" };
  }

  const needsRepairConfirm =
    !!r?.needsAdminRepairConfirm ||
    (isActionStyro && !!r?.styroRecuAt && !r?.styroMiseReparationAt && status === "brise");

  if (needsRepairConfirm) {
    return { needsMe: true, label: "À répondre: mettre en réparation", kind: "admin_repair_confirm" };
  }

  return { needsMe: false, label: "", kind: "" };
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [route, setRoute] = useState("trailers");

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAlertCount, setAdminAlertCount] = useState(0);

  // ✅ compteur global calculé depuis Firestore
  const [turnAlertCount, setTurnAlertCount] = useState(0);

  // ✅ on garde les rows réparations ici aussi pour les flashs globaux
  const [repairRows, setRepairRows] = useState([]);

  // -------------------------
  // Auth
  // -------------------------
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u || null));
  }, []);

  // -------------------------
  // Lire users/{uid}.isAdmin
  // -------------------------
  useEffect(() => {
    setIsAdmin(false);
    setAdminAlertCount(0);
    setTurnAlertCount(0);
    setRepairRows([]);

    if (!user?.uid) return;

    const uRef = doc(db, "users", user.uid);
    return onSnapshot(
      uRef,
      (snap) => {
        const data = snap.data() || {};
        setIsAdmin(!!data.isAdmin);
      },
      () => {
        setIsAdmin(false);
      }
    );
  }, [user?.uid]);

  // -------------------------
  // Notifs admin
  // -------------------------
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

  // -------------------------
  // ✅ Réparations globales pour garder
  // les flashs / badges même hors page réparations
  // -------------------------
  useEffect(() => {
    setRepairRows([]);
    setTurnAlertCount(0);

    if (!user?.uid) return;

    if (isAdmin) {
      const qAll = query(collectionGroup(db, "reparations"), orderBy("createdAt", "desc"));
      return onSnapshot(
        qAll,
        (snap) => {
          const mapped = snap.docs.map((d) => {
            const tId = d.ref?.parent?.parent?.id || null;
            return { id: d.id, ...d.data(), __trailerId: tId };
          });
          setRepairRows(mapped);
        },
        (err) => {
          console.error("reparations global snapshot:", err);
          setRepairRows([]);
        }
      );
    }

    // ✅ travailleur: seulement ses trailers
    const qMine = query(
      collection(db, "trailers"),
      where("ownerUid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    let unsubReps = [];
    const cleanRepUnsubs = () => {
      unsubReps.forEach((u) => u && u());
      unsubReps = [];
    };

    return onSnapshot(
      qMine,
      (trailersSnap) => {
        cleanRepUnsubs();

        const trailerIds = trailersSnap.docs.map((d) => d.id);
        if (trailerIds.length === 0) {
          setRepairRows([]);
          return;
        }

        const tempMap = new Map();

        trailerIds.forEach((tid) => {
          const qR = query(collection(db, "trailers", tid, "reparations"), orderBy("createdAt", "desc"));
          const unsub = onSnapshot(
            qR,
            (repSnap) => {
              // enlève anciennes rows de ce trailer
              for (const [k, v] of tempMap.entries()) {
                if ((v?.__trailerId || "") === tid) tempMap.delete(k);
              }

              repSnap.docs.forEach((d) => {
                tempMap.set(d.id, { id: d.id, ...d.data(), __trailerId: tid });
              });

              setRepairRows(Array.from(tempMap.values()));
            },
            (err) => {
              console.error("reparations worker snapshot:", err);
            }
          );
          unsubReps.push(unsub);
        });
      },
      (err) => {
        console.error("trailers worker snapshot:", err);
        setRepairRows([]);
      }
    );
  }, [user?.uid, isAdmin]);

  // -------------------------
  // ✅ Calcule le badge / flash global
  // -------------------------
  useEffect(() => {
    const count = (repairRows || []).reduce((acc, r) => {
      const info = computeTurnInfo(r, !!isAdmin);
      return acc + (info.needsMe ? 1 : 0);
    }, 0);

    setTurnAlertCount(count);

    try {
      window.dispatchEvent(new CustomEvent("app_turn_alert", { detail: { count } }));
    } catch {
      // ignore
    }
  }, [repairRows, isAdmin]);

  // -------------------------
  // Navigation demandée par une page
  // -------------------------
  useEffect(() => {
    function onGoRoute(e) {
      const next = (e?.detail?.route || "").toString().trim();
      if (!next) return;

      if (
        next === "trailers" ||
        next === "equipements" ||
        next === "reparations" ||
        next === "historique" ||
        next === "reglages"
      ) {
        setRoute(next);
      }
    }

    window.addEventListener("app_go_route", onGoRoute);
    return () => window.removeEventListener("app_go_route", onGoRoute);
  }, []);

  if (user === undefined) return <div style={{ padding: 20 }}>Chargement…</div>;
  if (!user) return <Login />;

  const topbarIsAlert = (isAdmin && adminAlertCount > 0) || turnAlertCount > 0;

  return (
    <div className="appShell">
      <header className={`topbar ${topbarIsAlert ? "topbarAlert" : ""}`}>
        <div className="topbarInner">
          <div className="brand">
            Trailers Contremaîtres

            {isAdmin && adminAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Notifications à traiter">
                {adminAlertCount}
              </span>
            ) : null}

            {!isAdmin && turnAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Actions à répondre">
                À répondre: {turnAlertCount}
              </span>
            ) : null}

            {isAdmin && turnAlertCount > 0 ? (
              <span className="topbarAlertPill" title="Actions à répondre">
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

            <button
              className={`tabBtn ${route === "reparations" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("reparations")}
              type="button"
            >
              Réparations
            </button>

            <button
              className={`tabBtn ${route === "historique" ? "tabBtnActive" : ""}`}
              onClick={() => setRoute("historique")}
              type="button"
            >
              Historique
            </button>

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
        ) : route === "reparations" ? (
          <PageReparations isAdmin={isAdmin} />
        ) : route === "historique" ? (
          <PageHistorique isAdmin={isAdmin} user={user} />
        ) : (
          <PageReglagesAdmin />
        )}
      </main>
    </div>
  );
}