// src/RepairTimelineModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebaseConfig";
import { doc, updateDoc, serverTimestamp, runTransaction, collection } from "firebase/firestore";

/**
 * Deux chemins:
 *
 * A) adminActionType="styro"
 *   1) Admin décide "Envoyer à Styro" + note
 *   2) Non-admin confirme: "Envoyé à Styro" (fait par)
 *   3) Admin: "Reçu" (note optionnelle)
 *   4) Admin: "Mis en réparation"
 *   5) Admin: "Renvoyé" (note optionnelle)
 *   6) Non-admin: "Reçu et remis dans le trailer" => retour qty + delete doc
 *
 * B) adminActionType="reparer"
 *   1) Admin décide "Aller faire réparer" + PO + note
 *   2) Non-admin: "Je l'ai porté à ..." (fait par + endroit) -> status "reparation"
 *   3) Non-admin: "Je l'ai été le chercher"
 *   4) Non-admin: "Prêt à l'emploi"
 *   5) Non-admin: "Remis dans le trailer" => retour qty + delete doc
 */

export default function RepairTimelineModal({
  open,
  onClose,
  row,
  isAdmin,
  getRowTrailerId,
  getRowTrailerNom,
  findEquipById,
  logHistory,
  notifDone,
  notifOpenOrUpdate,
}) {
  // ⚠️ IMPORTANT: on ne fait PAS de return conditionnel avant les hooks
  const visible = !!open && !!row;
  const r = row || {};

  const tId = useMemo(() => {
    if (!row) return null;
    return getRowTrailerId ? getRowTrailerId(row) : null;
  }, [row, getRowTrailerId]);

  const tNom = useMemo(() => {
    if (!row) return "—";
    return getRowTrailerNom ? getRowTrailerNom(row) : "—";
  }, [row, getRowTrailerNom]);

  const status = useMemo(() => ((r?.status || "") + "").trim(), [r?.status]);

  // ---------- Date helpers ----------
  function dateFromTs(ts) {
    if (!ts) return null;
    try {
      if (typeof ts?.toDate === "function") return ts.toDate();
      if (ts instanceof Date) return ts;
      const n = Number(ts);
      if (Number.isFinite(n)) return new Date(n);
      return null;
    } catch {
      return null;
    }
  }
  function fmtDateTimeFR(ts) {
    const d = dateFromTs(ts);
    if (!d) return "—";
    try {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = String(d.getFullYear());
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
    } catch {
      return "—";
    }
  }

  const actionType = ((r?.adminActionType || "") + "").trim(); // "styro" | "reparer" | ""

  // ---------- forms ----------
  const [adminChoice, setAdminChoice] = useState(""); // "" | "styro" | "reparer"
  const [adminPo, setAdminPo] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const [doneBy, setDoneBy] = useState("");
  const [porterWhere, setPorterWhere] = useState("");

  const [styroRecuNote, setStyroRecuNote] = useState("");
  const [styroRenvoyeNote, setStyroRenvoyeNote] = useState("");

  useEffect(() => {
    if (!visible) return;

    const existing = ((r?.adminActionType || "") + "").trim();
    setAdminChoice(existing === "styro" || existing === "reparer" ? existing : "");

    setAdminPo((r?.adminActionPo || "").toString());
    setAdminNote((r?.adminActionNote || "").toString());

    const defaultName =
      (auth.currentUser?.displayName || "").toString().trim() ||
      (auth.currentUser?.email || "").toString().trim() ||
      "";
    setDoneBy(defaultName);

    setPorterWhere((r?.porterWhere || "").toString());

    setStyroRecuNote((r?.styroRecuNote || "").toString());
    setStyroRenvoyeNote((r?.styroRenvoyeNote || "").toString());
  }, [visible, r]);

  // ---------- step booleans ----------
  const stepAdminDecisionDone = !!r?.adminActionAt;

  // Path styro:
  const stepToStyroDone = !!r?.toStyroAt;
  const stepStyroRecuDone = !!r?.styroRecuAt;
  const stepStyroMiseReparationDone = !!r?.styroMiseReparationAt;
  const stepStyroRenvoyeDone = !!r?.styroRenvoyeAt;

  // Path reparer:
  const stepPorteDone = !!r?.porterAt;
  const stepChercheDone = !!r?.chercherAt;
  const stepPretDone = !!r?.pretAt;

  // ---------- steps for UI (ALWAYS called, no conditional return before) ----------
  const steps = useMemo(() => {
    if (!stepAdminDecisionDone) {
      return [{ key: "decide", label: "1) Décision admin (Styro / Réparer)", done: false, date: "—" }];
    }

    const path = (actionType || adminChoice || "").trim();

    if (path === "styro") {
      return [
        { key: "decide", label: "1) Admin: Envoyer à Styro (note)", done: true, date: fmtDateTimeFR(r?.adminActionAt) },
        {
          key: "tostyro",
          label: "2) Pas-admin: Envoyé à Styro (fait par)",
          done: stepToStyroDone,
          date: stepToStyroDone ? fmtDateTimeFR(r?.toStyroAt) : "—",
          extra: stepToStyroDone ? (r?.toStyroByName || "—") : null,
        },
        {
          key: "recu",
          label: "3) Admin: Reçu",
          done: stepStyroRecuDone,
          date: stepStyroRecuDone ? fmtDateTimeFR(r?.styroRecuAt) : "—",
        },
        {
          key: "mise",
          label: "4) Admin: Mis en réparation",
          done: stepStyroMiseReparationDone,
          date: stepStyroMiseReparationDone ? fmtDateTimeFR(r?.styroMiseReparationAt) : "—",
        },
        {
          key: "renvoye",
          label: "5) Admin: Renvoyé",
          done: stepStyroRenvoyeDone,
          date: stepStyroRenvoyeDone ? fmtDateTimeFR(r?.styroRenvoyeAt) : "—",
        },
        { key: "retour", label: "6) Pas-admin: Reçu et remis dans le trailer", done: false, date: "—" },
      ];
    }

    // reparer
    return [
      { key: "decide", label: "1) Admin: Aller faire réparer (PO + note)", done: true, date: fmtDateTimeFR(r?.adminActionAt) },
      {
        key: "porte",
        label: "2) Pas-admin: Je l’ai porté à…",
        done: stepPorteDone,
        date: stepPorteDone ? fmtDateTimeFR(r?.porterAt) : "—",
        extra: stepPorteDone ? (r?.porterByName || "—") : null,
      },
      {
        key: "cherche",
        label: "3) Pas-admin: Je l’ai été le chercher",
        done: stepChercheDone,
        date: stepChercheDone ? fmtDateTimeFR(r?.chercherAt) : "—",
        extra: stepChercheDone ? (r?.chercherByName || "—") : null,
      },
      {
        key: "pret",
        label: "4) Pas-admin: Prêt à l’emploi",
        done: stepPretDone,
        date: stepPretDone ? fmtDateTimeFR(r?.pretAt) : "—",
        extra: stepPretDone ? (r?.pretByName || "—") : null,
      },
      { key: "retour", label: "5) Remis dans le trailer", done: false, date: "—" },
    ];
  }, [
    stepAdminDecisionDone,
    actionType,
    adminChoice,
    r,
    stepToStyroDone,
    stepStyroRecuDone,
    stepStyroMiseReparationDone,
    stepStyroRenvoyeDone,
    stepPorteDone,
    stepChercheDone,
    stepPretDone,
  ]);

  function Stepper() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        {steps.map((s, idx) => (
          <div key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                border: "2px solid rgba(15,23,42,0.35)",
                background: s.done ? "rgba(34,197,94,0.25)" : "rgba(148,163,184,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 1000,
                fontSize: 12,
                marginTop: 1,
              }}
            >
              {s.done ? "✓" : idx + 1}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 1000, fontSize: 13.5, opacity: s.done ? 0.95 : 0.8 }}>{s.label}</div>
              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 850, opacity: 0.75 }}>
                Date: {s.date}
                {s.extra ? (
                  <span style={{ marginLeft: 10 }}>
                    — Fait par: <b>{s.extra}</b>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ---------- helpers ----------
  function mustHaveOrigin() {
    const catId = (r?.from?.catId || "").toString().trim();
    const itemId = (r?.from?.itemId || "").toString().trim();
    return { catId, itemId, ok: !!catId && !!itemId };
  }

  async function returnToTrailerAndDelete({ whoName }) {
    const { catId, itemId, ok } = mustHaveOrigin();
    if (!ok) return alert("Origine manquante (from.catId / from.itemId). Impossible de retourner au trailer.");

    const eq = findEquipById?.(r?.equipementId);
    const unite = (eq?.unite || "").toString().trim();

    await runTransaction(db, async (tx) => {
      const repRef = doc(db, "trailers", tId, "reparations", r.id);
      const repSnap = await tx.get(repRef);
      if (!repSnap.exists()) throw new Error("Cette ligne n’existe plus.");

      const rep = repSnap.data() || {};
      const addQty = Number(rep.qty || 0);
      if (!Number.isFinite(addQty) || addQty <= 0) throw new Error("Quantité invalide sur la réparation.");

      const itemRef = doc(db, "trailers", tId, "categories", catId, "items", itemId);
      const itemSnap = await tx.get(itemRef);

      if (itemSnap.exists()) {
        const cur = Number(itemSnap.data()?.qty || 0);
        const next = (Number.isFinite(cur) ? cur : 0) + addQty;
        tx.update(itemRef, { qty: next });
      } else {
        tx.set(itemRef, {
          equipementId: rep.equipementId || null,
          nom: (rep.nom || "").toString(),
          unite: unite || (rep.unite || "").toString() || "",
          qty: addQty,
          createdAt: serverTimestamp(),
        });
      }

      const hRef = doc(collection(db, "reparations_history"));
      tx.set(hRef, {
        ts: serverTimestamp(),
        trackId: r.id,
        trailerId: tId || null,
        trailerNom: tNom,
        byUid: auth.currentUser?.uid || null,
        event: "RETOUR_TRAILER",
        nom: (rep.nom || "—").toString(),
        qty: addQty,
        status: "retour_trailer",
        equipementId: rep.equipementId || null,
        from: rep.from || { catId, itemId },
        extra: { whoName: whoName || null },
      });

      tx.delete(repRef);
    });
  }

  // ---------- ACTIONS ----------
  async function adminConfirmDecision() {
    if (!isAdmin) return;
    if (!tId || !r?.id) return;

    if (adminChoice !== "styro" && adminChoice !== "reparer") return alert("Choisis: Envoyer à Styro OU Aller le faire réparer.");

    const note = (adminNote || "").toString().trim();
    const po = (adminPo || "").toString().trim();

    if (!note) return alert("Note obligatoire.");
    if (adminChoice === "reparer" && !po) return alert("Numéro PO obligatoire si “Aller le faire réparer”.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        adminActionType: adminChoice,
        adminActionNote: note,
        adminActionPo: adminChoice === "reparer" ? po : null,
        adminActionAt: serverTimestamp(),
        adminActionByUid: u?.uid || null,
      });

      await logHistory?.("ADMIN_DECISION", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: status || "brise",
        equipementId: r?.equipementId || null,
        note,
        po: adminChoice === "reparer" ? po : null,
        extra: { adminActionType: adminChoice },
      });

      await notifDone?.(r.id, "admin_decision_done");
      onClose?.();
    } catch (e) {
      console.error("adminConfirmDecision:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // --- PATH STYRO ---
  async function userConfirmSentToStyro() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if (!stepAdminDecisionDone) return alert("L’admin n’a pas encore décidé.");
    if ((actionType || "").trim() !== "styro") return alert("Cette ligne n’est pas en mode Styro.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    try {
      const u = auth.currentUser;
      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        toStyroAt: serverTimestamp(),
        toStyroByUid: u?.uid || null,
        toStyroByName: who,
      });

      await logHistory?.("STYRO_ENVOYE", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "brise",
        equipementId: r?.equipementId || null,
        extra: { who },
      });

      onClose?.();
    } catch (e) {
      console.error("userConfirmSentToStyro:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function adminMarkStyroRecu() {
    if (!isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "styro") return alert("Pas le bon chemin.");
    if (!stepToStyroDone) return alert("Le pas-admin doit d’abord confirmer “Envoyé à Styro”.");

    try {
      const u = auth.currentUser;
      const note = (styroRecuNote || "").toString().trim() || null;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        styroRecuAt: serverTimestamp(),
        styroRecuByUid: u?.uid || null,
        styroRecuNote: note,
      });

      await logHistory?.("STYRO_RECU", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "brise",
        equipementId: r?.equipementId || null,
        note: note || null,
      });

      onClose?.();
    } catch (e) {
      console.error("adminMarkStyroRecu:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function adminMarkStyroMiseReparation() {
    if (!isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "styro") return alert("Pas le bon chemin.");
    if (!stepStyroRecuDone) return alert("Admin doit d’abord faire “Reçu”.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        styroMiseReparationAt: serverTimestamp(),
        styroMiseReparationByUid: u?.uid || null,
        status: "reparation",
      });

      await logHistory?.("STYRO_MIS_REPARATION", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
      });

      onClose?.();
    } catch (e) {
      console.error("adminMarkStyroMiseReparation:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function adminMarkStyroRenvoye() {
    if (!isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "styro") return alert("Pas le bon chemin.");
    if (!stepStyroMiseReparationDone) return alert("Admin doit d’abord faire “Mis en réparation”.");

    try {
      const u = auth.currentUser;
      const note = (styroRenvoyeNote || "").toString().trim() || null;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        styroRenvoyeAt: serverTimestamp(),
        styroRenvoyeByUid: u?.uid || null,
        styroRenvoyeNote: note,
      });

      await logHistory?.("STYRO_RENVOYE", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
        note: note || null,
      });

      await notifDone?.(r.id, "styro_renvoye_done");
      onClose?.();
    } catch (e) {
      console.error("adminMarkStyroRenvoye:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function userConfirmStyroReceivedAndReturned() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "styro") return alert("Pas le bon chemin.");
    if (!stepStyroRenvoyeDone) return alert("Admin doit d’abord faire “Renvoyé”.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    const ok = window.confirm("Confirmer: reçu et remis dans le trailer ?");
    if (!ok) return;

    try {
      await returnToTrailerAndDelete({ whoName: who });

      await notifDone?.(r.id, "styro_returned_trailer");
      onClose?.();
    } catch (e) {
      console.error("userConfirmStyroReceivedAndReturned:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // --- PATH REPARER ---
  async function userConfirmPorteA() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if (!stepAdminDecisionDone) return alert("L’admin n’a pas encore décidé.");
    if ((actionType || "").trim() !== "reparer") return alert("Cette ligne n’est pas en mode “Aller faire réparer”.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    const where = (porterWhere || "").toString().trim();
    if (!where) return alert("“Porté à …” obligatoire.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        porterAt: serverTimestamp(),
        porterByUid: u?.uid || null,
        porterByName: who,
        porterWhere: where,
        status: "reparation",
      });

      await logHistory?.("PORTE_REPARATION", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
        extra: { who, where },
      });

      onClose?.();
    } catch (e) {
      console.error("userConfirmPorteA:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function userConfirmCherche() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "reparer") return alert("Pas le bon chemin.");
    if (!stepPorteDone) return alert("Faut d’abord faire “Je l’ai porté à …”.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        chercherAt: serverTimestamp(),
        chercherByUid: u?.uid || null,
        chercherByName: who,
      });

      await logHistory?.("CHERCHE_REPARATION", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
        extra: { who },
      });

      onClose?.();
    } catch (e) {
      console.error("userConfirmCherche:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function userConfirmPret() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "reparer") return alert("Pas le bon chemin.");
    if (!stepChercheDone) return alert("Faut d’abord faire “Je l’ai été le chercher”.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        pretAt: serverTimestamp(),
        pretByUid: u?.uid || null,
        pretByName: who,
      });

      await logHistory?.("PRET_EMPLOI", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
        extra: { who },
      });

      await notifDone?.(r.id, "ready_done");
      onClose?.();
    } catch (e) {
      console.error("userConfirmPret:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function userReturnToTrailerAfterPret() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "reparer") return alert("Pas le bon chemin.");
    if (!stepPretDone) return alert("Faut d’abord faire “Prêt à l’emploi”.");

    const who = (doneBy || "").toString().trim();
    if (!who) return alert("“Fait par” obligatoire.");

    const ok = window.confirm("Confirmer: remis dans le trailer ?");
    if (!ok) return;

    try {
      await returnToTrailerAndDelete({ whoName: who });

      await notifDone?.(r.id, "returned_trailer");
      onClose?.();
    } catch (e) {
      console.error("userReturnToTrailerAfterPret:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  const adminActionLabel =
    ((r?.adminActionType || "") + "").trim() === "reparer"
      ? "Aller le faire réparer"
      : ((r?.adminActionType || "") + "").trim() === "styro"
      ? "Envoyer à Styro"
      : "—";

  // ✅ Maintenant seulement: on peut retourner null ICI (après tous les hooks)
  if (!visible) return null;

  return (
    <div className="pt-modalOverlay" onMouseDown={onClose}>
      <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pt-modalHead">
          <div className="pt-modalTitle">Ligne du temps — Réparation</div>
          <button className="pt-modalClose" type="button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="pt-modalBody">
          <div style={{ fontWeight: 1000, marginBottom: 8 }}>{r?.nom || "—"}</div>
          <div style={{ fontSize: 13.5, fontWeight: 900, opacity: 0.85 }}>{tNom}</div>

          <Stepper />

          {/* ÉTAPE 1 — ADMIN DÉCISION */}
          {!stepAdminDecisionDone && isAdmin && status === "brise" ? (
            <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
              <div className="pt-modalLabel">Étape 1 — Décision admin</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  className={"pt-btn " + (adminChoice === "styro" ? "" : "pt-btnGhost")}
                  onClick={() => setAdminChoice("styro")}
                >
                  📦 Envoyer à Styro
                </button>
                <button
                  type="button"
                  className={"pt-btn " + (adminChoice === "reparer" ? "" : "pt-btnGhost")}
                  onClick={() => setAdminChoice("reparer")}
                >
                  🛠 Aller le faire réparer
                </button>
              </div>

              {adminChoice === "reparer" ? (
                <div style={{ marginTop: 12 }}>
                  <div className="pt-modalLabel">Numéro PO (obligatoire)</div>
                  <input className="pt-input" value={adminPo} onChange={(e) => setAdminPo(e.target.value)} placeholder="ex: PO-12345" />
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <div className="pt-modalLabel">Note (obligatoire)</div>
                <input className="pt-input" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Ex: instructions" />
              </div>
            </div>
          ) : null}

          {/* Résumé décision */}
          {stepAdminDecisionDone ? (
            <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
              <div className="pt-modalLabel">Décision admin</div>
              <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>
                {adminActionLabel}
                {(r?.adminActionPo || "").toString().trim() ? (
                  <span>
                    {" "}
                    — PO: <b>{(r?.adminActionPo || "").toString().trim()}</b>
                  </span>
                ) : null}
              </div>
              <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 850, opacity: 0.85 }}>
                Note: <b>{(r?.adminActionNote || "").toString().trim() || "—"}</b>
              </div>
            </div>
          ) : null}

          {/* CHEMIN STYRO */}
          {stepAdminDecisionDone && actionType === "styro" ? (
            <>
              {!isAdmin && !stepToStyroDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 2 — Envoyé à Styro</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>
                </div>
              ) : null}

              {isAdmin && stepToStyroDone && !stepStyroRecuDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 3 — Reçu</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <input className="pt-input" value={styroRecuNote} onChange={(e) => setStyroRecuNote(e.target.value)} placeholder="ex: reçu au bureau" />
                  </div>
                </div>
              ) : null}

              {isAdmin && stepStyroRecuDone && !stepStyroMiseReparationDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 4 — Mis en réparation</div>
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 850, opacity: 0.75 }}>
                    Quand tu confirmes, la ligne passe dans “En réparation”.
                  </div>
                </div>
              ) : null}

              {isAdmin && stepStyroMiseReparationDone && !stepStyroRenvoyeDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 5 — Renvoyé</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <input className="pt-input" value={styroRenvoyeNote} onChange={(e) => setStyroRenvoyeNote(e.target.value)} placeholder="ex: renvoyé au trailer / à Jo" />
                  </div>
                </div>
              ) : null}

              {!isAdmin && stepStyroRenvoyeDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 6 — Reçu et remis dans le trailer</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* CHEMIN ALLER FAIRE RÉPARER */}
          {stepAdminDecisionDone && actionType === "reparer" ? (
            <>
              {!isAdmin && !stepPorteDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 2 — Je l’ai porté à…</div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Porté à (obligatoire)</div>
                    <input className="pt-input" value={porterWhere} onChange={(e) => setPorterWhere(e.target.value)} placeholder="ex: Garage X / Atelier Y" />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 850, opacity: 0.75 }}>
                    Quand tu confirmes, la ligne passe dans “En réparation”.
                  </div>
                </div>
              ) : null}

              {!isAdmin && stepPorteDone && !stepChercheDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 3 — Je l’ai été le chercher</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>
                </div>
              ) : null}

              {!isAdmin && stepChercheDone && !stepPretDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 4 — Prêt à l’emploi</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>
                </div>
              ) : null}

              {!isAdmin && stepPretDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 5 — Remis dans le trailer</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par (obligatoire)</div>
                    <input className="pt-input" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} placeholder="ex: Jo / Phil" />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="pt-modalFoot">
          {!stepAdminDecisionDone && isAdmin && status === "brise" ? (
            <button className="pt-btn" type="button" onClick={adminConfirmDecision}>
              Confirmer décision admin
            </button>
          ) : null}

          {stepAdminDecisionDone && actionType === "styro" ? (
            <>
              {!isAdmin && !stepToStyroDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmSentToStyro}>
                  Confirmer: Envoyé à Styro
                </button>
              ) : null}

              {isAdmin && stepToStyroDone && !stepStyroRecuDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroRecu}>
                  Confirmer: Reçu
                </button>
              ) : null}

              {isAdmin && stepStyroRecuDone && !stepStyroMiseReparationDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroMiseReparation}>
                  Confirmer: Mis en réparation
                </button>
              ) : null}

              {isAdmin && stepStyroMiseReparationDone && !stepStyroRenvoyeDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroRenvoye}>
                  Confirmer: Renvoyé
                </button>
              ) : null}

              {!isAdmin && stepStyroRenvoyeDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmStyroReceivedAndReturned}>
                  Confirmer: Reçu & remis trailer
                </button>
              ) : null}
            </>
          ) : null}

          {stepAdminDecisionDone && actionType === "reparer" ? (
            <>
              {!isAdmin && !stepPorteDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmPorteA}>
                  Confirmer: Porté à…
                </button>
              ) : null}

              {!isAdmin && stepPorteDone && !stepChercheDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmCherche}>
                  Confirmer: Été le chercher
                </button>
              ) : null}

              {!isAdmin && stepChercheDone && !stepPretDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmPret}>
                  Confirmer: Prêt à l’emploi
                </button>
              ) : null}

              {!isAdmin && stepPretDone ? (
                <button className="pt-btn" type="button" onClick={userReturnToTrailerAfterPret}>
                  Confirmer: Remis dans le trailer
                </button>
              ) : null}
            </>
          ) : null}

          <button className="pt-btn pt-btnGhost" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
