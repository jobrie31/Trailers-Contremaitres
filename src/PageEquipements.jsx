// src/PageEquipements.jsx
import React, { useEffect, useMemo, useState } from "react";
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
import { db } from "./firebaseConfig";

/* ---------- color helpers ---------- */
function withAlpha(hex, alpha) {
  if (!hex || typeof hex !== "string") return `rgba(15,23,42,${alpha})`;
  let h = hex.trim();
  if (!h.startsWith("#")) return `rgba(15,23,42,${alpha})`;
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (h.length !== 7) return `rgba(15,23,42,${alpha})`;

  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
const DEFAULT_COLOR = "#4F46E5";

export default function PageEquipements() {
  const [cats, setCats] = useState([]); // [{id, nom, color}]
  const catsSorted = useMemo(
    () => [...cats].sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr")),
    [cats]
  );

  // popover "+ catégorie"
  const [showAddCat, setShowAddCat] = useState(false);
  const [catNom, setCatNom] = useState("");
  const [catColor, setCatColor] = useState(DEFAULT_COLOR);

  const [equipements, setEquipements] = useState([]);

  // ajout équipement
  const [nom, setNom] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [unite, setUnite] = useState("");
  const [msg, setMsg] = useState("");

  // edit équipement
  const [editId, setEditId] = useState(null);
  const [editNom, setEditNom] = useState("");
  const [editUnite, setEditUnite] = useState("");

  // ---------------------------
  // subscribe catégories
  // ---------------------------
  useEffect(() => {
    const qC = query(collection(db, "categories"), orderBy("createdAt", "asc"));
    return onSnapshot(
      qC,
      (snap) => setCats(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setMsg("❌ Erreur lecture catégories: " + (err?.message || "inconnue"))
    );
  }, []);

  // ---------------------------
  // subscribe équipements
  // ---------------------------
  useEffect(() => {
    const qE = query(collection(db, "equipements"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qE,
      (snap) => setEquipements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setMsg("❌ Erreur lecture équipements: " + (err?.message || "inconnue"))
    );
  }, []);

  function catFromId(id) {
    return cats.find((c) => c.id === id) || null;
  }

  // ---------------------------
  // actions catégories
  // ---------------------------
  async function ajouterCategorie() {
    setMsg("");
    const n = catNom.trim();
    if (!n) return;

    const deja = cats.some((c) => (c.nom || "").trim().toLowerCase() === n.toLowerCase());
    if (deja) return setMsg("⚠️ Cette catégorie existe déjà.");

    try {
      await addDoc(collection(db, "categories"), {
        nom: n,
        color: (catColor || DEFAULT_COLOR).trim(),
        createdAt: serverTimestamp(),
      });
      setCatNom("");
      setCatColor(DEFAULT_COLOR);
      setShowAddCat(false);
      setMsg("✅ Catégorie ajoutée.");
    } catch (e) {
      setMsg("❌ Erreur ajout catégorie: " + (e?.message || "inconnue"));
    }
  }

  async function supprimerCategorie(catId) {
    if (!window.confirm("Supprimer cette catégorie?\n(Les équipements garderont leur catégorie vide)")) return;
    try {
      await deleteDoc(doc(db, "categories", catId));
      if (categorieId === catId) setCategorieId("");
      setMsg("✅ Catégorie supprimée.");
    } catch (e) {
      setMsg("❌ Erreur suppression catégorie: " + (e?.message || "inconnue"));
    }
  }

  async function changerCouleurCategorie(catId, newColor) {
    try {
      await updateDoc(doc(db, "categories", catId), { color: newColor });
    } catch (e) {
      alert("Erreur changement couleur: " + (e?.message || "inconnue"));
    }
  }

  // ---------------------------
  // actions équipements
  // ---------------------------
  async function ajouterEquipement(e) {
    e.preventDefault();
    setMsg("");

    const n = nom.trim();
    if (!n) return setMsg("⚠️ Entre un nom d’équipement.");
    if (!categorieId) return setMsg("⚠️ Choisis une catégorie.");

    const cat = catFromId(categorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    try {
      await addDoc(collection(db, "equipements"), {
        nom: n,
        categorieId,
        categorie: cat.nom || "",
        unite: unite.trim() || "",
        createdAt: serverTimestamp(),
      });

      setNom("");
      setCategorieId("");
      setUnite("");
      setMsg("✅ Équipement ajouté!");
    } catch (e2) {
      setMsg("❌ Erreur ajout équipement: " + (e2?.message || "inconnue"));
    }
  }

  function startEdit(eq) {
    setEditId(eq.id);
    setEditNom(eq.nom || "");
    setEditUnite(eq.unite || "");
    setMsg("");
  }

  function cancelEdit() {
    setEditId(null);
    setEditNom("");
    setEditUnite("");
  }

  async function saveEdit() {
    if (!editId) return;
    const n = editNom.trim();
    if (!n) return setMsg("⚠️ Nom vide.");

    try {
      await updateDoc(doc(db, "equipements", editId), {
        nom: n,
        unite: editUnite.trim() || "",
      });
      setMsg("✅ Modifié!");
      cancelEdit();
    } catch (e) {
      setMsg("❌ Erreur modification: " + (e?.message || "inconnue"));
    }
  }

  async function supprimerEquipement(id) {
    if (!window.confirm("Supprimer cet équipement?")) return;
    try {
      await deleteDoc(doc(db, "equipements", id));
      setMsg("✅ Supprimé!");
    } catch (e) {
      setMsg("❌ Erreur suppression: " + (e?.message || "inconnue"));
    }
  }

  // ---------------------------
  // Group par catégorie
  // ---------------------------
  const equipementsParCategorie = useMemo(() => {
    const map = new Map();
    for (const c of catsSorted) map.set(c.id, []);

    const autres = [];
    for (const eq of equipements) {
      const cid = (eq.categorieId || "").trim();
      if (cid && map.has(cid)) map.get(cid).push(eq);
      else autres.push(eq);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
      map.set(k, arr);
    }
    autres.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));

    return { map, autres };
  }, [equipements, catsSorted]);

  return (
    <div style={{ background: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Équipements</div>
          <div style={{ fontSize: 13, color: "rgba(15,23,42,0.65)", marginTop: 4 }}>
            Les couleurs sont définies par catégorie et restent identiques dans Trailers.
          </div>
        </div>

        {/* + catégories */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setShowAddCat((v) => !v); setCatNom(""); setCatColor(DEFAULT_COLOR); }}
            title="Ajouter une catégorie"
            style={{
              height: 38, width: 38, borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)",
              background: "#fff", cursor: "pointer", fontWeight: 900, fontSize: 18
            }}
          >
            +
          </button>

          {showAddCat && (
            <div style={{
              position: "absolute", right: 0, top: 44, width: 380,
              background: "#fff", border: "1px solid rgba(15,23,42,0.10)",
              borderRadius: 14, padding: 10, boxShadow: "0 14px 35px rgba(0,0,0,0.12)", zIndex: 20
            }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Nouvelle catégorie</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8 }}>
                <input value={catNom} onChange={(e) => setCatNom(e.target.value)} placeholder="Nom (ex: Arrimage)" style={inputStyle}/>
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  title="Couleur"
                  style={{ height: 42, width: "100%", borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}
                />
                <button type="button" onClick={ajouterCategorie} style={btnStyle}>Ajouter</button>
              </div>

              <div style={{ marginTop: 12, fontWeight: 900 }}>Catégories</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {catsSorted.length === 0 ? (
                  <div style={emptyStyle}>Aucune catégorie.</div>
                ) : (
                  catsSorted.map((c) => (
                    <div key={c.id} style={{
                      display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8,
                      border: "1px solid rgba(15,23,42,0.10)", borderRadius: 12, padding: 10, alignItems: "center"
                    }}>
                      <div style={{ fontWeight: 900 }}>{c.nom}</div>

                      <input
                        type="color"
                        value={c.color || DEFAULT_COLOR}
                        onChange={(e) => changerCouleurCategorie(c.id, e.target.value)}
                        title="Couleur"
                        style={{ height: 34, width: "100%", borderRadius: 10, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}
                      />

                      <button type="button" onClick={() => supprimerCategorie(c.id)} style={dangerSmallStyle}>X</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {msg ? (
        <div style={{
          marginBottom: 12, padding: 10, borderRadius: 12,
          background: "rgba(15,23,42,0.03)", border: "1px solid rgba(15,23,42,0.10)"
        }}>
          {msg}
        </div>
      ) : null}

      {/* Ajout équipement */}
      <form onSubmit={ajouterEquipement} style={{
        background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderRadius: 16,
        padding: 14, boxShadow: "0 10px 25px rgba(0,0,0,0.06)", marginBottom: 12
      }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Ajouter un équipement</div>

        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1fr auto", gap: 8, alignItems: "center" }}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" style={inputStyle} />

          <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)} style={inputStyle}>
            <option value="">Catégorie…</option>
            {catsSorted.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>

          <input value={unite} onChange={(e) => setUnite(e.target.value)} placeholder="Unité (optionnel)" style={inputStyle} />

          <button type="submit" style={btnStyle}>+ Ajouter</button>
        </div>
      </form>

      {/* Équipements par catégorie (couleur choisie) */}
      <div style={{
        background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderRadius: 16,
        padding: 14, boxShadow: "0 10px 25px rgba(0,0,0,0.06)"
      }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Équipements par catégorie</div>

        <div style={{ display: "grid", gap: 14 }}>
          {catsSorted.map((cat) => {
            const list = equipementsParCategorie.map.get(cat.id) || [];
            if (list.length === 0) return null;

            const base = cat.color || DEFAULT_COLOR;

            return (
              <div key={cat.id} style={{
                border: `1px solid ${withAlpha(base, 0.35)}`,
                borderRadius: 16,
                padding: 12,
                background: withAlpha(base, 0.12),
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: base, display: "inline-block" }} />
                    {cat.nom}
                  </div>
                  <div style={{ color: "rgba(15,23,42,0.65)", fontWeight: 800, fontSize: 13 }}>
                    {list.length} item{list.length > 1 ? "s" : ""}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {list.map((eq) => {
                    const isEdit = editId === eq.id;

                    return (
                      <div key={eq.id} style={{
                        border: "1px solid rgba(15,23,42,0.10)",
                        borderRadius: 14,
                        padding: 10,
                        background: "#fff",
                        display: "grid",
                        gridTemplateColumns: "1.6fr 1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}>
                        {isEdit ? (
                          <>
                            <input value={editNom} onChange={(e) => setEditNom(e.target.value)} style={inputStyle} />
                            <input value={editUnite} onChange={(e) => setEditUnite(e.target.value)} style={inputStyle} placeholder="Unité" />
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button type="button" onClick={saveEdit} style={btnStyleSmall}>OK</button>
                              <button type="button" onClick={cancelEdit} style={ghostStyleSmall}>Annuler</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 900 }}>{eq.nom}</div>
                            <div style={{ color: "rgba(15,23,42,0.75)" }}>{eq.unite || "—"}</div>
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button type="button" onClick={() => startEdit(eq)} style={ghostStyleSmall}>Modifier</button>
                              <button type="button" onClick={() => supprimerEquipement(eq.id)} style={dangerSmallStyle}>X</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* styles inline */
const inputStyle = {
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.10)",
  padding: "0 12px",
  outline: "none",
  background: "#fff",
};
const btnStyle = {
  height: 42,
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 14px",
  background: "#111827",
  color: "#fff",
  whiteSpace: "nowrap",
};
const btnStyleSmall = {
  height: 36,
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 12px",
  background: "#111827",
  color: "#fff",
  whiteSpace: "nowrap",
};
const ghostStyleSmall = {
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 12px",
};
const dangerSmallStyle = {
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.12)",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 12px",
};
const emptyStyle = {
  padding: 10,
  borderRadius: 12,
  background: "rgba(15,23,42,0.03)",
  border: "1px dashed rgba(15,23,42,0.12)",
  color: "rgba(15,23,42,0.65)",
  fontSize: 13,
};
