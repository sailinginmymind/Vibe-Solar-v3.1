/**
 * APP.JS - Vibe Solar v3.1
 * Organizzazione: Stato → Inizializzazione → Event Listeners → API → Logica Solare → UI
 */

/* =========================================================
   1. STATO GLOBALE
   ========================================================= */

let chartSelectionTimer;
let dataSelezionata = new Date();
let isGpsSyncing = false;

let state = {
    isWh:        false,
    currentSOC:  50,
    currentPsSOC: 50,
    camperName:  localStorage.getItem('vibe_camper_name') || "",
    battAh:      parseFloat(localStorage.getItem('vibe_batt_ah'))      || 0,
    psAh:        parseFloat(localStorage.getItem('vibe_ps_ah'))        || 0,
    panelWp:     parseFloat(localStorage.getItem('vibe_panel_wp'))     || 0,
    panelPsWp:   parseFloat(localStorage.getItem('vibe_panel_ps_wp'))  || 0,
    weatherData: null,
    panelTilt:   parseFloat(localStorage.getItem('vibe_panel_tilt'))   || 0,
};

/* =========================================================
   2. INIZIALIZZAZIONE
   ========================================================= */

window.onload = () => {
    initEventListeners();
    initSliders();
    loadSavedData();

    const savedColor = localStorage.getItem('vibe_solar_bg_color');
    if (savedColor) changeBg(savedColor);

    if (typeof updateConversions === 'function') updateConversions();

    setupStars();
    generaBottoniGiorni();

    switchView('live', document.querySelector('[data-view="live"]'));

    const latVal = document.getElementById('input-lat').value;
    if (!latVal) {
        handleGpsSync();
    } else {
        updateAll();
    }
};

function initEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view, item));
    });

    const gpsBtn = document.getElementById('btn-gps');
    if (gpsBtn) gpsBtn.addEventListener('click', handleGpsSync);

    const timeInput = document.getElementById('input-time');
    if (timeInput) {
        timeInput.addEventListener('input', () => updateAll(true));
    }

    const dateInput = document.getElementById('input-date');
    if (dateInput) {
        dateInput.addEventListener('input', (e) => {
            if (!e.target.value) return;
            dataSelezionata = new Date(e.target.value);
            aggiornaTuttaInterfaccia(true);
        });
    }

    const cityInput = document.getElementById('city-input');
    if (cityInput) {
        cityInput.addEventListener('change', function () {
            const query = this.value.trim();
            if (query.length >= 3) searchCityCoords(query);
        });
    }

    ['input-lat', 'input-lng'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => updateAll(false));
    });

    const saveNameBtn = document.getElementById('btn-save-name');
    if (saveNameBtn) saveNameBtn.onclick = saveGarageSettings;
}

