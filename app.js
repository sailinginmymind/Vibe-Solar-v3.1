/**
 * APP.JS - Vibe Solar v3.0
 * Organizzazione: Stato → Inizializzazione → Event Listeners → API → Logica Solare → UI
 */

/* =========================================================
   1. STATO GLOBALE
   ========================================================= */

/** Timer per evitare rimbalzi nella selezione del grafico */
let chartSelectionTimer;

/** Data attualmente selezionata per le previsioni */
let dataSelezionata = new Date();

/** Flag che impedisce updateCityName durante la sincronizzazione GPS */
let isGpsSyncing = false;

/** Stato principale dell'applicazione (persistito su localStorage dove indicato) */
let state = {
    isWh:        false,
    currentSOC:  50,
    currentPsSOC: 50,
    camperName:  localStorage.getItem('vibe_camper_name') || "",
    battAh:      parseFloat(localStorage.getItem('vibe_batt_ah'))      || 0,
    psAh:        parseFloat(localStorage.getItem('vibe_ps_ah'))        || 0,
    panelWp:     parseFloat(localStorage.getItem('vibe_panel_wp'))     || 0,
    panelPsWp:   parseFloat(localStorage.getItem('vibe_panel_ps_wp'))  || 0,
    weatherData: null,
    panelTilt:   parseFloat(localStorage.getItem('vibe_panel_tilt'))   || 0,
};


/* =========================================================
   2. INIZIALIZZAZIONE
   ========================================================= */

/**
 * Punto di ingresso principale: eseguito al caricamento della pagina.
 * Registra i listener, carica i dati salvati e avvia la prima sincronizzazione.
 */
window.onload = () => {
    initEventListeners();
    initSliders();
    loadSavedData();

    // Ripristina il tema colore salvato
    const savedColor = localStorage.getItem('vibe_solar_bg_color');
    if (savedColor) changeBg(savedColor);

    // Aggiorna i valori di conversione Ah ↔ Wh nel garage
    if (typeof updateConversions === 'function') updateConversions();

    setupStars();
    generaBottoniGiorni();

    // Apre la vista live come schermata iniziale
    switchView('live', document.querySelector('[data-view="live"]'));

    // Se non ci sono coordinate salvate, richiede il GPS automaticamente
    const latVal = document.getElementById('input-lat').value;
    if (!latVal) {
        handleGpsSync();
    } else {
        updateAll();
    }
};

/**
 * Registra tutti gli event listener dell'interfaccia.
 */
function initEventListeners() {
    // Navigazione tra le viste
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view, item));
    });

    // Bottone GPS
    const gpsBtn = document.getElementById('btn-gps');
    if (gpsBtn) gpsBtn.addEventListener('click', handleGpsSync);

    // Input ora manuale: ricalcola immediatamente
    const timeInput = document.getElementById('input-time');
    if (timeInput) {
        timeInput.addEventListener('input', () => updateAll(true));
    }

    // Input data manuale: aggiorna dataSelezionata e tutta l'interfaccia
    const dateInput = document.getElementById('input-date');
    if (dateInput) {
        dateInput.addEventListener('input', (e) => {
            if (!e.target.value) return;
            dataSelezionata = new Date(e.target.value);
            aggiornaTuttaInterfaccia(true);
        });
    }

    // Campo città: ricerca per nome quando l'utente lascia il campo
    const cityInput = document.getElementById('city-input');
    if (cityInput) {
        cityInput.addEventListener('change', function () {
            const query = this.value.trim();
            if (query.length >= 3) searchCityCoords(query);
        });
    }

    // Coordinate manuali: ricalcola alla modifica
    ['input-lat', 'input-lng'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => updateAll(false));
    });

    // Pulsante salva nome camper
    const saveNameBtn = document.getElementById('btn-save-name');
    if (saveNameBtn) saveNameBtn.onclick = saveGarageSettings;
}

/**
 * Configura gli slider SOC (batteria + power station) e lo slider del tilt.
 * Contiene anche la logica del pulsante AUTO-TILT.
 */
