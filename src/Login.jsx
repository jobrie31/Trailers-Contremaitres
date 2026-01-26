// src/Login.jsx
import React, { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth, db } from "./firebaseConfig";

import {
  collection,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [activationCode, setActivationCode] = useState(""); // ✅ NEW
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const cleanEmail = email.trim();
      const cleanEmailLower = cleanEmail.toLowerCase().trim();
      const cleanCode = (activationCode || "").toString().trim();

      if (!cleanEmail || !pass) {
        setErr("Entre un email et un mot de passe.");
        return;
      }

      if (mode === "login") {
        await signInWithEmailAndPassword(auth, cleanEmail, pass);
        return;
      }

      // ✅ REGISTER: on exige un code d'activation
      if (!cleanCode) {
        setErr("Entre ton code d’activation.");
        return;
      }

      // 1) Vérifier que l'email existe dans employes + code match
      const qEmp = query(
        collection(db, "employes"),
        where("emailLower", "==", cleanEmailLower),
        limit(1)
      );
      const snap = await getDocs(qEmp);

      if (snap.empty) {
        setErr("Cet email n’est pas autorisé. Demande à un admin de t’ajouter.");
        return;
      }

      const empDoc = snap.docs[0];
      const emp = empDoc.data() || {};

      const expectedCode = (emp.activationCode || "").toString().trim();
      const alreadyActivated = !!emp.uid;

      if (alreadyActivated) {
        setErr("Ce compte est déjà activé. Essaie de te connecter.");
        return;
      }

      if (!expectedCode || expectedCode !== cleanCode) {
        setErr("Code d’activation invalide.");
        return;
      }

      // 2) Créer le user Auth
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, pass);

      // 3) Lier le uid dans Firestore + marquer activé
      await updateDoc(empDoc.ref, {
        uid: cred.user.uid,
        activatedAt: serverTimestamp(),
        // Option: on efface le code après activation (plus sécuritaire)
        activationCode: null,
        email: cleanEmail,
        emailLower: cleanEmailLower,
      });

      // ✅ App.jsx va détecter via onAuthStateChanged
    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/invalid-credential") setErr("Email ou mot de passe invalide.");
      else if (code === "auth/user-not-found") setErr("Aucun compte avec cet email.");
      else if (code === "auth/wrong-password") setErr("Mot de passe incorrect.");
      else if (code === "auth/email-already-in-use") setErr("Cet email est déjà utilisé.");
      else if (code === "auth/weak-password") setErr("Mot de passe trop faible (6+).");
      else if (code === "auth/invalid-email") setErr("Email invalide.");
      else setErr(error?.message || "Erreur de connexion.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.title}>Trailers Contremaîtres</div>
        <div style={styles.sub}>
          {mode === "login" ? "Connexion" : "Créer un compte"}
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ex: jo@gmail.com"
            autoComplete="username"
          />

          <label style={styles.label}>Mot de passe</label>
          <input
            style={styles.input}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="******"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          {/* ✅ Code d'activation seulement en mode register */}
          {mode === "register" && (
            <>
              <label style={styles.label}>Code d’activation</label>
              <input
                style={styles.input}
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="ex: 483921"
                autoComplete="one-time-code"
              />
            </>
          )}

          <button style={styles.btn} disabled={loading}>
            {loading
              ? "Veuillez patienter..."
              : mode === "login"
              ? "Se connecter"
              : "Créer le compte"}
          </button>

          {err ? <div style={styles.err}>{err}</div> : null}
        </form>

        <div style={styles.footer}>
          {mode === "login" ? (
            <>
              Pas de compte?{" "}
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => setMode("register")}
              >
                Créer un compte
              </button>
            </>
          ) : (
            <>
              Déjà un compte?{" "}
              <button
                type="button"
                style={styles.linkBtn}
                onClick={() => setMode("login")}
              >
                Se connecter
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f6f7f9",
    padding: 16,
    fontFamily: "Arial, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 18,
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
  },
  title: { fontSize: 22, fontWeight: 800 },
  sub: { marginTop: 6, marginBottom: 14, opacity: 0.75 },
  form: { display: "grid", gap: 8 },
  label: { fontSize: 13, fontWeight: 700, marginTop: 6 },
  input: {
    height: 42,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    padding: "0 12px",
    outline: "none",
    fontSize: 15,
  },
  btn: {
    marginTop: 12,
    height: 44,
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    background: "#111827",
    color: "white",
    fontSize: 15,
  },
  err: {
    marginTop: 8,
    color: "#b91c1c",
    fontWeight: 700,
    fontSize: 13,
  },
  footer: { marginTop: 12, fontSize: 14, opacity: 0.85 },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#2563eb",
    fontWeight: 800,
    cursor: "pointer",
    padding: 0,
  },
};