function initSliders() {
    // Slider SOC
    [
        { id: 'soc-slider',    valId: 'soc-val',    stateKey: 'currentSOC'   },
        { id: 'ps-soc-slider', valId: 'ps-soc-val', stateKey: 'currentPsSOC' },
    ].forEach(s => {
        const el = document.getElementById(s.id);
        if (!el) return;
        el.style.setProperty('--value', el.value + '%');
        el.addEventListener('input', (e) => {
            state[s.stateKey] = e.target.value;
            document.getElementById(s.valId).innerText = e.target.value + '%';
            el.style.setProperty('--value', e.target.value + '%');
            updateAll();
        });
    });

    // Slider Tilt Manuale
    const tiltSlider  = document.getElementById('tilt-slider');
    const tiltDisplay = document.getElementById('tilt-val');

    if (tiltSlider) {
        tiltSlider.value = state.panelTilt || 0;
        if (tiltDisplay) tiltDisplay.innerText = state.panelTilt || 0;

        tiltSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            if (tiltDisplay) tiltDisplay.innerText = val;
            state.panelTilt = parseInt(val);
            localStorage.setItem('vibe_panel_tilt', val);
            updateAll();
        });
    }

    // Pulsante AUTO-TILT con LOGICA NOTTE
    const btnAuto    = document.getElementById('btn-auto-tilt');
    const hintBox    = document.getElementById('tilt-hint');
    const optimumVal = document.getElementById('optimum-tilt-val');

    if (btnAuto) {
        btnAuto.addEventListener('click', () => {
            const timeInput = document.getElementById('input-time');
            if (!timeInput || !timeInput.value) return;

            const [h, m] = timeInput.value.split(':').map(Number);
            const hDec = h + (m / 60);

            const sunriseTxt = document.getElementById('sunrise-txt').innerText;
            const sunsetTxt  = document.getElementById('sunset-txt').innerText;
            if (sunriseTxt === '--:--' || sunsetTxt === '--:--') return;

            const sunrise = SolarEngine.timeToDecimal(sunriseTxt);
            const sunset  = SolarEngine.timeToDecimal(sunsetTxt);

            // CONTROLLO NOTTE
            if (hDec < sunrise || hDec > sunset) {
                btnAuto.innerText = 'IL SOLE STA DORMENDO... 🌙';
                setTimeout(() => { btnAuto.innerText = 'AUTO ✨'; }, 2000);
                return; 
            }

            const progress = (hDec - sunrise) / (sunset - sunrise);
            const sunAlt = Math.sin(progress * Math.PI) * 65;

            let idealTilt = Math.max(0, Math.min(90, 90 - sunAlt));
            idealTilt = Math.round(idealTilt / 5) * 5;

            tiltSlider.value = idealTilt;
            if (tiltDisplay) tiltDisplay.innerText = idealTilt;
            state.panelTilt = idealTilt;
            localStorage.setItem('vibe_panel_tilt', idealTilt);

            if (hintBox)    hintBox.style.display = 'block';
            if (optimumVal) optimumVal.innerText = idealTilt;

            btnAuto.innerText = 'COPIATO! ✅';
            setTimeout(() => { btnAuto.innerText = 'AUTO ✨'; }, 1500);
            updateAll();
        });
    }
}

/* =========================================================
   3. LOGICA GPS E COORDINATE
   ========================================================= */

async function handleGpsSync() {
    isGpsSyncing = true;
    const btn       = document.getElementById('btn-gps');
    const timeInput = document.getElementById('input-time');
    const dateInput = document.getElementById('input-date');
    const latInput  = document.getElementById('input-lat');
    const lngInput  = document.getElementById('input-lng');

    if (!btn) return;
    btn.disabled  = true;
    btn.innerText = '🛰️ RICERCA POSIZIONE...';

    try {
        const coords = await WeatherAPI.getUserLocation();
        const now    = new Date();

        if (latInput) latInput.value = coords.latitude.toFixed(4);
        if (lngInput) lngInput.value = coords.longitude.toFixed(4);

        const oraStringa = now.getHours().toString().padStart(2, '0') + ':' +
                           now.getMinutes().toString().padStart(2, '0');
        if (timeInput) timeInput.value = oraStringa;

        dataSelezionata = new Date();
        if (dateInput) dateInput.value = dataSelezionata.toISOString().split('T')[0];

        await updateCityName(coords.latitude, coords.longitude);

        generaBottoniGiorni();
        updateAll(false);

        btn.innerText      = '✅ SINCRONIZZAZIONE RIUSCITA';
        btn.style.background = '#22c55e';
    } catch (err) {
        btn.innerText = '❌ ERRORE GPS';
    } finally {
        btn.disabled = false;
        isGpsSyncing = false;
        setTimeout(() => {
            btn.innerText      = '📡 AGGIORNA GPS E ORA ATTUALE';
            btn.style.background = '';
        }, 2000);
    }
}