function initSliders() {
    // --- Slider SOC Batteria e Power Station ---
    [
        { id: 'soc-slider',    valId: 'soc-val',    stateKey: 'currentSOC'   },
        { id: 'ps-soc-slider', valId: 'ps-soc-val', stateKey: 'currentPsSOC' },
    ].forEach(s => {
        const el = document.getElementById(s.id);
        if (!el) return;
        // Imposta il riempimento grafico CSS iniziale
        el.style.setProperty('--value', el.value + '%');
        el.addEventListener('input', (e) => {
            state[s.stateKey] = e.target.value;
            document.getElementById(s.valId).innerText = e.target.value + '%';
            el.style.setProperty('--value', e.target.value + '%');
            updateAll();
        });
    });

    // --- Slider Tilt Manuale ---
    const tiltSlider  = document.getElementById('tilt-slider');
    const tiltDisplay = document.getElementById('tilt-val');

    if (!tiltSlider) return;

    // Ripristina il valore salvato
    tiltSlider.value = state.panelTilt || 0;
    if (tiltDisplay) tiltDisplay.innerText = state.panelTilt || 0;

    tiltSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        if (tiltDisplay) tiltDisplay.innerText = val;
        state.panelTilt = parseInt(val);
        localStorage.setItem('vibe_panel_tilt', val);
        updateAll();
    });

    // --- Pulsante AUTO-TILT ---
    // Calcola il tilt ottimale per l'altezza solare corrente e lo applica
    const btnAuto    = document.getElementById('btn-auto-tilt');
    const hintBox    = document.getElementById('tilt-hint');
    const optimumVal = document.getElementById('optimum-tilt-val');

    if (!btnAuto) return;

    btnAuto.addEventListener('click', () => {
        const timeInput = document.getElementById('input-time');
        if (!timeInput || !timeInput.value) return;

        const [h, m] = timeInput.value.split(':').map(Number);
        const hDec = h + (m / 60);

        const sunriseTxt = document.getElementById('sunrise-txt').innerText;
        const sunsetTxt  = document.getElementById('sunset-txt').innerText;
        if (sunriseTxt === '--:--' || sunsetTxt === '--:--') return;

        const sunrise = SolarEngine.timeToDecimal(sunriseTxt);
        const sunset  = SolarEngine.timeToDecimal(sunsetTxt);

        // Calcolo altezza solare identico a quello usato in updateAll()
        const progress = (hDec - sunrise) / (sunset - sunrise);
        const sunAlt = (hDec >= sunrise && hDec <= sunset)
            ? Math.sin(progress * Math.PI) * 65
            : 0;
       if (sunAlt <= 0) {
            btnAuto.innerText = 'NOTTE 🌙'; 
            setTimeout(() => { btnAuto.innerText = 'AUTO ✨'; }, 1500);
            return;
        }

        // Arrotonda al multiplo di 5° più vicino (coerente con lo slider step=5)
        let idealTilt = Math.max(0, Math.min(90, 90 - sunAlt));
        idealTilt = Math.round(idealTilt / 5) * 5;

        // Aggiorna slider, stato e localStorage
        tiltSlider.value = idealTilt;
        if (tiltDisplay) tiltDisplay.innerText = idealTilt;
        state.panelTilt = idealTilt;
        localStorage.setItem('vibe_panel_tilt', idealTilt);

        // Mostra il suggerimento
        if (hintBox)    hintBox.style.display = 'block';
        if (optimumVal) optimumVal.innerText = idealTilt;

        btnAuto.innerText = 'COPIATO! ✅';
        setTimeout(() => { btnAuto.innerText = 'AUTO ✨'; }, 1500);

        updateAll();
    });
}


/* =========================================================
   3. LOGICA GPS E COORDINATE
   ========================================================= */

/**
 * Sincronizza posizione GPS, ora e data correnti, poi aggiorna tutta la UI.
 * Gestisce il feedback visivo del pulsante durante l'operazione.
 */
