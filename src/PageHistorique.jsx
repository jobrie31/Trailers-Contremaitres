// src/PageHistorique.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "./firebaseConfig";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
} from "firebase/firestore";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDateTimeFR(ts) {
  if (!ts) return "—";
  try {
    const d = typeof ts?.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null;
    if (!d) return "—";
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch {
    return "—";
  }
}

function eventLabel(ev) {
  const e = (ev || "").toString();
  switch (e) {
    case "AJOUT_BRISE":
      return "Ajout (Brisé)";
    case "AJOUT_JETE":
      return "Ajout (Brisé à jeté)";
    case "MOVE_REPARATION":
      return "→ Réparation";
    case "NON_REPARABLE":
      return "Non-réparable → Jeté";
    case "RETOUR_REPARE":
      return "Réparé → Retour trailer";
    case "SUIVI":
      return "Suivi";
    case "SUPPRIME":
      return "Supprimé";
    default:
      return e || "—";
  }
}

function statusLabel(st) {
  const s = (st || "").toString();
  switch (s) {
    case "brise":
      return "Brisé";
    case "reparation":
      return "Réparation";
    case "jete":
      return "Brisé à jeté";
    case "retour_trailer":
      return "Retour trailer";
    default:
      return s || "—";
  }
}

export default function PageHistorique() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal (détails d’un article)
  const [open, setOpen] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState(null);
  const [activeHeader, setActiveHeader] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [deletingTrackId, setDeletingTrackId] = useState(null);

  useEffect(() => {
    setLoading(true);

    // On charge les derniers logs (ex: 500) puis on groupe côté client en "1 ligne par article"
    const q = query(collection(db, "reparations_history"), orderBy("ts", "desc"), limit(500));
    return onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("historique snapshot:", err);
        setLoading(false);
      }
    );
  }, []);

  // 1 ligne par trackId => on garde le log le plus récent de chaque trackId
  const rows = useMemo(() => {
    const map = new Map(); // trackId => latest log
    for (const l of logs) {
      const tid = (l.trackId || "").toString().trim();
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, l);
    }
    return Array.from(map.values());
  }, [logs]);

  function openTimeline(latestLog) {
    const tid = (latestLog?.trackId || "").toString().trim();
    if (!tid) return;

    setActiveTrackId(tid);
    setActiveHeader({
      nom: latestLog?.nom || "—",
      trailerNom: latestLog?.trailerNom || "—",
      qty: latestLog?.qty ?? null,
      status: latestLog?.status || null,
    });

    setOpen(true);
  }

  // Quand le popup ouvre: on charge la timeline complète de CE trackId
  useEffect(() => {
    if (!open || !activeTrackId) return;

    setTimeline([]);
    setTimelineLoading(true);

    const q = query(
      collection(db, "reparations_history"),
      where("trackId", "==", activeTrackId),
      orderBy("ts", "asc")
    );

    return onSnapshot(
      q,
      (snap) => {
        setTimeline(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setTimelineLoading(false);
      },
      (err) => {
        console.error("timeline snapshot:", err);
        setTimelineLoading(false);
      }
    );
  }, [open, activeTrackId]);

  function closeModal() {
    setOpen(false);
    setActiveTrackId(null);
    setActiveHeader(null);
    setTimeline([]);
  }

  // ✅ Supprime tout l’historique pour un trackId (sinon la ligne reviendrait)
  async function deleteTrackHistory(trackId) {
    const tid = (trackId || "").toString().trim();
    if (!tid) return;

    const ok = window.confirm(
      `Supprimer cette ligne d’historique ?\n\nÇa efface TOUT l’historique (tous les événements) pour ce trackId.\n\nID: ${tid.slice(
        0,
        10
      )}…`
    );
    if (!ok) return;

    try {
      setDeletingTrackId(tid);

      // On récupère tous les docs qui matchent ce trackId
      const q = query(collection(db, "reparations_history"), where("trackId", "==", tid));
      const snap = await getDocs(q);

      if (snap.empty) return;

      // Batch delete (max 500 ops / batch)
      const docs = snap.docs;
      const BATCH_SIZE = 450; // marge de sécurité
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) {
          batch.delete(doc(db, "reparations_history", d.id));
        }
        await batch.commit();
      }
    } catch (e) {
      console.error("deleteTrackHistory:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    } finally {
      setDeletingTrackId(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Historique</div>

      {loading ? (
        <div style={{ opacity: 0.75 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ opacity: 0.75 }}>Aucun historique pour l’instant.</div>
      ) : (
        <div className="pt-card" style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2.2fr 1.2fr 0.7fr 1fr 1.1fr 44px",
              gap: 10,
              padding: "8px 10px",
              fontWeight: 900,
              borderBottom: "1px solid #eee",
            }}
          >
            <div>Article</div>
            <div>Trailer</div>
            <div>Qté</div>
            <div>Statut</div>
            <div>Dernière action</div>
            <div style={{ textAlign: "right" }}> </div>
          </div>

          {rows.map((r) => {
            const tid = (r.trackId || "").toString().trim();
            const isDeleting = deletingTrackId === tid;

            return (
              <div
                key={tid}
                role="button"
                tabIndex={0}
                onClick={() => openTimeline(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openTimeline(r);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  outline: "none",
                }}
                title="Clique pour voir toute l’historique"
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.2fr 1.2fr 0.7fr 1fr 1.1fr 44px",
                    gap: 10,
                    padding: "10px 10px",
                    borderBottom: "1px solid #f3f3f3",
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>
                    {r.nom || "—"}
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      {fmtDateTimeFR(r.ts)} — ID: {(tid || "").toString().slice(0, 8)}…
                    </div>
                  </div>

                  <div style={{ fontWeight: 700 }}>{r.trailerNom || "—"}</div>
                  <div style={{ fontWeight: 700 }}>{Number(r.qty || 0) || "—"}</div>
                  <div style={{ fontWeight: 700 }}>{statusLabel(r.status)}</div>
                  <div style={{ fontWeight: 700 }}>{eventLabel(r.event)}</div>

                  {/* ✅ X supprimer (ne doit pas ouvrir le popup) */}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteTrackHistory(tid);
                      }}
                      disabled={isDeleting}
                      title="Supprimer cette ligne d’historique"
                      style={{
                        width: 34,
                        height: 30,
                        borderRadius: 10,
                        border: "1px solid rgba(239,68,68,0.25)",
                        background: isDeleting ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.12)",
                        cursor: isDeleting ? "not-allowed" : "pointer",
                        fontWeight: 900,
                        lineHeight: "28px",
                      }}
                    >
                      {isDeleting ? "…" : "✕"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal timeline */}
      {open && (
        <div className="pt-modalOverlay" onMouseDown={closeModal}>
          <div className="pt-modal" style={{ maxWidth: 760 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Historique — {activeHeader?.nom || "—"}</div>
              <button className="pt-modalClose" type="button" onClick={closeModal}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <span className="pr-miniPill">
                  Trailer: <b>{activeHeader?.trailerNom || "—"}</b>
                </span>
                <span className="pr-miniPill">
                  Qté: <b>{activeHeader?.qty ?? "—"}</b>
                </span>
                <span className="pr-miniPill">
                  Statut: <b>{statusLabel(activeHeader?.status)}</b>
                </span>
              </div>

              {timelineLoading ? (
                <div style={{ opacity: 0.75 }}>Chargement…</div>
              ) : timeline.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Aucun événement.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {timeline.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 12,
                        padding: 10,
                        background: (t.event || "") === "SUIVI" ? "rgba(245, 158, 11, 0.12)" : "white",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 900 }}>{eventLabel(t.event)}</div>
                        <div style={{ opacity: 0.75, fontWeight: 700 }}>{fmtDateTimeFR(t.ts)}</div>
                      </div>

                      <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
                        <span>
                          Statut: <b>{statusLabel(t.status)}</b>
                        </span>
                        {t.qty != null ? (
                          <span>
                            Qté: <b>{Number(t.qty || 0)}</b>
                          </span>
                        ) : null}
                        {t.po ? (
                          <span>
                            PO: <b>{t.po}</b>
                          </span>
                        ) : null}
                        {t.endroit ? (
                          <span>
                            Endroit: <b>{t.endroit}</b>
                          </span>
                        ) : null}
                      </div>

                      {t.note ? (
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          Note: <b>{t.note}</b>
                        </div>
                      ) : null}

                      {t.followUpText ? (
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          Suivi: <b style={{ whiteSpace: "pre-wrap" }}>{t.followUpText}</b>
                        </div>
                      ) : null}

                      {t.extra ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                          Détails: <code>{JSON.stringify(t.extra)}</code>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={closeModal}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