async function updateCityName(lat, lng) {
    try {
        const url      = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=it`;
        const response = await fetch(url);
        const data     = await response.json();
        const city     = data.address.city || data.address.town || data.address.village || 'POSIZIONE';
        const el       = document.getElementById('city-input');
        if (el) el.value = city.toUpperCase();
    } catch (e) {}
}

async function searchCityCoords(cityName) {
    try {
        const url      = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&limit=1`;
        const response = await fetch(url);
        const data     = await response.json();
        if (data?.[0]) {
            document.getElementById('input-lat').value = parseFloat(data[0].lat).toFixed(4);
            document.getElementById('input-lng').value = parseFloat(data[0].lon).toFixed(4);
            updateAll();
        }
    } catch (e) {}
}

/* =========================================================
   4. AGGIORNAMENTO PRINCIPALE
   ========================================================= */

async function updateAll(isManualTime = false) {
    const lat        = document.getElementById('input-lat').value;
    const lng        = document.getElementById('input-lng').value;
    const timeInput = document.getElementById('input-time');

    if (!lat || !lng) return;
    if (!isGpsSyncing) updateCityName(lat, lng);

    if (timeInput && !timeInput.value) {
        const now = new Date();
        timeInput.value = now.getHours().toString().padStart(2, '0') + ':' +
                          now.getMinutes().toString().padStart(2, '0');
    }

    try {
        const dateStr = dataSelezionata.toISOString().split('T')[0];
        state.weatherData = await WeatherAPI.fetchForecast(lat, lng, dateStr, !isManualTime);

        if (!state.weatherData || !state.weatherData.hourly) return;

        const [ore, minuti] = timeInput.value.split(':').map(Number);
        const hourIdx = Math.min(ore, 23);
        const hDec    = ore + (minuti / 60);

        const hourly = state.weatherData.hourly;
        const daily  = state.weatherData.daily;

        const cloudCover = hourly.cloud_cover ? (hourly.cloud_cover[hourIdx] ?? 0) : 0;

        document.getElementById('r-wind').innerText          = Math.round(hourly.wind_speed_10m[hourIdx]) + ' km/h';
        document.getElementById('r-hum').innerText           = hourly.relative_humidity_2m[hourIdx] + '%';
        document.getElementById('r-temp').innerText          = Math.round(hourly.temperature_2m[hourIdx]) + '°C';
        document.getElementById('r-cloud-percent').innerText = cloudCover + '%';

        const sunrise = daily.sunrise[0].split('T')[1].substring(0, 5);
        const sunset  = daily.sunset[0].split('T')[1].substring(0, 5);
        document.getElementById('sunrise-txt').innerText         = sunrise;
        document.getElementById('sunset-txt').innerText          = sunset;
        document.getElementById('display-hour-center').innerText = timeInput.value;

        const sunH = SolarEngine.timeToDecimal(sunrise);
        const setH = SolarEngine.timeToDecimal(sunset);

        const progress    = (hDec - sunH) / (setH - sunH);
        const sunAltitude = (hDec >= sunH && hDec <= setH) ? Math.sin(progress * Math.PI) * 65 : 0;

        const pServ = SolarEngine.calculatePower(hDec, sunH, setH, state.panelWp,   cloudCover, state.panelTilt, sunAltitude);
        const pPS   = SolarEngine.calculatePower(hDec, sunH, setH, state.panelPsWp, cloudCover, state.panelTilt, sunAltitude);

        document.getElementById('w_out').innerText = Math.round(pServ + pPS) + ' W';
        const elServ = document.getElementById('w_services');
        const elPS   = document.getElementById('w_ps');
        if (elServ) elServ.innerText = Math.round(pServ) + ' W';
        if (elPS)   elPS.innerText   = Math.round(pPS)   + ' W';

        updateSunUI(hDec, sunH, setH);
        updateReportUI(pServ + pPS, sunH, setH);

    } catch (e) {
        console.error("Errore:", e);
    }
}

/* =========================================================
   5. SEZIONE REPORT
   ========================================================= */

