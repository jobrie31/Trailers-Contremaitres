// src/PanelReparations.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebaseConfig";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

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

/**
 * Reproduit le label riche (Produit + fields) utilisé dans PageTrailers
 * Retourne: "Nom — Champ: valeur • Champ2: valeur2"
 */
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

export default function PanelReparations({ trailerId, trailerNom = "", isAdmin, equipements, catsGlobal = [] }) {
  const [rows, setRows] = useState([]);

  const [po, setPo] = useState("");
  const [endroit, setEndroit] = useState("");
  const [note, setNote] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveRow, setMoveRow] = useState(null);

  const [dragOver, setDragOver] = useState(false);

  // ✅ Modal drop -> choisir quantité + destination (brisé / jeté)
  const [dropOpen, setDropOpen] = useState(false);
  const [dropPayload, setDropPayload] = useState(null);
  const [dropQty, setDropQty] = useState(1);
  const [dropDest, setDropDest] = useState("brise"); // "brise" | "jete"

  // ✅ Suivi (Brisé à jeté)
  const [suiviOpen, setSuiviOpen] = useState(false);
  const [suiviRow, setSuiviRow] = useState(null);
  const [suiviText, setSuiviText] = useState("");

  // ✅ Popup "Confirmer" (lecture pour l’instant)
  const [suiviViewOpen, setSuiviViewOpen] = useState(false);
  const [suiviViewRow, setSuiviViewRow] = useState(null);

  // -------------------------
  // Historique helper
  // -------------------------
  async function logHistory(eventName, payload = {}) {
    try {
      const u = auth.currentUser;
      await addDoc(collection(db, "reparations_history"), {
        ts: serverTimestamp(),
        trackId: payload?.trackId || null,
        trailerId: trailerId || null,
        trailerNom: (trailerNom || "").toString().trim() || payload?.trailerNom || "—",
        byUid: u?.uid || null,

        event: (eventName || "").toString().trim() || "—",

        // champs communs utiles
        nom: payload?.nom ?? null,
        qty: payload?.qty ?? null,
        status: payload?.status ?? null,
        equipementId: payload?.equipementId ?? null,

        // détails optionnels
        note: payload?.note ?? null,
        po: payload?.po ?? null,
        endroit: payload?.endroit ?? null,
        followUpText: payload?.followUpText ?? null,
        from: payload?.from ?? null,
        extra: payload?.extra ?? null,
      });
    } catch (e) {
      console.error("logHistory error:", e);
    }
  }

  useEffect(() => {
    setRows([]);
    setMoveOpen(false);
    setMoveRow(null);
    setPo("");
    setEndroit("");
    setNote("");
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

    if (!trailerId) return;

    const qR = query(collection(db, "trailers", trailerId, "reparations"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qR,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("reparations snapshot:", err)
    );
  }, [trailerId]);

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

  function dateFromCreatedAt(createdAt) {
    if (!createdAt) return null;
    if (typeof createdAt?.toDate === "function") return createdAt.toDate();
    if (createdAt instanceof Date) return createdAt;
    const n = Number(createdAt);
    if (Number.isFinite(n)) return new Date(n);
    return null;
  }

  function rowTrailerName(r) {
    const tn = (r?.trailerNom || "").toString().trim();
    if (tn) return tn;
    const prop = (trailerNom || "").toString().trim();
    return prop || "—";
  }

  function rowDate(r) {
    const d = dateFromCreatedAt(r?.createdAt);
    return fmtDateFR(d);
  }

  // =========================
  // ✅ Nettoyage: enlève "caractéristique:" si la valeur l’a déjà
  // =========================
  function stripCaracteristiquePrefix(s) {
    const v = (s ?? "").toString().trim();
    if (!v) return "";
    // gère: "caracteristique:", "caractéristique:", "caractéristique -", "caractéristique ="
    return v.replace(/^\s*caract[ée]ristique\s*[:=\-]\s*/i, "").trim();
  }

  // =========================
  // ✅ Produit + Caractéristique (via label riche) — sans "Caractéristique:"
  // =========================
  function caracteristiqueForRow(r) {
    const eq = findEquipById(r?.equipementId);
    if (!eq) return "";

    const label = optionLabelForEquipement(eq, catsGlobal);
    const head = (eq?.nom || "").trim() || "—";
    if (label === head) return "";

    const prefix = head + " — ";
    if (label.startsWith(prefix)) {
      // Ici on retourne "Champ: valeur • Champ2: valeur2"
      // Si un champ vaut "caractéristique: xxx", on nettoie quand même.
      return stripCaracteristiquePrefix(label.slice(prefix.length).trim());
    }
    return "";
  }

  // =========================
  // ✅ Détails (Marque / Modèle / Série / Remarque)
  // =========================
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

    // ✅ on va chercher une "caractéristique" en direct dans details si elle existe
    // ✅ et on enlève le préfixe "caractéristique:" si présent
    const caracteristique = stripCaracteristiquePrefix(
      getDetail(details, ["caracteristique", "caractéristique", "spec", "specification", "feature", "courant", "amp", "amperage"])
    );

    const marque = getDetail(details, ["marque", "brand", "manufacturer", "make"]);
    const modele = getDetail(details, ["modele", "modèle", "model"]);
    const serie = getDetail(details, ["serie", "série", "serial", "sn", "s/n", "numeroSerie", "numSerie", "vin"]);
    const dimension = getDetail(details, ["dimension", "dimensions", "taille", "size"]);

    const parts = [];

    // ✅ Produit (si tu veux l'enlever, supprime cette ligne)
    if (produit) parts.push(produit);

    // ✅ caractéristique "brute" sans "Caractéristique:"
    if (caracteristique) parts.push(caracteristique);

    if (marque) parts.push(`Marque: ${marque}`);
    if (modele) parts.push(`Modèle: ${modele}`);
    if (serie) parts.push(`Série: ${serie}`);
    if (dimension) parts.push(`Dim: ${dimension}`);

    const remarque = (eq?.remarque ?? eq?.note ?? details?.remarque ?? details?.note ?? "").toString().trim() || "";

    return {
      line: parts.join(" • "),
      remarque,
    };
  }

  function openMove(r) {
    if (!isAdmin) return;
    setMoveRow(r);
    setPo((r?.po || "").toString());
    setEndroit((r?.endroit || "").toString());
    setNote((r?.note || "").toString());
    setMoveOpen(true);
  }

  async function confirmMoveToRepair() {
    if (!isAdmin) return;
    if (!trailerId || !moveRow?.id) return;
    const u = auth.currentUser;

    const newPo = (po || "").toString().trim() || null;
    const newEndroit = (endroit || "").toString().trim() || null;
    const newNote = (note || "").toString().trim() || null;

    try {
      await updateDoc(doc(db, "trailers", trailerId, "reparations", moveRow.id), {
        status: "reparation",
        po: newPo,
        endroit: newEndroit,
        note: newNote,
        movedAt: serverTimestamp(),
        movedByUid: u?.uid || null,
      });

      await logHistory("MOVE_REPARATION", {
        trackId: moveRow.id,
        nom: moveRow?.nom || "—",
        qty: Number(moveRow?.qty || 0),
        status: "reparation",
        equipementId: moveRow?.equipementId || null,
        po: newPo,
        endroit: newEndroit,
        note: newNote,
        from: moveRow?.from || null,
      });

      setMoveOpen(false);
      setMoveRow(null);
    } catch (e) {
      console.error("confirmMoveToRepair:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function removeRow(r) {
    if (!trailerId || !r?.id) return;
    const ok = window.confirm("Supprimer cette ligne ?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "trailers", trailerId, "reparations", r.id));

      await logHistory("SUPPRIME", {
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: (r?.status || "").toString().trim() || null,
        equipementId: r?.equipementId || null,
        note: r?.note || null,
        po: r?.po || null,
        endroit: r?.endroit || null,
        followUpText: r?.followUpText || null,
        from: r?.from || null,
      });
    } catch (e) {
      console.error("removeRow:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // =========================
  // ✅ Réparé = retour dans trailer + supprimer la ligne réparation
  // =========================
  async function markAsRepaired(r) {
    if (!isAdmin) return;
    if (!trailerId || !r?.id) return;

    const qn = Number(r.qty || 0);
    if (!Number.isFinite(qn) || qn <= 0) return alert("Quantité invalide sur la réparation.");

    const catId = (r?.from?.catId || "").toString().trim();
    const itemId = (r?.from?.itemId || "").toString().trim();
    if (!catId || !itemId) return alert("Impossible de retourner dans le trailer: origine manquante (catId/itemId).");

    const eq = findEquipById(r.equipementId);
    const unite = (eq?.unite || "").toString().trim();

    try {
      await runTransaction(db, async (tx) => {
        const repRef = doc(db, "trailers", trailerId, "reparations", r.id);
        const repSnap = await tx.get(repRef);
        if (!repSnap.exists()) throw new Error("Cette ligne n’existe plus.");

        const rep = repSnap.data() || {};
        if ((rep.status || "") !== "reparation") throw new Error("Cette ligne n’est pas en réparation.");

        const addQty = Number(rep.qty || 0);
        if (!Number.isFinite(addQty) || addQty <= 0) throw new Error("Quantité invalide sur la réparation.");

        const itemRef = doc(db, "trailers", trailerId, "categories", catId, "items", itemId);
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
          trailerId: trailerId || null,
          trailerNom: (trailerNom || "").toString().trim() || (rep.trailerNom || "—"),
          byUid: auth.currentUser?.uid || null,
          event: "RETOUR_REPARE",
          nom: (rep.nom || "—").toString(),
          qty: addQty,
          status: "retour_trailer",
          equipementId: rep.equipementId || null,
          from: rep.from || { catId, itemId },
        });

        tx.delete(repRef);
      });
    } catch (e) {
      console.error("markAsRepaired:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // =========================
  // ✅ Non-réparable = déplacer vers "Brisé à jeté"
  // =========================
  async function markAsNotRepairable(r) {
    if (!isAdmin) return;
    if (!trailerId || !r?.id) return;

    const ok = window.confirm("Marquer NON-réparable ? (Ça envoie dans “Brisé à jeté”)");
    if (!ok) return;

    try {
      const u = auth.currentUser;
      await updateDoc(doc(db, "trailers", trailerId, "reparations", r.id), {
        status: "jete",
        nonReparableAt: serverTimestamp(),
        nonReparableByUid: u?.uid || null,
      });

      await logHistory("NON_REPARABLE", {
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "jete",
        equipementId: r?.equipementId || null,
        from: r?.from || null,
        extra: { fromStatus: "reparation" },
      });
    } catch (e) {
      console.error("markAsNotRepairable:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // =========================
  // ✅ Suivi (Brisé à jeté)
  // =========================
  function openSuiviModal(r) {
    if (!isAdmin) return;
    setSuiviRow(r);
    setSuiviText("");
    setSuiviOpen(true);
  }

  async function confirmSuivi() {
    if (!isAdmin) return;
    if (!trailerId || !suiviRow?.id) return;

    const text = (suiviText || "").toString().trim();
    if (!text) return alert("Écris quoi faire (obligatoire).");

    try {
      const u = auth.currentUser;
      await updateDoc(doc(db, "trailers", trailerId, "reparations", suiviRow.id), {
        followUpText: text,
        followUpAt: serverTimestamp(),
        followUpByUid: u?.uid || null,
      });

      await logHistory("SUIVI", {
        trackId: suiviRow.id,
        nom: suiviRow?.nom || "—",
        qty: Number(suiviRow?.qty || 0),
        status: (suiviRow?.status || "").toString().trim() || "jete",
        equipementId: suiviRow?.equipementId || null,
        followUpText: text,
        from: suiviRow?.from || null,
      });

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

  // =========================
  // Drag & drop depuis les items du trailer
  // =========================
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
          po: null,
          endroit: null,
          note: null,
          createdAt: serverTimestamp(),
          createdByUid: u.uid,
          source: "dragdrop",
          from: { catId, itemId },
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
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 850, color: "rgba(15,23,42,0.72)", lineHeight: 1.25 }}>
        {line ? <div>{line}</div> : null}
        {rm ? (
          <div style={{ marginTop: line ? 4 : 0, color: "rgba(15,23,42,0.68)" }}>
            Remarque: <b>{rm.length > 70 ? rm.slice(0, 70) + "…" : rm}</b>
          </div>
        ) : null}
      </div>
    );
  }

  // ✅ affiche la caractéristique (fields) SANS le label "Caractéristique:"
  // et enlève aussi le préfixe si la valeur le contient déjà
  function renderProduitCaracteristique(r) {
    const raw = caracteristiqueForRow(r);
    const car = stripCaracteristiquePrefix(raw);
    if (!car) return null;

    return (
      <div style={{ marginTop: 6, fontSize: 12.5, color: "rgba(15,23,42,0.78)", lineHeight: 1.25 }}>
        <b>{car}</b>
      </div>
    );
  }

  return (
    <div className="pr-rail">
      {/* Header + Dropzone seulement */}
      <div className="pr-card pr-headCard">
        <div className="pr-headTop">
          <div>
            <div className="pr-title">Bris / Réparation</div>
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

      {/* Brisé */}
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
            {broken.map((r) => (
              <div key={r.id} className="pr-row">
                <div className="pr-rowMain">
                  <div className="pr-rowName">{r.nom || "—"}</div>

                  {/* ✅ caractéristique sans "Caractéristique:" */}
                  {renderProduitCaracteristique(r)}

                  {renderExtraLine(r)}

                  <div className="pr-rowMeta" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>
                      Qté: <b>{Number(r.qty || 0)}</b>
                    </span>
                    <span>
                      Date: <b>{rowDate(r)}</b>
                    </span>
                    <span>
                      Trailer: <b>{rowTrailerName(r)}</b>
                    </span>
                  </div>
                </div>

                <div className="pr-rowActions">
                  {isAdmin ? (
                    <button className="pr-btn pr-btnGhost" type="button" onClick={() => openMove(r)}>
                      → Réparation
                    </button>
                  ) : null}
                  <button className="pr-btn pr-btnDanger" type="button" onClick={() => removeRow(r)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Brisé à jeté */}
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
              return (
                <div
                  key={r.id}
                  className="pr-row"
                  style={
                    hasFollowUp
                      ? {
                          background: "rgba(245, 158, 11, 0.18)",
                          border: "1px solid rgba(245, 158, 11, 0.35)",
                        }
                      : undefined
                  }
                >
                  <div className="pr-rowMain">
                    <div className="pr-rowName">{r.nom || "—"}</div>

                    {/* ✅ caractéristique sans "Caractéristique:" */}
                    {renderProduitCaracteristique(r)}

                    {renderExtraLine(r)}

                    <div className="pr-rowMeta" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>
                        Qté: <b>{Number(r.qty || 0)}</b>
                      </span>
                      <span>
                        Date: <b>{rowDate(r)}</b>
                      </span>
                      <span>
                        Trailer: <b>{rowTrailerName(r)}</b>
                      </span>
                    </div>

                    {hasFollowUp ? (
                      <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                        Suivi:{" "}
                        <b>
                          {(r.followUpText || "").toString().slice(0, 60)}
                          {(r.followUpText || "").toString().length > 60 ? "…" : ""}
                        </b>
                      </div>
                    ) : null}
                  </div>

                  <div className="pr-rowActions">
                    {isAdmin ? (
                      hasFollowUp ? (
                        <button className="pr-btn pr-btnGhost" type="button" onClick={() => openSuiviViewModal(r)}>
                          ✅ Confirmer
                        </button>
                      ) : (
                        <button className="pr-btn pr-btnGhost" type="button" onClick={() => openSuiviModal(r)}>
                          📝 Suivi
                        </button>
                      )
                    ) : null}

                    <button className="pr-btn pr-btnDanger" type="button" onClick={() => removeRow(r)}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* En réparation */}
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
            {inRepair.map((r) => (
              <div key={r.id} className="pr-row">
                <div className="pr-rowMain">
                  <div className="pr-rowName">{r.nom || "—"}</div>

                  {/* ✅ caractéristique sans "Caractéristique:" */}
                  {renderProduitCaracteristique(r)}

                  {renderExtraLine(r)}

                  <div className="pr-rowMeta" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>
                      Qté: <b>{Number(r.qty || 0)}</b>
                    </span>
                    <span>
                      Date: <b>{rowDate(r)}</b>
                    </span>
                    <span>
                      Trailer: <b>{rowTrailerName(r)}</b>
                    </span>
                  </div>

                  <div className="pr-repairMeta" style={{ marginTop: 6 }}>
                    <span className="pr-miniPill">
                      PO: <b>{r.po || "—"}</b>
                    </span>
                    <span className="pr-miniPill">
                      Endroit: <b>{r.endroit || "—"}</b>
                    </span>
                  </div>

                  {r.note ? <div className="pr-note">{r.note}</div> : null}
                </div>

                <div className="pr-rowActions">
                  {isAdmin ? (
                    <>
                      <button className="pr-btn pr-btnGhost" type="button" onClick={() => markAsRepaired(r)}>
                        ✅ Réparé
                      </button>
                      <button className="pr-btn pr-btnDanger" type="button" onClick={() => markAsNotRepairable(r)}>
                        🗑 Non-réparable
                      </button>
                    </>
                  ) : null}

                  <button className="pr-btn pr-btnDanger" type="button" onClick={() => removeRow(r)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal admin -> passer en réparation */}
      {moveOpen && moveRow && isAdmin && (
        <div className="pt-modalOverlay" onMouseDown={() => setMoveOpen(false)}>
          <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Passer en réparation</div>
              <button className="pt-modalClose" type="button" onClick={() => setMoveOpen(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div style={{ fontWeight: 1000, marginBottom: 10 }}>{moveRow.nom || "—"}</div>

              {/* ✅ caractéristique sans "Caractéristique:" */}
              {renderProduitCaracteristique(moveRow)}

              {renderExtraLine(moveRow)}

              <div className="pr-modalGrid" style={{ marginTop: 10 }}>
                <div>
                  <div className="pt-modalLabel">Numéro PO</div>
                  <input className="pt-input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="ex: PO-12345" />
                </div>

                <div>
                  <div className="pt-modalLabel">Endroit</div>
                  <input
                    className="pt-input"
                    value={endroit}
                    onChange={(e) => setEndroit(e.target.value)}
                    placeholder="ex: Garage — Étagère A"
                  />
                </div>

                <div className="pr-span2">
                  <div className="pt-modalLabel">Note</div>
                  <input className="pt-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex: Bearing à changer" />
                </div>
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={confirmMoveToRepair}>
                Confirmer
              </button>
              <button className="pt-btn pt-btnGhost" type="button" onClick={() => setMoveOpen(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal drop (quantité + destination) */}
      {dropOpen && dropPayload && (
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
      )}

      {/* Modal Suivi (écrire quoi faire) */}
      {suiviOpen && suiviRow && isAdmin && (
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

              {/* ✅ caractéristique sans "Caractéristique:" */}
              {renderProduitCaracteristique(suiviRow)}

              {renderExtraLine(suiviRow)}

              <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 10 }}>
                <div className="pt-modalLabel">Quoi faire ?</div>
                <textarea
                  className="pt-input"
                  style={{ minHeight: 110, resize: "vertical" }}
                  value={suiviText}
                  onChange={(e) => setSuiviText(e.target.value)}
                  placeholder="Ex: Apporter au bureau / envoyer photo / demander à Phil / etc."
                />
                <div className="pt-modalHint">Après confirmation, la case devient jaune et le bouton devient “Confirmer”.</div>
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
      )}

      {/* Modal Confirmer (lecture seulement pour l’instant) */}
      {suiviViewOpen && suiviViewRow && (
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

              {/* ✅ caractéristique sans "Caractéristique:" */}
              {renderProduitCaracteristique(suiviViewRow)}

              {renderExtraLine(suiviViewRow)}

              <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 10 }}>
                <div className="pt-modalLabel">À faire</div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                  {(suiviViewRow.followUpText || "").toString().trim() || "—"}
                </div>
                <div className="pt-modalHint">Pour l’instant, ce bouton ne fait rien d’autre. On va le lier plus tard.</div>
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={() => setSuiviViewOpen(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