async function handleGpsSync() {
    isGpsSyncing = true;
    const btn       = document.getElementById('btn-gps');
    const timeInput = document.getElementById('input-time');
    const dateInput = document.getElementById('input-date');
    const latInput  = document.getElementById('input-lat');
    const lngInput  = document.getElementById('input-lng');

    if (!btn) return;
    btn.disabled  = true;
    btn.innerText = '🛰️ RICERCA POSIZIONE...';

    try {
        const coords = await WeatherAPI.getUserLocation();
        const now    = new Date();

        if (latInput) latInput.value = coords.latitude.toFixed(4);
        if (lngInput) lngInput.value = coords.longitude.toFixed(4);

        // Imposta l'ora locale corrente
        const oraStringa = now.getHours().toString().padStart(2, '0') + ':' +
                           now.getMinutes().toString().padStart(2, '0');
        if (timeInput) timeInput.value = oraStringa;

        // Imposta la data corrente
        dataSelezionata = new Date();
        if (dateInput) dateInput.value = dataSelezionata.toISOString().split('T')[0];

        // Aggiorna il nome città tramite reverse geocoding
        await updateCityName(coords.latitude, coords.longitude);

        generaBottoniGiorni();
        updateAll(false);

        btn.innerText      = '✅ SINCRONIZZAZIONE RIUSCITA';
        btn.style.background = '#22c55e';
    } catch (err) {
        btn.innerText = '❌ ERRORE GPS';
    } finally {
        btn.disabled = false;
        isGpsSyncing = false;
        setTimeout(() => {
            btn.innerText      = '📡 AGGIORNA GPS E ORA ATTUALE';
            btn.style.background = '';
        }, 2000);
    }
}

/**
 * Recupera il nome della città dalle coordinate tramite Nominatim (reverse geocoding).
 * Aggiorna il campo city-input con il nome trovato.
 * @param {number|string} lat - Latitudine
 * @param {number|string} lng - Longitudine
 */
/**
 * Recupera il nome della città e aggiorna sia lo span visibile che l'input.
 */
async function updateCityName(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=it`;
        const response = await fetch(url);
        const data = await response.json();
        
        // Trova il nome della città o del villaggio
        const city = data.address.city || data.address.town || data.address.village || 'POSIZIONE';
        const cityUpper = city.toUpperCase();

        // 1. Aggiorna lo span che l'utente vede (quello col pin 📍)
        const displayEl = document.getElementById('city-name-display');
        if (displayEl) displayEl.innerText = `📍 ${cityUpper}`;

        // 2. Aggiorna anche l'input (nel caso volessi riutilizzarlo per le ricerche)
        const inputEl = document.getElementById('city-input');
        if (inputEl) inputEl.value = cityUpper;

    } catch (e) {
        console.error("Errore geocoding:", e);
    }
}

/**
 * Cerca le coordinate geografiche di una città tramite Nominatim.
 * Aggiorna lat/lng e ricalcola tutto.
 * @param {string} cityName - Nome della città da cercare
 */
async function searchCityCoords(cityName) {
    try {
        const url      = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&limit=1`;
        const response = await fetch(url);
        const data     = await response.json();
        if (data?.[0]) {
            document.getElementById('input-lat').value = parseFloat(data[0].lat).toFixed(4);
            document.getElementById('input-lng').value = parseFloat(data[0].lon).toFixed(4);
            updateAll();
        }
    } catch (e) {
        // Fallimento silenzioso
    }
}


/* =========================================================
   4. AGGIORNAMENTO PRINCIPALE (API + CALCOLI)
   ========================================================= */

/**
 * Funzione centrale: recupera i dati meteo e aggiorna tutta l'interfaccia.
 * @param {boolean} isManualTime - true se l'utente ha modificato l'ora manualmente
 */