function updateReportUI(totalPower, sunH, setH) {
    const chart = document.getElementById('hourly-chart');
    const totalDisplay = document.getElementById('total-wh-day');
    if (!chart || !state.weatherData) return;

    const wServ = parseFloat(document.getElementById('w_services')?.innerText) || 0;
    const wPS   = parseFloat(document.getElementById('w_ps')?.innerText)        || 0;
    const psAhEquiv = state.psAh / 12.8;

    const safeSet = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    safeSet('batt_charge_80_txt',  SolarEngine.estimateChargeTime(state.currentSOC,   80,  wServ, state.battAh));
    safeSet('batt_charge_90_txt',  SolarEngine.estimateChargeTime(state.currentSOC,   90,  wServ, state.battAh));
    safeSet('batt_charge_100_txt', SolarEngine.estimateChargeTime(state.currentSOC,   100, wServ, state.battAh));
    safeSet('ps_charge_80_txt',    SolarEngine.estimateChargeTime(state.currentPsSOC, 80,  wPS,   psAhEquiv));
    safeSet('ps_charge_90_txt',    SolarEngine.estimateChargeTime(state.currentPsSOC, 90,  wPS,   psAhEquiv));
    safeSet('ps_charge_100_txt',   SolarEngine.estimateChargeTime(state.currentPsSOC, 100, wPS,   psAhEquiv));

    chart.innerHTML = '';
    let dailyTotal = 0;
    const startH = Math.floor(sunH);
    const endH   = Math.ceil(setH);
    const maxPotenza = (state.panelWp + state.panelPsWp) || 1;

    const timeInput  = document.getElementById('input-time');
    const currentH   = (timeInput && timeInput.value) ? parseInt(timeInput.value.split(':')[0]) : -1;

 for (let h = startH; h <= endH; h++) {
        const hProgress  = (h - sunH) / (setH - sunH);
        const hAltitude  = Math.max(0, Math.sin(hProgress * Math.PI) * 65);
        const cloud      = state.weatherData.hourly.cloud_cover[h] || 0;
        const hP         = SolarEngine.calculatePower(h, sunH, setH, state.panelWp + state.panelPsWp, cloud, state.panelTilt, hAltitude);
        dailyTotal += hP;

        const bar = document.createElement('div');
        bar.className    = 'bar';
        bar.style.height = Math.max(5, (hP / maxPotenza * 100)) + '%';
        
        // --- EVIDENZIAZIONE SINTONIZZATA COL TEMA ---
        // Opacità sempre a 1 per tutte le barre come richiesto
        bar.style.opacity = '1';

        if (h === currentH) {
            // Barra ora attuale: colore del tema + bagliore
            bar.style.background = 'var(--accento)';
            bar.style.boxShadow  = '0 0 12px var(--accento)';
        } else {
            // Altre barre: mantengono il colore base definito nel CSS (es. rgba(255,255,255,0.3))
            // Non forziamo un colore fisso qui così rispettano lo stile originale
            bar.style.background = ''; 
            bar.style.boxShadow  = 'none';
        }

        bar.onclick = () => {
            const detail = document.getElementById('detail-display');
            if (detail) {
                detail.innerHTML = `<span style="color:var(--accento); font-weight:bold;">ORE ${h}:00 → ${Math.round(hP)} W</span>`;
            }
        };
        chart.appendChild(bar);
    }

    if (totalDisplay) totalDisplay.innerText = Math.round(dailyTotal) + ' Wh';
}
/* =========================================================
   6. GARAGE
   ========================================================= */

function saveGarageSettings() {
    const name = document.getElementById('camper_name_input').value.trim();
    localStorage.setItem('vibe_camper_name', name);
    localStorage.setItem('vibe_batt_ah',     state.battAh);
    localStorage.setItem('vibe_panel_wp',    state.panelWp);
    localStorage.setItem('vibe_ps_ah',       state.psAh);
    localStorage.setItem('vibe_panel_ps_wp', state.panelPsWp);

    const display = document.getElementById('camper-name-display');
    if (display && name) display.innerText = name.toUpperCase();

    const btn = document.getElementById('btn-save-name');
    if (btn) {
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.style.background = ''; }, 1500);
    }
}

