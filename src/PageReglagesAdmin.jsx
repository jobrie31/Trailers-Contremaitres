// src/PageReglagesAdmin.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebaseConfig";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  setDoc,
} from "firebase/firestore";

function normEmail(s) {
  return (s || "").toString().trim();
}
function lowerEmail(s) {
  return normEmail(s).toLowerCase();
}
function makeCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

export default function PageReglagesAdmin() {
  const [meLoading, setMeLoading] = useState(true);
  const [meIsAdmin, setMeIsAdmin] = useState(false);

  const [employes, setEmployes] = useState([]);

  // form ajout
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(makeCode());
  const [isAdmin, setIsAdmin] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // ✅ Déterminer si moi je suis admin via employes(uid == auth.uid)
  // ✅ BOOTSTRAP: si aucun employé n'existe encore -> créer mon doc en ADMIN automatiquement
  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setMeLoading(true);
        const u = auth.currentUser;

        if (!u) {
          if (!alive) return;
          setMeIsAdmin(false);
          setMeLoading(false);
          return;
        }

        // 1) Essayer de trouver mon doc par uid
        const qMe = query(collection(db, "employes"), where("uid", "==", u.uid), limit(1));
        let snapMe = await getDocs(qMe);

        if (!snapMe.empty) {
          const me = snapMe.docs[0].data() || {};
          if (!alive) return;
          setMeIsAdmin(!!me?.isAdmin);
          setMeLoading(false);
          return;
        }

        // 2) Fallback par emailLower (auto-link si doc existe uid==null)
        const emailLower = (u.email || "").toLowerCase().trim();
        if (emailLower) {
          const qByEmail = query(collection(db, "employes"), where("emailLower", "==", emailLower), limit(1));
          const snapEmail = await getDocs(qByEmail);

          if (!snapEmail.empty) {
            const empDoc = snapEmail.docs[0];
            const emp = empDoc.data() || {};

            if (!emp.uid) {
              await updateDoc(empDoc.ref, { uid: u.uid, activatedAt: serverTimestamp() });
            }

            if (!alive) return;
            setMeIsAdmin(!!emp?.isAdmin);
            setMeLoading(false);
            return;
          }
        }

        // 3) Aucun doc me: vérifier si employes est vide => bootstrap premier admin
        const snapAny = await getDocs(query(collection(db, "employes"), limit(1)));

        if (snapAny.empty) {
          await addDoc(collection(db, "employes"), {
            nom: (u.displayName || u.email || "Admin").toString(),
            email: (u.email || "").toString().trim(),
            emailLower: (u.email || "").toLowerCase().trim(),
            activationCode: null,
            isAdmin: true,
            uid: u.uid,
            activatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            createdByUid: u.uid,
            bootstrap: true,
          });

          // ✅ IMPORTANT: un admin n’a PAS de trailer
          await setDoc(
            doc(db, "users", u.uid),
            {
              uid: u.uid,
              email: (u.email || "").toLowerCase().trim(),
              isAdmin: true,
              trailerId: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              bootstrap: true,
            },
            { merge: true }
          );

          if (!alive) return;
          setMeIsAdmin(true);
          setMeLoading(false);
          return;
        }

        // 4) Il existe déjà des employés, mais pas toi -> pas admin
        if (!alive) return;
        setMeIsAdmin(false);
        setMeLoading(false);
      } catch (e) {
        console.error("load me:", e);
        if (!alive) return;
        setMeIsAdmin(false);
        setMeLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ Liste employes (admin only)
  useEffect(() => {
    if (!meIsAdmin) return;
    const qE = query(collection(db, "employes"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qE,
      (snap) => setEmployes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("employes snapshot:", err)
    );
  }, [meIsAdmin]);

  const employesSorted = useMemo(() => {
    const copy = [...employes];
    copy.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    return copy;
  }, [employes]);

  async function ajouterPersonne(e) {
    e.preventDefault();
    setMsg("");
    setBusy(true);

    try {
      const cleanNom = (nom || "").toString().trim();
      const cleanEmail = normEmail(email);
      const cleanEmailLower = lowerEmail(email);
      const cleanCode = (code || "").toString().trim();

      if (!cleanNom) return setMsg("❌ Entre un nom.");
      if (!cleanEmail || !cleanEmailLower.includes("@")) return setMsg("❌ Email invalide.");
      if (!cleanCode) return setMsg("❌ Code d’activation requis.");

      const qExist = query(collection(db, "employes"), where("emailLower", "==", cleanEmailLower), limit(1));
      const ex = await getDocs(qExist);
      if (!ex.empty) {
        setMsg("❌ Cet email existe déjà dans la liste.");
        return;
      }

      await addDoc(collection(db, "employes"), {
        nom: cleanNom,
        email: cleanEmail,
        emailLower: cleanEmailLower,
        activationCode: cleanCode,
        isAdmin: !!isAdmin,
        uid: null,
        activatedAt: null,
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid || null,
      });

      setNom("");
      setEmail("");
      setIsAdmin(false);
      setCode(makeCode());
      setMsg("✅ Personne ajoutée. Donne-lui son code d’activation.");
    } catch (e2) {
      console.error("ajouterPersonne:", e2);
      setMsg("❌ Erreur: " + (e2?.message || "inconnue"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(empId, next) {
    try {
      await updateDoc(doc(db, "employes", empId), { isAdmin: !!next });
    } catch (e) {
      console.error("toggleAdmin:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  async function resetCode(emp) {
    if (emp?.uid) return alert("Déjà activé (uid présent). Impossible de reset le code.");
    const newCode = makeCode();
    try {
      await updateDoc(doc(db, "employes", emp.id), { activationCode: newCode });
      alert("Nouveau code: " + newCode);
    } catch (e) {
      console.error("resetCode:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  // ✅ SUPPRIMER EMPLOYÉ (MAINTENANT: permis même si activé)
  async function supprimerEmploye(emp) {
    if (!emp?.id) return;

    const labelTxt = `${emp.nom || "—"} (${emp.email || "—"})`;
    const active = !!emp.uid;

    // sécurité: empêcher l'admin de se supprimer lui-même
    const myUid = auth.currentUser?.uid || null;
    if (active && myUid && emp.uid === myUid) {
      alert("Impossible de supprimer ton propre compte admin.");
      return;
    }

    const warn = active
      ? `⚠️ ATTENTION: ce compte est DÉJÀ ACTIVÉ.\n\n` +
        `Ça va supprimer le document employé + le user/trailer associés dans Firestore.\n` +
        `⚠️ Ça NE supprime PAS l'utilisateur dans Firebase Auth (il existe encore techniquement).\n\n`
      : "";

    const ok = window.confirm(`Supprimer cet employé?\n\n${warn}${labelTxt}\n\nCette action est définitive.`);
    if (!ok) return;

    try {
      // 1) supprimer employes/{id}
      await deleteDoc(doc(db, "employes", emp.id));

      // 2) best-effort: supprimer users/{uid} + trailers/{uid} si uid présent
      if (emp.uid) {
        try {
          await deleteDoc(doc(db, "users", emp.uid));
        } catch (e1) {
          console.warn("delete users failed:", e1);
        }
        try {
          await deleteDoc(doc(db, "trailers", emp.uid));
        } catch (e2) {
          console.warn("delete trailer failed:", e2);
        }
      }

      alert("Employé supprimé.");
    } catch (e) {
      console.error("supprimerEmploye:", e);
      alert("Erreur: " + (e?.message || "inconnue"));
    }
  }

  if (meLoading) {
    return <div style={{ padding: 16, fontWeight: 800 }}>Chargement…</div>;
  }

  if (!meIsAdmin) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 900 }}>Réglages</div>
        <div style={{ marginTop: 10, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          ❌ Accès refusé. (Admin seulement)
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 24, fontWeight: 950, marginBottom: 12 }}>Réglages — Utilisateurs</div>

      {/* AJOUT */}
      <div style={card}>
        <div style={{ fontWeight: 950, marginBottom: 10 }}>Ajouter une personne</div>

        <form onSubmit={ajouterPersonne} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <div>
            <div style={label}>Nom</div>
            <input style={input} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Marc Tremblay" />
          </div>

          <div>
            <div style={label}>Email</div>
            <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex: marc@styro.ca" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
            <div>
              <div style={label}>Code d’activation</div>
              <input style={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex: 123456" />
            </div>
            <button type="button" style={btnGhost} onClick={() => setCode(makeCode())} disabled={busy}>
              Générer
            </button>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            Admin
          </label>

          <button style={btn} disabled={busy}>
            {busy ? "Ajout..." : "Ajouter"}
          </button>

          {msg ? <div style={{ fontWeight: 900 }}>{msg}</div> : null}
        </form>
      </div>

      {/* LISTE */}
      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontWeight: 950, marginBottom: 10 }}>Employés ({employesSorted.length})</div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Nom</th>
                <th style={th}>Email</th>
                <th style={th}>Admin</th>
                <th style={th}>Activation</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employesSorted.map((e) => {
                const active = !!e.uid;
                const myUid = auth.currentUser?.uid || null;
                const isMe = !!myUid && !!e.uid && e.uid === myUid;

                return (
                  <tr key={e.id}>
                    <td style={td}><b>{e.nom || "—"}</b></td>
                    <td style={td}>{e.email || "—"}</td>

                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={!!e.isAdmin}
                        onChange={(ev) => toggleAdmin(e.id, ev.target.checked)}
                        title="Admin"
                        disabled={isMe} // évite de te retirer tes droits par accident
                      />
                    </td>

                    <td style={td}>
                      {active ? (
                        <span style={{ fontWeight: 900, color: "#065f46" }}>✅ Activé</span>
                      ) : (
                        <span style={{ fontWeight: 900, color: "#92400e" }}>⏳ En attente</span>
                      )}
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                        Code: {e.activationCode ? <b>{e.activationCode}</b> : <span style={{ opacity: 0.7 }}>—</span>}
                      </div>
                    </td>

                    <td style={td}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          style={{ ...btnGhost, height: 34, opacity: active ? 0.45 : 1 }}
                          onClick={() => resetCode(e)}
                          disabled={active}
                          title={active ? "Déjà activé" : "Reset code"}
                        >
                          Reset code
                        </button>

                        <button
                          type="button"
                          style={{ ...btnDanger, height: 34, opacity: isMe ? 0.45 : 1 }}
                          onClick={() => supprimerEmploye(e)}
                          disabled={isMe}
                          title={isMe ? "Impossible: ton propre compte" : "Supprimer"}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {employesSorted.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>Aucun employé.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const card = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
};

const label = { fontWeight: 900, marginBottom: 6 };
const input = {
  height: 42,
  width: "100%",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "0 12px",
  outline: "none",
  fontWeight: 800,
};

const btn = {
  height: 44,
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontWeight: 900,
  background: "#111827",
  color: "white",
};

const btnGhost = {
  height: 44,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  cursor: "pointer",
  fontWeight: 900,
  background: "#fff",
};

const btnDanger = {
  height: 44,
  borderRadius: 10,
  border: "1px solid #ef4444",
  cursor: "pointer",
  fontWeight: 900,
  background: "#fff",
  color: "#b91c1c",
};

const th = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  opacity: 0.8,
};

const td = {
  padding: "10px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};
