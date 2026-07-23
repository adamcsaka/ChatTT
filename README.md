# 🌐 P2P Reddit - Szerver Nélküli Decentralizált Chat & Fórum

Egy teljesen szerverfüggetlen, **Peer-to-Peer (P2P)** alapú közösségi chat és fórum alkalmazás **WebRTC** technológiával. Nem igényel központi szervert az üzenetváltáshoz, fájlmegosztáshoz, hanghívásokhoz és élő közvetítésekhez!

---

## ⚡ Főbb Funkciók (v3.0)

* 👥 **Tartós Ismerős Törlés & Böngészőfrissítés Védelem**:
  * Törölt peerek/ismerősök megőrzése (`deletedUserIds` lista).
  * Böngészőfrissítés után a törölt ismerősök **NEM térnek vissza automatikusan**, a megjegyzett beállítások fogadnak.
* 🔄 **Interaktív Szinkronizálási Menü (Sync Options Modal)**:
  * A `🔄 Szinkronizálás` gombra kattintva felugró menüből választhatsz:
    1. 💬 **Csak Topikok szinkronizálása**
    2. 👥 **Csak Ismerősök & Peerek szinkronizálása**
    3. 🔄 **Mindent szinkronizál (Topikok + Ismerősök)**
  * Pipálható opció a törölt ismerősök szándékos visszaállítására.
* 📌 **Megjegyzett Állapotok & Aktuális Topik**:
  * Az éppen megnyitott topik, sávszélességek, színek, üzenethangok és beállítások megőrződnek frissítés után is.
* 🎙️ **P2P Hanghívások & 🎥 Élő Streamelések (WebRTC)**:
  * Mikrofon alapú **hanghívások** és képernyő/kamera **élő közvetítések** (Stream).
  * **Instant Stream Player Popup**: Az élő adás vagy hívás azonnal megnyílik egy beágyazott lejátszó ablakban.
  * **Autoplay Kötöttségek Feloldása**: Böngészős tiltások automatikus kezelése engedélyező gombbal.
* ↔️ **Átméretezhető Felület (Resizable Divider)**:
  * A bal oldali topik/felhasználó sáv és a chat ablak közötti elválasztóvonal szabadon **húzható és átméretezhető**.
* 📌 **Rögzített Üzenetek & Média Felugró Ablak (Modal Window)**:
  * Kényelmes felugró ablak a pineknek és médiafájloknak.
* 📥 **TXT Beszélgetés Exportálás**:
  * Beszélgetések azonnali mentése és letöltése `.txt` fájlként.
* 🫨 **MSN Nudge / Rezgetés & Üzenethangok**:
  * Megrezgethető ablakok és kiválasztható MSN csengőhangok.

---

## 🚀 Használat

1. Nyisd meg a `ChatTT/index.html` fájlt bármilyen modern böngészőben.
2. Add meg a felhasználónevedet és a Peer ID-dat (pl. `1` vagy `2`).
3. Csatlakozz az ismerőseidhez és használd a P2P funkciókat!
