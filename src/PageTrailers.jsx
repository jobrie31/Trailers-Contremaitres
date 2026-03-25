// src/PageTrailers.jsx
import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
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

/* ---------- helpers affichage ---------- */
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

function sanitizeFields(rawFields) {
  return (Array.isArray(rawFields) ? rawFields : [])
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      return {
        id: (f.id || "").toString(),
        nom: (f.nom || "").toString(),
      };
    })
    .filter((f) => f && f.id && f.nom.trim());
}

function sanitizeVariants(rawVariants, fields = []) {
  return (Array.isArray(rawVariants) ? rawVariants : [])
    .map((v) => {
      const details = {};
      for (const f of fields) details[f.id] = (v?.details?.[f.id] ?? "").toString();
      return {
        id: (v?.id || "").toString(),
        nom: (v?.nom || "").toString().trim(),
        details,
      };
    })
    .filter((v) => v.id || v.nom || Object.values(v.details || {}).some((x) => String(x || "").trim()));
}

function optionLabelForEquipement(eq) {
  return (eq?.nom || "").trim() || "—";
}

function optionLabelForVariante(eq, variante, catsGlobal) {
  const head = (variante?.nom || "").trim() || "Type sans nom";
  const extras = [];

  const catId = (eq?.categorieId || "").trim();
  const cat = catsGlobal.find((c) => (c.id || "").trim() === catId) || null;
  const fields = sanitizeFields(cat?.fields);

  for (const f of fields) {
    const v = (variante?.details?.[f.id] ?? "").toString().trim();
    if (!v) continue;
    extras.push(`${f.nom}: ${shorten(v)}`);
  }

  return extras.length ? `${head} — ${extras.join(" • ")}` : head;
}