function loadSavedData() {
    const savedName = localStorage.getItem('vibe_camper_name');
    if (savedName) {
        state.camperName = savedName;
        const display = document.getElementById('camper-name-display');
        if(display) display.innerText = savedName.toUpperCase();
        const input = document.getElementById('camper_name_input');
        if(input) input.value = savedName;
    }
    document.getElementById('batt_val').innerText     = state.battAh;
    document.getElementById('panel_val').innerText    = state.panelWp;
    document.getElementById('ps_val').innerText       = state.psAh;
    document.getElementById('panel_ps_val').innerText = state.panelPsWp;
}

function editSpec(type) {
    const specs = {
        batt:  { stateKey: 'battAh',   label: 'Capacità Batteria (Ah)' },
        ps:    { stateKey: 'psAh',     label: 'Capacità Power Station (Wh)' },
        pan:   { stateKey: 'panelWp',  label: 'Potenza Pannelli Camper (W)' },
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

function updateConversions() {
    const bAh     = parseFloat(document.getElementById('batt_val').innerText) || 0;
    const bConvEl = document.getElementById('batt_conv_val');
    if (bConvEl) bConvEl.innerText = Math.round(bAh * 12.8);

    const pWh     = parseFloat(document.getElementById('ps_val').innerText) || 0;
    const pConvEl = document.getElementById('ps_conv_val');
    if (pConvEl) pConvEl.innerText = Math.round(pWh / 12.8);
}

/* =========================================================
   7. DATE E SELECTOR
   ========================================================= */

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
        btn.onclick   = () => { dataSelezionata = new Date(d); aggiornaTuttaInterfaccia(); };
        container.appendChild(btn);
    }
}

function aggiornaTuttaInterfaccia(isManual = true) {
    const inputDate = document.getElementById('input-date');
    if (inputDate) inputDate.value = dataSelezionata.toISOString().split('T')[0];
    generaBottoniGiorni();
    updateAll(isManual);
}

/* =========================================================
   8. AGGIORNAMENTO UI
   ========================================================= */

function updateSunUI(hDec, sunH, setH) {
    const sun = document.getElementById('sun-body');
    const sky = document.getElementById('sky-box');
    if (!sun || !sky) return;

    if (hDec < sunH || hDec > setH) {
        sun.style.display   = 'none';
        sky.style.background = 'linear-gradient(to bottom, #0f172a, #1e293b)';
    } else {
        sun.style.display   = 'block';
        const progress      = (hDec - sunH) / (setH - sunH);
        sun.style.left      = `${15 + (progress * 70)}%`;
        sun.style.bottom    = `${(Math.sin(progress * Math.PI) * 35) + 10}%`;
        sky.style.background = (progress < 0.2 || progress > 0.8)
            ? 'linear-gradient(to bottom, #f59e0b, #7c2d12)'
            : 'linear-gradient(to bottom, #38bdf8, #1d4ed8)';
    }
}

function changeBg(color) {
    document.body.classList.remove('tema-verde', 'tema-rosso', 'tema-grigio');
    if (color === '#062c1f') document.body.classList.add('tema-verde');
    else if (color === '#2d0a1a') document.body.classList.add('tema-rosso');
    else if (color === '#1a1a1a') document.body.classList.add('tema-grigio');
    document.body.style.backgroundColor = color;
    localStorage.setItem('vibe_solar_bg_color', color);
}

function switchView(vId, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const target = document.getElementById('view-' + vId);
    if (target) target.classList.add('active');
    if (el)     el.classList.add('active');
}

function setupStars() {
    const container = document.getElementById('stars-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 50; i++) {
        const star       = document.createElement('div');
        star.className   = 'star';
        star.style.left  = Math.random() * 100 + '%';
        star.style.top   = Math.random() * 60  + '%';
        const size       = Math.random() * 2 + 'px';
        star.style.width = star.style.height = size;
        container.appendChild(star);
    }
}
