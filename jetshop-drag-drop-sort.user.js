// ==UserScript==
// @name         Jetshop Admin - Dra och släpp-sortering
// @namespace    https://github.com/AxpUtv/jetshop-drag-drop-sort
// @version      1.1.0
// @description  Dra och släpp för att sortera om rader i Jetshop-admin (filterlistan och kategoriproduktlistan). Ctrl-klick markerar flera rader att flytta samtidigt.
// @author       ArkUtv
// @downloadURL  https://raw.githubusercontent.com/AxpUtv/jetshop-drag-drop-sort/main/jetshop-drag-drop-sort.user.js
// @updateURL    https://raw.githubusercontent.com/AxpUtv/jetshop-drag-drop-sort/main/jetshop-drag-drop-sort.user.js
// @match        *://*/admin/Administration/Products/Filtering.aspx*
// @match        *://*/admin/Administration/Products/AddEditCategoryProductList.aspx*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Varje sida har en tabell med rader som innehåller ett "Egen sortering"-fält.
    // Vi identifierar sidan på vilken tabell/fält som finns, inte på exakt URL.
    const CONFIGS = [
        { name: 'filter',   tableSel: '#filtersList_FiltersGrid',              sortSel: 'input[id$="_txtSortOrder"]' },
        { name: 'produkt',  tableSel: '#addeditcategoryproductlist_dgProductList', sortSel: 'input[id$="_tbSortOrder"]' },
    ];

    const SORT_STEP = 10; // Ny sorteringsordning blir 10, 20, 30 ...

    // ---- Hjälpfunktioner --------------------------------------------------

    function allRows(table) {
        // Direkta rader i tabellen (webbläsaren lägger själv till en tbody).
        return Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
    }

    function isDataRow(row, cfg) {
        return !!row.querySelector(cfg.sortSel);
    }

    function dataRows(table, cfg) {
        return allRows(table).filter(r => isDataRow(r, cfg));
    }

    function getSelected(table, cfg) {
        // Returnerar markerade datarader i DOM-ordning.
        return dataRows(table, cfg).filter(r => r.classList.contains('jsdd-selected'));
    }

    function clearSelection(table, cfg) {
        dataRows(table, cfg).forEach(r => r.classList.remove('jsdd-selected'));
    }

    function clearIndicators(table) {
        table.querySelectorAll('.jsdd-drop-above, .jsdd-drop-below')
            .forEach(r => r.classList.remove('jsdd-drop-above', 'jsdd-drop-below'));
    }

    // Skriver om alla sorteringsfält efter nuvarande visuella ordning.
    function renumber(table, cfg) {
        const rows = dataRows(table, cfg);
        rows.forEach((row, i) => {
            const inp = row.querySelector(cfg.sortSel);
            if (inp) {
                inp.value = (i + 1) * SORT_STEP;
                // Trigga eventuell validering/ändringslyssnare.
                inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    // ---- Uppbyggnad av gränssnitt ----------------------------------------

    function addHandleCells(table, cfg) {
        allRows(table).forEach((row, idx) => {
            if (row.querySelector('.jsdd-handle-cell')) return; // redan hanterad

            if (isDataRow(row, cfg)) {
                row.classList.add('jsdd-row');
                const td = document.createElement('td');
                td.className = 'jsdd-handle-cell';

                const grip = document.createElement('span');
                grip.className = 'jsdd-handle';
                grip.textContent = '⠇'; // ⠇-liknande grepp-ikon
                // Medvetet INTE draggable - se kommentaren vid attachHandlers.
                grip.title = 'Dra för att flytta raden.\nCtrl-klick markerar flera rader.\nShift-klick markerar ett intervall.';
                td.appendChild(grip);

                row.insertBefore(td, row.firstChild);
            } else if (idx === 0) {
                // Rubrikraden: lägg till en tom cell så kolumnerna hamnar rätt.
                const isTh = !!row.querySelector('th');
                const cell = document.createElement(isTh ? 'th' : 'td');
                cell.className = 'jsdd-handle-cell jsdd-handle-header';
                if (row.querySelector('td.listHeader')) cell.className += ' listHeader';
                row.insertBefore(cell, row.firstChild);
            }
        });
    }

    function addBanner(table) {
        if (table.previousElementSibling && table.previousElementSibling.classList.contains('jsdd-banner')) return;
        const banner = document.createElement('div');
        banner.className = 'jsdd-banner';
        banner.innerHTML =
            '<strong>Dra och släpp-sortering aktiv.</strong> ' +
            'Ta tag i grepp-ikonen och dra raden dit du vill. ' +
            'Ctrl-klick (eller Shift-klick) på grepp-ikonen markerar flera rader att flytta samtidigt. ' +
            'Kom ihåg att klicka <em>Spara</em> efteråt.';
        table.parentNode.insertBefore(banner, table);
    }

    // Liten toast för återkoppling.
    let toastEl = null, toastTimer = null;
    function toast(msg) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'jsdd-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add('jsdd-toast-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('jsdd-toast-show'), 2200);
    }

    // Anpassad drag-bild som visar antalet rader.
    let dragImage = null;
    function getDragImage() {
        if (!dragImage) {
            dragImage = document.createElement('div');
            dragImage.className = 'jsdd-dragimage';
            document.body.appendChild(dragImage);
        }
        return dragImage;
    }

    // ---- Händelsehantering (delegerad på tabellen) ------------------------
    //
    // Dragningen bygger på pekarhändelser, inte på HTML5 dra och släpp.
    //
    // Version 1.0 använde draggable + dragstart/drop/dragend. Den dragningen
    // körs av operativsystemet, och fastnar den kommer dragend aldrig fram.
    // Då blev raden kvar halvgenomskinlig, pekaren stod som en greppande hand
    // över hela sidan och ingen ny dragning gick att starta förrän sidan
    // laddades om. Städningen låg i dragend och fick aldrig köra.
    //
    // Med pointerdown + setPointerCapture äger sidan hela förloppet själv.
    // Varje sätt en dragning kan ta slut på - släpp, pointercancel, förlorad
    // capture, fönsterbyte, Esc, en UpdatePanel-postback - leder till samma
    // städfunktion.

    const DRAG_THRESHOLD = 4;   // px innan en nedtryckning räknas som dragning
    const SCROLL_EDGE = 50;     // px från fönsterkanten där autoscroll startar
    const SCROLL_MAX = 18;      // px per bildruta vid kanten

    let drag = null;

    function endDrag(commit) {
        const d = drag;
        if (!d) return;
        drag = null;

        cancelAnimationFrame(d.raf);
        try {
            if (d.grip.hasPointerCapture && d.grip.hasPointerCapture(d.pointerId)) {
                d.grip.releasePointerCapture(d.pointerId);
            }
        } catch (_) { /* elementet kan redan vara borta */ }

        document.documentElement.classList.remove('jsdd-active');
        getDragImage().classList.remove('jsdd-dragimage-show');
        d.group.forEach(r => r.classList.remove('jsdd-dragging'));
        clearIndicators(d.table);

        // Har en postback bytt ut tabellen under tiden finns inget att flytta.
        if (commit && d.started && d.target && d.table.isConnected
            && d.target.row.isConnected && d.group.every(r => r.isConnected)) {
            moveRows(d.group, d.target.row, d.target.after);
            renumber(d.table, d.cfg);
            toast('Ny ordning satt. Klicka Spara för att spara.');
        }
    }

    function updateTarget(d, x, y) {
        const img = getDragImage();
        img.style.left = (x + 14) + 'px';
        img.style.top = (y + 10) + 'px';

        clearIndicators(d.table);
        d.target = null;

        const el = document.elementFromPoint(x, y);
        const row = el && el.closest('tr');
        if (!row || !d.table.contains(row) || !isDataRow(row, d.cfg)) return;
        if (d.group.includes(row)) return;

        const rect = row.getBoundingClientRect();
        const after = (y - rect.top) > rect.height / 2;
        row.classList.add(after ? 'jsdd-drop-below' : 'jsdd-drop-above');
        d.target = { row, after };
    }

    // Autoscroll när pekaren står nära över- eller underkanten. Utan den gick
    // det inte att flytta en rad längre än det som syntes på skärmen.
    function scrollLoop() {
        const d = drag;
        if (!d || !d.started) return;
        let dy = 0;
        if (d.y < SCROLL_EDGE) dy = -Math.ceil(SCROLL_MAX * (1 - d.y / SCROLL_EDGE));
        else if (d.y > innerHeight - SCROLL_EDGE) dy = Math.ceil(SCROLL_MAX * (1 - (innerHeight - d.y) / SCROLL_EDGE));
        if (dy) {
            window.scrollBy(0, dy);
            updateTarget(d, d.x, d.y);
        }
        d.raf = requestAnimationFrame(scrollLoop);
    }

    function attachHandlers(table, cfg) {
        if (table.dataset.jsddBound) return;
        table.dataset.jsddBound = '1';

        // Markering via klick på greppet.
        table.addEventListener('click', (e) => {
            const grip = e.target.closest('.jsdd-handle');
            if (!grip) return;
            const row = grip.closest('tr');
            if (!row || !isDataRow(row, cfg)) return;

            if (e.shiftKey) {
                e.preventDefault();
                const rows = dataRows(table, cfg);
                const anchor = table._jsddAnchor && rows.includes(table._jsddAnchor)
                    ? table._jsddAnchor : row;
                const a = rows.indexOf(anchor), b = rows.indexOf(row);
                const [lo, hi] = a < b ? [a, b] : [b, a];
                if (!(e.ctrlKey || e.metaKey)) clearSelection(table, cfg);
                for (let i = lo; i <= hi; i++) rows[i].classList.add('jsdd-selected');
            } else if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                row.classList.toggle('jsdd-selected');
                table._jsddAnchor = row;
            }
        });

        // Nedtryckning på greppet. Själva dragningen startar först när pekaren
        // rört sig förbi tröskeln, så att Ctrl- och Shift-klick fortfarande är
        // rena klick.
        table.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('.jsdd-handle');
            if (!grip || e.button !== 0) return;
            if (e.ctrlKey || e.metaKey || e.shiftKey) return; // markering, se click
            const row = grip.closest('tr');
            if (!row || !isDataRow(row, cfg)) return;

            endDrag(false); // om en tidigare dragning mot förmodan hänger kvar
            e.preventDefault(); // ingen textmarkering och ingen inbyggd dragning

            drag = {
                table, cfg, grip, row,
                pointerId: e.pointerId,
                startX: e.clientX, startY: e.clientY,
                x: e.clientX, y: e.clientY,
                started: false, group: [], target: null, raf: 0,
            };
            try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ignoreras */ }
        });

        table.addEventListener('pointermove', (e) => {
            const d = drag;
            if (!d || d.table !== table || e.pointerId !== d.pointerId) return;
            d.x = e.clientX;
            d.y = e.clientY;

            if (!d.started) {
                if (Math.abs(d.y - d.startY) < DRAG_THRESHOLD
                    && Math.abs(d.x - d.startX) < DRAG_THRESHOLD) return;

                const selected = getSelected(table, cfg);
                if (d.row.classList.contains('jsdd-selected') && selected.length) {
                    d.group = selected;
                } else {
                    clearSelection(table, cfg);
                    d.group = [d.row];
                }
                d.group.forEach(r => r.classList.add('jsdd-dragging'));
                d.started = true;

                const img = getDragImage();
                img.textContent = d.group.length > 1 ? (d.group.length + ' rader flyttas') : 'Flyttar rad';
                img.classList.add('jsdd-dragimage-show');
                document.documentElement.classList.add('jsdd-active');
                d.raf = requestAnimationFrame(scrollLoop);
            }

            e.preventDefault();
            updateTarget(d, d.x, d.y);
        });

        table.addEventListener('pointerup', (e) => {
            if (!drag || drag.table !== table || e.pointerId !== drag.pointerId) return;
            endDrag(true);
        });

        // Avbrott utan släpp: webbläsaren tog över pekaren, capture tappades
        // eller ett annat fönster fick fokus. Inget flyttas.
        table.addEventListener('pointercancel', () => endDrag(false));
        table.addEventListener('lostpointercapture', () => {
            // Tappad capture följer normalt direkt på pointerup, som redan
            // städat. Kommer den utan pointerup är dragningen avbruten.
            if (drag && drag.table === table) endDrag(false);
        });
    }

    function moveRows(group, targetRow, after) {
        const container = targetRow.parentNode;
        // Hitta ankarnod som inte ingår i gruppen.
        let anchor = after ? targetRow.nextElementSibling : targetRow;
        while (anchor && group.includes(anchor)) anchor = anchor.nextElementSibling;
        // Gruppen är i DOM-ordning; infoga före samma ankare för att bevara ordningen.
        group.forEach(r => {
            container.insertBefore(r, anchor);
            r.classList.add('jsdd-moved');
            setTimeout(() => r.classList.remove('jsdd-moved'), 900);
        });
    }

    // Esc avbryter en pågående dragning, annars rensar den markeringen.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (drag) {
            endDrag(false);
            return;
        }
        document.querySelectorAll('tr.jsdd-selected')
            .forEach(r => r.classList.remove('jsdd-selected'));
    });

    // Alt-Tab eller klick i ett annat fönster mitt i en dragning.
    window.addEventListener('blur', () => endDrag(false));

    // ---- Stilmall ---------------------------------------------------------

    function injectStyles() {
        if (document.getElementById('jsdd-styles')) return;
        const css = `
        .jsdd-banner {
            margin: 8px 0; padding: 8px 12px; border-radius: 4px;
            background: #eef6ff; border: 1px solid #b6d8f7; color: #1a4b73;
            font-size: 12px; line-height: 1.5;
        }
        .jsdd-handle-cell { width: 26px; text-align: center; padding: 0 4px !important; }
        .jsdd-handle {
            display: inline-block; cursor: grab; color: #888;
            font-size: 16px; line-height: 1; padding: 4px 2px; user-select: none;
            touch-action: none;
        }
        .jsdd-handle:hover { color: #1a4b73; }
        /* Greppande hand bara medan en dragning faktiskt pågår. Klassen tas
           bort av endDrag, som alla vägar ut ur en dragning går genom. */
        html.jsdd-active, html.jsdd-active * { cursor: grabbing !important; user-select: none !important; }
        tr.jsdd-selected > td { background: #dbeeff !important; }
        tr.jsdd-dragging { opacity: 0.45; }
        tr.jsdd-drop-above > td { box-shadow: inset 0 3px 0 -1px #2b7de9; }
        tr.jsdd-drop-below > td { box-shadow: inset 0 -3px 0 -1px #2b7de9; }
        tr.jsdd-moved > td { animation: jsddFlash 0.9s ease-out; }
        @keyframes jsddFlash {
            from { background: #fff6bf; }
            to   { background: transparent; }
        }
        .jsdd-dragimage {
            position: fixed; top: -1000px; left: -1000px; z-index: 99999;
            pointer-events: none; display: none;
            background: #2b7de9; color: #fff; padding: 4px 10px;
            border-radius: 4px; font-size: 12px; font-family: sans-serif;
            white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,.3);
        }
        .jsdd-dragimage.jsdd-dragimage-show { display: block; }
        .jsdd-toast {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(20px);
            background: #333; color: #fff; padding: 10px 16px; border-radius: 4px;
            font-size: 13px; font-family: sans-serif; opacity: 0; pointer-events: none;
            transition: opacity .2s, transform .2s; z-index: 99999;
        }
        .jsdd-toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }
        `;
        const style = document.createElement('style');
        style.id = 'jsdd-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ---- Initiering -------------------------------------------------------

    function init() {
        injectStyles();
        CONFIGS.forEach(cfg => {
            const table = document.querySelector(cfg.tableSel);
            if (!table) return;
            if (!dataRows(table, cfg).length) return;
            addBanner(table);
            addHandleCells(table, cfg);
            attachHandlers(table, cfg);
        });
    }

    init();

    // ASP.NET UpdatePanel gör delvisa postbacks som byter ut tabellen.
    // Kör init igen efter varje sådan så att grepp och lyssnare finns kvar.
    function hookPartialPostback() {
        try {
            if (window.Sys && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                const prm = Sys.WebForms.PageRequestManager.getInstance();
                // En postback mitt i en dragning byter ut raderna under oss.
                prm.add_initializeRequest(function () { endDrag(false); });
                prm.add_endRequest(function () { setTimeout(init, 0); });
                return true;
            }
        } catch (_) { /* ignoreras */ }
        return false;
    }

    if (!hookPartialPostback()) {
        // Sys kanske inte laddats än; försök en kort stund.
        let tries = 0;
        const t = setInterval(() => {
            if (hookPartialPostback() || ++tries > 20) clearInterval(t);
        }, 250);
    }
})();
