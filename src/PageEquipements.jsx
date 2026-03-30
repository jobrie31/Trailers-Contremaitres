// src/PageEquipements.jsx
import React, { useEffect, useMemo, useState } from "react";
import "./PageEquipements.css";
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
const UNCATEGORIZED_ID = "__uncat__";

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

/* tri alpha qui ignore emojis */
function stripEmojiForSort(s) {
  const str = (s || "").toString();
  return str
    .replace(/\uFE0F/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function alphaCompareIgnoreEmoji(a, b) {
  return stripEmojiForSort(a).localeCompare(stripEmojiForSort(b), "fr");
}

function makeEmptyVariante(fields = []) {
  const details = {};
  for (const f of fields) details[f.id] = "";
  return {
    id: uid(),
    nom: "",
    details,
  };
}

function sanitizeFields(rawFields) {
  return (Array.isArray(rawFields) ? rawFields : [])
    .map((f) => {
      if (typeof f === "string") return { id: uid(), nom: f };
      if (f && typeof f === "object") return { id: f.id || uid(), nom: f.nom || "" };
      return null;
    })
    .filter((x) => x && x.nom && x.nom.trim());
}

function sanitizeVariants(rawVariants, catFields) {
  const fields = Array.isArray(catFields) ? catFields : [];
  const arr = Array.isArray(rawVariants) ? rawVariants : [];
  return arr
    .map((v) => {
      const details = {};
      for (const f of fields) {
        details[f.id] = (v?.details?.[f.id] ?? "").toString();
      }
      return {
        id: v?.id || uid(),
        nom: (v?.nom || "").toString(),
        details,
      };
    })
    .filter((v) => v.nom.trim() || Object.values(v.details || {}).some((x) => String(x || "").trim()));
}

export default function PageEquipements() {
  const [cats, setCats] = useState([]);
  const catsSorted = useMemo(
    () => [...cats].sort((a, b) => alphaCompareIgnoreEmoji(a.nom || "", b.nom || "")),
    [cats]
  );

  // popover "+ catégorie"
  const [showAddCat, setShowAddCat] = useState(false);
  const [catNom, setCatNom] = useState("");
  const [catIcon, setCatIcon] = useState("");
  const [catColor, setCatColor] = useState(DEFAULT_COLOR);

  // popover "+ équipement"
  const [showAddEq, setShowAddEq] = useState(false);

  // champs catégorie
  const [catFieldNom, setCatFieldNom] = useState("");
  const [catFields, setCatFields] = useState([]);
  const [catManageId, setCatManageId] = useState(null);
  const [catManageFieldNom, setCatManageFieldNom] = useState("");

  const [equipements, setEquipements] = useState([]);

  // ajout équipement
  const [nomEq, setNomEq] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [variantes, setVariantes] = useState([]);
  const [msg, setMsg] = useState("");

  // edit équipement
  const [editId, setEditId] = useState(null);
  const [editNom, setEditNom] = useState("");
  const [editCategorieId, setEditCategorieId] = useState("");

  // edit types
  const [typeEditEquipId, setTypeEditEquipId] = useState(null);
  const [typeEditNom, setTypeEditNom] = useState("");
  const [typeEditCategorieId, setTypeEditCategorieId] = useState("");
  const [typeEditVariantes, setTypeEditVariantes] = useState([]);
  const [typeEditVarianteId, setTypeEditVarianteId] = useState(null);

  // onglet catégorie ouvert
  const [activeCatId, setActiveCatId] = useState("");

  // lignes ouvertes
  const [openEquipIds, setOpenEquipIds] = useState({});

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
            const fields = sanitizeFields(data.fields);
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

  // champs dynamiques "Sans catégorie"
  const sansCatFields = useMemo(() => {
    const set = new Map();
    for (const eq of equipements) {
      const cid = (eq.categorieId || "").trim();
      if (cid) continue;

      const variants = Array.isArray(eq.variantes) ? eq.variantes : [];
      for (const v of variants) {
        const d = v?.details || {};
        for (const k of Object.keys(d)) {
          const val = (d?.[k] ?? "").toString().trim();
          if (!val) continue;
          set.set(k, "Infos");
          break;
        }
      }

      const legacyDetails = eq.details || {};
      for (const k of Object.keys(legacyDetails)) {
        const val = (legacyDetails?.[k] ?? "").toString().trim();
        if (!val) continue;
        set.set("legacy:infos", "Infos");
        break;
      }
    }
    const arr = [];
    for (const [id, nom] of set.entries()) arr.push({ id, nom });
    return arr;
  }, [equipements]);

  // remap variantes when changing category (add eq)
  useEffect(() => {
    if (!categorieId) {
      setVariantes([]);
      return;
    }
    const fields = fieldsForCat(categorieId);
    setVariantes((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return [makeEmptyVariante(fields)];
      return prev.map((v) => {
        const nextDetails = {};
        for (const f of fields) nextDetails[f.id] = v?.details?.[f.id] ?? "";
        return { ...v, details: nextDetails };
      });
    });
  }, [categorieId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------
  // catégories (champs)
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
        "Retirer ce champ de la catégorie?\n(Les valeurs déjà saisies resteront dans les équipements existants, mais ne seront plus affichées ici.)"
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
  // catégories (CRUD)
  // ---------------------------
  async function ajouterCategorie() {
    setMsg("");
    const n = catNom.trim();
    if (!n) return;

    const deja = cats.some((c) => (c.nom || "").trim().toLowerCase() === n.toLowerCase());
    if (deja) return setMsg("⚠️ Cette catégorie existe déjà.");

    try {
      const ref = await addDoc(collection(db, "categories"), {
        nom: n,
        icon: (catIcon || "").trim(),
        color: (catColor || DEFAULT_COLOR).trim(),
        fields: (catFields || []).filter((f) => f.nom && f.nom.trim()),
        createdAt: serverTimestamp(),
      });

      setCatNom("");
      setCatIcon("");
      setCatColor(DEFAULT_COLOR);
      setCatFields([]);
      setCatFieldNom("");
      setShowAddCat(false);
      setMsg("✅ Catégorie ajoutée.");
      setActiveCatId(ref.id);
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
      if (activeCatId === catId) setActiveCatId("");
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

  async function changerIconCategorie(catId, newIcon) {
    try {
      await updateDoc(doc(db, "categories", catId), { icon: (newIcon || "").trim() });
    } catch (e) {
      alert("Erreur changement emoji: " + (e?.message || "inconnue"));
    }
  }

  // ---------------------------
  // variantes helpers
  // ---------------------------
  function addVariante() {
    const fields = fieldsForCat(categorieId);
    setVariantes((arr) => [...arr, makeEmptyVariante(fields)]);
  }

  function removeVariante(varianteId) {
    setVariantes((arr) => arr.filter((v) => v.id !== varianteId));
  }

  function setVarianteNom(varianteId, value) {
    setVariantes((arr) => arr.map((v) => (v.id === varianteId ? { ...v, nom: value } : v)));
  }

  function setVarianteDetailValue(varianteId, fieldId, value) {
    setVariantes((arr) =>
      arr.map((v) =>
        v.id === varianteId
          ? { ...v, details: { ...(v.details || {}), [fieldId]: value } }
          : v
      )
    );
  }

  function addTypeEditVariante() {
    const fields = fieldsForCat(typeEditCategorieId);
    const nv = makeEmptyVariante(fields);
    setTypeEditVariantes((arr) => [...arr, nv]);
    setTypeEditVarianteId(nv.id);
  }

  function removeTypeEditVariante(varianteId) {
    setTypeEditVariantes((arr) => {
      const next = arr.filter((v) => v.id !== varianteId);
      setTypeEditVarianteId((current) => {
        if (current && current !== varianteId) return current;
        return next[0]?.id || null;
      });
      return next;
    });
  }

  function setTypeEditVarianteNom(varianteId, value) {
    setTypeEditVariantes((arr) => arr.map((v) => (v.id === varianteId ? { ...v, nom: value } : v)));
  }

  function setTypeEditVarianteDetailValue(varianteId, fieldId, value) {
    setTypeEditVariantes((arr) =>
      arr.map((v) =>
        v.id === varianteId
          ? { ...v, details: { ...(v.details || {}), [fieldId]: value } }
          : v
      )
    );
  }

  function openEquipRow(eqId) {
    setOpenEquipIds((prev) => ({ ...prev, [eqId]: true }));
  }

  function onClickEquipRow(eq) {
    const isEdit = editId === eq.id;
    if (!isEdit) {
      setOpenEquipIds((prev) => ({ ...prev, [eq.id]: !prev[eq.id] }));
    }
  }

  function loadTypeEditFromEquip(eq, varianteId = null) {
    const cid = (eq?.categorieId || "").trim();
    const cat = cid ? catFromId(cid) : null;
    const fields = (cat?.fields || []).filter((f) => f?.id);

    const existingVariants =
      Array.isArray(eq?.variantes) && eq.variantes.length > 0
        ? eq.variantes
        : [
            {
              id: uid(),
              nom: eq?.nom || "",
              details: eq?.details || {},
            },
          ];

    const nextVariants = existingVariants.map((v) => {
      const nextDetails = {};
      for (const f of fields) nextDetails[f.id] = (v?.details?.[f.id] ?? "").toString();
      return {
        id: v?.id || uid(),
        nom: (v?.nom || "").toString(),
        details: nextDetails,
      };
    });

    setTypeEditEquipId(eq?.id || null);
    setTypeEditNom(eq?.nom || "");
    setTypeEditCategorieId(cid || "");
    setTypeEditVariantes(nextVariants);
    setTypeEditVarianteId(varianteId || nextVariants[0]?.id || null);
  }

  function cancelTypeEdit() {
    setTypeEditEquipId(null);
    setTypeEditNom("");
    setTypeEditCategorieId("");
    setTypeEditVariantes([]);
    setTypeEditVarianteId(null);
  }

  function startTypeEdit(eq, varianteId = null) {
    cancelEdit();
    openEquipRow(eq.id);
    loadTypeEditFromEquip(eq, varianteId);
    setMsg("");
  }

  function onClickVariantRow(eq, varianteId) {
    startTypeEdit(eq, varianteId || null);
  }

  // ---------------------------
  // équipements
  // ---------------------------
  async function ajouterEquipement(e) {
    e.preventDefault();
    setMsg("");

    const n = nomEq.trim();
    if (!n) return setMsg("⚠️ Entre un nom d’équipement.");
    if (!categorieId) return setMsg("⚠️ Choisis une catégorie.");

    const cat = catFromId(categorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    const fields = (cat.fields || []).filter((f) => f?.id && (f.nom || "").trim());
    const cleanedVariantes = (variantes || [])
      .map((v) => {
        const cleaned = {};
        for (const f of fields) cleaned[f.id] = (v?.details?.[f.id] || "").toString();
        return {
          id: v?.id || uid(),
          nom: (v?.nom || "").toString().trim(),
          details: cleaned,
        };
      })
      .filter((v) => v.nom || Object.values(v.details || {}).some((x) => String(x || "").trim()));

    if (cleanedVariantes.length === 0) {
      return setMsg("⚠️ Ajoute au moins un type / modèle dans cet équipement.");
    }

    try {
      await addDoc(collection(db, "equipements"), {
        nom: n,
        categorieId,
        categorie: cat.nom || "",
        variantes: cleanedVariantes,
        createdAt: serverTimestamp(),
      });

      setNomEq("");
      setCategorieId("");
      setVariantes([]);
      setMsg("✅ Équipement ajouté!");
      setActiveCatId(categorieId);
      setShowAddEq(false);
    } catch (e2) {
      setMsg("❌ Erreur ajout équipement: " + (e2?.message || "inconnue"));
    }
  }

  function startEdit(eq) {
    const cid = (eq.categorieId || "").trim();

    cancelTypeEdit();
    setEditId(eq.id);
    setEditNom(eq.nom || "");
    setEditCategorieId(cid || "");
    setMsg("");
    setActiveCatId(cid || UNCATEGORIZED_ID);
  }

  function cancelEdit() {
    setEditId(null);
    setEditNom("");
    setEditCategorieId("");
  }

  useEffect(() => {
    if (!typeEditEquipId) return;
    if (!typeEditCategorieId) {
      setTypeEditVariantes([]);
      return;
    }
    const fields = fieldsForCat(typeEditCategorieId);
    setTypeEditVariantes((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return [makeEmptyVariante(fields)];
      return prev.map((v) => {
        const nextDetails = {};
        for (const f of fields) nextDetails[f.id] = v?.details?.[f.id] ?? "";
        return { ...v, details: nextDetails };
      });
    });
  }, [typeEditCategorieId, typeEditEquipId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdit() {
    if (!editId) return;
    const n = editNom.trim();
    if (!n) return setMsg("⚠️ Nom vide.");
    if (!editCategorieId) return setMsg("⚠️ Choisis une catégorie pour sauvegarder.");

    const cat = catFromId(editCategorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    try {
      const eq = equipements.find((x) => x.id === editId) || null;
      await updateDoc(doc(db, "equipements", editId), {
        nom: n,
        categorieId: editCategorieId,
        categorie: cat.nom || "",
        variantes: Array.isArray(eq?.variantes) ? eq.variantes : [],
      });
      setMsg("✅ Modifié!");
      cancelEdit();
      setActiveCatId(editCategorieId);
    } catch (e) {
      setMsg("❌ Erreur modification: " + (e?.message || "inconnue"));
    }
  }

  async function saveTypeEdit() {
    if (!typeEditEquipId) return;
    if (!typeEditCategorieId) return setMsg("⚠️ Catégorie introuvable pour les types.");

    const cat = catFromId(typeEditCategorieId);
    if (!cat) return setMsg("⚠️ Catégorie introuvable.");

    const fields = (cat.fields || []).filter((f) => f?.id && (f.nom || "").trim());
    const cleanedVariantes = (typeEditVariantes || [])
      .map((v) => {
        const cleaned = {};
        for (const f of fields) cleaned[f.id] = (v?.details?.[f.id] || "").toString();
        return {
          id: v?.id || uid(),
          nom: (v?.nom || "").toString().trim(),
          details: cleaned,
        };
      })
      .filter((v) => v.nom || Object.values(v.details || {}).some((x) => String(x || "").trim()));

    if (cleanedVariantes.length === 0) {
      return setMsg("⚠️ Garde au moins un type / modèle.");
    }

    try {
      await updateDoc(doc(db, "equipements", typeEditEquipId), {
        nom: typeEditNom,
        categorieId: typeEditCategorieId,
        categorie: cat.nom || "",
        variantes: cleanedVariantes,
      });
      setMsg("✅ Types modifiés!");
      cancelTypeEdit();
      setActiveCatId(typeEditCategorieId);
    } catch (e) {
      setMsg("❌ Erreur modification des types: " + (e?.message || "inconnue"));
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

  function toggleOpenEquip(eqId) {
    setOpenEquipIds((prev) => ({ ...prev, [eqId]: !prev[eqId] }));
  }

  // ---------------------------
  // group by cat
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
      arr.sort((a, b) => alphaCompareIgnoreEmoji(a.nom || "", b.nom || ""));
      map.set(k, arr);
    }
    autres.sort((a, b) => alphaCompareIgnoreEmoji(a.nom || "", b.nom || ""));

    return { map, autres };
  }, [equipements, catsSorted]);

  const categoryTabs = useMemo(() => {
    const tabs = catsSorted.map((c) => ({
      id: c.id,
      nom: c.nom || "",
      icon: (c.icon || "").trim(),
      color: c.color || DEFAULT_COLOR,
      count: (equipementsParCategorie.map.get(c.id) || []).length,
    }));

    if ((equipementsParCategorie.autres || []).length > 0) {
      tabs.push({
        id: UNCATEGORIZED_ID,
        nom: "Sans catégorie",
        icon: "",
        color: "#64748B",
        count: equipementsParCategorie.autres.length,
      });
    }
    return tabs;
  }, [catsSorted, equipementsParCategorie]);

  useEffect(() => {
    if (activeCatId) {
      const ok = categoryTabs.some((t) => t.id === activeCatId);
      if (!ok) setActiveCatId("");
      return;
    }
    if (categoryTabs.length === 0) return;
    const firstWithItems = categoryTabs.find((t) => (t.count || 0) > 0);
    setActiveCatId((firstWithItems || categoryTabs[0]).id);
  }, [categoryTabs, activeCatId]);

  function columnsForCat(cat) {
    return (cat?.fields || []).filter((f) => f?.id && (f.nom || "").trim());
  }

  const selectedCat = categorieId ? catFromId(categorieId) : null;
  const selectedFields = selectedCat ? selectedCat.fields || [] : [];

  const isUncatActive = activeCatId === UNCATEGORIZED_ID;
  const activeCat = !isUncatActive ? catFromId(activeCatId) : null;

  const activeColor = isUncatActive ? "#64748B" : activeCat?.color || DEFAULT_COLOR;
  const activeIcon = !isUncatActive ? (activeCat?.icon || "").trim() : "";
  const activeCols = isUncatActive ? [] : columnsForCat(activeCat);
  const activeList = isUncatActive
    ? equipementsParCategorie.autres
    : equipementsParCategorie.map.get(activeCatId) || [];

  const activeBg = withAlpha(activeColor, 0.12);
  const activeBorder = withAlpha(activeColor, 0.35);

  return (
    <div className="peq-page">
      <div className="peq-header">
        <div>
          <div className="peq-title">Équipements</div>
          <div className="peq-subtitle">
            Clique une catégorie en haut pour voir sa liste complète.
          </div>
        </div>

        <div className="peq-rightBtns">
          {/* Ajouter un équipement */}
          <div className="peq-addcatWrap">
            <button
              type="button"
              className="peq-iconBtn"
              title="Ajouter un équipement"
              onClick={() => {
                setShowAddEq((v) => !v);
                setShowAddCat(false);
                setMsg("");

                const preset = !isUncatActive && activeCatId ? activeCatId : catsSorted[0]?.id || "";
                setCategorieId(preset || "");
                setNomEq("");
                setVariantes(preset ? [makeEmptyVariante(fieldsForCat(preset))] : []);
              }}
            >
              Ajouter un équipement
            </button>

            {showAddEq && (
              <div className="peq-popover peq-popoverEq">
                <div className="peq-popTitle">Nouvel équipement</div>

                <form onSubmit={ajouterEquipement} className="peq-eqForm">
                  <div className="peq-eqRow">
                    <input
                      value={nomEq}
                      onChange={(e) => setNomEq(e.target.value)}
                      placeholder="Nom de l’équipement (ex: Perceuse)"
                      className="peq-input"
                      autoFocus
                    />

                    <select
                      value={categorieId}
                      onChange={(e) => setCategorieId(e.target.value)}
                      className="peq-input"
                      title="Catégorie"
                    >
                      <option value="">Catégorie…</option>
                      {catsSorted.map((c) => (
                        <option key={c.id} value={c.id}>
                          {(c.icon || "").trim() ? `${(c.icon || "").trim()} ` : ""}
                          {c.nom}
                        </option>
                      ))}
                    </select>

                    <button type="submit" className="peq-btn">
                      Ajouter
                    </button>
                  </div>

                  {categorieId && (
                    <div className="peq-dynFields">
                      <div className="peq-blockTitle">Types / modèles de cet équipement</div>

                      {variantes.length === 0 ? (
                        <div className="peq-empty">
                          Aucun type. Ajoute au moins un modèle dans cet équipement.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                          {variantes.map((v, idx) => (
                            <div
                              key={v.id}
                              style={{
                                border: "1px solid rgba(15, 23, 42, 0.1)",
                                borderRadius: 12,
                                padding: 10,
                                background: "rgba(255,255,255,0.75)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  marginBottom: 8,
                                }}
                              >
                                <div style={{ fontWeight: 900 }}>Type {idx + 1}</div>
                                <button
                                  type="button"
                                  onClick={() => removeVariante(v.id)}
                                  className="peq-dangerBtnXs"
                                >
                                  X
                                </button>
                              </div>

                              <div className="peq-gridDynInputs">
                                <input
                                  value={v.nom}
                                  onChange={(e) => setVarianteNom(v.id, e.target.value)}
                                  placeholder="Marque"
                                  className="peq-input"
                                />

                                {selectedFields.map((f) => (
                                  <input
                                    key={f.id}
                                    value={(v.details?.[f.id] ?? "").toString()}
                                    onChange={(e) => setVarianteDetailValue(v.id, f.id, e.target.value)}
                                    placeholder={f.nom}
                                    className="peq-input"
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ marginTop: 10 }}>
                        <button type="button" onClick={addVariante} className="peq-btnSmall">
                          + Ajouter un type
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {msg ? <div className="peq-msg">{msg}</div> : null}

      {/* Barre horizontale catégories */}
      <div className="peq-card">
        <div
          className="peq-cardHeader"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div className="peq-cardTitle" style={{ marginBottom: 0 }}>
            Catégories
          </div>

          {/* Ajouter une catégorie */}
          <div className="peq-addcatWrap">
            <button
              type="button"
              onClick={() => {
                setShowAddCat((v) => !v);
                setShowAddEq(false);
                setCatNom("");
                setCatIcon("");
                setCatColor(DEFAULT_COLOR);
                setCatFields([]);
                setCatFieldNom("");
              }}
              title="Ajouter une catégorie"
              className="peq-iconBtn"
            >
              Ajouter une catégorie
            </button>

            {showAddCat && (
              <div className="peq-popover">
                <div className="peq-popTitle">Nouvelle catégorie</div>

                <div className="peq-gridNewCat">
                  <input
                    value={catNom}
                    onChange={(e) => setCatNom(e.target.value)}
                    placeholder="Nom (ex: Outils)"
                    className="peq-input"
                  />

                  <input
                    value={catIcon}
                    onChange={(e) => setCatIcon(e.target.value)}
                    placeholder="Emoji"
                    title="Emoji (optionnel)"
                    className="peq-input peq-inputEmoji"
                  />

                  <input
                    type="color"
                    value={catColor}
                    onChange={(e) => setCatColor(e.target.value)}
                    title="Couleur"
                    className="peq-colorPicker"
                  />

                  <button type="button" onClick={ajouterCategorie} className="peq-btn">
                    Ajouter
                  </button>
                </div>

                <div className="peq-blockTitle">Colonnes des types / modèles</div>
                <div className="peq-gridAddField">
                  <input
                    value={catFieldNom}
                    onChange={(e) => setCatFieldNom(e.target.value)}
                    placeholder="Ex: Marque, Unité, Voltage..."
                    className="peq-input"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        ajouterChampTemp();
                      }
                    }}
                  />
                  <button type="button" onClick={ajouterChampTemp} className="peq-btn">
                    + Colonne
                  </button>
                </div>

                <div className="peq-chips">
                  {catFields.length === 0 ? (
                    <div className="peq-empty">
                      Aucune colonne. (Tu peux quand même en ajouter plus tard.)
                    </div>
                  ) : (
                    catFields.map((f) => (
                      <div key={f.id} className="peq-chip">
                        {f.nom}
                        <button
                          type="button"
                          onClick={() => retirerChampTemp(f.id)}
                          className="peq-chipX"
                          title="Retirer"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="peq-blockTitle">Catégories</div>
                <div className="peq-catsList">
                  {catsSorted.length === 0 ? (
                    <div className="peq-empty">Aucune catégorie.</div>
                  ) : (
                    catsSorted.map((c) => {
                      const managing = catManageId === c.id;
                      return (
                        <div key={c.id} className="peq-catCard">
                          <div className="peq-catCardTop">
                            <div className="peq-catName">
                              {c.icon ? <span className="peq-emoji">{c.icon}</span> : null}
                              {c.nom}
                            </div>

                            <input
                              defaultValue={(c.icon || "").trim()}
                              placeholder="😀"
                              title="Emoji"
                              className="peq-input peq-inputEmoji peq-inputEmojiSmall"
                              onBlur={(e) => changerIconCategorie(c.id, e.target.value)}
                            />

                            <input
                              type="color"
                              value={c.color || DEFAULT_COLOR}
                              onChange={(e) => changerCouleurCategorie(c.id, e.target.value)}
                              title="Couleur"
                              className="peq-colorPickerSmall"
                            />

                            <button
                              type="button"
                              onClick={() => toggleManageCat(c.id)}
                              className="peq-ghostBtnSmall"
                              title="Gérer colonnes"
                            >
                              Colonnes
                            </button>

                            <button
                              type="button"
                              onClick={() => supprimerCategorie(c.id)}
                              className="peq-dangerBtnSmall"
                              title="Supprimer"
                            >
                              X
                            </button>
                          </div>

                          {managing && (
                            <div className="peq-managePanel">
                              <div className="peq-manageTitle">Colonnes de “{c.nom}”</div>

                              <div className="peq-gridAddField">
                                <input
                                  value={catManageFieldNom}
                                  onChange={(e) => setCatManageFieldNom(e.target.value)}
                                  placeholder="Ajouter une colonne (ex: Marque)"
                                  className="peq-input"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addFieldToExistingCat(c.id);
                                    }
                                  }}
                                />
                                <button type="button" onClick={() => addFieldToExistingCat(c.id)} className="peq-btn">
                                  + Ajouter
                                </button>
                              </div>

                              <div className="peq-chips">
                                {(c.fields || []).length === 0 ? (
                                  <div className="peq-empty">Aucune colonne.</div>
                                ) : (
                                  (c.fields || []).map((f) => (
                                    <div key={f.id} className="peq-chip">
                                      {f.nom}
                                      <button
                                        type="button"
                                        onClick={() => removeFieldFromExistingCat(c.id, f.id)}
                                        className="peq-chipX peq-chipXDanger"
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

        <div className="peq-tabsRow">
          {categoryTabs.length === 0 ? (
            <div className="peq-empty">Aucune catégorie (et aucun équipement).</div>
          ) : (
            categoryTabs.map((t) => {
              const active = t.id === activeCatId;

              const border = active ? withAlpha(t.color, 0.55) : "rgba(15,23,42,0.10)";
              const bg = active ? withAlpha(t.color, 0.14) : "rgba(255,255,255,0.95)";

              return (
                <button
                  key={t.id}
                  type="button"
                  className={`peq-tab ${active ? "isActive" : ""}`}
                  onClick={() => {
                    setActiveCatId(t.id);
                    cancelEdit();
                    setMsg("");
                  }}
                  style={{ borderColor: border, background: bg }}
                  title={t.nom}
                >
                  <span className="peq-tabDot" style={{ background: t.color }} />
                  <span className="peq-tabName">
                    {t.icon ? <span className="peq-emoji">{t.icon}</span> : null}
                    {t.nom}
                  </span>
                  <span className="peq-tabCount">{t.count}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Vue catégorie ouverte */}
      <div className="peq-catPanel" style={{ background: activeBg, borderColor: activeBorder }}>
        <div className="peq-catViewHeader">
          <div className="peq-catViewTitle">
            <span className="peq-dot" style={{ background: activeColor }} />
            {activeIcon ? <span className="peq-emoji">{activeIcon}</span> : null}
            {isUncatActive ? "Sans catégorie" : activeCat?.nom || "Catégorie"}
          </div>
          <div className="peq-catCount">
            {activeList.length} équipement{activeList.length > 1 ? "s" : ""}
          </div>
        </div>

        {activeList.length === 0 ? (
          <div className="peq-empty">Aucun équipement dans cette catégorie.</div>
        ) : (
          <div className="peq-tableWrap">
            <table className="peq-table peq-tableUltraCompact">
              <thead>
                <tr>
                  <th className="peq-th peq-thSm" style={{ width: 44 }}></th>
                  <th className="peq-th peq-thSm">Équipement</th>
                  <th className="peq-th peq-thSm">Nb types</th>
                  <th className="peq-th peq-thSm peq-thRight">Actions</th>
                </tr>
              </thead>

              <tbody>
                {activeList.map((eq) => {
                  const isEdit = editId === eq.id;
                  const isOpen = !!openEquipIds[eq.id];

                  const variants =
                    Array.isArray(eq.variantes) && eq.variantes.length > 0
                      ? sanitizeVariants(eq.variantes, activeCols)
                      : [];

                  const isTypeEdit = typeEditEquipId === eq.id;

                  return (
                    <React.Fragment key={eq.id}>
                      <tr
                        onClick={() => onClickEquipRow(eq)}
                        style={{ cursor: isEdit ? "default" : "pointer" }}
                        title={isEdit ? "" : isOpen ? "Cliquer pour fermer" : "Cliquer pour ouvrir les types"}
                      >
                        {isEdit ? (
                          <>
                            <td className="peq-td peq-tdSm">✏️</td>

                            <td className="peq-td peq-tdSm">
                              <input
                                value={editNom}
                                onChange={(e) => setEditNom(e.target.value)}
                                className="peq-inputXs"
                              />
                              <div className="peq-mt4">
                                <select
                                  value={editCategorieId}
                                  onChange={(e) => setEditCategorieId(e.target.value)}
                                  className="peq-inputXs"
                                >
                                  <option value="">Catégorie…</option>
                                  {catsSorted.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {(c.icon || "").trim() ? `${(c.icon || "").trim()} ` : ""}
                                      {c.nom}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>

                            <td className="peq-td peq-tdSm">
                              {Array.isArray(eq.variantes) ? eq.variantes.length : 0} type
                              {Array.isArray(eq.variantes) && eq.variantes.length > 1 ? "s" : ""}
                            </td>

                            <td className="peq-td peq-tdSm peq-tdRight">
                              <div className="peq-actionsRight">
                                <button type="button" onClick={saveEdit} className="peq-btnXs">
                                  OK
                                </button>
                                <button type="button" onClick={cancelEdit} className="peq-ghostBtnXs">
                                  Annuler
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="peq-td peq-tdSm">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleOpenEquip(eq.id);
                                }}
                                className="peq-ghostBtnXs"
                                title={isOpen ? "Fermer" : "Ouvrir"}
                              >
                                {isOpen ? "−" : "+"}
                              </button>
                            </td>

                            <td className="peq-td peq-tdSm">
                              <div className="peq-eqNameSm">{eq.nom}</div>
                            </td>

                            <td className="peq-td peq-tdSm">
                              {variants.length || (Array.isArray(eq.variantes) ? eq.variantes.length : 0)}
                            </td>

                            <td className="peq-td peq-tdSm peq-tdRight">
                              <div className="peq-actionsRight">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(eq);
                                  }}
                                  className="peq-ghostBtnXs"
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    supprimerEquipement(eq.id);
                                  }}
                                  className="peq-dangerBtnXs"
                                >
                                  X
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>

                      {(isOpen || isEdit || isTypeEdit) && (
                        <tr>
                          <td className="peq-td peq-tdSm" colSpan={4}>
                            <div
                              style={{
                                margin: "6px 0",
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.08)",
                                background: "rgba(255,255,255,0.6)",
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 900,
                                  marginBottom: 8,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <span>Types / modèles de {eq.nom}</span>

                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      startTypeEdit(eq);
                                      addTypeEditVariante();
                                    }}
                                    className="peq-btnXs"
                                  >
                                    + Ajouter un type
                                  </button>

                                  {isTypeEdit ? (
                                    <>
                                      <button type="button" onClick={saveTypeEdit} className="peq-btnXs">
                                        OK
                                      </button>
                                      <button type="button" onClick={cancelTypeEdit} className="peq-ghostBtnXs">
                                        Annuler
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              {isTypeEdit ? (
                                typeEditVariantes.length === 0 ? (
                                  <div className="peq-empty">Aucun type.</div>
                                ) : (
                                  <div className="peq-tableWrap">
                                    <table className="peq-table peq-tableUltraCompact">
                                      <thead>
                                        <tr>
                                          <th className="peq-th peq-thSm">Type</th>
                                          {activeCols.map((c) => (
                                            <th key={c.id} className="peq-th peq-thSm">
                                              {c.nom}
                                            </th>
                                          ))}
                                          <th className="peq-th peq-thSm peq-thRight" style={{ width: 70 }}>
                                            X
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {typeEditVariantes
                                          .slice()
                                          .sort((a, b) => alphaCompareIgnoreEmoji(a.nom || "", b.nom || ""))
                                          .map((v) => {
                                            const isSelected = (typeEditVarianteId || "") === v.id;
                                            return (
                                              <tr
                                                key={v.id}
                                                onClick={() => setTypeEditVarianteId(v.id)}
                                                style={{
                                                  background: isSelected ? "rgba(79,70,229,0.08)" : undefined,
                                                }}
                                                title="Cliquer pour sélectionner ce type"
                                              >
                                                <td className="peq-td peq-tdSm">
                                                  <input
                                                    value={v.nom}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) =>
                                                      setTypeEditVarianteNom(v.id, e.target.value)
                                                    }
                                                    placeholder="Type"
                                                    className="peq-inputXs"
                                                  />
                                                </td>

                                                {activeCols.map((field) => (
                                                  <td key={field.id} className="peq-td peq-tdSm">
                                                    <input
                                                      value={(v.details?.[field.id] ?? "").toString()}
                                                      onClick={(e) => e.stopPropagation()}
                                                      onChange={(e) =>
                                                        setTypeEditVarianteDetailValue(
                                                          v.id,
                                                          field.id,
                                                          e.target.value
                                                        )
                                                      }
                                                      placeholder={field.nom}
                                                      className="peq-inputXs"
                                                    />
                                                  </td>
                                                ))}

                                                <td className="peq-td peq-tdSm peq-tdRight">
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      removeTypeEditVariante(v.id);
                                                    }}
                                                    className="peq-dangerBtnXs"
                                                  >
                                                    X
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                      </tbody>
                                    </table>
                                  </div>
                                )
                              ) : variants.length === 0 ? (
                                <div className="peq-empty">Aucun type enregistré.</div>
                              ) : (
                                <div className="peq-tableWrap">
                                  <table className="peq-table peq-tableUltraCompact">
                                    <thead>
                                      <tr>
                                        <th className="peq-th peq-thSm">Marque</th>
                                        {activeCols.map((c) => (
                                          <th key={c.id} className="peq-th peq-thSm">
                                            {c.nom}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {variants
                                        .slice()
                                        .sort((a, b) => alphaCompareIgnoreEmoji(a.nom || "", b.nom || ""))
                                        .map((v) => (
                                          <tr
                                            key={v.id}
                                            onClick={() => onClickVariantRow(eq, v.id)}
                                            style={{ cursor: "pointer" }}
                                            title="Cliquer pour modifier ce type"
                                          >
                                            <td className="peq-td peq-tdSm">{v.nom || <span className="peq-muted">—</span>}</td>

                                            {activeCols.map((field) => {
                                              const value = (v?.details?.[field.id] ?? "").toString().trim();
                                              return (
                                                <td key={field.id} className="peq-td peq-tdSm">
                                                  {value ? value : <span className="peq-muted">—</span>}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}