async function updateAll(isManualTime = false) {
    const lat       = document.getElementById('input-lat').value;
    const lng       = document.getElementById('input-lng').value;
    const timeInput = document.getElementById('input-time');

    if (!lat || !lng) return;

    // Aggiorna il nome città solo se non stiamo già eseguendo un GPS sync
    if (!isGpsSyncing) {
        updateCityName(lat, lng);
    }

    // Se l'ora non è impostata, usa quella locale corrente
    if (timeInput && !timeInput.value) {
        const now = new Date();
        timeInput.value = now.getHours().toString().padStart(2, '0') + ':' +
                          now.getMinutes().toString().padStart(2, '0');
    }

    try {
        const dateStr = dataSelezionata.toISOString().split('T')[0];

        // Recupera i dati meteo dall'API (aggiorna gli input solo se non è ora manuale)
        state.weatherData = await WeatherAPI.fetchForecast(lat, lng, dateStr, !isManualTime);

        if (!state.weatherData || !state.weatherData.hourly) {
            console.error('Dati meteo mancanti o malformati');
            return;
        }

        // Parsing dell'ora corrente in valori decimali
        const [ore, minuti] = timeInput.value.split(':').map(Number);
        const hourIdx = Math.min(ore, 23);
        const hDec    = ore + (minuti / 60);

        const hourly = state.weatherData.hourly;
        const daily  = state.weatherData.daily;

        // Copertura nuvolosa all'ora corrente
        const cloudCover = (hourly.cloud_cover && hourly.cloud_cover[hourIdx] !== undefined)
            ? hourly.cloud_cover[hourIdx]
            : 0;

        // --- Aggiornamento Badge Meteo ---
        document.getElementById('r-wind').innerText        = Math.round(hourly.wind_speed_10m[hourIdx]) + ' km/h';
        document.getElementById('r-hum').innerText         = hourly.relative_humidity_2m[hourIdx] + '%';
        document.getElementById('r-temp').innerText        = Math.round(hourly.temperature_2m[hourIdx]) + '°C';
        document.getElementById('r-cloud-percent').innerText = cloudCover + '%';

        // --- Alba e Tramonto ---
        const sunrise = daily.sunrise[0].split('T')[1].substring(0, 5);
        const sunset  = daily.sunset[0].split('T')[1].substring(0, 5);
        document.getElementById('sunrise-txt').innerText        = sunrise;
        document.getElementById('sunset-txt').innerText         = sunset;
        document.getElementById('display-hour-center').innerText = timeInput.value;

        const sunH = SolarEngine.timeToDecimal(sunrise);
        const setH = SolarEngine.timeToDecimal(sunset);

     // --- Calcolo Altezza Solare ---
        const progress    = (hDec - sunH) / (setH - sunH);
        const sunAltitude = (hDec >= sunH && hDec <= setH)
            ? Math.sin(progress * Math.PI) * 65
            : 0;

        // --- Gestione Messaggio Auto-Tilt (Sole dormiente) ---
        const hintBox = document.getElementById('tilt-hint');
        if (hintBox) {
            if (sunAltitude <= 0) {
                // Messaggio quando il sole non c'è
                hintBox.style.display = 'block';
                hintBox.innerHTML = `🌙 <span style="font-style: italic; color: #94a3b8;">Il sole sta dormendo...</span>`;
            } else {
                // Ripristina il layout normale se il sole è sveglio
                let ideal = Math.max(0, Math.min(90, 90 - sunAltitude));
                ideal = Math.round(ideal / 5) * 5;
                hintBox.innerHTML = `Consigliato: <strong id="optimum-tilt-val">${ideal}</strong>°`;
            }
        }

        // --- Calcolo Potenza Istantanea ---
        const pServ = SolarEngine.calculatePower(hDec, sunH, setH, state.panelWp,   cloudCover, state.panelTilt, sunAltitude);
        const pPS   = SolarEngine.calculatePower(hDec, sunH, setH, state.panelPsWp, cloudCover, state.panelTilt, sunAltitude);

        // --- Aggiornamento Display Potenza ---
        document.getElementById('w_out').innerText = Math.round(pServ + pPS) + ' W';
        const elServ = document.getElementById('w_services');
        const elPS   = document.getElementById('w_ps');
        if (elServ) elServ.innerText = Math.round(pServ) + ' W';
        if (elPS)   elPS.innerText   = Math.round(pPS)   + ' W';

        // --- Aggiornamento UI Solare e Report ---
        updateSunUI(hDec, sunH, setH);
        updateReportUI(pServ + pPS, sunH, setH);

    } catch (e) {
        console.error("Errore durante l'aggiornamento:", e);
    }
}


