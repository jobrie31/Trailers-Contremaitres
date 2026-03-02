// src/RepairTimelineModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { auth, db } from "./firebaseConfig";
import { doc, updateDoc, serverTimestamp, runTransaction, collection } from "firebase/firestore";

/**
 * Deux chemins:
 *
 * A) adminActionType="styro"
 *   1) Brisé (créé dans le tableau "Brisé")
 *   2) Décision admin
 *   3) Non-admin: "Envoyé à Styro" (fait par = user actuel)
 *   4) Admin: "Reçu" (note optionnelle) -> met needsAdminRepairConfirm=true (ORANGE dans "Brisé")
 *   5) Admin: "Mis en réparation" (passe status="reparation")
 *   6) Admin: "Renvoyé" (NOTE optionnelle seulement)  ✅ "Renvoyé à ..." ENLEVÉ COMPLET
 *   7) Non-admin: "Reçu et remis dans le trailer" => retour qty + delete doc
 *
 * B) adminActionType="reparer"
 *   1) Brisé
 *   2) Décision admin (Endroit obligatoire + Note optionnel)
 *   3) Non-admin: "Porté" (note optionnel) -> status "reparation"
 *   4) Non-admin: "Aller le chercher & remis trailer" (1 bouton) => retour qty + delete doc
 *
 * NOTE:
 * - needsAdminRepairConfirm: true/false => utilisé dans le tableau "Brisé" pour colorer ORANGE.
 * - Nouveaux champs optionnels utilisés ici:
 *   - porterNote (note du worker étape 3)
 *   - pickupNote (note du worker étape 4)
 *   - remisTrailerAt / remisTrailerByUid / remisTrailerByName
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
  // ⚠️ IMPORTANT: pas de return conditionnel avant les hooks
  const visible = !!open && !!row;
  const r = row || {};

  // ✅ lock scroll quand modal ouvert (iOS + UX)
  useEffect(() => {
    if (!visible) return;
    const prev = document?.body?.style?.overflow;
    if (document?.body) document.body.style.overflow = "hidden";
    return () => {
      if (document?.body) document.body.style.overflow = prev || "";
    };
  }, [visible]);

  const tId = useMemo(() => {
    if (!row) return null;
    return getRowTrailerId ? getRowTrailerId(row) : null;
  }, [row, getRowTrailerId]);

  const tNom = useMemo(() => {
    if (!row) return "—";
    return getRowTrailerNom ? getRowTrailerNom(row) : "—";
  }, [row, getRowTrailerNom]);

  const status = useMemo(() => ((r?.status || "") + "").trim(), [r?.status]);

  // ✅ Nom du tableau (affiché dans le titre du popup)
  const tableauNom = useMemo(() => {
    if (status === "brise") return "Brisé";
    if (status === "jete") return "Brisé à jeté";
    if (status === "reparation") return "En réparation";
    return "Réparations";
  }, [status]);

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
  function fmtDateFR(ts) {
    const d = dateFromTs(ts);
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

  function currentUserName() {
    return (
      (auth.currentUser?.displayName || "").toString().trim() ||
      (auth.currentUser?.email || "").toString().trim() ||
      "—"
    );
  }

  const actionType = ((r?.adminActionType || "") + "").trim(); // "styro" | "reparer" | ""

  // ---------- forms ----------
  const [adminChoice, setAdminChoice] = useState(""); // "" | "styro" | "reparer"
  const [adminPo, setAdminPo] = useState("");
  const [adminEndroit, setAdminEndroit] = useState(""); // ✅ NEW (Endroit obligatoire si reparer)
  const [adminNoteOpt, setAdminNoteOpt] = useState(""); // ✅ NEW note optionnel

  const [styroRecuNote, setStyroRecuNote] = useState("");
  const [styroRenvoyeNote, setStyroRenvoyeNote] = useState("");

  const [workerPorterNote, setWorkerPorterNote] = useState(""); // ✅ NEW: étape 3 reparer note optionnel
  const [workerPickupNote, setWorkerPickupNote] = useState(""); // ✅ NEW: étape 4 (pickup+return) note optionnel

  useEffect(() => {
    if (!visible) return;

    const existing = ((r?.adminActionType || "") + "").trim();
    setAdminChoice(existing === "styro" || existing === "reparer" ? existing : "");

    setAdminPo((r?.adminActionPo || "").toString());

    // ✅ on mappe: endroit = porterWhere, note optionnel = adminActionNote
    setAdminEndroit((r?.porterWhere || "").toString());
    setAdminNoteOpt((r?.adminActionNote || "").toString());

    setStyroRecuNote((r?.styroRecuNote || "").toString());
    setStyroRenvoyeNote((r?.styroRenvoyeNote || "").toString());

    setWorkerPorterNote("");
    setWorkerPickupNote("");
  }, [visible, r]);

  // ---------- step booleans ----------
  const stepBriseDone = true;
  const stepAdminDecisionDone = !!r?.adminActionAt;

  // Path styro:
  const stepToStyroDone = !!r?.toStyroAt;
  const stepStyroRecuDone = !!r?.styroRecuAt;
  const stepStyroMiseReparationDone = !!r?.styroMiseReparationAt;
  const stepStyroRenvoyeDone = !!r?.styroRenvoyeAt;

  // Path reparer (NOUVEAU FLOW):
  const stepPorteDone = !!r?.porterAt;
  const stepPickupReturnDone = !!r?.remisTrailerAt; // ✅ NEW: 1 seul bouton
  // (compat anciens champs si déjà présents)
  const stepChercheDone = !!r?.chercherAt;
  const stepPretDone = !!r?.pretAt;

  // ---------- steps ----------
  const steps = useMemo(() => {
    if (!stepAdminDecisionDone) {
      return [
        { key: "brise", labelShort: "Brisé", done: stepBriseDone },
        { key: "decide", labelShort: "Décision", done: false },
      ];
    }

    const path = (actionType || adminChoice || "").trim();

    if (path === "styro") {
      return [
        { key: "brise", labelShort: "Brisé", done: stepBriseDone },
        { key: "decide", labelShort: "Décision", done: true },
        { key: "tostyro", labelShort: "Envoyé", done: stepToStyroDone },
        { key: "recu", labelShort: "Reçu", done: stepStyroRecuDone },
        { key: "mise", labelShort: "En réparation", done: stepStyroMiseReparationDone },
        { key: "renvoye", labelShort: "Renvoyé", done: stepStyroRenvoyeDone },
        { key: "retour", labelShort: "Remis trailer", done: false },
      ];
    }

    // ✅ Nouveau flow reparer: 4 étapes principales
    return [
      { key: "brise", labelShort: "Brisé", done: stepBriseDone },
      { key: "decide", labelShort: "Décision", done: true },
      { key: "porte", labelShort: "Porté", done: stepPorteDone },
      { key: "pickupreturn", labelShort: "Cherché & remis", done: stepPickupReturnDone },
    ];
  }, [
    stepAdminDecisionDone,
    actionType,
    adminChoice,
    stepBriseDone,
    stepToStyroDone,
    stepStyroRecuDone,
    stepStyroMiseReparationDone,
    stepStyroRenvoyeDone,
    stepPorteDone,
    stepPickupReturnDone,
  ]);

  const activeIndex = useMemo(() => {
    const idx = steps.findIndex((s) => !s.done);
    return idx === -1 ? steps.length - 1 : idx;
  }, [steps]);

  const repairSinceLabel = useMemo(() => {
    const ts = r?.styroMiseReparationAt || r?.porterAt || r?.createdAt || null;
    return fmtDateFR(ts);
  }, [r]);

  const repairWhereLabel = useMemo(() => ((r?.porterWhere || "").toString().trim() || "—"), [r]);

  const stepInfo = useMemo(() => {
    const path = (stepAdminDecisionDone ? actionType : "") || "";
    const infos = {};

    infos.brise = {
      when: fmtDateTimeFR(r?.createdAt),
      lines: [fmtDateFR(r?.createdAt) === "—" ? "Marqué brisé." : `Marqué brisé le ${fmtDateFR(r?.createdAt)}.`],
    };

    if (!stepAdminDecisionDone) return infos;

    infos.decide = {
      when: fmtDateTimeFR(r?.adminActionAt),
      lines: [
        `Choix: ${
          ((r?.adminActionType || "") + "").trim() === "styro"
            ? "Envoyer à Styro"
            : ((r?.adminActionType || "") + "").trim() === "reparer"
            ? "Aller le faire réparer"
            : "—"
        }`,
        ((r?.adminActionPo || "").toString().trim() ? `PO: ${(r?.adminActionPo || "").toString().trim()}` : null),
        // ✅ pour reparer: Endroit obligatoire
        ((r?.adminActionType || "") + "").trim() === "reparer"
          ? `Endroit: ${(r?.porterWhere || "").toString().trim() || "—"}`
          : null,
        `Note: ${(r?.adminActionNote || "").toString().trim() || "—"}`,
      ].filter(Boolean),
    };

    if (path === "styro") {
      if (stepToStyroDone) {
        infos.tostyro = {
          when: fmtDateTimeFR(r?.toStyroAt),
          lines: [`Fait par: ${(r?.toStyroByName || "").toString().trim() || "—"}`],
        };
      }
      if (stepStyroRecuDone) {
        infos.recu = {
          when: fmtDateTimeFR(r?.styroRecuAt),
          lines: [
            (r?.styroRecuNote || "").toString().trim() ? `Note: ${(r?.styroRecuNote || "").toString().trim()}` : null,
          ].filter(Boolean),
        };
      }
      if (stepStyroMiseReparationDone) {
        infos.mise = {
          when: fmtDateTimeFR(r?.styroMiseReparationAt),
          lines: [`Statut: En réparation (depuis ${repairSinceLabel})`],
        };
      }
      if (stepStyroRenvoyeDone) {
        const when = fmtDateTimeFR(r?.styroRenvoyeAt);
        infos.renvoye = {
          when,
          lines: [
            (r?.styroRenvoyeNote || "").toString().trim()
              ? `Note: ${(r?.styroRenvoyeNote || "").toString().trim()}`
              : null,
          ].filter(Boolean),
        };
      }
    } else if (path === "reparer") {
      if (stepPorteDone) {
        infos.porte = {
          when: fmtDateTimeFR(r?.porterAt),
          lines: [
            `Endroit: ${(r?.porterWhere || "").toString().trim() || "—"}`,
            `Fait par: ${(r?.porterByName || "").toString().trim() || "—"}`,
            (r?.porterNote || "").toString().trim() ? `Note: ${(r?.porterNote || "").toString().trim()}` : null,
          ].filter(Boolean),
        };
      }
      if (stepPickupReturnDone) {
        infos.pickupreturn = {
          when: fmtDateTimeFR(r?.remisTrailerAt),
          lines: [
            `Fait par: ${(r?.remisTrailerByName || "").toString().trim() || "—"}`,
            (r?.pickupNote || "").toString().trim() ? `Note: ${(r?.pickupNote || "").toString().trim()}` : null,
          ].filter(Boolean),
        };
      } else {
        // compat affichage si anciens champs existent
        if (stepChercheDone) {
          infos.cherche = {
            when: fmtDateTimeFR(r?.chercherAt),
            lines: [`Fait par: ${(r?.chercherByName || "").toString().trim() || "—"}`],
          };
        }
        if (stepPretDone) {
          infos.pret = {
            when: fmtDateTimeFR(r?.pretAt),
            lines: [`Fait par: ${(r?.pretByName || "").toString().trim() || "—"}`],
          };
        }
      }
    }

    return infos;
  }, [
    stepAdminDecisionDone,
    actionType,
    r,
    stepToStyroDone,
    stepStyroRecuDone,
    stepStyroMiseReparationDone,
    stepStyroRenvoyeDone,
    stepPorteDone,
    stepPickupReturnDone,
    stepChercheDone,
    stepPretDone,
    repairSinceLabel,
  ]);

  function TimelineHorizontal() {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {steps.map((s, idx) => {
            const isActive = idx === activeIndex;
            const done = !!s.done;

            return (
              <React.Fragment key={s.key}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 54 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 1000,
                      fontSize: 13,
                      border: done ? "2px solid rgba(34,197,94,0.65)" : "2px solid rgba(15,23,42,0.22)",
                      background: done
                        ? "rgba(34,197,94,0.18)"
                        : isActive
                        ? "rgba(59,130,246,0.12)"
                        : "rgba(148,163,184,0.12)",
                      color: done ? "rgba(22,101,52,0.95)" : "rgba(15,23,42,0.90)",
                    }}
                    title={s.labelShort}
                  >
                    {done ? "✓" : idx + 1}
                  </div>

                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 900,
                      opacity: done ? 0.9 : isActive ? 0.85 : 0.6,
                      textAlign: "center",
                      lineHeight: 1.05,
                      maxWidth: 110,
                    }}
                  >
                    {s.labelShort}
                  </div>
                </div>

                {idx < steps.length - 1 ? (
                  <div
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 999,
                      background: steps[idx].done ? "rgba(34,197,94,0.45)" : "rgba(148,163,184,0.25)",
                      minWidth: 10,
                    }}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {steps
            .filter((s) => s.done && stepInfo?.[s.key])
            .map((s) => {
              const info = stepInfo[s.key];
              return (
                <div
                  key={`info_${s.key}`}
                  style={{
                    border: "1px solid rgba(15,23,42,0.10)",
                    background: "rgba(255,255,255,0.85)",
                    borderRadius: 14,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 1000, fontSize: 13.5, opacity: 0.92 }}>
                      Étape {steps.findIndex((x) => x.key === s.key) + 1} — {s.labelShort}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.7 }}>{info.when}</div>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 12.8, fontWeight: 850, opacity: 0.85, lineHeight: 1.25 }}>
                    {info.lines.map((ln, i) => (
                      <div key={i}>{ln}</div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    );
  }

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

    if (adminChoice !== "styro" && adminChoice !== "reparer") {
      return alert("Choisis: Envoyer à Styro OU Aller le faire réparer.");
    }

    const po = (adminPo || "").toString().trim();

    // ✅ REPARER: Endroit obligatoire (remplace note obligatoire)
    const endroit = (adminEndroit || "").toString().trim();
    if (adminChoice === "reparer" && !endroit) return alert("Endroit obligatoire.");

    // ✅ Note optionnel (aucune obligation)
    const noteOpt = (adminNoteOpt || "").toString().trim() || null;

    // (PO: je le garde comme avant si tu l'utilises)
    if (adminChoice === "reparer" && !po) return alert("Numéro PO obligatoire si “Aller le faire réparer”.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        adminActionType: adminChoice,
        adminActionPo: adminChoice === "reparer" ? po : null,

        // ✅ adminActionNote = note optionnel
        adminActionNote: noteOpt,

        // ✅ endroit obligatoire stocké dans porterWhere
        porterWhere: adminChoice === "reparer" ? endroit : (r?.porterWhere || null),

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
        note: noteOpt,
        po: adminChoice === "reparer" ? po : null,
        extra: { adminActionType: adminChoice, endroit: adminChoice === "reparer" ? endroit : null },
      });

      // ✅ si c’est “reparer” => on veut que ça flash rouge au worker (notifications/turnInfo le gère via porterAt vide)
      await notifOpenOrUpdate?.(r.id, {
        targetRole: "admin", // si toi tu utilises "admin" uniquement, tu peux enlever. Sinon ignore.
        done: false,
        type: adminChoice === "reparer" ? "reparer_assigned" : "styro_assigned",
        trailerId: tId,
        trailerNom: tNom,
        repId: r.id,
        status: status || "brise",
        nom: r?.nom || "—",
      });

      await notifDone?.(r.id, "admin_decision_done");
      onClose?.();
    } catch (e) {
      console.error("adminConfirmDecision:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function userConfirmSentToStyro() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if (!stepAdminDecisionDone) return alert("L’admin n’a pas encore décidé.");
    if ((actionType || "").trim() !== "styro") return alert("Cette ligne n’est pas en mode Styro.");

    const who = currentUserName();
    if (!who || who === "—") return alert("Utilisateur non détecté.");

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
    if (!stepToStyroDone) return alert("Le travailleur doit d’abord confirmer “Envoyé à Styro”.");

    try {
      const u = auth.currentUser;
      const note = (styroRecuNote || "").toString().trim() || null;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        styroRecuAt: serverTimestamp(),
        styroRecuByUid: u?.uid || null,
        styroRecuNote: note,
        needsAdminRepairConfirm: true,
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
        needsAdminRepairConfirm: false,
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
        styroRenvoyeTo: null,
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

    const who = currentUserName();
    if (!who || who === "—") return alert("Utilisateur non détecté.");

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

  // ✅ NEW: Étape 3 (worker) pour "reparer" = note optionnel seulement
  async function userConfirmPorte() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if (!stepAdminDecisionDone) return alert("L’admin n’a pas encore décidé.");
    if ((actionType || "").trim() !== "reparer") return alert("Cette ligne n’est pas en mode “Aller le faire réparer”.");

    const who = currentUserName();
    if (!who || who === "—") return alert("Utilisateur non détecté.");

    try {
      const u = auth.currentUser;

      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        porterAt: serverTimestamp(),
        porterByUid: u?.uid || null,
        porterByName: who,
        porterNote: (workerPorterNote || "").toString().trim() || null,
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
        note: (workerPorterNote || "").toString().trim() || null,
        extra: { who, endroit: repairWhereLabel },
      });

      onClose?.();
    } catch (e) {
      console.error("userConfirmPorte:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // ✅ NEW: Étape 4 (worker) = “Aller le chercher & remis trailer” (1 bouton) + delete doc
  async function userPickupAndReturnToTrailer() {
    if (isAdmin) return;
    if (!tId || !r?.id) return;
    if ((actionType || "").trim() !== "reparer") return alert("Pas le bon chemin.");
    if (!stepPorteDone) return alert("Faut d’abord faire “Porté”.");

    const who = currentUserName();
    if (!who || who === "—") return alert("Utilisateur non détecté.");

    const ok = window.confirm("Confirmer: allé le chercher et remis dans le trailer ?");
    if (!ok) return;

    try {
      // on marque les timestamps (log) puis on retourne qty + delete
      await updateDoc(doc(db, "trailers", tId, "reparations", r.id), {
        chercherAt: serverTimestamp(),
        chercherByUid: auth.currentUser?.uid || null,
        chercherByName: who,

        remisTrailerAt: serverTimestamp(),
        remisTrailerByUid: auth.currentUser?.uid || null,
        remisTrailerByName: who,

        pickupNote: (workerPickupNote || "").toString().trim() || null,
      });

      await logHistory?.("CHERCHER_ET_REMIS_TRAILER", {
        trailerId: tId,
        trailerNom: tNom,
        trackId: r.id,
        nom: r?.nom || "—",
        qty: Number(r?.qty || 0),
        status: "reparation",
        equipementId: r?.equipementId || null,
        note: (workerPickupNote || "").toString().trim() || null,
        extra: { who, endroit: repairWhereLabel },
      });

      await returnToTrailerAndDelete({ whoName: who });

      await notifDone?.(r.id, "pickup_returned_trailer");
      onClose?.();
    } catch (e) {
      console.error("userPickupAndReturnToTrailer:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // ✅ return null seulement après hooks
  if (!visible) return null;
  if (typeof document === "undefined") return null;

  // Styles rappel (ORANGE)
  const warnOrange = { background: "rgba(249,115,22,0.14)", border: "1px solid rgba(249,115,22,0.25)" };
  const inRepairOrange = { background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.22)" };

  const needRepairConfirmNow = isAdmin && actionType === "styro" && stepStyroRecuDone && !stepStyroMiseReparationDone;

  const showInRepairInfo = status === "reparation" || stepPorteDone || stepStyroMiseReparationDone;

  const modal = (
    <div className="pt-modalOverlay" onMouseDown={onClose}>
      <div className="pt-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pt-modalHead">
          <div className="pt-modalTitle">Tableau — {tableauNom}</div>
          <button className="pt-modalClose" type="button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="pt-modalBody">
          <div style={{ fontWeight: 1000, marginBottom: 8 }}>{r?.nom || "—"}</div>
          <div style={{ fontSize: 13.5, fontWeight: 900, opacity: 0.85 }}>{tNom}</div>

          {/* ✅ affiche endroit/date quand en réparation */}
          {showInRepairInfo ? (
            <div style={{ marginTop: 10, ...inRepairOrange, borderRadius: 14, padding: "10px 12px", fontWeight: 950 }}>
              🛠 En réparation — Depuis <b>{repairSinceLabel}</b> — Endroit: <b>{repairWhereLabel}</b>
            </div>
          ) : null}

          <TimelineHorizontal />

          {/* ÉTAPE 2 — ADMIN DÉCISION (seulement si pas encore décidé) */}
          {!stepAdminDecisionDone && isAdmin && status === "brise" ? (
            <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
              <div className="pt-modalLabel">Étape 2 — Décision admin</div>

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
                  <input
                    className="pt-input"
                    value={adminPo}
                    onChange={(e) => setAdminPo(e.target.value)}
                    placeholder="ex: PO-12345"
                  />

                  {/* ✅ Endroit obligatoire */}
                  <div className="pt-modalLabel" style={{ marginTop: 10 }}>
                    Endroit (obligatoire)
                  </div>
                  <input
                    className="pt-input"
                    value={adminEndroit}
                    onChange={(e) => setAdminEndroit(e.target.value)}
                    placeholder="ex: Garage X / Atelier Y"
                  />

                  {/* ✅ Note optionnel */}
                  <div className="pt-modalLabel" style={{ marginTop: 10 }}>
                    Note (optionnel)
                  </div>
                  <textarea
                    className="pt-input"
                    style={{ minHeight: 80, resize: "vertical" }}
                    value={adminNoteOpt}
                    onChange={(e) => setAdminNoteOpt(e.target.value)}
                    placeholder="Optionnel…"
                  />
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div className="pt-modalLabel">Note (obligatoire)</div>
                  <input
                    className="pt-input"
                    value={adminNoteOpt}
                    onChange={(e) => setAdminNoteOpt(e.target.value)}
                    placeholder="Quand le renvoyer"
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* CHEMIN STYRO */}
          {stepAdminDecisionDone && actionType === "styro" ? (
            <>
              {!isAdmin && !stepToStyroDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 3 — Envoyé à Styro</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par</div>
                    <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>{currentUserName()}</div>
                  </div>
                </div>
              ) : null}

              {isAdmin && stepToStyroDone && !stepStyroRecuDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 4 — Reçu</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <input
                      className="pt-input"
                      value={styroRecuNote}
                      onChange={(e) => setStyroRecuNote(e.target.value)}
                      placeholder="ex: reçu au bureau"
                    />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 850, opacity: 0.75 }}>
                    Après confirmation, la case dans le tableau “Brisé” devient orange (rappel: mettre en réparation).
                  </div>
                </div>
              ) : null}

              {needRepairConfirmNow ? (
                <div className={"pt-modalBlock pt-blinkOrange"} style={{ marginTop: 14, ...warnOrange }}>
                  <div className="pt-modalLabel">Étape 5 — Mettre en réparation</div>
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 900, opacity: 0.9 }}>
                    ⚠️ Tant que tu n’as pas confirmé, la case reste ORANGE dans le tableau “Brisé”.
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 850, opacity: 0.8 }}>
                    Quand tu confirmes, la ligne passe dans “En réparation”.
                  </div>
                </div>
              ) : null}

              {isAdmin && stepStyroMiseReparationDone && !stepStyroRenvoyeDone ? (
                <div className="pt-modalBlock" style={{ marginTop: 14, ...inRepairOrange }}>
                  <div className="pt-modalLabel">Étape 6 — Renvoyé</div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <input
                      className="pt-input"
                      value={styroRenvoyeNote}
                      onChange={(e) => setStyroRenvoyeNote(e.target.value)}
                      placeholder="ex: renvoyé au trailer / au bureau"
                    />
                  </div>
                </div>
              ) : null}

              {!isAdmin && stepStyroRenvoyeDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 7 — Reçu et remis dans le trailer</div>
                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par</div>
                    <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>{currentUserName()}</div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* CHEMIN ALLER FAIRE RÉPARER (NOUVEAU) */}
          {stepAdminDecisionDone && actionType === "reparer" ? (
            <>
              {!isAdmin && !stepPorteDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 3 — Porté</div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Endroit</div>
                    <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>{repairWhereLabel}</div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <textarea
                      className="pt-input"
                      style={{ minHeight: 80, resize: "vertical" }}
                      value={workerPorterNote}
                      onChange={(e) => setWorkerPorterNote(e.target.value)}
                      placeholder="Optionnel…"
                    />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par</div>
                    <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>{currentUserName()}</div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 850, opacity: 0.75 }}>
                    Quand tu confirmes, la ligne passe dans “En réparation”.
                  </div>
                </div>
              ) : null}

              {/* ✅ Étape 4 = 1 seul bouton */}
              {!isAdmin && stepPorteDone && !stepPickupReturnDone ? (
                <div className="pt-modalBlock" style={{ background: "#fff", marginTop: 14 }}>
                  <div className="pt-modalLabel">Étape 4 — Aller le chercher & remis trailer</div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Note (optionnel)</div>
                    <textarea
                      className="pt-input"
                      style={{ minHeight: 80, resize: "vertical" }}
                      value={workerPickupNote}
                      onChange={(e) => setWorkerPickupNote(e.target.value)}
                      placeholder="Optionnel…"
                    />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="pt-modalLabel">Fait par</div>
                    <div style={{ marginTop: 6, fontWeight: 950, opacity: 0.9 }}>{currentUserName()}</div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="pt-modalFoot">
          {!stepAdminDecisionDone && isAdmin && status === "brise" ? (
            <button className="pt-btn" type="button" onClick={adminConfirmDecision}>
              Confirmer décision (Étape 2)
            </button>
          ) : null}

          {stepAdminDecisionDone && actionType === "styro" ? (
            <>
              {!isAdmin && !stepToStyroDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmSentToStyro}>
                  Confirmer: Envoyé à Styro (Étape 3)
                </button>
              ) : null}

              {isAdmin && stepToStyroDone && !stepStyroRecuDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroRecu}>
                  Confirmer: Reçu (Étape 4)
                </button>
              ) : null}

              {isAdmin && stepStyroRecuDone && !stepStyroMiseReparationDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroMiseReparation}>
                  Confirmer: En réparation (Étape 5)
                </button>
              ) : null}

              {isAdmin && stepStyroMiseReparationDone && !stepStyroRenvoyeDone ? (
                <button className="pt-btn" type="button" onClick={adminMarkStyroRenvoye}>
                  Confirmer: Renvoyé (Étape 6)
                </button>
              ) : null}

              {!isAdmin && stepStyroRenvoyeDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmStyroReceivedAndReturned}>
                  Confirmer: Reçu & remis trailer (Étape 7)
                </button>
              ) : null}
            </>
          ) : null}

          {stepAdminDecisionDone && actionType === "reparer" ? (
            <>
              {!isAdmin && !stepPorteDone ? (
                <button className="pt-btn" type="button" onClick={userConfirmPorte}>
                  Confirmer: Porté (Étape 3)
                </button>
              ) : null}

              {!isAdmin && stepPorteDone && !stepPickupReturnDone ? (
                <button className="pt-btn" type="button" onClick={userPickupAndReturnToTrailer}>
                  Confirmer: Cherché & remis trailer (Étape 4)
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

  return createPortal(modal, document.body);
}