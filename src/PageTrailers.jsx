// src/PageTrailers.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import "./PageTrailers.css";

/* ---------- Color helpers (uses categories.color) ---------- */
const DEFAULT_COLOR = "#4F46E5";

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

function catColorFromId(catsGlobal, categorieId) {
  const c = catsGlobal.find((x) => x.id === categorieId);
  return (c?.color || DEFAULT_COLOR).trim();
}
function catNameFromId(catsGlobal, categorieId) {
  const c = catsGlobal.find((x) => x.id === categorieId);
  return (c?.nom || "").trim();
}

/* ---------- helpers affichage sous-catégories ---------- */
function shorten(s, max = 34) {
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
 * (GARDÉ) label riche pour le dropdown "Ajouter équipement"
 * Exemple: "Sangle — Marque: X • Unité: pce • Modèle: Y"
 */
function optionLabelForEquipement(eq, catsGlobal) {
  const head = (eq?.nom || "").trim() || "—";
  const extras = [];

  const catId = (eq?.categorieId || "").trim();
  const cat = catsGlobal.find((c) => (c.id || "").trim() === catId) || null;

  const fieldsRaw = Array.isArray(cat?.fields) ? cat.fields : [];
  const fields = fieldsRaw
    .map((f) => {
      if (!f) return null;
      if (typeof f === "string") return null; // pas d'id => on ignore
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
  if (uniteLegacy && !hasUniteField) {
    extras.push(`Unité: ${shorten(uniteLegacy)}`);
  }

  return extras.length ? `${head} — ${extras.join(" • ")}` : head;
}

export default function PageTrailers() {
  const [equipements, setEquipements] = useState([]);

  // ✅ catégories globales (créées dans PageÉquipements)
  const [catsGlobal, setCatsGlobal] = useState([]); // [{id, nom, color, fields?}]

  const [trailers, setTrailers] = useState([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState(null);

  // Ajouter trailer
  const [trailerNom, setTrailerNom] = useState("");

  // subcollection trailers/{id}/categories => {id, nom, categorieId}
  const [categories, setCategories] = useState([]);
  const [itemsByCat, setItemsByCat] = useState({});

  // 🔎 recherche
  const [search, setSearch] = useState("");

  // ➕ modal ajout équipement
  const [showAddEquip, setShowAddEquip] = useState(false);
  const [addCatGlobalId, setAddCatGlobalId] = useState("");
  const [addEquipId, setAddEquipId] = useState("");
  const [addQty, setAddQty] = useState(1);

  // 🧮 modal ajuster quantité (clic item)
  const [qtyModalOpen, setQtyModalOpen] = useState(false);
  const [qtyModalCatId, setQtyModalCatId] = useState("");
  const [qtyModalItem, setQtyModalItem] = useState(null); // {id, nom, qty, equipementId, ...}
  const [qtyModalDelta, setQtyModalDelta] = useState(1);

  // ------------------------- ÉCHANGE (modal) -------------------------
  const [showTrade, setShowTrade] = useState(false);

  const [tradeFromTrailerId, setTradeFromTrailerId] = useState("");
  const [tradeFromCats, setTradeFromCats] = useState([]); // [{id, nom, categorieId}]
  const [tradeFromCatId, setTradeFromCatId] = useState("");
  const [tradeFromItems, setTradeFromItems] = useState([]); // [{id, nom, equipementId, qty, ...}]
  const [tradeFromItemId, setTradeFromItemId] = useState("");
  const [tradeQty, setTradeQty] = useState(1);

  const [tradeToTrailerId, setTradeToTrailerId] = useState("");
  const [tradeToCats, setTradeToCats] = useState([]);
  const [tradeToCatId, setTradeToCatId] = useState("");

  // ------------------------- Banque d’équipements -------------------------
  useEffect(() => {
    const qEq = query(collection(db, "equipements"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qEq,
      (snap) => setEquipements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("equipements snapshot:", err)
    );
  }, []);

  // ------------------------- ✅ Catégories globales (collection "categories") -------------------------
  useEffect(() => {
    const qC = query(collection(db, "categories"), orderBy("createdAt", "asc"));
    return onSnapshot(
      qC,
      (snap) => setCatsGlobal(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("categories(global) snapshot:", err)
    );
  }, []);

  const catsGlobalSorted = useMemo(() => {
    return [...catsGlobal].sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  }, [catsGlobal]);

  // ------------------------- Trailers -------------------------
  useEffect(() => {
    const qT = query(collection(db, "trailers"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qT,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTrailers(list);

        if (!selectedTrailerId && list.length) setSelectedTrailerId(list[0].id);
        if (selectedTrailerId && !list.some((t) => t.id === selectedTrailerId)) {
          setSelectedTrailerId(list[0]?.id || null);
        }
      },
      (err) => console.error("trailers snapshot:", err)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTrailer = useMemo(
    () => trailers.find((t) => t.id === selectedTrailerId) || null,
    [trailers, selectedTrailerId]
  );

  // ------------------------- Categories du trailer sélectionné (subcollection) -------------------------
  useEffect(() => {
    setCategories([]);
    setItemsByCat({});
    setSearch("");
    setShowAddEquip(false);
    setAddCatGlobalId("");
    setAddEquipId("");
    setAddQty(1);

    if (!selectedTrailerId) return;

    const qC = query(collection(db, "trailers", selectedTrailerId, "categories"), orderBy("createdAt", "asc"));
    return onSnapshot(
      qC,
      (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("categories(trailer) snapshot:", err)
    );
  }, [selectedTrailerId]);

  // ------------------------- ✅ Sync: chaque trailer a TOUJOURS toutes les catégories globales -------------------------
  async function ensureAllCategoriesForTrailer(trailerId) {
    if (!trailerId) return;
    if (catsGlobalSorted.length === 0) return;

    const catsCol = collection(db, "trailers", trailerId, "categories");
    const snap = await getDocs(query(catsCol, orderBy("createdAt", "asc")));
    const existing = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const existingByGlobalId = new Map();
    for (const c of existing) {
      const gid = (c.categorieId || "").trim();
      if (gid) existingByGlobalId.set(gid, c);
    }

    const missing = catsGlobalSorted.filter((g) => !existingByGlobalId.has((g.id || "").trim()));
    if (missing.length === 0) return;

    const batch = writeBatch(db);
    for (const g of missing) {
      const newRef = doc(catsCol);
      batch.set(newRef, {
        categorieId: g.id,
        nom: g.nom || "",
        createdAt: serverTimestamp(),
        source: "global_auto",
      });
    }
    await batch.commit();
  }

  useEffect(() => {
    if (!selectedTrailerId) return;
    ensureAllCategoriesForTrailer(selectedTrailerId).catch((e) => console.error("ensureAllCategoriesForTrailer:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrailerId, catsGlobalSorted.length]);

  // ------------------------- Items par catégorie (listeners) -------------------------
  useEffect(() => {
    setItemsByCat({});
    if (!selectedTrailerId) return;

    const unsubs = [];
    categories.forEach((cat) => {
      const qI = query(
        collection(db, "trailers", selectedTrailerId, "categories", cat.id, "items"),
        orderBy("createdAt", "asc")
      );

      const unsub = onSnapshot(
        qI,
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setItemsByCat((prev) => ({ ...prev, [cat.id]: items }));
        },
        (err) => console.error("items snapshot:", err)
      );

      unsubs.push(unsub);
    });

    return () => unsubs.forEach((u) => u && u());
  }, [categories, selectedTrailerId]);

  // ------------------------- Helpers -------------------------
  function equipementsPourCategorieId(categorieId) {
    const cid = (categorieId || "").trim();
    return equipements
      .filter((e) => (e.categorieId || "").trim() === cid)
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  }

  function findTrailerCatDocIdByGlobalCatId(globalCatId) {
    const gid = (globalCatId || "").trim();
    const found = categories.find((c) => (c.categorieId || "").trim() === gid);
    return found?.id || "";
  }

  function normalize(s) {
    return (s || "").toString().toLowerCase().trim();
  }

  function filterItems(items) {
    const q = normalize(search);
    if (!q) return items;
    return (items || []).filter((it) => normalize(it.nom).includes(q));
  }

  const categoriesSorted = useMemo(() => {
    const copy = [...categories];
    copy.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    return copy;
  }, [categories]);

  function equipementById(id) {
    const eid = (id || "").trim();
    return equipements.find((e) => (e.id || "").trim() === eid) || null;
  }

  // ✅ champs (sous-catégories) pour une catégorie globale => colonnes du tableau
  function fieldsForGlobalCatId(globalCatId) {
    const gid = (globalCatId || "").trim();
    const cat = catsGlobal.find((c) => (c.id || "").trim() === gid) || null;

    const fieldsRaw = Array.isArray(cat?.fields) ? cat.fields : [];
    const fields = fieldsRaw
      .map((f) => {
        if (!f) return null;
        if (typeof f === "string") return null; // pas d'id => ignore (sinon impossible de lire eq.details)
        if (typeof f === "object") return { id: (f.id || "").toString(), nom: (f.nom || "").toString() };
        return null;
      })
      .filter((x) => x && x.id && (x.nom || "").trim());

    return fields;
  }

  // ✅ valeur d’une colonne (field) pour un item de trailer
  function valueForItemField(item, field) {
    const eq = equipementById(item?.equipementId);
    if (!eq) return "";

    const d = eq.details || {};
    const v = (d?.[field.id] ?? "").toString().trim();
    if (v) return v;

    // fallback legacy unite
    if (isUniteLabel(field.nom)) {
      const u = (eq.unite || "").toString().trim();
      if (u) return u;
    }

    return "";
  }

  // label riche seulement pour le modal quantité / échange
  function labelForTrailerItem(it) {
    const eq = equipementById(it?.equipementId);
    if (eq) return optionLabelForEquipement(eq, catsGlobal);
    return (it?.nom || "").trim() || "—";
  }

  // ------------------------- Actions -------------------------
  async function ajouterTrailer(e) {
    e.preventDefault();
    const tn = trailerNom.trim();
    if (!tn) return;

    const ref = await addDoc(collection(db, "trailers"), {
      trailerNom: tn,
      createdAt: serverTimestamp(),
    });

    setTrailerNom("");
    setSelectedTrailerId(ref.id);

    try {
      await ensureAllCategoriesForTrailer(ref.id);
    } catch (err) {
      console.error("ensure categories on create:", err);
    }
  }

  function openAddEquipModalForCategory(globalCatId) {
    if (!selectedTrailerId) return;
    setShowAddEquip(true);
    setAddCatGlobalId((globalCatId || "").trim());
    setAddEquipId("");
    setAddQty(1);
  }

  async function ajouterEquipementAuTrailer() {
    if (!selectedTrailerId) return;
    if (!addCatGlobalId) return alert("Choisis une catégorie.");
    if (!addEquipId) return alert("Choisis un équipement.");

    const qty = Number(addQty || 0);
    if (!qty || qty <= 0) return alert("Quantité invalide (min 1).");

    let trailerCatDocId = findTrailerCatDocIdByGlobalCatId(addCatGlobalId);

    if (!trailerCatDocId) {
      await ensureAllCategoriesForTrailer(selectedTrailerId);
      trailerCatDocId = findTrailerCatDocIdByGlobalCatId(addCatGlobalId);
      if (!trailerCatDocId) return alert("Erreur: catégorie introuvable dans ce trailer.");
    }

    const eq = equipements.find((e) => e.id === addEquipId);
    if (!eq) return alert("Équipement introuvable.");

    const itemsCol = collection(db, "trailers", selectedTrailerId, "categories", trailerCatDocId, "items");

    const qExisting = query(itemsCol, where("equipementId", "==", addEquipId));
    const exSnap = await getDocs(qExisting);

    const batch = writeBatch(db);

    if (!exSnap.empty) {
      const ex = exSnap.docs[0];
      const newQty = Number(ex.data().qty || 0) + qty;
      batch.update(ex.ref, { qty: newQty });
    } else {
      const newRef = doc(itemsCol);
      batch.set(newRef, {
        equipementId: addEquipId,
        nom: eq.nom || "",
        unite: eq.unite || "",
        qty,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();

    setShowAddEquip(false);
    setAddEquipId("");
    setAddQty(1);
  }

  function openQtyModal(catId, item) {
    setQtyModalCatId(catId);
    setQtyModalItem(item);
    setQtyModalDelta(1);
    setQtyModalOpen(true);
  }

  async function applyQtyDelta(sign) {
    if (!selectedTrailerId) return;
    if (!qtyModalOpen || !qtyModalCatId || !qtyModalItem?.id) return;

    const delta = Number(qtyModalDelta || 0);
    if (!delta || delta <= 0) return alert("Entre une quantité valide (min 1).");

    const current = Number(qtyModalItem.qty || 0);
    const next = sign === "add" ? current + delta : current - delta;

    const ref = doc(db, "trailers", selectedTrailerId, "categories", qtyModalCatId, "items", qtyModalItem.id);

    try {
      if (next <= 0) {
        await deleteDoc(ref);
      } else {
        await updateDoc(ref, { qty: next });
      }
      setQtyModalOpen(false);
    } catch (e) {
      console.error("applyQtyDelta:", e);
      alert("Erreur modification quantité: " + (e?.message || "inconnue"));
    }
  }

  async function supprimerItem(catId, itemId) {
    if (!selectedTrailerId) return;
    if (!window.confirm("Supprimer cet item?")) return;
    await deleteDoc(doc(db, "trailers", selectedTrailerId, "categories", catId, "items", itemId));
  }

  // ------------------------- ÉCHANGE helpers -------------------------
  async function loadCatsForTrailer(trailerId) {
    if (!trailerId) return [];
    const qC = query(collection(db, "trailers", trailerId, "categories"), orderBy("createdAt", "asc"));
    const snap = await getDocs(qC);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function loadItemsForCat(trailerId, catId) {
    if (!trailerId || !catId) return [];
    const qI = query(collection(db, "trailers", trailerId, "categories", catId, "items"), orderBy("createdAt", "asc"));
    const snap = await getDocs(qI);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  function openTradeModal() {
    const firstTrailer = selectedTrailerId || trailers[0]?.id || "";
    const secondTrailer = trailers.find((t) => t.id !== firstTrailer)?.id || firstTrailer;

    setShowTrade(true);
    setTradeFromTrailerId(firstTrailer);
    setTradeToTrailerId(secondTrailer);

    setTradeFromCats([]);
    setTradeFromCatId("");
    setTradeFromItems([]);
    setTradeFromItemId("");
    setTradeQty(1);

    setTradeToCats([]);
    setTradeToCatId("");

    (async () => {
      const fc = await loadCatsForTrailer(firstTrailer);
      const tc = await loadCatsForTrailer(secondTrailer);

      setTradeFromCats(fc);
      setTradeToCats(tc);

      if (fc[0]?.id) {
        setTradeFromCatId(fc[0].id);
        const items = await loadItemsForCat(firstTrailer, fc[0].id);
        setTradeFromItems(items);
        if (items[0]?.id) setTradeFromItemId(items[0].id);

        const matchTo = tc.find((c) => (c.categorieId || "") === (fc[0].categorieId || ""));
        if (matchTo) setTradeToCatId(matchTo.id);
      }
    })();
  }

  async function onChangeFromTrailer(id) {
    setTradeFromTrailerId(id);
    setTradeFromCats([]);
    setTradeFromCatId("");
    setTradeFromItems([]);
    setTradeFromItemId("");
    setTradeQty(1);

    const fc = await loadCatsForTrailer(id);
    setTradeFromCats(fc);

    if (fc[0]?.id) {
      setTradeFromCatId(fc[0].id);
      const items = await loadItemsForCat(id, fc[0].id);
      setTradeFromItems(items);
      if (items[0]?.id) setTradeFromItemId(items[0].id);

      const matchTo = tradeToCats.find((c) => (c.categorieId || "") === (fc[0].categorieId || ""));
      if (matchTo) setTradeToCatId(matchTo.id);
    }
  }

  async function onChangeFromCat(catId) {
    setTradeFromCatId(catId);
    setTradeFromItems([]);
    setTradeFromItemId("");
    setTradeQty(1);

    const items = await loadItemsForCat(tradeFromTrailerId, catId);
    setTradeFromItems(items);
    if (items[0]?.id) setTradeFromItemId(items[0].id);

    const fromCatObj = tradeFromCats.find((c) => c.id === catId);
    if (fromCatObj) {
      const matchTo = tradeToCats.find((c) => (c.categorieId || "") === (fromCatObj.categorieId || ""));
      if (matchTo) setTradeToCatId(matchTo.id);
    }
  }

  async function onChangeToTrailer(id) {
    setTradeToTrailerId(id);
    setTradeToCats([]);
    setTradeToCatId("");

    const tc = await loadCatsForTrailer(id);
    setTradeToCats(tc);

    const fromCatObj = tradeFromCats.find((c) => c.id === tradeFromCatId);
    if (fromCatObj) {
      const matchTo = tc.find((c) => (c.categorieId || "") === (fromCatObj.categorieId || ""));
      if (matchTo) setTradeToCatId(matchTo.id);
    } else if (tc[0]?.id) {
      setTradeToCatId(tc[0].id);
    }
  }

  async function effectuerEchange() {
    if (!tradeFromTrailerId || !tradeFromCatId || !tradeFromItemId) return alert("Choisis l’article à transférer.");
    if (!tradeToTrailerId || !tradeToCatId) return alert("Choisis le trailer de destination + catégorie.");

    const item = tradeFromItems.find((x) => x.id === tradeFromItemId);
    if (!item) return alert("Item introuvable.");

    const moveQty = Number(tradeQty || 0);
    if (!moveQty || moveQty <= 0) return alert("Quantité invalide.");
    if (moveQty > Number(item.qty || 0)) return alert("Quantité trop grande.");

    const fromItemRef = doc(db, "trailers", tradeFromTrailerId, "categories", tradeFromCatId, "items", tradeFromItemId);
    const destItemsCol = collection(db, "trailers", tradeToTrailerId, "categories", tradeToCatId, "items");

    try {
      const qExisting = query(destItemsCol, where("equipementId", "==", item.equipementId));
      const existingSnap = await getDocs(qExisting);

      const batch = writeBatch(db);

      const remaining = Number(item.qty || 0) - moveQty;
      if (remaining <= 0) batch.delete(fromItemRef);
      else batch.update(fromItemRef, { qty: remaining });

      if (!existingSnap.empty) {
        const ex = existingSnap.docs[0];
        const newQty = Number(ex.data().qty || 0) + moveQty;
        batch.update(ex.ref, { qty: newQty });
      } else {
        const newRef = doc(destItemsCol);
        batch.set(newRef, {
          equipementId: item.equipementId,
          nom: item.nom || "",
          unite: item.unite || "",
          qty: moveQty,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      alert("✅ Transfert effectué !");
      setShowTrade(false);
    } catch (e) {
      console.error("effectuerEchange error:", e);
      alert("❌ Erreur échange: " + (e?.message || "inconnue"));
    }
  }

  // ------------------------- Options ajout modal -------------------------
  const addEquipOptions = useMemo(() => {
    const gid = (addCatGlobalId || "").trim();
    if (!gid) return [];
    return equipementsPourCategorieId(gid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addCatGlobalId, equipements]);

  // ------------------------- Render -------------------------
  return (
    <div className="pt-page">
      <div className="pt-header">
        <div style={{ width: "100%" }}>
          <div className="pt-headerRow">
            <div>
              <h1 className="pt-title">Trailers</h1>
              <div className="pt-sub">
                Clique sur un item pour ajuster sa quantité. Les sous-catégories (Marque/Unité/etc.) apparaissent en COLONNES.
              </div>
            </div>

            <div className="pt-headerActions">
              <button className="pt-btn pt-btnSwap" type="button" onClick={openTradeModal} disabled={trailers.length < 2}>
                Faire un échange
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-grid">
        {/* LEFT */}
        <div className="pt-card">
          <div className="pt-cardTitle">Liste des trailers</div>

          <form className="pt-formRow" onSubmit={ajouterTrailer} style={{ gridTemplateColumns: "1fr auto" }}>
            <input
              className="pt-input"
              placeholder="Nom (ex: Trailer 01 — Marc)"
              value={trailerNom}
              onChange={(e) => setTrailerNom(e.target.value)}
            />
            <button className="pt-btn" type="submit">
              + Ajouter
            </button>
          </form>

          <div className="pt-list">
            {trailers.length === 0 ? (
              <div className="pt-empty">Aucun trailer.</div>
            ) : (
              trailers.map((t) => {
                const active = t.id === selectedTrailerId;
                return (
                  <div
                    key={t.id}
                    className={`pt-trailerRow ${active ? "pt-trailerRowActive" : ""}`}
                    onClick={() => setSelectedTrailerId(t.id)}
                  >
                    <div>
                      <div className="pt-trailerName">{t.trailerNom || "Sans nom"}</div>
                      <div className="pt-trailerMeta">Clique pour ouvrir</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {trailers.length < 2 && (
            <div className="pt-footHint" style={{ marginTop: 10 }}>
              Ajoute au moins 2 trailers pour utiliser “Faire un échange”.
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="pt-card">
          <div className="pt-cardTitle" style={{ justifyContent: "flex-end" }}>
            <input
              className="pt-input pt-search"
              placeholder="Rechercher un équipement dans ce trailer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!selectedTrailerId}
            />
          </div>

          {!selectedTrailer ? (
            <div className="pt-empty">Choisis un trailer.</div>
          ) : (
            <>
              <h2 className="pt-detailTitle" style={{ fontSize: 30, fontWeight: 950, marginTop: 6 }}>
                {selectedTrailer.trailerNom}
              </h2>

              {categoriesSorted.length === 0 ? (
                <div className="pt-empty">Chargement des catégories…</div>
              ) : (
                <div className="pt-cats">
                  {categoriesSorted.map((cat) => {
                    const itemsAll = itemsByCat[cat.id] || [];
                    const items = filterItems(itemsAll);

                    if (search.trim() && items.length === 0) return null;

                    const base = catColorFromId(catsGlobal, cat.categorieId);
                    const cols = fieldsForGlobalCatId(cat.categorieId);

                    return (
                      <div
                        key={cat.id}
                        className="pt-section"
                        style={{
                          background: withAlpha(base, 0.12),
                          borderColor: withAlpha(base, 0.35),
                        }}
                      >
                        <div className="pt-sectionHead">
                          <div className="pt-sectionName" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: base,
                                display: "inline-block",
                              }}
                            />
                            <span>{cat.nom || catNameFromId(catsGlobal, cat.categorieId) || "Catégorie"}</span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div className="pt-catMeta">
                              {itemsAll.length} item{itemsAll.length > 1 ? "s" : ""}
                            </div>

                            <button
                              type="button"
                              className="pt-btn"
                              style={{ height: 32, padding: "0 10px" }}
                              onClick={() => openAddEquipModalForCategory(cat.categorieId)}
                              title="Ajouter un équipement dans cette catégorie"
                              disabled={!selectedTrailerId}
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {itemsAll.length === 0 ? (
                          <div className="pt-empty" style={{ marginTop: 10 }}>
                            Aucun item dans cette catégorie.
                          </div>
                        ) : items.length === 0 ? (
                          <div className="pt-empty" style={{ marginTop: 10 }}>
                            Aucun résultat pour “{search}”.
                          </div>
                        ) : (
                          // ✅ TABLEAU: maintenant compact via CSS (.pt-th/.pt-td/.pt-tableWrap/.pt-table)
                          <div className="pt-tableWrap">
                            <table className="pt-table">
                              <thead>
                                <tr>
                                  <th className="pt-th">Nom</th>
                                  {cols.map((f) => (
                                    <th key={f.id} className="pt-th">
                                      {f.nom}
                                    </th>
                                  ))}
                                  <th className="pt-th" style={{ textAlign: "right" }}>
                                    Qté
                                  </th>
                                  <th className="pt-th" style={{ textAlign: "right" }}>
                                    Actions
                                  </th>
                                </tr>
                              </thead>

                              <tbody>
                                {items.map((it) => {
                                  return (
                                    <tr
                                      key={it.id}
                                      style={{ cursor: "pointer" }}
                                      onClick={() => openQtyModal(cat.id, it)}
                                      title="Cliquer pour ajuster la quantité"
                                    >
                                      <td className="pt-td">
                                        <div style={{ fontWeight: 900 }}>{it.nom || "—"}</div>
                                      </td>

                                      {cols.map((f) => {
                                        const v = valueForItemField(it, f);
                                        return (
                                          <td key={f.id} className="pt-td">
                                            {v ? v : <span style={{ opacity: 0.55 }}>—</span>}
                                          </td>
                                        );
                                      })}

                                      <td className="pt-td" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                        <span className="pt-qtyBadge" style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                                          <span>{Number(it.qty || 0)}</span>
                                        </span>
                                      </td>

                                      <td className="pt-td" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                                        <button type="button" className="pt-btnDanger" onClick={() => supprimerItem(cat.id, it.id)}>
                                          X
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------------- MODAL AJOUT ÉQUIPEMENT ---------------- */}
      {showAddEquip && (
        <div className="pt-modalOverlay" onMouseDown={() => setShowAddEquip(false)}>
          <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Ajouter un équipement</div>
              <button className="pt-modalClose" type="button" onClick={() => setShowAddEquip(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div className="pt-modalBlock" style={{ background: "#fff" }}>
                <div className="pt-modalLabel">Catégorie</div>
                <select
                  className="pt-select"
                  value={addCatGlobalId}
                  onChange={(e) => {
                    setAddCatGlobalId(e.target.value);
                    setAddEquipId("");
                  }}
                >
                  <option value="">Choisir une catégorie…</option>
                  {catsGlobalSorted.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>

                <div className="pt-modalLabel">Équipement</div>
                <select className="pt-select" value={addEquipId} onChange={(e) => setAddEquipId(e.target.value)}>
                  <option value="">Choisir un équipement…</option>
                  {addEquipOptions.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {optionLabelForEquipement(eq, catsGlobal)}
                    </option>
                  ))}
                </select>

                <div className="pt-modalLabel">Quantité</div>
                <input
                  className="pt-input pt-qtyInput pt-noSpin"
                  type="number"
                  min="1"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />

                <div className="pt-modalHint">Si l’équipement existe déjà dans cette catégorie, la quantité sera additionnée.</div>
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={ajouterEquipementAuTrailer}>
                Ajouter
              </button>
              <button className="pt-btn pt-btnGhost" type="button" onClick={() => setShowAddEquip(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL AJUSTER QUANTITÉ ---------------- */}
      {qtyModalOpen && qtyModalItem && (
        <div className="pt-modalOverlay" onMouseDown={() => setQtyModalOpen(false)}>
          <div className="pt-modal pt-modalSmall" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Ajuster quantité</div>
              <button className="pt-modalClose" type="button" onClick={() => setQtyModalOpen(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div className="pt-qtyTop">
                <div className="pt-qtyTitle">{labelForTrailerItem(qtyModalItem)}</div>
                <div className="pt-qtyCurrent">
                  Qté actuelle: <b>{Number(qtyModalItem.qty || 0)}</b>
                </div>
              </div>

              <div className="pt-modalBlock" style={{ background: "#fff" }}>
                <div className="pt-modalLabel">Combien ajouter / enlever ?</div>
                <input
                  className="pt-input pt-qtyInput pt-noSpin"
                  type="number"
                  min="1"
                  value={qtyModalDelta}
                  onChange={(e) => setQtyModalDelta(e.target.value)}
                />

                <div className="pt-qtyActions">
                  <button className="pt-btn" type="button" onClick={() => applyQtyDelta("add")}>
                    Ajouter
                  </button>
                  <button className="pt-btnDangerWide" type="button" onClick={() => applyQtyDelta("remove")}>
                    Enlever
                  </button>
                </div>

                <div className="pt-modalHint">Si la quantité tombe à 0 ou moins, l’équipement est retiré du trailer.</div>
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn pt-btnGhost" type="button" onClick={() => setQtyModalOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL ÉCHANGE ---------------- */}
      {showTrade && (
        <div className="pt-modalOverlay" onMouseDown={() => setShowTrade(false)}>
          <div className="pt-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Faire un échange</div>
              <button className="pt-modalClose" type="button" onClick={() => setShowTrade(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div className="pt-modalGrid">
                {/* FROM */}
                <div className="pt-modalBlock">
                  <div className="pt-modalLabel">De</div>

                  <select className="pt-select" value={tradeFromTrailerId} onChange={(e) => onChangeFromTrailer(e.target.value)}>
                    {trailers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.trailerNom || "Sans nom"}
                      </option>
                    ))}
                  </select>

                  <select className="pt-select" value={tradeFromCatId} onChange={(e) => onChangeFromCat(e.target.value)}>
                    <option value="">Catégorie…</option>
                    {tradeFromCats.map((c) => {
                      const label = c.nom || catNameFromId(catsGlobal, c.categorieId) || "Catégorie";
                      return (
                        <option key={c.id} value={c.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>

                  <select
                    className="pt-select"
                    value={tradeFromItemId}
                    onChange={(e) => {
                      setTradeFromItemId(e.target.value);
                      setTradeQty(1);
                    }}
                  >
                    <option value="">Article…</option>
                    {tradeFromItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {labelForTrailerItem(it)} — dispo: {it.qty}
                      </option>
                    ))}
                  </select>

                  <input
                    className="pt-input pt-noSpin"
                    type="number"
                    min="1"
                    value={tradeQty}
                    onChange={(e) => setTradeQty(e.target.value)}
                    placeholder="Quantité"
                  />
                </div>

                {/* TO */}
                <div className="pt-modalBlock">
                  <div className="pt-modalLabel">Vers</div>

                  <select className="pt-select" value={tradeToTrailerId} onChange={(e) => onChangeToTrailer(e.target.value)}>
                    {trailers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.trailerNom || "Sans nom"}
                      </option>
                    ))}
                  </select>

                  <select className="pt-select" value={tradeToCatId} onChange={(e) => setTradeToCatId(e.target.value)}>
                    <option value="">Catégorie destination…</option>
                    {tradeToCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}
                      </option>
                    ))}
                  </select>

                  <div className="pt-modalHint">Astuce: si le trailer destination a la même catégorie, je la sélectionne automatiquement.</div>
                </div>
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={effectuerEchange}>
                Confirmer
              </button>
              <button className="pt-btn pt-btnGhost" type="button" onClick={() => setShowTrade(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