/* =========================================================
   5. SEZIONE REPORT (GRAFICO + TEMPI DI CARICA)
   ========================================================= */

/**
 * Aggiorna la vista Report: grafico orario a barre e stime di ricarica.
 * @param {number} totalPower - Potenza istantanea totale (W)
 * @param {number} sunH  - Ora decimale dell'alba
 * @param {number} setH  - Ora decimale del tramonto
 */
function updateReportUI(totalPower, sunH, setH) {
    const chart        = document.getElementById('hourly-chart');
    const totalDisplay = document.getElementById('total-wh-day');
    if (!chart || !state.weatherData) return;

    // Potenze correnti dai display
    const wServ = parseFloat(document.getElementById('w_services')?.innerText) || 0;
    const wPS   = parseFloat(document.getElementById('w_ps')?.innerText)       || 0;

    // La Power Station è configurata in Wh ma estimateChargeTime usa Ah → conversione
    const psAhEquiv = state.psAh / 12.8;

    /** Helper per aggiornare in sicurezza un elemento testuale */
    const safeSet = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    // --- Stime Tempi di Ricarica ---
    safeSet('batt_charge_80_txt',  SolarEngine.estimateChargeTime(state.currentSOC,   80,  wServ, state.battAh));
    safeSet('batt_charge_90_txt',  SolarEngine.estimateChargeTime(state.currentSOC,   90,  wServ, state.battAh));
    safeSet('batt_charge_100_txt', SolarEngine.estimateChargeTime(state.currentSOC,   100, wServ, state.battAh));
    safeSet('ps_charge_80_txt',    SolarEngine.estimateChargeTime(state.currentPsSOC, 80,  wPS,   psAhEquiv));
    safeSet('ps_charge_90_txt',    SolarEngine.estimateChargeTime(state.currentPsSOC, 90,  wPS,   psAhEquiv));
    safeSet('ps_charge_100_txt',   SolarEngine.estimateChargeTime(state.currentPsSOC, 100, wPS,   psAhEquiv));

    // --- Grafico a Barre Orario ---
    chart.innerHTML = '';
    let dailyTotal = 0;
    const startH = Math.floor(sunH);
    const endH   = Math.ceil(setH);
    const maxPotenza = (state.panelWp + state.panelPsWp) || 1;

    // Ora attuale per evidenziare la barra corrente
    const timeInput  = document.getElementById('input-time');
    const currentH   = (timeInput && timeInput.value) ? parseInt(timeInput.value.split(':')[0]) : -1;

    for (let h = startH; h <= endH; h++) {
        const hProgress  = (h - sunH) / (setH - sunH);
        const hAltitude  = Math.max(0, Math.sin(hProgress * Math.PI) * 65);
        const cloud      = state.weatherData.hourly.cloud_cover[h] || 0;
        const hP         = SolarEngine.calculatePower(h, sunH, setH, state.panelWp + state.panelPsWp, cloud, state.panelTilt, hAltitude);
        dailyTotal += hP;

        const bar = document.createElement('div');
        bar.className    = 'bar';
        bar.style.height = Math.max(5, (hP / maxPotenza * 100)) + '%';

        // La barra dell'ora corrente viene evidenziata in giallo
        if (h === currentH) bar.style.background = 'var(--accento, #fbbf24)';

        // Click sulla barra: mostra il dettaglio orario
        bar.onclick = () => {
            const detail = document.getElementById('detail-display');
            if (detail) detail.innerHTML = `<span style="color:#fbbf24;">ORE ${h}:00 → ${Math.round(hP)} W</span>`;
        };

        chart.appendChild(bar);
    }

    if (totalDisplay) totalDisplay.innerText = Math.round(dailyTotal) + ' Wh';
}


