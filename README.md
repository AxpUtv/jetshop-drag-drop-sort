# Jetshop Admin - Dra och släpp-sortering

Userscript (Tampermonkey/Violentmonkey) som lägger till dra och släpp för att sortera om rader i Jetshop-admin.

## Fungerar på

- **Filterlistan**: `.../admin/Administration/Products/Filtering.aspx`
- **Kategoriproduktlistan**: `.../admin/Administration/Products/AddEditCategoryProductList.aspx`

Matchar alla Jetshop-butiker (`*://*/admin/Administration/Products/...`).

## Så funkar det

1. Varje rad får ett grepp längst till vänster. Ta tag i det och dra raden dit du vill.
2. **Ctrl-klick** på greppet markerar flera rader. **Shift-klick** markerar ett intervall. Dra en markerad rad så flyttas hela gruppen samtidigt.
3. **Esc** avbryter en pågående dragning, annars rensar den markeringen.
4. När du släpper skrivs kolumnen "Egen sortering" om automatiskt (10, 20, 30 ...) efter den nya ordningen.
5. Klicka **Spara** i admin för att spara ordningen. Skriptet sparar inte åt dig.

## Installation

1. Installera Tampermonkey eller Violentmonkey i webbläsaren.
2. Öppna `jetshop-drag-drop-sort.user.js` och installera.

## Teknik

Sorteringen i Jetshop lagras i numeriska textfält per rad. Skriptet flyttar bara raderna i DOM och numrerar om fälten efter den synliga ordningen. Delvisa postbacks (ASP.NET UpdatePanel) fångas så att grepp och lyssnare läggs tillbaka när tabellen byts ut.

Dragningen bygger på pekarhändelser (`pointerdown` med `setPointerCapture`), inte på webbläsarens inbyggda HTML5 dra och släpp. Version 1.0 använde den inbyggda varianten, och när den fastnade kom `dragend` aldrig fram: raden blev kvar gråad, pekaren stod som en greppande hand över hela sidan och ingen ny dragning gick att starta förrän sidan laddades om. Från 1.1 går varje sätt en dragning kan ta slut på - släpp, avbrott, fönsterbyte, Esc, postback - genom samma städning. Nära fönstrets över- och underkant scrollar sidan automatiskt under dragningen.
