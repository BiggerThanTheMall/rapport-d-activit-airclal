// ==UserScript==
// @name         LTOA Aircall – Collecteur d'appels
// @namespace    https://github.com/BiggerThanTheMall/tampermonkey-ltoa
// @version      2.2.0
// @description  Collecte les appels Aircall pour le rapport LTOA Modulr
// @author       LTOA
//
// @match        https://dashboard.aircall.io/*
// @run-at       document-end
//
// @grant        window.close
//
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/tampermonkey-ltoa/main/LTOA-Aircall-Collecteur-Appels.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/tampermonkey-ltoa/main/LTOA-Aircall-Collecteur-Appels.user.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        DEBUG: true,
        DELAY_BETWEEN_ACTIONS: 1000,
        DELAY_LOAD_MORE: 2000,
        DELAY_PREVIEW: 1500,
        MAX_LOAD_MORE_CLICKS: 20,
    };

    // Mapping Modulr -> Aircall
    const USER_MAP_AIRCALL = {
        'Doryan KALAH': 'Doryan Kalah',
        'Eddy KALAH': 'Eddy Kalah',
        'Ghais Kalah': 'Ghais Kalah',
        'GHAIS KALAH': 'Ghais Kalah',
        'Jake CASIMIR': 'Jake CASIMIR',
        'Louli VULLIOD-PIN': 'Louli VULLIOD',
        'Nadia KALAH': 'Nadia Kalah',
        'Youness OUACHBAB': 'Youness OUACHBAB',
        'Sheana KRIEF': 'Sheana KRIEF',
    };

    const Utils = {
        log: (msg, data = null) => {
            if (CONFIG.DEBUG) console.log(`[LTOA-Aircall] ${msg}`, data || '');
        },
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        formatDateForAircall: (dateStr) => {
            const parts = dateStr.split('/');
            const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
            const day = date.getDate();
            const suffix = (day === 1 || day === 21 || day === 31) ? 'st' :
                          (day === 2 || day === 22) ? 'nd' :
                          (day === 3 || day === 23) ? 'rd' : 'th';
            return `${months[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
        },

        isLoggedIn: () => {
            return !window.location.pathname.includes('/login') &&
                   !window.location.pathname.includes('/auth') &&
                   !document.querySelector('input[type="password"]');
        },

        getLtoaParams: () => {
            const params = new URLSearchParams(window.location.search);
            const user = params.get('ltoa_user');
            const date = params.get('ltoa_date');
            const autoclose = params.get('ltoa_autoclose') === 'true';
            if (user && date) return { user, date, autoclose };
            return null;
        },

        sendToParent: (data) => {
            if (window.opener) {
                try { window.opener.postMessage(data, '*'); return true; } catch (e) {}
            }
            return false;
        }
    };

    const AircallCollector = {
        createStatusIndicator() {
            const existing = document.getElementById('ltoa-status');
            if (existing) existing.remove();

            const div = document.createElement('div');
            div.id = 'ltoa-status';
            div.innerHTML = `
                <div style="position:fixed;top:10px;right:10px;z-index:999999;background:linear-gradient(135deg,#c62828,#8e0000);color:white;padding:15px 20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:sans-serif;min-width:300px;">
                    <div style="display:flex;align-items:center;margin-bottom:8px;">
                        <span style="font-size:20px;margin-right:10px;">📞</span>
                        <strong>LTOA Aircall</strong>
                    </div>
                    <div id="ltoa-user" style="font-size:12px;opacity:0.8;"></div>
                    <div id="ltoa-date" style="font-size:12px;opacity:0.8;margin-bottom:8px;"></div>
                    <div id="ltoa-msg" style="font-size:13px;">Démarrage...</div>
                    <div style="margin-top:10px;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;">
                        <div id="ltoa-bar" style="width:0%;height:100%;background:white;transition:width 0.3s;"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(div);
        },

        updateStatus(msg, pct = null) {
            Utils.log(msg);
            const el = document.getElementById('ltoa-msg');
            const bar = document.getElementById('ltoa-bar');
            if (el) el.textContent = msg;
            if (bar && pct !== null) bar.style.width = pct + '%';
            Utils.sendToParent({ type: 'LTOA_AIRCALL_STATUS', message: msg });
        },

        async waitForPageLoad() {
            this.updateStatus('Chargement page...', 5);
            for (let i = 0; i < 30; i++) {
                await Utils.delay(500);
                if (document.querySelector('[data-test="all-filters-button"]')) return true;
            }
            return false;
        },

        // 1. Ouvrir filtres
        async openFilters() {
            this.updateStatus('Ouverture filtres...', 10);
            const btn = document.querySelector('[data-test="all-filters-button"]');
            if (btn) {
                btn.click();
                await Utils.delay(1000);
                return true;
            }
            return false;
        },

        // 2. Sélectionner utilisateur
        async selectUser(userName) {
            const aircallName = USER_MAP_AIRCALL[userName] || userName;
            this.updateStatus(`Sélection: ${aircallName}`, 20);

            // Clic sur bouton "Utilisateurs"
            const trigger = document.querySelector('[data-test="filter-summary-user-trigger"]');
            if (!trigger) {
                Utils.log('❌ Bouton Utilisateurs non trouvé');
                return false;
            }

            Utils.log('Clic sur Utilisateurs');
            trigger.click();
            await Utils.delay(1000);

            // Chercher dans la liste des menu-items
            const items = document.querySelectorAll('[data-test^="menu-item-"]');
            Utils.log(`${items.length} items trouvés`);

            for (const item of items) {
                const text = item.textContent.trim();
                Utils.log(`  Item: "${text.substring(0, 30)}..."`);

                // Vérifier si le nom est dedans
                if (text.toLowerCase().includes(aircallName.toLowerCase())) {
                    Utils.log(`  ✓ TROUVÉ! Clic`);

                    // Cliquer sur la checkbox
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.click();
                        await Utils.delay(500);
                        return true;
                    }
                }
            }

            Utils.log('❌ Utilisateur non trouvé');
            return false;
        },

        // 3. Sélectionner date
        async selectDate(dateStr) {
            const aircallDate = Utils.formatDateForAircall(dateStr);
            this.updateStatus(`Sélection date: ${dateStr}`, 35);

            // Clic sur bouton "Date"
            const trigger = document.querySelector('[data-test="date-select-input"]');
            if (!trigger) {
                Utils.log('❌ Bouton Date non trouvé');
                return false;
            }

            Utils.log('Clic sur Date');
            trigger.click();
            await Utils.delay(1000);

            // Clic 2x sur la date
            for (let i = 0; i < 2; i++) {
                const btns = document.querySelectorAll('button[title]');
                for (const btn of btns) {
                    if (btn.title === aircallDate) {
                        Utils.log(`Clic ${i+1}/2 sur ${btn.title}`);
                        btn.click();
                        await Utils.delay(500);
                        break;
                    }
                }
            }
            return true;
        },

        // 4. Valider
        async clickSeeResults() {
            this.updateStatus('Validation filtres...', 50);
            const btn = document.querySelector('[data-test="see-results-button"]');
            if (btn) {
                btn.click();
                await Utils.delay(2000);
                return true;
            }
            return false;
        },

        // 5. Charger tout
        async loadAllResults() {
            this.updateStatus('Chargement résultats...', 55);
            let clicks = 0;
            while (clicks < CONFIG.MAX_LOAD_MORE_CLICKS) {
                await Utils.delay(1000);
                const btn = document.querySelector('[data-test="loading-button"]');
                if (!btn || btn.disabled) break;
                btn.click();
                clicks++;
                this.updateStatus(`Chargement... (${clicks})`, 55 + clicks);
                await Utils.delay(2000);
            }
        },

        // Résumé IA
        async getSummary(row) {
            try {
                const btn = row.querySelector('[data-test="table-preview-button"]');
                if (!btn) return null;
                btn.click();
                await Utils.delay(CONFIG.DELAY_PREVIEW);
                const el = document.querySelector('[data-test="call-context-summary-text"]');
                const summary = el ? el.textContent.trim() : null;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                await Utils.delay(300);
                return summary;
            } catch (e) { return null; }
        },

        // 6. Collecter
        async collectCalls() {
            this.updateStatus('Collecte appels...', 65);
            const calls = [];
            const rows = document.querySelectorAll('tbody tr');
            Utils.log(`${rows.length} appels`);

            let i = 0;
            for (const row of rows) {
                i++;
                this.updateStatus(`Collecte ${i}/${rows.length}...`, 65 + (i/rows.length)*25);

                try {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 6) continue;

                    const svg = cells[0].innerHTML || '';
                    const type = svg.includes('M12.293') ? 'sortant' : (svg.includes('M16.942') ? 'entrant' : 'inconnu');
                    const user = (cells[1].textContent || '').trim().split('\n')[0];
                    const contact = (cells[3].textContent || '').trim().split('\n')[0] || 'Inconnu';
                    const duration = (cells[4].textContent || '').trim() || '0s';
                    const time = (cells[5].textContent || '').trim().split('\n')[0] || '';

                    let mood = null;
                    for (const c of cells) {
                        const t = c.textContent || '';
                        if (t.includes('Neutre')) { mood = 'Neutre'; break; }
                        if (t.includes('Positif')) { mood = 'Positif'; break; }
                        if (t.includes('Négatif')) { mood = 'Négatif'; break; }
                    }

                    const summary = await this.getSummary(row);
                    calls.push({ type, user, contact, duration, time, mood, summary });
                    Utils.log(`  ✓ ${type} | ${contact}`);
                } catch (e) {}
            }
            return calls;
        },

        async start(request) {
            this.createStatusIndicator();
            document.getElementById('ltoa-user').textContent = `👤 ${request.user}`;
            document.getElementById('ltoa-date').textContent = `📅 ${request.date}`;

            Utils.log('=== AIRCALL v2.2.0 ===');
            Utils.log('User:', request.user);
            Utils.log('Date:', request.date);

            try {
                // Connexion
                let wait = 0;
                while (!Utils.isLoggedIn() && wait < 60000) {
                    this.updateStatus('Connexion...', 0);
                    await Utils.delay(2000);
                    wait += 2000;
                }
                if (!Utils.isLoggedIn()) throw new Error('Non connecté');

                await this.waitForPageLoad();
                await Utils.delay(1000);

                // Filtres
                await this.openFilters();
                await Utils.delay(1000);

                await this.selectUser(request.user);
                await Utils.delay(1000);

                await this.selectDate(request.date);
                await Utils.delay(1000);

                await this.clickSeeResults();
                await Utils.delay(1500);

                await this.loadAllResults();
                await Utils.delay(1000);

                const calls = await this.collectCalls();

                this.updateStatus('Envoi...', 95);
                Utils.sendToParent({
                    type: 'LTOA_AIRCALL_RESPONSE',
                    success: true,
                    calls: calls,
                    user: request.user,
                    date: request.date
                });

                this.updateStatus(`✅ ${calls.length} appels !`, 100);

                await Utils.delay(2000);
                if (request.autoclose) window.close();

            } catch (e) {
                Utils.log('ERREUR:', e);
                this.updateStatus(`❌ ${e.message}`, 0);
                Utils.sendToParent({ type: 'LTOA_AIRCALL_RESPONSE', success: false, error: e.message });
            }
        },

        init() {
            Utils.log('=== AIRCALL v2.2.0 ===');
            const params = Utils.getLtoaParams();
            if (params) setTimeout(() => this.start(params), 2000);
        }
    };

    AircallCollector.init();
})();
