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
    const d =
      typeof ts?.toDate === "function"
        ? ts.toDate()
        : ts instanceof Date
        ? ts
        : null;
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

export default function PageHistorique({ isAdmin = false, user = null }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal (détails d’un équipement)
  const [open, setOpen] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState(null);
  const [activeHeader, setActiveHeader] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [deletingTrackId, setDeletingTrackId] = useState(null);

  useEffect(() => {
    setLoading(true);

    if (!user?.uid) {
      setLogs([]);
      setLoading(false);
      return;
    }

    const q = isAdmin
      ? query(
          collection(db, "reparations_history"),
          orderBy("ts", "desc"),
          limit(800)
        )
      : query(
          collection(db, "reparations_history"),
          where("visibleToUid", "==", user.uid),
          orderBy("ts", "desc"),
          limit(800)
        );

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
  }, [user?.uid, user?.email, isAdmin]);

  // ✅ 1 ligne par trackId
  const rows = useMemo(() => {
    const latestByTid = new Map();
    const countByTid = new Map();

    for (const l of logs) {
      const tid = (l.trackId || "").toString().trim();
      if (!tid) continue;

      countByTid.set(tid, (countByTid.get(tid) || 0) + 1);

      if (!latestByTid.has(tid)) latestByTid.set(tid, l);
    }

    const arr = Array.from(latestByTid.values()).map((l) => {
      const tid = (l.trackId || "").toString().trim();
      return {
        ...l,
        _eventsCountApprox: countByTid.get(tid) || 1,
      };
    });

    return arr;
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
      lastTs: latestLog?.ts || null,
      lastEvent: latestLog?.event || null,
      trackId: tid,
    });

    setOpen(true);
  }

  useEffect(() => {
    if (!open || !activeTrackId || !user?.uid) return;

    setTimeline([]);
    setTimelineLoading(true);

    const q = isAdmin
      ? query(
          collection(db, "reparations_history"),
          where("trackId", "==", activeTrackId),
          orderBy("ts", "asc")
        )
      : query(
          collection(db, "reparations_history"),
          where("trackId", "==", activeTrackId),
          where("visibleToUid", "==", user.uid),
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
  }, [open, activeTrackId, isAdmin, user?.uid, user?.email]);

  function closeModal() {
    setOpen(false);
    setActiveTrackId(null);
    setActiveHeader(null);
    setTimeline([]);
  }

  async function deleteTrackHistory(trackId) {
    if (!isAdmin) return;

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

      const q = query(
        collection(db, "reparations_history"),
        where("trackId", "==", tid)
      );
      const snap = await getDocs(q);
      if (snap.empty) return;

      const docs = snap.docs;
      const BATCH_SIZE = 450;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const d of chunk) batch.delete(doc(db, "reparations_history", d.id));
        await batch.commit();
      }
    } catch (e) {
      console.error("deleteTrackHistory:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    } finally {
      setDeletingTrackId(null);
    }
  }

  const gridCols = isAdmin
    ? "2.2fr 1.2fr 0.7fr 1fr 1.2fr 44px"
    : "2.2fr 1.2fr 0.7fr 1fr 1.2fr";

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
        Historique (1 ligne par équipement)
      </div>

      {loading ? (
        <div style={{ opacity: 0.75 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ opacity: 0.75 }}>Aucun historique pour l’instant.</div>
      ) : (
        <div
          className="pt-card"
          style={{ background: "#fff", borderRadius: 12, padding: 12 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              gap: 10,
              padding: "8px 10px",
              fontWeight: 900,
              borderBottom: "1px solid #eee",
            }}
          >
            <div>Équipement</div>
            <div>Trailer</div>
            <div>Qté</div>
            <div>Statut</div>
            <div>Dernière action</div>
            {isAdmin ? <div style={{ textAlign: "right" }} /> : null}
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
                title="Clique pour voir tous les avancements"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  gap: 10,
                  padding: "10px 10px",
                  borderBottom: "1px solid #f3f3f3",
                  alignItems: "center",
                  cursor: "pointer",
                  borderRadius: 10,
                  outline: "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {r.nom || "—"}
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                    {fmtDateTimeFR(r.ts)} — ID: {tid.slice(0, 8)}… — env.{" "}
                    {r._eventsCountApprox} évènement(s)
                  </div>
                </div>

                <div style={{ fontWeight: 800 }}>{r.trailerNom || "—"}</div>
                <div style={{ fontWeight: 800 }}>
                  {r.qty != null ? Number(r.qty || 0) : "—"}
                </div>
                <div style={{ fontWeight: 800 }}>{statusLabel(r.status)}</div>
                <div style={{ fontWeight: 800 }}>{eventLabel(r.event)}</div>

                {isAdmin ? (
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
                        background: isDeleting
                          ? "rgba(239,68,68,0.08)"
                          : "rgba(239,68,68,0.12)",
                        cursor: isDeleting ? "not-allowed" : "pointer",
                        fontWeight: 900,
                        lineHeight: "28px",
                      }}
                    >
                      {isDeleting ? "…" : "✕"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="pt-modalOverlay" onMouseDown={closeModal}>
          <div
            className="pt-modal"
            style={{ maxWidth: 820 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="pt-modalHead">
              <div className="pt-modalTitle">
                Avancements — {activeHeader?.nom || "—"}
              </div>
              <button className="pt-modalClose" type="button" onClick={closeModal}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <span className="pr-miniPill">
                  Trailer: <b>{activeHeader?.trailerNom || "—"}</b>
                </span>
                <span className="pr-miniPill">
                  Qté: <b>{activeHeader?.qty ?? "—"}</b>
                </span>
                <span className="pr-miniPill">
                  Statut: <b>{statusLabel(activeHeader?.status)}</b>
                </span>
                <span className="pr-miniPill">
                  Dernière action: <b>{eventLabel(activeHeader?.lastEvent)}</b>
                </span>
                <span className="pr-miniPill">
                  ID: <b>{activeHeader?.trackId?.slice(0, 12)}…</b>
                </span>
              </div>

              {timelineLoading ? (
                <div style={{ opacity: 0.75 }}>Chargement…</div>
              ) : timeline.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Aucun événement.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {timeline.map((t, idx) => {
                    const isFollow = (t.event || "") === "SUIVI";
                    return (
                      <div
                        key={t.id}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 12,
                          padding: 10,
                          background: isFollow ? "rgba(245, 158, 11, 0.12)" : "white",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "baseline",
                          }}
                        >
                          <div style={{ fontWeight: 950 }}>
                            #{idx + 1} — {eventLabel(t.event)}
                          </div>
                          <div style={{ opacity: 0.75, fontWeight: 800 }}>
                            {fmtDateTimeFR(t.ts)}
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 6,
                            display: "flex",
                            gap: 10,
                            flexWrap: "wrap",
                            fontSize: 13,
                          }}
                        >
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
                            Suivi:{" "}
                            <b style={{ whiteSpace: "pre-wrap" }}>{t.followUpText}</b>
                          </div>
                        ) : null}

                        {t.extra ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                            Détails: <code>{JSON.stringify(t.extra)}</code>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
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