// src/PanelReparations.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { auth, db } from "./firebaseConfig";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  setDoc,
} from "firebase/firestore";

import RepairTimelineModal from "./RepairTimelineModal";

function shorten(s, max = 60) {
  const str = (s || "").toString().trim();
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
function norm(s) {
  return (s || "").toString().trim().toLowerCase();
}
function isUniteLabel(label) {
  const n = norm(label);
  return n === "unite" || n === "unité" || n.includes("unité") || n.includes("unite");
}

function optionLabelForEquipement(eq, catsGlobal) {
  const head = (eq?.nom || "").trim() || "—";
  const extras = [];

  const catId = (eq?.categorieId || "").trim();
  const cat = (catsGlobal || []).find((c) => (c.id || "").trim() === catId) || null;

  const fieldsRaw = Array.isArray(cat?.fields) ? cat.fields : [];
  const fields = fieldsRaw
    .map((f) => {
      if (!f) return null;
      if (typeof f === "string") return null;
      if (typeof f === "object") return { id: (f.id || "").toString(), nom: (f.nom || "").toString() };
      return null;
    })
    .filter((f) => f && f.id && f.nom && f.nom.trim());

  const details = eq?.details || {};
  for (const f of fields) {
    const v = (details?.[f.id] ?? "").toString().trim();
    if (!v) continue;
    extras.push(`${f.nom}: ${shorten(v)}`);
  }

  const hasUniteField = fields.some((f) => isUniteLabel(f.nom));
  const uniteLegacy = (eq?.unite || "").toString().trim();
  if (uniteLegacy && !hasUniteField) extras.push(`Unité: ${shorten(uniteLegacy)}`);

  return extras.length ? `${head} — ${extras.join(" • ")}` : head;
}

function Portal({ children, enabled }) {
  if (!enabled) return null;
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/**
 * ✅ Détection "À QUI DE RÉPONDRE" (clignotant rouge)
 * - Travailleur:
 *   - adminActionType = envoyer à Styro  => worker doit confirmer (toStyroAt vide)
 *   - adminActionType = aller porter réparateur => worker doit confirmer (porterAt vide)
 *   - pretAt rempli mais chercherAt vide => worker doit aller chercher / confirmer
 *   - suivi (followUpText) sur "brisé à jeté" => worker doit confirmer/voir
 *   - styroRenvoyeAt rempli => worker doit confirmer "Reçu et remis dans le trailer"
 * - Admin:
 *   - status "brise" sans adminActionType => admin doit décider quoi faire
 *   - toStyroAt rempli mais styroRecuAt vide => admin doit confirmer réception à Styro
 *   - ✅ NEW: needsAdminRepairConfirm true (ou styroRecuAt fait mais pas styroMiseReparationAt) => admin doit faire Étape 5 "Mettre en réparation"
 */
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

      // ✅ NEW: Étape 7 (après renvoyé)
      if (isActionStyro && !!r?.styroRenvoyeAt) {
        return { needsMe: true, label: "À répondre: remis trailer", kind: "styro_return" };
      }

      if (isActionPorter && !r?.porterAt) {
        return { needsMe: true, label: "À répondre: aller porter", kind: "porter" };
      }
    }

    if (r?.pretAt && !r?.chercherAt) {
      return { needsMe: true, label: "À répondre: aller chercher", kind: "pickup" };
    }

    return { needsMe: false, label: "", kind: "" };
  }

  // ✅ Admin
  if (status === "brise" && !adminActionType) {
    return { needsMe: true, label: "À répondre: décider action", kind: "admin_decide" };
  }

  if (r?.toStyroAt && !r?.styroRecuAt) {
    return { needsMe: true, label: "À répondre: réception Styro", kind: "admin_styro_receive" };
  }

  // ✅ NEW: Étape 5 tant que non confirmé => ORANGE + "à répondre"
  // On supporte le flag officiel + fallback logique (styro reçu mais pas mis en réparation)
  const needsRepairConfirm =
    !!r?.needsAdminRepairConfirm || (isActionStyro && !!r?.styroRecuAt && !r?.styroMiseReparationAt && status === "brise");

  if (needsRepairConfirm) {
    return { needsMe: true, label: "À répondre: mettre en réparation", kind: "admin_repair_confirm" };
  }

  return { needsMe: false, label: "", kind: "" };
}