/* =========================================================
   6. GARAGE (IMPOSTAZIONI CAMPER)
   ========================================================= */

/**
 * Salva tutte le impostazioni del garage su localStorage e aggiorna il display del nome.
 */
function saveGarageSettings() {
    const name = document.getElementById('camper_name_input').value.trim();
    localStorage.setItem('vibe_camper_name', name);
    localStorage.setItem('vibe_batt_ah',     state.battAh);
    localStorage.setItem('vibe_panel_wp',    state.panelWp);
    localStorage.setItem('vibe_ps_ah',       state.psAh);
    localStorage.setItem('vibe_panel_ps_wp', state.panelPsWp);

    const display = document.getElementById('camper-name-display');
    if (display && name) display.innerText = name.toUpperCase();

    // Feedback visivo sul pulsante salva
    const btn = document.getElementById('btn-save-name');
    if (btn) {
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.style.background = ''; }, 1500);
    }
}

/**
 * Carica i dati salvati e popola i display del garage all'avvio.
 */
function loadSavedData() {
    const savedName = localStorage.getItem('vibe_camper_name');
    if (savedName) {
        state.camperName = savedName;
        document.getElementById('camper-name-display').innerText = savedName.toUpperCase();
        document.getElementById('camper_name_input').value       = savedName;
    }
    document.getElementById('batt_val').innerText     = state.battAh;
    document.getElementById('panel_val').innerText    = state.panelWp;
    document.getElementById('ps_val').innerText       = state.psAh;
    document.getElementById('panel_ps_val').innerText = state.panelPsWp;
}

/**
 * Apre un prompt per modificare un parametro hardware del camper.
 * Dopo la modifica salva, ricarica i dati e ricalcola.
 * @param {string} type - 'batt' | 'ps' | 'pan' | 'panPs'
 */
function editSpec(type) {
    const specs = {
        batt:  { stateKey: 'battAh',   label: 'Capacità Batteria (Ah)' },
        ps:    { stateKey: 'psAh',     label: 'Capacità Power Station (Wh)' },
        pan:   { stateKey: 'panelWp',  label: 'Potenza Pannelli Camper (W)' },
        panPs: { stateKey: 'panelPsWp',label: 'Potenza Pannelli PS (W)' },
    };
    const spec = specs[type];
    if (!spec) return;

    const v = prompt(`Modifica ${spec.label}:`, state[spec.stateKey]);
    if (v !== null && v !== '' && !isNaN(v)) {
        state[spec.stateKey] = parseFloat(v);
        saveGarageSettings();
        loadSavedData();
        updateConversions();
        updateAll();
    }
}

/**
 * Aggiorna le etichette di conversione Ah↔Wh nel garage.
 */
function updateConversions() {
    const bAh     = parseFloat(document.getElementById('batt_val').innerText) || 0;
    const bConvEl = document.getElementById('batt_conv_val');
    if (bConvEl) bConvEl.innerText = Math.round(bAh * 12.8);

    const pWh     = parseFloat(document.getElementById('ps_val').innerText) || 0;
    const pConvEl = document.getElementById('ps_conv_val');
    if (pConvEl) pConvEl.innerText = Math.round(pWh / 12.8);
}


/* =========================================================
   7. GESTIONE DATE E SELECTOR GIORNI
   ========================================================= */

/**
 * Genera i 7 pulsanti giorno nella vista Report.
 * Il giorno attivo corrisponde a dataSelezionata.
 */
