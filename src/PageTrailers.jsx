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

export default function PageTrailers() {
  const [equipements, setEquipements] = useState([]);

  // ✅ catégories globales (créées dans PageÉquipements)
  const [catsGlobal, setCatsGlobal] = useState([]); // [{id, nom, color}]

  const [trailers, setTrailers] = useState([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState(null);

  // Ajouter trailer (1 champ)
  const [trailerNom, setTrailerNom] = useState("");

  // trailer/categories => {id, nom, categorieId}
  const [categories, setCategories] = useState([]);
  const [itemsByCat, setItemsByCat] = useState({});
  const [addItemState, setAddItemState] = useState({}); // {catId:{equipementId, qty}}

  // UI: ajout catégorie via "+"
  const [showAddCat, setShowAddCat] = useState(false);
  const [catToAddId, setCatToAddId] = useState(""); // ✅ categorieId (global)

  // UI: ouvrir panneau ajout équipement pour une catégorie
  const [openAddForCatId, setOpenAddForCatId] = useState(null);

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

  // -------------------------
  // Banque d’équipements
  // -------------------------
  useEffect(() => {
    const qEq = query(collection(db, "equipements"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qEq,
      (snap) => setEquipements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("equipements snapshot:", err)
    );
  }, []);

  // -------------------------
  // ✅ Catégories globales (collection "categories")
  // -------------------------
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

  // -------------------------
  // Trailers
  // -------------------------
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

  // -------------------------
  // Categories du trailer sélectionné
  // -------------------------
  useEffect(() => {
    setCategories([]);
    setShowAddCat(false);
    setCatToAddId("");
    setOpenAddForCatId(null);
    setAddItemState({});
    setItemsByCat({});

    if (!selectedTrailerId) return;

    const qC = query(
      collection(db, "trailers", selectedTrailerId, "categories"),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(
      qC,
      (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("categories(trailer) snapshot:", err)
    );
  }, [selectedTrailerId]);

  // -------------------------
  // Items par catégorie
  // -------------------------
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

  // -------------------------
  // Helpers
  // -------------------------
  function setCatAddState(catId, patch) {
    setAddItemState((prev) => ({
      ...prev,
      [catId]: { equipementId: "", qty: 1, ...(prev[catId] || {}), ...patch },
    }));
  }

  // ✅ Equipements filtrés par categorieId (pas par texte)
  function equipementsPourCategorieId(categorieId) {
    const cid = (categorieId || "").trim();
    return equipements
      .filter((e) => (e.categorieId || "").trim() === cid)
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  }

  // -------------------------
  // Actions
  // -------------------------
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
  }

  // ✅ Ajouter une catégorie au trailer depuis categories (global)
  async function ajouterCategorieDepuisGlobal() {
    if (!selectedTrailerId) return;
    const cid = (catToAddId || "").trim();
    if (!cid) return;

    const catNom = catNameFromId(catsGlobal, cid);
    if (!catNom) return alert("Catégorie introuvable.");

    const deja = categories.some((c) => (c.categorieId || "") === cid);
    if (deja) return alert("Cette catégorie est déjà ajoutée dans ce trailer.");

    await addDoc(collection(db, "trailers", selectedTrailerId, "categories"), {
      categorieId: cid,
      nom: catNom,
      createdAt: serverTimestamp(),
      source: "global",
    });

    setCatToAddId("");
    setShowAddCat(false);
  }

  async function ajouterItem(cat) {
    if (!selectedTrailerId) return;
    const catId = cat.id;

    const st = addItemState[catId] || { equipementId: "", qty: 1 };
    const eqId = st.equipementId;
    const qty = Number(st.qty || 0);

    if (!eqId) return alert("Choisis un équipement.");
    if (!qty || qty <= 0) return alert("Quantité invalide.");

    const eq = equipements.find((e) => e.id === eqId);
    if (!eq) return alert("Équipement introuvable.");

    await addDoc(collection(db, "trailers", selectedTrailerId, "categories", catId, "items"), {
      equipementId: eqId,
      nom: eq.nom || "",
      unite: eq.unite || "",
      qty,
      createdAt: serverTimestamp(),
    });

    setCatAddState(catId, { equipementId: "", qty: 1 });
    setOpenAddForCatId(null);
  }

  async function supprimerItem(catId, itemId) {
    if (!selectedTrailerId) return;
    if (!window.confirm("Supprimer cet item?")) return;

    await deleteDoc(doc(db, "trailers", selectedTrailerId, "categories", catId, "items", itemId));
  }

  // ✅ Qté modifiable directement
  async function updateQty(catId, itemId, qtyValue) {
    if (!selectedTrailerId) return;

    const qty = Number(qtyValue || 0);
    if (!qty || qty <= 0) return;

    try {
      await updateDoc(doc(db, "trailers", selectedTrailerId, "categories", catId, "items", itemId), {
        qty,
      });
    } catch (e) {
      console.error("update qty error:", e);
      alert("Erreur modification quantité: " + (e?.message || "inconnue"));
    }
  }

  // ✅ Retirer: supprime items + doc catégorie
  async function retirerCategorie(catId) {
    if (!selectedTrailerId) return;
    if (!window.confirm("Retirer cette catégorie du trailer?\n(Tous les items dedans seront supprimés)")) return;

    try {
      const itemsRef = collection(db, "trailers", selectedTrailerId, "categories", catId, "items");
      const snap = await getDocs(itemsRef);

      let batch = writeBatch(db);
      let count = 0;

      for (const d of snap.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 450 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      await batch.commit();

      await deleteDoc(doc(db, "trailers", selectedTrailerId, "categories", catId));
    } catch (e) {
      console.error("retirerCategorie error:", e);
      alert("Erreur Retirer: " + (e?.message || "inconnue"));
    }
  }

  // -------------------------
  // ÉCHANGE helpers
  // -------------------------
  async function loadCatsForTrailer(trailerId) {
    if (!trailerId) return [];
    const qC = query(collection(db, "trailers", trailerId, "categories"), orderBy("createdAt", "asc"));
    const snap = await getDocs(qC);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function loadItemsForCat(trailerId, catId) {
    if (!trailerId || !catId) return [];
    const qI = query(
      collection(db, "trailers", trailerId, "categories", catId, "items"),
      orderBy("createdAt", "asc")
    );
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

      // source
      const remaining = Number(item.qty || 0) - moveQty;
      if (remaining <= 0) batch.delete(fromItemRef);
      else batch.update(fromItemRef, { qty: remaining });

      // destination
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

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="pt-page">
      <div className="pt-header">
        <div style={{ width: "100%" }}>
          <div className="pt-headerRow">
            <div>
              <h1 className="pt-title">Trailers</h1>
              <div className="pt-sub">
                “+” en haut : ajoute une catégorie (créée dans Équipements). “+” dans une catégorie : ajoute un équipement.
              </div>
            </div>

            <button className="pt-btn pt-btnSwap" type="button" onClick={openTradeModal} disabled={trailers.length < 2}>
              Faire un échange
            </button>
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
          <div className="pt-cardTitle">
            <span>Détails</span>

            {/* "+" global pour ajouter une catégorie */}
            <div className="pt-cardTitleRight">
              <button
                className="pt-iconBtn"
                type="button"
                title="Ajouter une catégorie"
                onClick={() => {
                  if (!selectedTrailerId) return;
                  setShowAddCat((v) => !v);
                  setCatToAddId("");
                }}
              >
                +
              </button>

              {showAddCat && (
                <div className="pt-popover">
                  <div className="pt-popoverTitle">Ajouter une catégorie</div>

                  {catsGlobalSorted.length === 0 ? (
                    <div className="pt-empty">Aucune catégorie. Va dans Équipements et crée des catégories avec le “+”.</div>
                  ) : (
                    <div className="pt-popoverRow">
                      <select className="pt-select" value={catToAddId} onChange={(e) => setCatToAddId(e.target.value)}>
                        <option value="">Choisir une catégorie…</option>
                        {catsGlobalSorted.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))}
                      </select>

                      <button className="pt-btn" type="button" onClick={ajouterCategorieDepuisGlobal}>
                        Ajouter
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!selectedTrailer ? (
            <div className="pt-empty">Choisis un trailer.</div>
          ) : (
            <>
              <h2 className="pt-detailTitle">{selectedTrailer.trailerNom}</h2>

              {categories.length === 0 ? (
                <div className="pt-empty">Aucune catégorie. Clique sur “+” en haut à droite pour en ajouter.</div>
              ) : (
                <div className="pt-cats">
                  {categories.map((cat) => {
                    const items = itemsByCat[cat.id] || [];
                    const st = addItemState[cat.id] || { equipementId: "", qty: 1 };

                    const eqOptions = equipementsPourCategorieId(cat.categorieId);
                    const isOpen = openAddForCatId === cat.id;

                    const base = catColorFromId(catsGlobal, cat.categorieId);

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
                            <span>{cat.nom || "Catégorie"}</span>
                          </div>

                          <div className="pt-catActions">
                            <button
                              className="pt-miniIconBtn"
                              type="button"
                              title="Ajouter un équipement"
                              onClick={() => {
                                setOpenAddForCatId((prev) => (prev === cat.id ? null : cat.id));
                                setCatAddState(cat.id, {});
                              }}
                            >
                              +
                            </button>

                            <button className="pt-btnDanger" type="button" onClick={() => retirerCategorie(cat.id)}>
                              Retirer
                            </button>
                          </div>
                        </div>

                        {/* panneau ajout (sans notes) */}
                        {isOpen && (
                          <div className="pt-addPanel">
                            <div className="pt-addItemRow">
                              <select
                                className="pt-select"
                                value={st.equipementId}
                                onChange={(e) => setCatAddState(cat.id, { equipementId: e.target.value })}
                              >
                                <option value="">Choisir un équipement…</option>
                                {eqOptions.map((eq) => (
                                  <option key={eq.id} value={eq.id}>
                                    {eq.nom}
                                    {eq.unite ? ` (${eq.unite})` : ""}
                                  </option>
                                ))}
                              </select>

                              <input
                                className="pt-input pt-qty"
                                type="number"
                                min="1"
                                value={st.qty}
                                onChange={(e) => setCatAddState(cat.id, { qty: e.target.value })}
                              />

                              <button className="pt-btn" type="button" onClick={() => ajouterItem(cat)}>
                                Ajouter
                              </button>
                            </div>
                          </div>
                        )}

                        {/* items (sans notes) */}
                        {items.length === 0 ? (
                          <div className="pt-empty" style={{ marginTop: 10 }}>
                            Aucun item dans cette catégorie.
                          </div>
                        ) : (
                          <div className="pt-items">
                            {items.map((it) => (
                              <div key={it.id} className="pt-itemRow" style={{ gridTemplateColumns: "1.8fr 120px 70px" }}>
                                <div className="pt-itemName">
                                  {it.nom || "—"}{" "}
                                  <span className="pt-itemUnit">{it.unite ? `(${it.unite})` : ""}</span>
                                </div>

                                <input
                                  className="pt-input pt-qty"
                                  type="number"
                                  min="1"
                                  defaultValue={it.qty || 1}
                                  onBlur={(e) => updateQty(cat.id, it.id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                  }}
                                />

                                <div style={{ textAlign: "right" }}>
                                  <button
                                    type="button"
                                    className="pt-btnDanger"
                                    onClick={() => supprimerItem(cat.id, it.id)}
                                  >
                                    X
                                  </button>
                                </div>
                              </div>
                            ))}
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
                      const base = catColorFromId(catsGlobal, c.categorieId);
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
                        {it.nom} — dispo: {it.qty}
                      </option>
                    ))}
                  </select>

                  <input
                    className="pt-input"
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

                  <div className="pt-modalHint">
                    Astuce: si le trailer destination a la même catégorie, je la sélectionne automatiquement.
                  </div>
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
