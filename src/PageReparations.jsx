import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import PanelReparations from "./PanelReparations";
import "./PageReparations.css";

export default function PageReparations({ isAdmin }) {
  const [trailers, setTrailers] = useState([]);
  const [equipements, setEquipements] = useState([]);
  const [catsGlobal, setCatsGlobal] = useState([]);
  const [selectedTrailerId, setSelectedTrailerId] = useState("");

  useEffect(() => {
    let unsubTrailers = null;

    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (unsubTrailers) {
        unsubTrailers();
        unsubTrailers = null;
      }

      if (!u?.uid) {
        setTrailers([]);
        return;
      }

      const qT = isAdmin
        ? query(collection(db, "trailers"), orderBy("createdAt", "desc"))
        : query(
            collection(db, "trailers"),
            where("ownerUid", "==", u.uid),
            orderBy("createdAt", "desc")
          );

      unsubTrailers = onSnapshot(
        qT,
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setTrailers(arr);
        },
        (err) => console.error("trailers snapshot:", err)
      );
    });

    const unsubEquipements = onSnapshot(
      query(collection(db, "equipements"), orderBy("createdAt", "desc")),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEquipements(arr);
      },
      (err) => console.error("equipements snapshot:", err)
    );

    const unsubCats = onSnapshot(
      query(collection(db, "categories"), orderBy("createdAt", "asc")),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCatsGlobal(arr);
      },
      (err) => console.error("categories snapshot:", err)
    );

    return () => {
      unsubAuth?.();
      unsubTrailers?.();
      unsubEquipements?.();
      unsubCats?.();
    };
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    if (!trailers.length) return;
    if (selectedTrailerId) return;
    setSelectedTrailerId(trailers[0]?.id || "");
  }, [trailers, isAdmin, selectedTrailerId]);

  const selectedTrailer = useMemo(() => {
    return trailers.find((t) => t.id === selectedTrailerId) || null;
  }, [trailers, selectedTrailerId]);

  return (
    <div className="pageRep">
      {isAdmin || selectedTrailerId ? (
        <PanelReparations
          trailerId={isAdmin ? null : selectedTrailerId}
          trailerNom={isAdmin ? "" : selectedTrailer?.trailerNom || ""}
          isAdmin={isAdmin}
          equipements={equipements}
          catsGlobal={catsGlobal}
        />
      ) : null}
    </div>
  );
}