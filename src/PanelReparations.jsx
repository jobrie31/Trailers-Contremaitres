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
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

export default function PanelReparations({ trailerId, isAdmin, equipements }) {
  const [rows, setRows] = useState([]);
  const [equipId, setEquipId] = useState("");
  const [qty, setQty] = useState(1);

  const [po, setPo] = useState("");
  const [endroit, setEndroit] = useState("");
  const [note, setNote] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveRow, setMoveRow] = useState(null);

  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setRows([]);
    setEquipId("");
    setQty(1);
    setMoveOpen(false);
    setMoveRow(null);
    setPo("");
    setEndroit("");
    setNote("");
    setDragOver(false);

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
  const inRepair = useMemo(() => rows.filter((r) => r.status === "reparation"), [rows]);

  async function addBrokenManual() {
    if (!trailerId) return;
    const u = auth.currentUser;
    if (!u) return alert("Non connecté.");

    const qn = Number(qty || 0);
    if (!equipId) return alert("Choisis un équipement.");
    if (!Number.isFinite(qn) || qn <= 0) return alert("Quantité invalide (min 1).");

    const eq = equipOptions.find((e) => e.id === equipId) || null;
    const nom = (eq?.nom || "").toString().trim() || "—";

    try {
      await addDoc(collection(db, "trailers", trailerId, "reparations"), {
        status: "brise",
        equipementId: equipId,
        nom,
        qty: qn,
        po: null,
        endroit: null,
        note: null,
        createdAt: serverTimestamp(),
        createdByUid: u.uid,
      });

      setEquipId("");
      setQty(1);
    } catch (e) {
      console.error("addBroken:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
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

    try {
      await updateDoc(doc(db, "trailers", trailerId, "reparations", moveRow.id), {
        status: "reparation",
        po: (po || "").toString().trim() || null,
        endroit: (endroit || "").toString().trim() || null,
        note: (note || "").toString().trim() || null,
        movedAt: serverTimestamp(),
        movedByUid: u?.uid || null,
      });
      setMoveOpen(false);
      setMoveRow(null);
    } catch (e) {
      console.error("confirmMoveToRepair:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function moveBackToBroken(r) {
    if (!isAdmin) return;
    if (!trailerId || !r?.id) return;
    const u = auth.currentUser;
    try {
      await updateDoc(doc(db, "trailers", trailerId, "reparations", r.id), {
        status: "brise",
        movedAt: serverTimestamp(),
        movedByUid: u?.uid || null,
      });
    } catch (e) {
      console.error("moveBackToBroken:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function removeRow(r) {
    if (!trailerId || !r?.id) return;
    const ok = window.confirm("Supprimer cette ligne ?");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "trailers", trailerId, "reparations", r.id));
    } catch (e) {
      console.error("removeRow:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // =========================
  // Drag & drop depuis les items du trailer (payload "application/x-gyrotech-item")
  // => drop = mettre BRISÉ automatiquement
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

  async function addBrokenFromDrop(payload) {
    if (!trailerId) return;
    const u = auth.currentUser;
    if (!u) return alert("Non connecté.");

    const nom = (payload?.nom || "").toString().trim() || "—";
    const equipementId = (payload?.equipementId || "").toString().trim() || null;

    // défaut: 1 (on ne veut pas “casser” 15 items d’un coup par accident)
    const qn = 1;

    try {
      await addDoc(collection(db, "trailers", trailerId, "reparations"), {
        status: "brise",
        equipementId: equipementId || null,
        nom,
        qty: qn,
        po: null,
        endroit: null,
        note: null,
        createdAt: serverTimestamp(),
        createdByUid: u.uid,
        source: "dragdrop",
      });
    } catch (e) {
      console.error("addBrokenFromDrop:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
    e.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave() {
    setDragOver(false);
  }
  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const payload = parseDroppedPayload(e);
    if (!payload) return;
    await addBrokenFromDrop(payload);
  }

  const canUse = !!trailerId;

  return (
    <div className="pr-rail">
      {/* Header */}
      <div className="pr-card pr-headCard">
        <div className="pr-headTop">
          <div>
            <div className="pr-title">Bris / Réparation</div>
            <div className="pr-sub">
              Dépose un item ici pour le mettre <b>Brisé</b>. (Admin: le passer en <b>En réparation</b> avec PO / endroit.)
            </div>
          </div>
          <div className="pr-badges">
            <span className="pr-pill pr-pillRed">Brisé: {broken.length}</span>
            <span className="pr-pill pr-pillAmber">Réparation: {inRepair.length}</span>
          </div>
        </div>

        {/* Dropzone */}
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
            <div className="pr-dropHint">→ Ça ajoute automatiquement dans “Brisé” (Qté = 1)</div>
          </div>
        </div>

        {/* Ajout manuel */}
        <div className="pr-form">
          <select className="pt-input pr-inputTight" value={equipId} onChange={(e) => setEquipId(e.target.value)} disabled={!canUse}>
            <option value="">Choisir un équipement…</option>
            {equipOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom || "—"}
              </option>
            ))}
          </select>

          <input
            className="pt-input pr-inputQty pt-noSpin"
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={!canUse}
            placeholder="Qté"
          />

          <button className="pt-btn pr-btnTight" type="button" onClick={addBrokenManual} disabled={!canUse}>
            Mettre brisé
          </button>
        </div>
      </div>

      {/* Brisé */}
      <div className="pr-card">
        <div className="pr-sectionHead">
          <div className="pr-sectionTitle">
            <span className="pr-dot pr-dotRed" /> Brisé
          </div>
          <div className="pr-sectionMeta">{broken.length} item{broken.length > 1 ? "s" : ""}</div>
        </div>

        {broken.length === 0 ? (
          <div className="pr-empty">Aucun item brisé.</div>
        ) : (
          <div className="pr-list">
            {broken.map((r) => (
              <div key={r.id} className="pr-row">
                <div className="pr-rowMain">
                  <div className="pr-rowName">{r.nom || "—"}</div>
                  <div className="pr-rowMeta">Qté: <b>{Number(r.qty || 0)}</b></div>
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

      {/* En réparation */}
      <div className="pr-card">
        <div className="pr-sectionHead">
          <div className="pr-sectionTitle">
            <span className="pr-dot pr-dotAmber" /> En réparation
          </div>
          <div className="pr-sectionMeta">{inRepair.length} item{inRepair.length > 1 ? "s" : ""}</div>
        </div>

        {inRepair.length === 0 ? (
          <div className="pr-empty">Aucun item en réparation.</div>
        ) : (
          <div className="pr-list">
            {inRepair.map((r) => (
              <div key={r.id} className="pr-row">
                <div className="pr-rowMain">
                  <div className="pr-rowName">{r.nom || "—"}</div>

                  <div className="pr-repairMeta">
                    <span className="pr-miniPill">PO: <b>{r.po || "—"}</b></span>
                    <span className="pr-miniPill">Endroit: <b>{r.endroit || "—"}</b></span>
                  </div>

                  {r.note ? <div className="pr-note">{r.note}</div> : null}
                </div>

                <div className="pr-rowActions">
                  {isAdmin ? (
                    <button className="pr-btn pr-btnGhost" type="button" onClick={() => moveBackToBroken(r)}>
                      ← Brisé
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

      {/* Modal admin */}
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

              <div className="pr-modalGrid">
                <div>
                  <div className="pt-modalLabel">Numéro PO</div>
                  <input className="pt-input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="ex: PO-12345" />
                </div>

                <div>
                  <div className="pt-modalLabel">Endroit</div>
                  <input className="pt-input" value={endroit} onChange={(e) => setEndroit(e.target.value)} placeholder="ex: Garage — Étagère A" />
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
    </div>
  );
}