function generaBottoniGiorni() {
    const container = document.getElementById('days-selector');
    if (!container) return;
    container.innerHTML = '';
    const oggi = new Date();

    for (let i = 0; i < 7; i++) {
        const d = new Date(oggi);
        d.setDate(oggi.getDate() + i);

        const btn = document.createElement('div');
        btn.className = 'day-btn' + (d.toDateString() === dataSelezionata.toDateString() ? ' active' : '');
        btn.innerHTML = `<span>${d.toLocaleDateString('it-IT', { weekday: 'short' }).charAt(0).toUpperCase()}</span><b>${d.getDate()}</b>`;
        btn.onclick   = () => { dataSelezionata = new Date(d); aggiornaTuttaInterfaccia(); };
        container.appendChild(btn);
    }
}

/**
 * Aggiorna il campo data, rigenera i bottoni giorni e ricalcola tutto.
 * @param {boolean} isManual - true se l'aggiornamento è manuale
 */
function aggiornaTuttaInterfaccia(isManual = true) {
    const inputDate = document.getElementById('input-date');
    if (inputDate) inputDate.value = dataSelezionata.toISOString().split('T')[0];
    generaBottoniGiorni();
    updateAll(isManual);
}


/* =========================================================
   8. AGGIORNAMENTO UI
   ========================================================= */

/**
 * Aggiorna la posizione e l'aspetto visivo del sole nel cielo animato.
 * @param {number} hDec - Ora corrente in formato decimale
 * @param {number} sunH - Ora alba decimale
 * @param {number} setH - Ora tramonto decimale
 */
function updateSunUI(hDec, sunH, setH) {
    const sun = document.getElementById('sun-body');
    const sky = document.getElementById('sky-box');
    if (!sun || !sky) return;

    if (hDec < sunH || hDec > setH) {
        // Notte: nascondi il sole e imposta sfondo scuro
        sun.style.display  = 'none';
        sky.style.background = 'linear-gradient(to bottom, #0f172a, #1e293b)';
    } else {
        // Giorno: posiziona il sole lungo la parabola
        sun.style.display  = 'block';
        const progress     = (hDec - sunH) / (setH - sunH);
        sun.style.left     = `${15 + (progress * 70)}%`;
        sun.style.bottom   = `${(Math.sin(progress * Math.PI) * 35) + 10}%`;

        // Alba/Tramonto → toni arancio; Mezzogiorno → toni azzurri
        sky.style.background = (progress < 0.2 || progress > 0.8)
            ? 'linear-gradient(to bottom, #f59e0b, #7c2d12)'
            : 'linear-gradient(to bottom, #38bdf8, #1d4ed8)';
    }
}

/**
 * Cambia il tema colore dell'app aggiungendo la classe CSS appropriata al body.
 * Salva la preferenza su localStorage.
 * @param {string} color - Codice esadecimale del colore scelto
 */
function changeBg(color) {
    document.body.classList.remove('tema-verde', 'tema-rosso', 'tema-grigio');
    if (color === '#062c1f') document.body.classList.add('tema-verde');
    else if (color === '#2d0a1a') document.body.classList.add('tema-rosso');
    else if (color === '#1a1a1a') document.body.classList.add('tema-grigio');
    document.body.style.backgroundColor = color;
    localStorage.setItem('vibe_solar_bg_color', color);
}

/**
 * Mostra una vista nascondendo le altre e aggiorna l'elemento nav attivo.
 * @param {string} vId - ID della vista (es. 'live', 'energy', 'garage')
 * @param {Element} el  - Elemento nav cliccato
 */
function switchView(vId, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const target = document.getElementById('view-' + vId);
    if (target) target.classList.add('active');
    if (el)     el.classList.add('active');
}

/**
 * Genera 50 stelle casuali nel contenitore del cielo notturno.
 */
function setupStars() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 50; i++) {
        const star       = document.createElement('div');
        star.className   = 'star';
        star.style.left  = Math.random() * 100 + '%';
        star.style.top   = Math.random() * 60  + '%';
        const size       = Math.random() * 2 + 'px';
        star.style.width = star.style.height = size;
        container.appendChild(star);
    }
}