export default function PanelReparations({ trailerId, trailerNom = "", isAdmin, equipements, catsGlobal = [] }) {
  const [rows, setRows] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const [dropOpen, setDropOpen] = useState(false);
  const [dropPayload, setDropPayload] = useState(null);
  const [dropQty, setDropQty] = useState(1);
  const [dropDest, setDropDest] = useState("brise");

  const [suiviOpen, setSuiviOpen] = useState(false);
  const [suiviRow, setSuiviRow] = useState(null);
  const [suiviText, setSuiviText] = useState("");

  const [suiviViewOpen, setSuiviViewOpen] = useState(false);
  const [suiviViewRow, setSuiviViewRow] = useState(null);

  const [tlOpen, setTlOpen] = useState(false);
  const [tlRow, setTlRow] = useState(null);

  function openTimeline(r) {
    setTlRow(r);
    setTlOpen(true);
  }
  function closeTimeline() {
    setTlOpen(false);
    setTlRow(null);
  }

  function getRowTrailerId(r) {
    if (isAdmin) return (r?.__trailerId || r?.trailerId || "").toString().trim() || null;
    return (trailerId || "").toString().trim() || null;
  }
  function getRowTrailerNom(r) {
    const tn = (r?.trailerNom || "").toString().trim();
    if (tn) return tn;
    const prop = (trailerNom || "").toString().trim();
    return prop || "—";
  }

  async function notifDone(repId, doneAction = "treated") {
    const id = (repId || "").toString().trim();
    if (!id) return;
    try {
      await updateDoc(doc(db, "notifications", id), {
        done: true,
        doneAt: serverTimestamp(),
        doneByUid: auth.currentUser?.uid || null,
        doneAction: doneAction || "treated",
      });
    } catch {
      // ignore
    }
  }

  async function notifOpenOrUpdate(repId, payload = {}) {
    const id = (repId || "").toString().trim();
    if (!id) return;
    try {
      await setDoc(
        doc(db, "notifications", id),
        {
          targetRole: "admin",
          done: false,
          createdAt: serverTimestamp(),
          createdByUid: auth.currentUser?.uid || null,
          ...payload,
        },
        { merge: true }
      );
    } catch (e) {
      console.error("notifOpenOrUpdate error:", e);
    }
  }

  async function logHistory(eventName, payload = {}) {
    try {
      const u = auth.currentUser;

      const tId = (payload?.trailerId || trailerId || null) ?? null;
      const tNom = (payload?.trailerNom || trailerNom || "—").toString().trim() || "—";

      await addDoc(collection(db, "reparations_history"), {
        ts: serverTimestamp(),
        trackId: payload?.trackId || null,
        trailerId: tId,
        trailerNom: tNom,
        byUid: u?.uid || null,
        event: (eventName || "").toString().trim() || "—",
        nom: payload?.nom ?? null,
        qty: payload?.qty ?? null,
        status: payload?.status ?? null,
        equipementId: payload?.equipementId ?? null,
        note: payload?.note ?? null,
        po: payload?.po ?? null,
        followUpText: payload?.followUpText ?? null,
        from: payload?.from ?? null,
        extra: payload?.extra ?? null,
      });
    } catch (e) {
      console.error("logHistory error:", e);
    }
  }

  // ✅ reset + snapshot
  useEffect(() => {
    setRows([]);
    setDragOver(false);

    setDropOpen(false);
    setDropPayload(null);
    setDropQty(1);
    setDropDest("brise");

    setSuiviOpen(false);
    setSuiviRow(null);
    setSuiviText("");

    setSuiviViewOpen(false);
    setSuiviViewRow(null);

    setTlOpen(false);
    setTlRow(null);

    if (isAdmin) {
      const qAll = query(collectionGroup(db, "reparations"), orderBy("createdAt", "desc"));
      return onSnapshot(
        qAll,
        (snap) => {
          const mapped = snap.docs.map((d) => {
            const tId = d.ref?.parent?.parent?.id || null;
            return { id: d.id, ...d.data(), __trailerId: tId };
          });
          setRows(mapped);
        },
        (err) => console.error("reparations (admin global) snapshot:", err)
      );
    }

    if (!trailerId) return;

    const qR = query(collection(db, "trailers", trailerId, "reparations"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qR,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data(), __trailerId: trailerId }))),
      (err) => console.error("reparations snapshot:", err)
    );
  }, [isAdmin, trailerId]);

  const equipOptions = useMemo(() => {
    return [...(equipements || [])].sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  }, [equipements]);

  const broken = useMemo(() => rows.filter((r) => r.status === "brise"), [rows]);
  const trashed = useMemo(() => rows.filter((r) => r.status === "jete"), [rows]);
  const inRepair = useMemo(() => rows.filter((r) => r.status === "reparation"), [rows]);

  function findEquipById(id) {
    const eid = (id || "").toString().trim();
    return equipOptions.find((e) => (e.id || "").toString().trim() === eid) || null;
  }

  // ---------- Dates ----------
  function fmtDateFR(d) {
    if (!d) return "—";
    try {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = String(d.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return "—";
    }
  }
  function dateFromTs(ts) {
    if (!ts) return null;
    if (typeof ts?.toDate === "function") return ts.toDate();
    if (ts instanceof Date) return ts;
    const n = Number(ts);
    if (Number.isFinite(n)) return new Date(n);
    return null;
  }
  function rowDate(r) {
    return fmtDateFR(dateFromTs(r?.createdAt));
  }
  function rowStyroRecuDate(r) {
    return fmtDateFR(dateFromTs(r?.styroRecuAt));
  }

  function stripCaracteristiquePrefix(s) {
    const v = (s ?? "").toString().trim();
    if (!v) return "";
    return v.replace(/^\s*caract[ée]ristique\s*[:=\-]\s*/i, "").trim();
  }

  function fieldsTextForRow(r) {
    const eq = findEquipById(r?.equipementId);
    if (!eq) return "";

    const label = optionLabelForEquipement(eq, catsGlobal);
    const head = (eq?.nom || "").trim() || "—";
    if (label === head) return "";

    const prefix = head + " — ";
    if (label.startsWith(prefix)) {
      return label.slice(prefix.length).trim();
    }
    return "";
  }

  function toFRNumberString(x) {
    const s = (x ?? "").toString().trim();
    if (!s) return "";
    if (/^\d+(\.\d+)?$/.test(s)) return s.replace(".", ",");
    return s.replace(/(\d+)\.(\d+)/g, "$1,$2");
  }

  function cleanValueOnly(text) {
    let t = (text ?? "").toString().trim();
    if (!t) return "";

    const idx = t.indexOf(":");
    if (idx >= 0) t = t.slice(idx + 1).trim();

    t = t.replace(/^\s*(courant|current)\s*[:=\-]\s*/i, "").trim();
    t = toFRNumberString(t);

    t = t.replace(/\s*(amps?|amp|a)\b/gi, " Amp");
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/\bamp\b/gi, "Amp");
    t = t.replace(/(\d)(Amp)\b/g, "$1 $2");

    return t;
  }

  function inlineCaracteristiqueForRow(r) {
    const raw = stripCaracteristiquePrefix(fieldsTextForRow(r));
    if (!raw) return "";

    const parts = raw
      .split("•")
      .map((p) => p.trim())
      .filter(Boolean);

    const pick = parts.find((p) => /courant|amp|amperage|amp[eé]rage|current/i.test(p)) || parts[0] || "";
    return cleanValueOnly(stripCaracteristiquePrefix(pick));
  }

  function getDetail(details, keys) {
    const d = details || {};
    for (const k of keys) {
      const v = (d?.[k] ?? "").toString().trim();
      if (v) return v;
    }
    return "";
  }

  function equipMetaForRow(r) {
    const eq = findEquipById(r?.equipementId);
    if (!eq) return { line: "", remarque: "" };

    const details = eq?.details || {};

    const produit = getDetail(details, ["produit", "product", "item"]);
    const caracteristique = stripCaracteristiquePrefix(
      getDetail(details, ["caracteristique", "caractéristique", "spec", "specification", "feature", "courant", "amp", "amperage"])
    );

    const marque = getDetail(details, ["marque", "brand", "manufacturer", "make"]);
    const modele = getDetail(details, ["modele", "modèle", "model"]);
    const serie = getDetail(details, ["serie", "série", "serial", "sn", "s/n", "numeroSerie", "numSerie", "vin"]);
    const dimension = getDetail(details, ["dimension", "dimensions", "taille", "size"]);

    const parts = [];
    if (produit) parts.push(produit);
    if (caracteristique) parts.push(cleanValueOnly(caracteristique));
    if (marque) parts.push(`Marque: ${marque}`);
    if (modele) parts.push(`Modèle: ${modele}`);
    if (serie) parts.push(`Série: ${serie}`);
    if (dimension) parts.push(`Dim: ${dimension}`);

    const remarque = (eq?.remarque ?? eq?.note ?? details?.remarque ?? details?.note ?? "").toString().trim() || "";
    return { line: parts.join(" • "), remarque };
  }

  async function removeRow(r) {
    const tId = getRowTrailerId(r);
    if (!tId || !r?.id) return;

    const ok = window.confirm("Supprimer cette ligne ?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "trailers", tId, "reparations", r.id));

      await logHistory("SUPPRIME", {
        trailerId: tId,
        trailerNom: getRowTrailerNom(r),
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: (r?.status || "").toString().trim() || null,
        equipementId: r?.equipementId || null,
        note: r?.note || null,
        po: r?.po || null,
        followUpText: r?.followUpText || null,
        from: r?.from || null,
      });

      await notifDone(r.id, "deleted");
    } catch (e) {
      console.error("removeRow:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  function openSuiviModal(r) {
    if (!isAdmin) return;
    setSuiviRow(r);
    setSuiviText("");
    setSuiviOpen(true);
  }

  async function confirmSuivi() {
    if (!isAdmin) return;
    if (!suiviRow?.id) return;

    const tId = getRowTrailerId(suiviRow);
    if (!tId) return alert("Trailer manquant sur cette ligne.");

    const text = (suiviText || "").toString().trim();
    if (!text) return alert("Écris quoi faire (obligatoire).");

    try {
      const u = auth.currentUser;
      await updateDoc(doc(db, "trailers", tId, "reparations", suiviRow.id), {
        followUpText: text,
        followUpAt: serverTimestamp(),
        followUpByUid: u?.uid || null,
      });

      await logHistory("SUIVI", {
        trailerId: tId,
        trailerNom: getRowTrailerNom(suiviRow),
        trackId: suiviRow.id,
        nom: suiviRow?.nom || "—",
        qty: Number(suiviRow?.qty || 0),
        status: (suiviRow?.status || "").toString().trim() || "jete",
        equipementId: suiviRow?.equipementId || null,
        followUpText: text,
        from: suiviRow?.from || null,
      });

      await notifDone(suiviRow.id, "suivi_written");

      setSuiviOpen(false);
      setSuiviRow(null);
      setSuiviText("");
    } catch (e) {
      console.error("confirmSuivi:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  function openSuiviViewModal(r) {
    setSuiviViewRow(r);
    setSuiviViewOpen(true);
  }

  function parseDroppedPayload(e) {
    try {
      const raw = e.dataTransfer.getData("application/x-gyrotech-item") || e.dataTransfer.getData("text/plain") || "";
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || obj.type !== "trailer_item") return null;
      return obj;
    } catch {
      return null;
    }
  }

  function openDropModal(payload) {
    const available = Number(payload?.qty || 0);
    if (!Number.isFinite(available) || available <= 0) return alert("Quantité invalide sur l’item (0).");

    setDropPayload(payload);
    setDropQty(1);
    setDropDest("brise");
    setDropOpen(true);
  }

  async function confirmDropToBroken() {
    if (!trailerId) return;
    const u = auth.currentUser;
    if (!u) return alert("Non connecté.");
    if (!dropPayload) return;

    const qn = Number(dropQty || 0);
    if (!Number.isFinite(qn) || qn <= 0) return alert("Quantité invalide (min 1).");

    const nom = (dropPayload?.nom || "").toString().trim() || "—";
    const equipementId = (dropPayload?.equipementId || "").toString().trim() || null;

    const catId = (dropPayload?.catId || "").toString().trim();
    const itemId = (dropPayload?.itemId || "").toString().trim();
    if (!catId || !itemId) return alert("Payload incomplet (catId/itemId).");

    const status = dropDest === "jete" ? "jete" : "brise";
    const safeTrailerNom = (trailerNom || "").toString().trim() || "—";
    const historyEvent = status === "jete" ? "AJOUT_JETE" : "AJOUT_BRISE";

    try {
      await runTransaction(db, async (tx) => {
        const itemRef = doc(db, "trailers", trailerId, "categories", catId, "items", itemId);
        const snap = await tx.get(itemRef);
        if (!snap.exists()) throw new Error("Item introuvable (il a peut-être déjà été modifié).");

        const currentQty = Number(snap.data()?.qty || 0);
        if (!Number.isFinite(currentQty) || currentQty <= 0) throw new Error("Quantité actuelle invalide (0).");
        if (qn > currentQty) throw new Error(`Quantité trop grande. Dispo: ${currentQty}`);

        const remaining = currentQty - qn;
        if (remaining <= 0) tx.delete(itemRef);
        else tx.update(itemRef, { qty: remaining });

        const repRef = doc(collection(db, "trailers", trailerId, "reparations"));
        tx.set(repRef, {
          trackId: repRef.id,
          status,
          equipementId: equipementId || null,
          nom,
          qty: qn,
          trailerNom: safeTrailerNom,
          createdAt: serverTimestamp(),
          createdByUid: u.uid,
          source: "dragdrop",
          from: { catId, itemId },

          adminActionType: null,
          adminActionNote: null,
          adminActionPo: null,
          adminActionAt: null,
          adminActionByUid: null,

          porterAt: null,
          porterByUid: null,
          porterByName: null,
          porterWhere: null,

          chercherAt: null,
          chercherByUid: null,
          chercherByName: null,

          pretAt: null,
          pretByUid: null,
          pretByName: null,

          toStyroAt: null,
          toStyroByUid: null,
          toStyroByName: null,

          styroRecuAt: null,
          styroRecuByUid: null,
          styroRecuNote: null,

          needsAdminRepairConfirm: false, // ✅ NEW: flag ORANGE (étape 5)

          styroMiseReparationAt: null,
          styroMiseReparationByUid: null,

          styroRenvoyeAt: null,
          styroRenvoyeByUid: null,
          styroRenvoyeTo: null,
          styroRenvoyeNote: null,
        });

        const hRef = doc(collection(db, "reparations_history"));
        tx.set(hRef, {
          ts: serverTimestamp(),
          trackId: repRef.id,
          trailerId: trailerId || null,
          trailerNom: safeTrailerNom,
          byUid: u.uid,
          event: historyEvent,
          nom,
          qty: qn,
          status,
          equipementId: equipementId || null,
          from: { catId, itemId },
          extra: {
            trailerQtyBefore: currentQty,
            trailerQtyAfter: remaining <= 0 ? 0 : remaining,
          },
        });

        if (!isAdmin) {
          const nRef = doc(db, "notifications", repRef.id);
          tx.set(nRef, {
            targetRole: "admin",
            done: false,
            createdAt: serverTimestamp(),
            createdByUid: u.uid,
            type: "reparation_added",
            status,
            trailerId: trailerId || null,
            trailerNom: safeTrailerNom,
            repId: repRef.id,
            nom,
            qty: qn,
            source: "dragdrop_non_admin",
          });
        }
      });

      setDropOpen(false);
      setDropPayload(null);
      setDropQty(1);
      setDropDest("brise");
    } catch (e) {
      console.error("confirmDropToBroken:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
    e.dataTransfer.dropEffect = "move";
  }
  function onDragLeave() {
    setDragOver(false);
  }
  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const payload = parseDroppedPayload(e);
    if (!payload) return;
    openDropModal(payload);
  }

  const canUse = !!trailerId;

  function renderExtraLine(r) {
    const meta = equipMetaForRow(r);
    const line = (meta.line || "").trim();
    const rm = (meta.remarque || "").trim();
    if (!line && !rm) return null;

    return (
      <div style={{ marginTop: 3, fontSize: 11, fontWeight: 750, color: "rgba(15,23,42,0.70)", lineHeight: 1.2 }}>
        {line ? <div>{line}</div> : null}
        {rm ? (
          <div style={{ marginTop: line ? 3 : 0, color: "rgba(15,23,42,0.66)" }}>
            Remarque: <b>{rm.length > 60 ? rm.slice(0, 60) + "…" : rm}</b>
          </div>
        ) : null}
      </div>
    );
  }

  function TinyX({ onClick }) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        title="Supprimer"
        aria-label="Supprimer"
        style={{
          height: 22,
          minWidth: 22,
          padding: "0 6px",
          borderRadius: 999,
          border: "1px solid rgba(239,68,68,0.35)",
          background: "rgba(239,68,68,0.10)",
          color: "rgba(185,28,28,0.95)",
          fontSize: 12,
          fontWeight: 1000,
          lineHeight: "20px",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    );
  }

  function ReparRow({ r, actions, onOpen, alertInfo }) {
    const car = inlineCaracteristiqueForRow(r);
    const tName = getRowTrailerNom(r);
    const needs = !!alertInfo?.needsMe;
    const label = (alertInfo?.label || "").toString().trim();

    const orangeWaiting =
      r?.status === "brise" && (!!r?.needsAdminRepairConfirm || (!!r?.styroRecuAt && !r?.styroMiseReparationAt));

    const orangeDate = orangeWaiting ? rowStyroRecuDate(r) : "";

    return (
      <div
        className={`pr-row ${needs ? "pr-rowAlert" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpen?.(r)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen?.(r);
          }
        }}
        style={{
          padding: "10px 12px",
          margin: "0 0 10px 0",
          cursor: "pointer",

          // ✅ ORANGE dans le tableau "Brisé" tant que l’admin n’a pas confirmé Étape 5
          background: orangeWaiting ? "rgba(249,115,22,0.14)" : undefined,
          border: orangeWaiting ? "1px solid rgba(249,115,22,0.30)" : undefined,
          borderRadius: orangeWaiting ? 14 : undefined,
        }}
        title={orangeWaiting ? `À mettre en réparation (reçu: ${orangeDate || "—"})` : needs ? label || "À répondre" : "Ouvrir la réparation"}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 13.5, fontWeight: 1000, opacity: 0.9, minWidth: 0 }}>{tName}</div>

              {needs ? (
                <span className="replyBlinkPill" title={label || "À répondre"}>
                  <span className="replyBlinkDot" />
                  {label || "À répondre"}
                </span>
              ) : null}

              {/* ✅ Petit indicateur ORANGE + date dans la case */}
              {orangeWaiting ? (
                <span
                  style={{
                    marginLeft: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(249,115,22,0.30)",
                    background: "rgba(249,115,22,0.12)",
                    fontWeight: 1000,
                    fontSize: 12,
                    color: "rgba(124,45,18,0.95)",
                    whiteSpace: "nowrap",
                  }}
                  title="Étape 5 en attente — Mettre en réparation"
                >
                  ⏳ En attente (reçu {orangeDate || "—"})
                </span>
              ) : null}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", lineHeight: 1.15 }}>
              <div className="pr-rowName" style={{ margin: 0, fontSize: 15, fontWeight: 1000 }}>
                {r.nom || "—"}
              </div>
              {car ? <div style={{ fontWeight: 1000, fontSize: 15, lineHeight: 1.15 }}>{car}</div> : null}
            </div>

            {renderExtraLine(r)}

            <div
              className="pr-rowMeta"
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 6,
                fontSize: 12.5,
                fontWeight: 850,
                opacity: 0.98,
                lineHeight: 1.15,
              }}
            >
              <span>
                <b>{rowDate(r)}</b>
              </span>
              <span>
                Qté: <b>{Number(r.qty || 0)}</b>
              </span>

              {/* ✅ Date aussi dans la zone "meta" (au cas où tu veux juste voir ici) */}
              {orangeWaiting ? (
                <span style={{ fontWeight: 1000, color: "rgba(124,45,18,0.95)" }}>
                  Reçu: <b>{orangeDate || "—"}</b>
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", paddingTop: 2 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}
            >
              {actions}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ✅ lock scroll si un des modals locaux est ouvert
  const localModalOpen = dropOpen || suiviOpen || suiviViewOpen;
  useEffect(() => {
    if (!localModalOpen) return;
    const prev = document?.body?.style?.overflow;
    if (document?.body) document.body.style.overflow = "hidden";
    return () => {
      if (document?.body) document.body.style.overflow = prev || "";
    };
  }, [localModalOpen]);

  // ✅ Compte "à répondre" pour l'utilisateur connecté (admin ou travailleur)
  const myTurnCount = useMemo(() => {
    return (rows || []).reduce((acc, r) => {
      const info = computeTurnInfo(r, !!isAdmin);
      return acc + (info.needsMe ? 1 : 0);
    }, 0);
  }, [rows, isAdmin]);

  // ✅ broadcast pour App.jsx (topbar flash)
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("app_turn_alert", { detail: { count: myTurnCount } }));
    } catch {
      // ignore
    }
  }, [myTurnCount]);

  return (
    <div className="pr-rail">
      <div className="pr-card pr-headCard">
        <div className="pr-headTop">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="pr-title">Bris / Réparation</div>

              {myTurnCount > 0 ? (
                <span className="replyBlinkPill" title="Tu as des actions à faire">
                  <span className="replyBlinkDot" />
                  À répondre: {myTurnCount}
                </span>
              ) : null}
            </div>

            {isAdmin ? (
              <div style={{ marginTop: 2, fontSize: 12, opacity: 0.75 }}>
                Vue admin: <b>tous les trailers</b>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`pr-dropZone ${dragOver ? "pr-dropZoneOver" : ""} ${!canUse ? "pr-dropZoneDisabled" : ""}`}
          onDragOver={canUse ? onDragOver : undefined}
          onDragLeave={canUse ? onDragLeave : undefined}
          onDrop={canUse ? onDrop : undefined}
          title={canUse ? "Dépose un item du tableau ici" : "Choisis un trailer"}
        >
          <div className="pr-dropIcon">⤓</div>
          <div className="pr-dropText">
            <div className="pr-dropTitle">Déposer ici</div>
          </div>
        </div>
      </div>

      <div className="pr-card">
        <div className="pr-sectionHead">
          <div className="pr-sectionTitle">
            <span className="pr-dot pr-dotRed" /> Brisé
          </div>
          <div className="pr-sectionMeta">
            {broken.length} item{broken.length > 1 ? "s" : ""}
          </div>
        </div>

        {broken.length === 0 ? (
          <div className="pr-empty">Aucun item brisé.</div>
        ) : (
          <div className="pr-list">
            {broken.map((r) => {
              const alertInfo = computeTurnInfo(r, !!isAdmin);
              return (
                <ReparRow
                  key={`${r.__trailerId || "t"}_${r.id}`}
                  r={r}
                  onOpen={openTimeline}
                  alertInfo={alertInfo}
                  actions={
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <TinyX onClick={() => removeRow(r)} />
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="pr-card">
        <div className="pr-sectionHead">
          <div className="pr-sectionTitle">
            <span className="pr-dot pr-dotRed" style={{ opacity: 0.7 }} /> Brisé à jeté
          </div>
          <div className="pr-sectionMeta">
            {trashed.length} item{trashed.length > 1 ? "s" : ""}
          </div>
        </div>

        {trashed.length === 0 ? (
          <div className="pr-empty">Aucun item brisé à jeté.</div>
        ) : (
          <div className="pr-list">
            {trashed.map((r) => {
              const hasFollowUp = !!(r?.followUpText || "").toString().trim();
              const alertInfo = computeTurnInfo(r, !!isAdmin);

              return (
                <div
                  key={`${r.__trailerId || "t"}_${r.id}`}
                  style={
                    hasFollowUp
                      ? {
                          background: "rgba(245, 158, 11, 0.15)",
                          border: "1px solid rgba(245, 158, 11, 0.30)",
                          borderRadius: 14,
                          padding: 0,
                        }
                      : undefined
                  }
                >
                  <ReparRow
                    r={r}
                    onOpen={openTimeline}
                    alertInfo={alertInfo}
                    actions={
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {isAdmin && !hasFollowUp ? (
                          <button
                            className="pr-btn pr-btnGhost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSuiviModal(r);
                            }}
                          >
                            📝 Suivi
                          </button>
                        ) : null}

                        {!isAdmin && hasFollowUp ? (
                          <button
                            className="pr-btn pr-btnGhost"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSuiviViewModal(r);
                            }}
                          >
                            ✅ Confirmer
                          </button>
                        ) : null}

                        <TinyX onClick={() => removeRow(r)} />
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="pr-card">
        <div className="pr-sectionHead">
          <div className="pr-sectionTitle">
            <span className="pr-dot pr-dotAmber" /> En réparation
          </div>
          <div className="pr-sectionMeta">
            {inRepair.length} item{inRepair.length > 1 ? "s" : ""}
          </div>
        </div>

        {inRepair.length === 0 ? (
          <div className="pr-empty">Aucun item en réparation.</div>
        ) : (
          <div className="pr-list">
            {inRepair.map((r) => {
              const alertInfo = computeTurnInfo(r, !!isAdmin);
              return (
                <ReparRow
                  key={`${r.__trailerId || "t"}_${r.id}`}
                  r={r}
                  onOpen={openTimeline}
                  alertInfo={alertInfo}
                  actions={
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <TinyX onClick={() => removeRow(r)} />
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ✅ Modal drop => PORTAL */}
      <Portal enabled={dropOpen && !!dropPayload}>
        {dropOpen && dropPayload ? (
          <div className="pt-modalOverlay" onMouseDown={() => setDropOpen(false)}>
            <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
              <div className="pt-modalHead">
                <div className="pt-modalTitle">Drag & drop</div>
                <button className="pt-modalClose" type="button" onClick={() => setDropOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="pt-modalBody">
                <div style={{ fontWeight: 1000, marginBottom: 8 }}>{dropPayload.nom || "—"}</div>
                <div style={{ opacity: 0.75, marginBottom: 12 }}>
                  Dispo dans le trailer: <b>{Number(dropPayload.qty || 0)}</b>
                </div>

                <div className="pt-modalBlock" style={{ background: "#fff" }}>
                  <div className="pt-modalLabel">Type</div>
                  <select className="pt-select" value={dropDest} onChange={(e) => setDropDest(e.target.value)}>
                    <option value="brise">Brisé</option>
                    <option value="jete">Brisé à jeté</option>
                  </select>

                  <div className="pt-modalLabel" style={{ marginTop: 10 }}>
                    Quantité
                  </div>
                  <input
                    className="pt-input pt-noSpin"
                    type="number"
                    min="1"
                    max={Number(dropPayload.qty || 0) || undefined}
                    value={dropQty}
                    onChange={(e) => setDropQty(e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>

              <div className="pt-modalFoot">
                <button className="pt-btn" type="button" onClick={confirmDropToBroken}>
                  Confirmer
                </button>
                <button className="pt-btn pt-btnGhost" type="button" onClick={() => setDropOpen(false)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Portal>

      {/* ✅ Modal Suivi (ADMIN) => PORTAL */}
      <Portal enabled={suiviOpen && !!suiviRow && isAdmin}>
        {suiviOpen && suiviRow && isAdmin ? (
          <div className="pt-modalOverlay" onMouseDown={() => setSuiviOpen(false)}>
            <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
              <div className="pt-modalHead">
                <div className="pt-modalTitle">Suivi — Brisé à jeté</div>
                <button className="pt-modalClose" type="button" onClick={() => setSuiviOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="pt-modalBody">
                <div style={{ fontWeight: 1000, marginBottom: 8 }}>{suiviRow.nom || "—"}</div>
                <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 1000, opacity: 0.9 }}>{getRowTrailerNom(suiviRow)}</div>

                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 10 }}>
                  <div className="pt-modalLabel">Quoi faire ?</div>
                  <textarea
                    className="pt-input"
                    style={{ minHeight: 110, resize: "vertical" }}
                    value={suiviText}
                    onChange={(e) => setSuiviText(e.target.value)}
                    placeholder="Ex: Apporter au bureau / envoyer photo / demander à Phil / etc."
                  />
                </div>
              </div>

              <div className="pt-modalFoot">
                <button className="pt-btn" type="button" onClick={confirmSuivi}>
                  Confirmer
                </button>
                <button className="pt-btn pt-btnGhost" type="button" onClick={() => setSuiviOpen(false)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Portal>

      {/* ✅ Modal Confirmer (lecture) => PORTAL */}
      <Portal enabled={suiviViewOpen && !!suiviViewRow}>
        {suiviViewOpen && suiviViewRow ? (
          <div className="pt-modalOverlay" onMouseDown={() => setSuiviViewOpen(false)}>
            <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
              <div className="pt-modalHead">
                <div className="pt-modalTitle">Confirmer — Suivi</div>
                <button className="pt-modalClose" type="button" onClick={() => setSuiviViewOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="pt-modalBody">
                <div style={{ fontWeight: 1000, marginBottom: 8 }}>{suiviViewRow.nom || "—"}</div>
                <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 1000, opacity: 0.9 }}>{getRowTrailerNom(suiviViewRow)}</div>

                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 10 }}>
                  <div className="pt-modalLabel">À faire</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                    {(suiviViewRow.followUpText || "").toString().trim() || "—"}
                  </div>
                </div>
              </div>

              <div className="pt-modalFoot">
                <button className="pt-btn" type="button" onClick={() => setSuiviViewOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Portal>

      {/* ✅ Timeline modal (déjà en PORTAL dans RepairTimelineModal) */}
      <RepairTimelineModal
        open={tlOpen}
        onClose={closeTimeline}
        row={tlRow}
        isAdmin={isAdmin}
        getRowTrailerId={getRowTrailerId}
        getRowTrailerNom={getRowTrailerNom}
        findEquipById={findEquipById}
        logHistory={logHistory}
        notifDone={notifDone}
        notifOpenOrUpdate={notifOpenOrUpdate}
      />
    </div>
  );
}