export default function PageTrailers() {
  const [meUid, setMeUid] = useState(null);
  const [meIsAdmin, setMeIsAdmin] = useState(false);

  const [equipements, setEquipements] = useState([]);
  const [catsGlobal, setCatsGlobal] = useState([]);

  const [trailers, setTrailers] = useState([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState(null);

  const [categories, setCategories] = useState([]);
  const [itemsByCat, setItemsByCat] = useState({});

  const [search, setSearch] = useState("");
  const [searchByCat, setSearchByCat] = useState({});

  const [showAddEquip, setShowAddEquip] = useState(false);
  const [addCatGlobalId, setAddCatGlobalId] = useState("");
  const [addEquipId, setAddEquipId] = useState("");
  const [addVarianteId, setAddVarianteId] = useState("");
  const [addQty, setAddQty] = useState("");

  // Modal envoyer en réparation
  const [repairSendOpen, setRepairSendOpen] = useState(false);
  const [repairSendCatId, setRepairSendCatId] = useState("");
  const [repairSendItem, setRepairSendItem] = useState(null);
  const [repairSendQty, setRepairSendQty] = useState(1);
  const [repairSendDest, setRepairSendDest] = useState("brise"); // "brise" | "jete"

  // -------- ÉCHANGE (admin only) --------
  const [showTrade, setShowTrade] = useState(false);

  const [tradeFromTrailerId, setTradeFromTrailerId] = useState("");
  const [tradeFromCats, setTradeFromCats] = useState([]);
  const [tradeFromCatId, setTradeFromCatId] = useState("");
  const [tradeFromItems, setTradeFromItems] = useState([]);
  const [tradeFromItemId, setTradeFromItemId] = useState("");
  const [tradeQty, setTradeQty] = useState(1);

  const [tradeToTrailerId, setTradeToTrailerId] = useState("");
  const [tradeToCats, setTradeToCats] = useState([]);
  const [tradeToCatId, setTradeToCatId] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setMeUid(u?.uid || null);

      if (!u?.uid) {
        setMeIsAdmin(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? snap.data() : {};
        setMeIsAdmin(!!data?.isAdmin);
      } catch (e) {
        console.error("load users/{uid}:", e);
        setMeIsAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const qEq = query(collection(db, "equipements"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qEq,
      (snap) => setEquipements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("equipements snapshot:", err)
    );
  }, []);

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

  useEffect(() => {
    setTrailers([]);
    setSelectedTrailerId(null);

    if (!meUid) return;

    const qT = meIsAdmin
      ? query(collection(db, "trailers"), orderBy("createdAt", "desc"))
      : query(collection(db, "trailers"), where("ownerUid", "==", meUid), orderBy("createdAt", "desc"));

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
  }, [meUid, meIsAdmin]);

  const selectedTrailer = useMemo(
    () => trailers.find((t) => t.id === selectedTrailerId) || null,
    [trailers, selectedTrailerId]
  );

  useEffect(() => {
    setCategories([]);
    setItemsByCat({});
    setSearch("");
    setSearchByCat({});

    setShowAddEquip(false);
    setAddCatGlobalId("");
    setAddEquipId("");
    setAddVarianteId("");
    setAddQty("");

    if (!selectedTrailerId) return;

    const qC = query(collection(db, "trailers", selectedTrailerId, "categories"), orderBy("createdAt", "asc"));
    return onSnapshot(
      qC,
      (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("categories(trailer) snapshot:", err)
    );
  }, [selectedTrailerId]);

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

  function filterItems(items, catDocId) {
    const qGlobal = normalize(search);
    const perCat = normalize(searchByCat?.[catDocId] || "");
    const q = (qGlobal + " " + perCat).trim();
    if (!q) return items;
    return (items || []).filter((it) => {
      const hay = [
        it.nom,
        it.varianteNom,
        ...(Object.values(it.details || {})),
      ]
        .map((x) => normalize(x))
        .join(" ");
      return hay.includes(q);
    });
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

  function fieldsForGlobalCatId(globalCatId) {
    const gid = (globalCatId || "").trim();
    const cat = catsGlobal.find((c) => (c.id || "").trim() === gid) || null;
    return sanitizeFields(cat?.fields);
  }

  function variantesForEquipement(eq) {
    if (!eq) return [];
    const fields = fieldsForGlobalCatId(eq.categorieId);
    return sanitizeVariants(eq.variantes, fields).sort((a, b) =>
      (a.nom || "").localeCompare(b.nom || "", "fr")
    );
  }

  function varianteById(eq, varianteId) {
    return variantesForEquipement(eq).find((v) => (v.id || "").trim() === (varianteId || "").trim()) || null;
  }

  function valueForItemField(item, field) {
    const direct = (item?.details?.[field.id] ?? "").toString().trim();
    if (direct) return direct;

    const eq = equipementById(item?.equipementId);
    if (!eq) return "";

    const v = varianteById(eq, item?.varianteId);
    const vv = (v?.details?.[field.id] ?? "").toString().trim();
    if (vv) return vv;

    if (isUniteLabel(field.nom)) {
      const u = (item?.unite ?? eq?.unite ?? "").toString().trim();
      if (u) return u;
    }
    return "";
  }

  function labelForTrailerItem(it) {
    const eqName = (it?.nom || "").trim() || "—";
    const varName = (it?.varianteNom || "").trim();
    return varName ? `${eqName} — ${varName}` : eqName;
  }

  function remarqueForTrailerItem(it) {
    const eq = equipementById(it?.equipementId);

    const pick = (...vals) => {
      for (const v of vals) {
        const s = (v ?? "").toString().trim();
        if (s) return s;
      }
      return "";
    };

    return pick(eq?.remarque, eq?.note, eq?.details?.remarque, eq?.details?.note, it?.remarque, it?.note);
  }

  function openAddEquipModalForCategory(globalCatId) {
    if (!selectedTrailerId) return;
    setShowAddEquip(true);
    setAddCatGlobalId((globalCatId || "").trim());
    setAddEquipId("");
    setAddVarianteId("");
    setAddQty("");
  }

  async function ajouterEquipementAuTrailer() {
    if (!selectedTrailerId) return;

    if (!addCatGlobalId) return alert("Erreur: catégorie manquante (bouton +).");
    if (!addEquipId) return alert("Choisis un objet.");
    if (!addVarianteId) return alert("Choisis une marque.");

    const qtyStr = (addQty ?? "").toString().trim();
    if (!qtyStr) return alert("Entre une quantité (obligatoire).");

    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) return alert("Quantité invalide (min 1).");

    let trailerCatDocId = findTrailerCatDocIdByGlobalCatId(addCatGlobalId);

    if (!trailerCatDocId) {
      await ensureAllCategoriesForTrailer(selectedTrailerId);
      trailerCatDocId = findTrailerCatDocIdByGlobalCatId(addCatGlobalId);
      if (!trailerCatDocId) return alert("Erreur: catégorie introuvable dans ce trailer.");
    }

    const eq = equipements.find((e) => e.id === addEquipId);
    if (!eq) return alert("Équipement introuvable.");

    const variante = varianteById(eq, addVarianteId);
    if (!variante) return alert("Type introuvable.");

    const itemsCol = collection(db, "trailers", selectedTrailerId, "categories", trailerCatDocId, "items");

    const qExisting = query(
      itemsCol,
      where("equipementId", "==", addEquipId),
      where("varianteId", "==", addVarianteId)
    );
    const exSnap = await getDocs(qExisting);

    const batch = writeBatch(db);

    if (!exSnap.empty) {
      const ex = exSnap.docs[0];
      const newQty = Number(ex.data().qty || 0) + qty;
      batch.update(ex.ref, {
        qty: newQty,
        nom: eq.nom || "",
        varianteNom: variante.nom || "",
        details: variante.details || {},
        unite: eq.unite || "",
      });
    } else {
      const newRef = doc(itemsCol);
      batch.set(newRef, {
        equipementId: addEquipId,
        nom: eq.nom || "",
        varianteId: variante.id || "",
        varianteNom: variante.nom || "",
        details: variante.details || {},
        unite: eq.unite || "",
        qty,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();

    setShowAddEquip(false);
    setAddEquipId("");
    setAddVarianteId("");
    setAddQty("");
  }

  function openRepairSendModal(catId, item) {
    const available = Number(item?.qty || 0);
    if (!Number.isFinite(available) || available <= 0) return;

    setRepairSendCatId(catId);
    setRepairSendItem(item);
    setRepairSendQty(1);
    setRepairSendDest("brise");
    setRepairSendOpen(true);
  }

  async function confirmSendToRepair() {
    if (!selectedTrailerId || !repairSendCatId || !repairSendItem?.id) return;

    const qn = Number(repairSendQty || 0);
    if (!Number.isFinite(qn) || qn <= 0) return alert("Quantité invalide (min 1).");

    const currentQty = Number(repairSendItem.qty || 0);
    if (qn > currentQty) return alert(`Quantité trop grande. Dispo: ${currentQty}`);

    const status = repairSendDest === "jete" ? "jete" : "brise";
    const safeTrailerNom = (selectedTrailer?.trailerNom || "").toString().trim() || "—";

    try {
      const batch = writeBatch(db);

      const itemRef = doc(
        db,
        "trailers",
        selectedTrailerId,
        "categories",
        repairSendCatId,
        "items",
        repairSendItem.id
      );

      const remaining = currentQty - qn;
      if (remaining <= 0) {
        batch.delete(itemRef);
      } else {
        batch.update(itemRef, { qty: remaining });
      }

      const repRef = doc(collection(db, "trailers", selectedTrailerId, "reparations"));
      batch.set(repRef, {
        trackId: repRef.id,
        status,
        equipementId: repairSendItem.equipementId || null,
        nom: (repairSendItem.nom || "").toString(),
        varianteId: repairSendItem.varianteId || null,
        varianteNom: (repairSendItem.varianteNom || "").toString(),
        details: repairSendItem.details || {},
        unite: (repairSendItem.unite || "").toString(),
        qty: qn,
        trailerNom: safeTrailerNom,
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid || null,
        source: "page_trailers_click",
        from: { catId: repairSendCatId, itemId: repairSendItem.id },

        adminActionType: null,
        adminActionNote: null,
        adminActionPo: null,
        adminActionAt: null,
        adminActionByUid: null,

        porterWhere: null,
        porterAt: null,
        porterByUid: null,
        porterByName: null,
        porterNote: null,

        chercherAt: null,
        chercherByUid: null,
        chercherByName: null,
        remisTrailerAt: null,
        remisTrailerByUid: null,
        remisTrailerByName: null,
        pickupNote: null,

        pretAt: null,
        pretByUid: null,
        pretByName: null,

        toStyroAt: null,
        toStyroByUid: null,
        toStyroByName: null,

        styroRecuAt: null,
        styroRecuByUid: null,
        styroRecuNote: null,

        needsAdminRepairConfirm: false,

        styroMiseReparationAt: null,
        styroMiseReparationByUid: null,

        styroRenvoyeAt: null,
        styroRenvoyeByUid: null,
        styroRenvoyeTo: null,
        styroRenvoyeNote: null,
      });

      const histRef = doc(collection(db, "reparations_history"));
      batch.set(histRef, {
        ts: serverTimestamp(),
        trackId: repRef.id,
        trailerId: selectedTrailerId,
        trailerNom: safeTrailerNom,
        byUid: auth.currentUser?.uid || null,
        event: status === "jete" ? "AJOUT_JETE" : "AJOUT_BRISE",
        nom: (repairSendItem.nom || "").toString(),
        varianteNom: (repairSendItem.varianteNom || "").toString(),
        qty: qn,
        status,
        equipementId: repairSendItem.equipementId || null,
        varianteId: repairSendItem.varianteId || null,
        from: { catId: repairSendCatId, itemId: repairSendItem.id },
        extra: {
          trailerQtyBefore: currentQty,
          trailerQtyAfter: remaining <= 0 ? 0 : remaining,
          source: "page_trailers_click",
        },
      });

      if (!meIsAdmin) {
        const notifRef = doc(db, "notifications", repRef.id);
        batch.set(notifRef, {
          targetRole: "admin",
          done: false,
          createdAt: serverTimestamp(),
          createdByUid: auth.currentUser?.uid || null,
          type: "reparation_added",
          status,
          trailerId: selectedTrailerId,
          trailerNom: safeTrailerNom,
          repId: repRef.id,
          nom: (repairSendItem.nom || "").toString(),
          varianteNom: (repairSendItem.varianteNom || "").toString(),
          qty: qn,
          source: "page_trailers_click",
        });
      }

      await batch.commit();

      setRepairSendOpen(false);
      setRepairSendCatId("");
      setRepairSendItem(null);
      setRepairSendQty(1);
      setRepairSendDest("brise");

      try {
        window.dispatchEvent(new CustomEvent("app_go_route", { detail: { route: "reparations" } }));
      } catch {}
    } catch (e) {
      console.error("confirmSendToRepair:", e);
      alert("Erreur envoi réparation: " + (e?.message || "inconnue"));
    }
  }

  async function supprimerItem(catId, itemId) {
    if (!selectedTrailerId) return;
    if (!window.confirm("Supprimer cet item?")) return;
    await deleteDoc(doc(db, "trailers", selectedTrailerId, "categories", catId, "items", itemId));
  }

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
    if (!meIsAdmin) return;

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

    const fromCatObj = tradeFromCats.find((c) => (c.id || "") === (tradeFromCatId || ""));
    if (fromCatObj) {
      const matchTo = tc.find((c) => (c.categorieId || "") === (fromCatObj.categorieId || ""));
      if (matchTo) setTradeToCatId(matchTo.id);
    } else if (tc[0]?.id) {
      setTradeToCatId(tc[0].id);
    }
  }

  async function effectuerEchange() {
    if (!meIsAdmin) return;
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
      const qExisting = query(
        destItemsCol,
        where("equipementId", "==", item.equipementId || ""),
        where("varianteId", "==", item.varianteId || "")
      );
      const existingSnap = await getDocs(qExisting);

      const batch = writeBatch(db);

      const remaining = Number(item.qty || 0) - moveQty;
      if (remaining <= 0) batch.delete(fromItemRef);
      else batch.update(fromItemRef, { qty: remaining });

      if (!existingSnap.empty) {
        const ex = existingSnap.docs[0];
        const newQty = Number(ex.data().qty || 0) + moveQty;
        batch.update(ex.ref, {
          qty: newQty,
          nom: item.nom || "",
          varianteId: item.varianteId || "",
          varianteNom: item.varianteNom || "",
          details: item.details || {},
          unite: item.unite || "",
        });
      } else {
        const newRef = doc(destItemsCol);
        batch.set(newRef, {
          equipementId: item.equipementId || "",
          nom: item.nom || "",
          varianteId: item.varianteId || "",
          varianteNom: item.varianteNom || "",
          details: item.details || {},
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

  const addEquipOptions = useMemo(() => {
    const gid = (addCatGlobalId || "").trim();
    if (!gid) return [];
    return equipementsPourCategorieId(gid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addCatGlobalId, equipements]);

  const addSelectedEquip = useMemo(() => {
    return equipements.find((e) => e.id === addEquipId) || null;
  }, [equipements, addEquipId]);

  const addVarianteOptions = useMemo(() => {
    if (!addSelectedEquip) return [];
    return variantesForEquipement(addSelectedEquip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSelectedEquip, catsGlobal]);

  useEffect(() => {
    setAddVarianteId("");
  }, [addEquipId]);

  function onClickRow(catId, it) {
    openRepairSendModal(catId, it);
  }

  return (
    <div className="pt-page">
      <div className="pt-header">
        <div style={{ width: "100%" }}>
          <div className="pt-headerRow">
            <div>
              <h1 className="pt-title">Trailers</h1>
            </div>

            <div className="pt-headerActions">
              {meIsAdmin ? (
                <button
                  className="pt-btn pt-btnSwap pt-btnSwapFixed"
                  type="button"
                  onClick={openTradeModal}
                  disabled={trailers.length < 2}
                >
                  Faire un échange
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-grid">
        <div className="pt-card">
          <div className="pt-cardTitle">Liste des trailers</div>

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

          {meIsAdmin && trailers.length < 2 && (
            <div className="pt-footHint" style={{ marginTop: 10 }}>
              Ajoute au moins 2 trailers pour utiliser “Faire un échange”.
            </div>
          )}
        </div>

        <div className="pt-card">
          {!selectedTrailer ? (
            <div className="pt-empty">Choisis un trailer.</div>
          ) : (
            <>
              <div className="pt-detailHead">
                <h2 className="pt-detailTitle pt-detailTitleNoMargin">{selectedTrailer.trailerNom}</h2>

                <input
                  className="pt-input pt-search pt-searchInline"
                  placeholder="Rechercher un équipement"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!selectedTrailerId}
                />
              </div>

              {categoriesSorted.length === 0 ? (
                <div className="pt-empty">Chargement des catégories…</div>
              ) : (
                <div className="pt-cats">
                  {categoriesSorted.map((cat) => {
                    const itemsAll = itemsByCat[cat.id] || [];
                    const items = filterItems(itemsAll, cat.id);

                    const qGlobal = (search || "").trim();
                    const qLocal = (searchByCat?.[cat.id] || "").trim();
                    if ((qGlobal || qLocal) && items.length === 0) return null;

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
                          <div className="pt-sectionLeft">
                            <div className="pt-sectionName">
                              <span aria-hidden="true" className="pt-dot" style={{ background: base }} />
                              <span>{cat.nom || catNameFromId(catsGlobal, cat.categorieId) || "Catégorie"}</span>
                            </div>
                          </div>

                          <div className="pt-sectionRight">
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
                            Aucun résultat.
                          </div>
                        ) : (
                          <div className="pt-tableWrap pt-tableWrapScroll10">
                            <table className="pt-table">
                              <thead>
                                <tr>
                                  <th className="pt-th">Produit / Type / Remarque</th>
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
                                  const remarque = remarqueForTrailerItem(it);
                                  return (
                                    <tr
                                      key={it.id}
                                      onClick={() => onClickRow(cat.id, it)}
                                      title="Cliquer pour envoyer en réparation"
                                      style={{ cursor: "pointer" }}
                                    >
                                      <td className="pt-td">
                                        <div className="pt-itemCell">
                                          <div className="pt-itemTop">
                                            <span className="pt-itemName">{it.nom || "—"}</span>
                                          </div>

                                          {(it.varianteNom || "").trim() ? (
                                            <div className="pt-itemTypeCenter">{it.varianteNom}</div>
                                          ) : null}

                                          {remarque ? <div className="pt-itemRemark">{remarque}</div> : null}
                                        </div>
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
                                        <span style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                                          <span>{Number(it.qty || 0)}</span>
                                        </span>
                                      </td>

                                      <td
                                        className="pt-td"
                                        style={{ textAlign: "right" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          className="pt-btnDanger"
                                          onClick={() => supprimerItem(cat.id, it.id)}
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

      {showAddEquip && (
        <div className="pt-modalOverlay" onClick={() => setShowAddEquip(false)}>
          <div className="pt-modal pt-modalSmall" onClick={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">
                Ajouter un équipement{" "}
                <span style={{ opacity: 0.7, fontWeight: 900 }}>
                  — {catNameFromId(catsGlobal, addCatGlobalId) || "Catégorie"}
                </span>
              </div>
              <button className="pt-modalClose" type="button" onClick={() => setShowAddEquip(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div className="pt-modalBlock" style={{ background: "#fff" }}>
                <div className="pt-modalLabel">Objet</div>
                <select className="pt-select" value={addEquipId} onChange={(e) => setAddEquipId(e.target.value)}>
                  <option value="">Choisir un objet…</option>
                  {addEquipOptions.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {optionLabelForEquipement(eq)}
                    </option>
                  ))}
                </select>

                <div className="pt-modalLabel" style={{ marginTop: 10 }}>Marque</div>
                <select
                  className="pt-select"
                  value={addVarianteId}
                  onChange={(e) => setAddVarianteId(e.target.value)}
                  disabled={!addEquipId}
                >
                  <option value="">Choisir une marque...</option>
                  {addVarianteOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {optionLabelForVariante(addSelectedEquip, v, catsGlobal)}
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
                  placeholder="Obligatoire"
                />

                <div className="pt-modalHint">
                  Si le même objet avec le même type existe déjà dans cette catégorie, la quantité sera additionnée.
                </div>
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

      {repairSendOpen && repairSendItem && (
        <div className="pt-modalOverlay" onClick={() => setRepairSendOpen(false)}>
          <div className="pt-modal pt-modalSmall" onClick={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Envoyer en réparation</div>
              <button className="pt-modalClose" type="button" onClick={() => setRepairSendOpen(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div style={{ fontWeight: 1000, marginBottom: 4 }}>{repairSendItem.nom || "—"}</div>
              <div style={{ fontWeight: 700, opacity: 0.8, marginBottom: 8 }}>
                {(repairSendItem.varianteNom || "").trim() || "—"}
              </div>

              <div style={{ opacity: 0.75, marginBottom: 12 }}>
                Dispo dans le trailer: <b>{Number(repairSendItem.qty || 0)}</b>
              </div>

              <div className="pt-modalBlock" style={{ background: "#fff" }}>
                <div className="pt-modalLabel">Type</div>
                <select
                  className="pt-select"
                  value={repairSendDest}
                  onChange={(e) => setRepairSendDest(e.target.value)}
                >
                  <option value="brise">Brisé</option>
                  <option value="jete">Brisé à jeté</option>
                </select>

                <div className="pt-modalLabel" style={{ marginTop: 10 }}>
                  Quantité
                </div>
                <input
                  className="pt-input pt-noSpin"
                  type="number"
                  min="1"
                  max={Number(repairSendItem.qty || 0) || undefined}
                  value={repairSendQty}
                  onChange={(e) => setRepairSendQty(e.target.value)}
                  placeholder="1"
                />
              </div>
            </div>

            <div className="pt-modalFoot">
              <button className="pt-btn" type="button" onClick={confirmSendToRepair}>
                Confirmer
              </button>
              <button className="pt-btn pt-btnGhost" type="button" onClick={() => setRepairSendOpen(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrade && meIsAdmin && (
        <div className="pt-modalOverlay" onClick={() => setShowTrade(false)}>
          <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pt-modalHead">
              <div className="pt-modalTitle">Faire un échange</div>
              <button className="pt-modalClose" type="button" onClick={() => setShowTrade(false)}>
                ✕
              </button>
            </div>

            <div className="pt-modalBody">
              <div className="pt-modalGrid">
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
                    {tradeFromCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom || catNameFromId(catsGlobal, c.categorieId) || "Catégorie"}
                      </option>
                    ))}
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