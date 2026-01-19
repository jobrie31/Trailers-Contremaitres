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

/* ---------- field helpers ---------- */
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
function norm(s) {
  return (s || "").toString().trim().toLowerCase();
}
function isUniteLabel(label) {
  const n = norm(label);
  return n === "unite" || n === "unité" || n.includes("unité") || n.includes("unite");
}

export default function PageEquipements() {
  const [cats, setCats] = useState([]); // [{id, nom, color, fields:[{id, nom}]}]
  const catsSorted = useMemo(
    () => [...cats].sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr")),
    [cats]
  );

  // popover "+ catégorie"
  const [showAddCat, setShowAddCat] = useState(false);
  const [catNom, setCatNom] = useState("");
  const [catColor, setCatColor] = useState(DEFAULT_COLOR);

  // champs sous-catégories (cat)
  const [catFieldNom, setCatFieldNom] = useState("");
  const [catFields, setCatFields] = useState([]); // [{id, nom}]
  const [catManageId, setCatManageId] = useState(null); // pour gérer champs d'une catégorie existante
  const [catManageFieldNom, setCatManageFieldNom] = useState("");

  const [equipements, setEquipements] = useState([]);

  // ajout équipement
  const [nomEq, setNomEq] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [details, setDetails] = useState({}); // { fieldId: value }
  const [msg, setMsg] = useState("");

  // edit équipement
  const [editId, setEditId] = useState(null);
  const [editNom, setEditNom] = useState("");
  const [editCategorieId, setEditCategorieId] = useState("");
  const [editDetails, setEditDetails] = useState({}); // { fieldId: value }

  // ---------------------------
  // subscribe catégories
  // ---------------------------
  useEffect(() => {
    const qC = query(collection(db, "categories"), orderBy("createdAt", "asc"));
    return onSnapshot(
      qC,
      (snap) =>
        setCats(
          snap.docs.map((d) => {
            const data = d.data() || {};
            const fieldsRaw = Array.isArray(data.fields) ? data.fields : [];
            const fields = fieldsRaw
              .map((f) => {
                if (typeof f === "string") return { id: uid(), nom: f };
                if (f && typeof f === "object") return { id: f.id || uid(), nom: f.nom || "" };
                return null;
              })
              .filter((x) => x && x.nom && x.nom.trim());
            return { id: d.id, ...data, fields };
          })
        ),
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

  function fieldsForCat(catId) {
    const c = catFromId(catId);
    return (c?.fields || []).filter((f) => (f?.nom || "").trim());
  }

  // ---------- NEW: champs dynamiques "Sans catégorie" ----------
  // On déduit les colonnes existantes en regardant tous les équipements "Sans catégorie"
  // (leurs details/unite). Ça permet d'avoir un vrai tableau + d'éditer la catégorie.
  const sansCatFields = useMemo(() => {
    const set = new Map(); // key -> label
    for (const eq of equipements) {
      const cid = (eq.categorieId || "").trim();
      if (cid) continue;

      // legacy unite
      if ((eq.unite || "").trim()) set.set("legacy:unite", "Unité");

      // details keys (si existant)
      const d = eq.details || {};
      for (const k of Object.keys(d)) {
        const val = (d?.[k] ?? "").toString().trim();
        if (!val) continue;
        // on ne connait pas le label original, mais on peut montrer "Champ <k>".
        // Pour une meilleure UX, on garde une colonne générique "Infos" et on concatène.
        set.set("legacy:infos", "Infos");
        break;
      }
    }

    const arr = [];
    for (const [id, nom] of set.entries()) arr.push({ id, nom });
    // toujours au moins "Infos" pour afficher quelque chose si vide
    return arr;
  }, [equipements]);

  // quand on change la catégorie (ajout), on remappe details vers nouveaux champs
  useEffect(() => {
    if (!categorieId) {
      setDetails({});
      return;
    }
    const fields = fieldsForCat(categorieId);
    setDetails((prev) => {
      const next = {};
      for (const f of fields) next[f.id] = prev?.[f.id] ?? "";
      return next;
    });
  }, [categorieId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------
  // actions catégories (champs)
  // ---------------------------
  function ajouterChampTemp() {
    const n = catFieldNom.trim();
    if (!n) return;
    const deja = catFields.some((f) => norm(f.nom) === norm(n));
    if (deja) return;
    setCatFields((arr) => [...arr, { id: uid(), nom: n }]);
    setCatFieldNom("");
  }

  function retirerChampTemp(fieldId) {
    setCatFields((arr) => arr.filter((f) => f.id !== fieldId));
  }

  // gérer champs d'une catégorie existante
  function toggleManageCat(catId) {
    setCatManageFieldNom("");
    setCatManageId((prev) => (prev === catId ? null : catId));
  }

  async function addFieldToExistingCat(catId) {
    const c = catFromId(catId);
    if (!c) return;
    const n = catManageFieldNom.trim();
    if (!n) return;

    const already = (c.fields || []).some((f) => norm(f.nom) === norm(n));
    if (already) return;

    const nextFields = [...(c.fields || []), { id: uid(), nom: n }];
    try {
      await updateDoc(doc(db, "categories", catId), { fields: nextFields });
      setCatManageFieldNom("");
    } catch (e) {
      alert("Erreur ajout champ: " + (e?.message || "inconnue"));
    }
  }

  async function removeFieldFromExistingCat(catId, fieldId) {
    const c = catFromId(catId);
    if (!c) return;
    if (
      !window.confirm(
        "Retirer ce champ de la catégorie?\n(Les valeurs déjà saisies resteront dans les produits existants, mais ne seront plus affichées ici.)"
      )
    )
      return;

    const nextFields = (c.fields || []).filter((f) => f.id !== fieldId);
    try {
      await updateDoc(doc(db, "categories", catId), { fields: nextFields });
    } catch (e) {
      alert("Erreur retrait champ: " + (e?.message || "inconnue"));
    }
  }

  // ---------------------------
  // actions catégories (CRUD)
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
        fields: (catFields || []).filter((f) => f.nom && f.nom.trim()),
        createdAt: serverTimestamp(),
      });
      setCatNom("");
      setCatColor(DEFAULT_COLOR);
      setCatFields([]);
      setCatFieldNom("");
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
      if (editCategorieId === catId) setEditCategorieId("");
      if (catManageId === catId) setCatManageId(null);
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
  function setDetailValue(fieldId, value) {
    setDetails((d) => ({ ...(d || {}), [fieldId]: value }));
  }
  function setEditDetailValue(fieldId, value) {
    setEditDetails((d) => ({ ...(d || {}), [fieldId]: value }));
  }

  function extractLegacyUnite(cat, detailsObj) {
    const fields = (cat?.fields || []).filter((f) => f?.nom);
    const uniteField = fields.find((f) => isUniteLabel(f.nom));
    if (!uniteField) return "";
    return (detailsObj?.[uniteField.id] || "").toString().trim();
  }

  async function ajouterEquipement(e) {
    e.preventDefault();
    setMsg("");

    const n = nomEq.trim();
    if (!n) return setMsg("⚠️ Entre un nom d’équipement.");
    if (!categorieId) return setMsg("⚠️ Choisis une catégorie.");

    const cat = catFromId(categorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    const fields = (cat.fields || []).filter((f) => f?.id && (f.nom || "").trim());
    const cleaned = {};
    for (const f of fields) cleaned[f.id] = (details?.[f.id] || "").toString();

    const uniteLegacy = extractLegacyUnite(cat, cleaned);

    try {
      await addDoc(collection(db, "equipements"), {
        nom: n,
        categorieId,
        categorie: cat.nom || "",
        details: cleaned,
        unite: uniteLegacy || "",
        createdAt: serverTimestamp(),
      });

      setNomEq("");
      setCategorieId("");
      setDetails({});
      setMsg("✅ Équipement ajouté!");
    } catch (e2) {
      setMsg("❌ Erreur ajout équipement: " + (e2?.message || "inconnue"));
    }
  }

  // ✅ FIX: startEdit fonctionne aussi pour "Sans catégorie"
  // - On ouvre l'éditeur avec categorieId vide
  // - Et on permet ensuite de choisir une catégorie
  function startEdit(eq) {
    const cid = (eq.categorieId || "").trim();
    const cat = cid ? catFromId(cid) : null;

    setEditId(eq.id);
    setEditNom(eq.nom || "");
    setEditCategorieId(cid || "");

    if (!cid || !cat) {
      // sans catégorie => pas de champs connus (on laisse vide, puis l'utilisateur choisit une catégorie)
      setEditDetails({});
      setMsg("");
      return;
    }

    const fields = (cat?.fields || []).filter((f) => f?.id);
    const base = { ...(eq.details || {}) };

    if (cat && Object.keys(base).length === 0 && (eq.unite || "").trim()) {
      const uf = fields.find((f) => isUniteLabel(f.nom));
      if (uf) base[uf.id] = eq.unite || "";
    }

    const next = {};
    for (const f of fields) next[f.id] = (base?.[f.id] ?? "").toString();
    setEditDetails(next);

    setMsg("");
  }

  function cancelEdit() {
    setEditId(null);
    setEditNom("");
    setEditCategorieId("");
    setEditDetails({});
  }

  // remappe editDetails si on change la catégorie en mode édition
  useEffect(() => {
    if (!editId) return;
    if (!editCategorieId) {
      setEditDetails({});
      return;
    }
    const fields = fieldsForCat(editCategorieId);
    setEditDetails((prev) => {
      const next = {};
      for (const f of fields) next[f.id] = prev?.[f.id] ?? "";
      return next;
    });
  }, [editCategorieId, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdit() {
    if (!editId) return;
    const n = editNom.trim();
    if (!n) return setMsg("⚠️ Nom vide.");

    // ✅ maintenant permis de passer de "Sans catégorie" -> une catégorie
    if (!editCategorieId) return setMsg("⚠️ Choisis une catégorie pour sauvegarder.");

    const cat = catFromId(editCategorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    const fields = (cat.fields || []).filter((f) => f?.id && (f.nom || "").trim());
    const cleaned = {};
    for (const f of fields) cleaned[f.id] = (editDetails?.[f.id] || "").toString();

    const uniteLegacy = extractLegacyUnite(cat, cleaned);

    try {
      await updateDoc(doc(db, "equipements", editId), {
        nom: n,
        categorieId: editCategorieId,
        categorie: cat.nom || "",
        details: cleaned,
        unite: uniteLegacy || "",
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

  // ✅ (1) Les sous-catégories (ex: Marque) deviennent des COLONNES du tableau
  // => Header = Nom + chaque champ + Actions
  function columnsForCat(cat) {
    const fields = (cat?.fields || []).filter((f) => f?.id && (f.nom || "").trim());
    return fields;
  }

  function valueForField(eq, field) {
    const d = eq.details || {};
    const v = (d?.[field.id] ?? "").toString().trim();
    if (v) return v;

    // fallback legacy unite
    if (isUniteLabel(field.nom) && (eq.unite || "").trim()) return (eq.unite || "").toString();

    return "";
  }

  const selectedCat = categorieId ? catFromId(categorieId) : null;
  const selectedFields = selectedCat ? (selectedCat.fields || []) : [];

  const editCat = editCategorieId ? catFromId(editCategorieId) : null;
  const editFields = editCat ? (editCat.fields || []) : [];

  return (
    <div style={{ background: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Équipements</div>
          <div style={{ fontSize: 13, color: "rgba(15,23,42,0.65)", marginTop: 4 }}>
            Les champs (ex: Marque) apparaissent comme colonnes dans le tableau de chaque catégorie.
          </div>
        </div>

        {/* + catégories */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => {
              setShowAddCat((v) => !v);
              setCatNom("");
              setCatColor(DEFAULT_COLOR);
              setCatFields([]);
              setCatFieldNom("");
            }}
            title="Ajouter une catégorie"
            style={{
              height: 38,
              width: 38,
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 900,
              fontSize: 18,
            }}
          >
            +
          </button>

          {showAddCat && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 44,
                width: 420,
                background: "#fff",
                border: "1px solid rgba(15,23,42,0.10)",
                borderRadius: 14,
                padding: 10,
                boxShadow: "0 14px 35px rgba(0,0,0,0.12)",
                zIndex: 20,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Nouvelle catégorie</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8 }}>
                <input
                  value={catNom}
                  onChange={(e) => setCatNom(e.target.value)}
                  placeholder="Nom (ex: Arrimage)"
                  style={inputStyle}
                />
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  title="Couleur"
                  style={{
                    height: 42,
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(15,23,42,0.10)",
                    background: "#fff",
                  }}
                />
                <button type="button" onClick={ajouterCategorie} style={btnStyle}>
                  Ajouter
                </button>
              </div>

              {/* Sous-catégories (champs) */}
              <div style={{ marginTop: 12, fontWeight: 900 }}>Sous-catégories (colonnes)</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <input
                  value={catFieldNom}
                  onChange={(e) => setCatFieldNom(e.target.value)}
                  placeholder="Ex: Marque, Unité, Infos..."
                  style={inputStyle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      ajouterChampTemp();
                    }
                  }}
                />
                <button type="button" onClick={ajouterChampTemp} style={btnStyle}>
                  + Colonne
                </button>
              </div>

              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {catFields.length === 0 ? (
                  <div style={emptyStyle}>Aucune colonne. (Tu peux quand même en ajouter plus tard.)</div>
                ) : (
                  catFields.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "rgba(15,23,42,0.05)",
                        border: "1px solid rgba(15,23,42,0.10)",
                        fontWeight: 800,
                      }}
                    >
                      {f.nom}
                      <button
                        type="button"
                        onClick={() => retirerChampTemp(f.id)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          border: "1px solid rgba(239,68,68,0.35)",
                          background: "rgba(239,68,68,0.12)",
                          cursor: "pointer",
                          fontWeight: 900,
                          lineHeight: "22px",
                        }}
                        title="Retirer"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 14, fontWeight: 900 }}>Catégories</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {catsSorted.length === 0 ? (
                  <div style={emptyStyle}>Aucune catégorie.</div>
                ) : (
                  catsSorted.map((c) => {
                    const managing = catManageId === c.id;
                    return (
                      <div
                        key={c.id}
                        style={{
                          border: "1px solid rgba(15,23,42,0.10)",
                          borderRadius: 12,
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 110px auto auto",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{c.nom}</div>

                          <input
                            type="color"
                            value={c.color || DEFAULT_COLOR}
                            onChange={(e) => changerCouleurCategorie(c.id, e.target.value)}
                            title="Couleur"
                            style={{
                              height: 34,
                              width: "100%",
                              borderRadius: 10,
                              border: "1px solid rgba(15,23,42,0.10)",
                              background: "#fff",
                            }}
                          />

                          <button type="button" onClick={() => toggleManageCat(c.id)} style={ghostStyleSmall} title="Gérer colonnes">
                            Colonnes
                          </button>

                          <button type="button" onClick={() => supprimerCategorie(c.id)} style={dangerSmallStyle} title="Supprimer">
                            X
                          </button>
                        </div>

                        {managing && (
                          <div style={{ borderTop: "1px dashed rgba(15,23,42,0.15)", paddingTop: 10, display: "grid", gap: 8 }}>
                            <div style={{ fontWeight: 900 }}>Colonnes de “{c.nom}”</div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                              <input
                                value={catManageFieldNom}
                                onChange={(e) => setCatManageFieldNom(e.target.value)}
                                placeholder="Ajouter une colonne (ex: Marque)"
                                style={inputStyle}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addFieldToExistingCat(c.id);
                                  }
                                }}
                              />
                              <button type="button" onClick={() => addFieldToExistingCat(c.id)} style={btnStyle}>
                                + Ajouter
                              </button>
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {(c.fields || []).length === 0 ? (
                                <div style={emptyStyle}>Aucune colonne.</div>
                              ) : (
                                (c.fields || []).map((f) => (
                                  <div
                                    key={f.id}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      background: "rgba(15,23,42,0.05)",
                                      border: "1px solid rgba(15,23,42,0.10)",
                                      fontWeight: 800,
                                    }}
                                  >
                                    {f.nom}
                                    <button
                                      type="button"
                                      onClick={() => removeFieldFromExistingCat(c.id, f.id)}
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 999,
                                        border: "1px solid rgba(239,68,68,0.35)",
                                        background: "rgba(239,68,68,0.12)",
                                        cursor: "pointer",
                                        fontWeight: 900,
                                        lineHeight: "22px",
                                      }}
                                      title="Retirer"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {msg ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 12,
            background: "rgba(15,23,42,0.03)",
            border: "1px solid rgba(15,23,42,0.10)",
          }}
        >
          {msg}
        </div>
      ) : null}

      {/* Ajout équipement */}
      <form
        onSubmit={ajouterEquipement}
        style={{
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: 16,
          padding: 14,
          boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Ajouter un équipement</div>

        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr auto", gap: 8, alignItems: "center" }}>
          <input value={nomEq} onChange={(e) => setNomEq(e.target.value)} placeholder="Nom" style={inputStyle} />

          <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)} style={inputStyle}>
            <option value="">Catégorie…</option>
            {catsSorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>

          <button type="submit" style={btnStyle}>
            + Ajouter
          </button>
        </div>

        {/* Champs dynamiques */}
        {categorieId && (
          <div style={{ marginTop: 10 }}>
            {selectedFields.length === 0 ? (
              <div style={emptyStyle}>Cette catégorie n’a pas de colonnes. (Ajoute-en via “Colonnes” dans les catégories.)</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {selectedFields.map((f) => (
                  <input
                    key={f.id}
                    value={(details?.[f.id] ?? "").toString()}
                    onChange={(e) => setDetailValue(f.id, e.target.value)}
                    placeholder={f.nom}
                    style={inputStyle}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </form>

      {/* Équipements par catégorie (tableau: Nom + colonnes champs) */}
      <div
        style={{
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: 16,
          padding: 14,
          boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Équipements par catégorie</div>

        <div style={{ display: "grid", gap: 14 }}>
          {catsSorted.map((cat) => {
            const list = equipementsParCategorie.map.get(cat.id) || [];
            if (list.length === 0) return null;

            const base = cat.color || DEFAULT_COLOR;
            const cols = columnsForCat(cat);

            return (
              <div
                key={cat.id}
                style={{
                  border: `1px solid ${withAlpha(base, 0.35)}`,
                  borderRadius: 16,
                  padding: 12,
                  background: withAlpha(base, 0.12),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: base, display: "inline-block" }} />
                    {cat.nom}
                  </div>
                  <div style={{ color: "rgba(15,23,42,0.65)", fontWeight: 800, fontSize: 13 }}>
                    {list.length} item{list.length > 1 ? "s" : ""}
                  </div>
                </div>

                {/* TABLE */}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Nom</th>
                        {cols.map((c) => (
                          <th key={c.id} style={thStyle}>
                            {c.nom}
                          </th>
                        ))}
                        <th style={thStyleRight}>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {list.map((eq) => {
                        const isEdit = editId === eq.id;

                        return (
                          <tr key={eq.id}>
                            {isEdit ? (
                              <>
                                <td style={tdStyle}>
                                  <input value={editNom} onChange={(e) => setEditNom(e.target.value)} style={inputStyle} />
                                  <div style={{ marginTop: 8 }}>
                                    <select
                                      value={editCategorieId}
                                      onChange={(e) => setEditCategorieId(e.target.value)}
                                      style={inputStyle}
                                    >
                                      <option value="">Catégorie…</option>
                                      {catsSorted.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.nom}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </td>

                                {/* colonnes */}
                                {cols.map((field) => (
                                  <td key={field.id} style={tdStyle}>
                                    <input
                                      value={(editDetails?.[field.id] ?? "").toString()}
                                      onChange={(e) => setEditDetailValue(field.id, e.target.value)}
                                      placeholder={field.nom}
                                      style={inputStyle}
                                    />
                                  </td>
                                ))}

                                <td style={tdStyleRight}>
                                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button type="button" onClick={saveEdit} style={btnStyleSmall}>
                                      OK
                                    </button>
                                    <button type="button" onClick={cancelEdit} style={ghostStyleSmall}>
                                      Annuler
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td style={tdStyle}>
                                  <div style={{ fontWeight: 900 }}>{eq.nom}</div>
                                </td>

                                {cols.map((field) => (
                                  <td key={field.id} style={tdStyle}>
                                    {valueForField(eq, field) || <span style={{ color: "rgba(15,23,42,0.55)" }}>—</span>}
                                  </td>
                                ))}

                                <td style={tdStyleRight}>
                                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button type="button" onClick={() => startEdit(eq)} style={ghostStyleSmall}>
                                      Modifier
                                    </button>
                                    <button type="button" onClick={() => supprimerEquipement(eq.id)} style={dangerSmallStyle}>
                                      X
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* ✅ Sans catégorie avec "Modifier" qui marche (tu peux choisir une catégorie) */}
          {equipementsParCategorie.autres.length > 0 && (
            <div
              style={{
                border: "1px dashed rgba(15,23,42,0.20)",
                borderRadius: 16,
                padding: 12,
                background: "rgba(15,23,42,0.03)",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Sans catégorie</div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Nom</th>
                      {sansCatFields.map((f) => (
                        <th key={f.id} style={thStyle}>
                          {f.nom}
                        </th>
                      ))}
                      <th style={thStyleRight}>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {equipementsParCategorie.autres.map((eq) => {
                      const isEdit = editId === eq.id;

                      return (
                        <tr key={eq.id}>
                          {isEdit ? (
                            <>
                              <td style={tdStyle}>
                                <input value={editNom} onChange={(e) => setEditNom(e.target.value)} style={inputStyle} />
                                <div style={{ marginTop: 8 }}>
                                  <select value={editCategorieId} onChange={(e) => setEditCategorieId(e.target.value)} style={inputStyle}>
                                    <option value="">Catégorie…</option>
                                    {catsSorted.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.nom}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {editCategorieId ? (
                                  <div style={{ marginTop: 8, ...emptyStyle }}>
                                    Choisis une catégorie puis remplis ses champs (colonnes) dans la section de la catégorie après sauvegarde.
                                  </div>
                                ) : null}
                              </td>

                              {sansCatFields.map((f) => (
                                <td key={f.id} style={tdStyle}>
                                  {f.id === "legacy:unite" ? (
                                    <input
                                      value={(eq.unite || "").toString()}
                                      disabled
                                      style={{ ...inputStyle, background: "rgba(15,23,42,0.03)" }}
                                    />
                                  ) : (
                                    <div style={{ color: "rgba(15,23,42,0.60)" }}>—</div>
                                  )}
                                </td>
                              ))}

                              <td style={tdStyleRight}>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                  <button type="button" onClick={saveEdit} style={btnStyleSmall}>
                                    OK
                                  </button>
                                  <button type="button" onClick={cancelEdit} style={ghostStyleSmall}>
                                    Annuler
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={tdStyle}>
                                <div style={{ fontWeight: 900 }}>{eq.nom}</div>
                              </td>

                              {sansCatFields.map((f) => (
                                <td key={f.id} style={tdStyle}>
                                  {f.id === "legacy:unite" ? (eq.unite || "—") : <span style={{ color: "rgba(15,23,42,0.55)" }}>—</span>}
                                </td>
                              ))}

                              <td style={tdStyleRight}>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                  <button type="button" onClick={() => startEdit(eq)} style={ghostStyleSmall}>
                                    Modifier
                                  </button>
                                  <button type="button" onClick={() => supprimerEquipement(eq.id)} style={dangerSmallStyle}>
                                    X
                                  </button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
  width: "100%",
  boxSizing: "border-box",
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
  whiteSpace: "nowrap",
};
const dangerSmallStyle = {
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.12)",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 12px",
  whiteSpace: "nowrap",
};
const emptyStyle = {
  padding: 10,
  borderRadius: 12,
  background: "rgba(15,23,42,0.03)",
  border: "1px dashed rgba(15,23,42,0.12)",
  color: "rgba(15,23,42,0.65)",
  fontSize: 13,
};
const thStyle = {
  textAlign: "left",
  padding: "10px 10px",
  fontSize: 13,
  fontWeight: 900,
  color: "rgba(15,23,42,0.75)",
  borderBottom: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.6)",
  position: "sticky",
  top: 0,
};
const thStyleRight = {
  ...thStyle,
  textAlign: "right",
};
const tdStyle = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(15,23,42,0.08)",
  verticalAlign: "top",
};
const tdStyleRight = {
  ...tdStyle,
  textAlign: "right",
};
