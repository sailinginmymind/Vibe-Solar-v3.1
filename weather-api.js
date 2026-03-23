/**
 * WEATHER-API.JS - Vibe Solar v3.0
 * Gestisce il GPS del browser, le chiamate all'API meteo (Open-Meteo)
 * e la sincronizzazione dell'orologio con il fuso orario locale del camper.
 */

/** Offset UTC in secondi per il fuso orario della posizione corrente (aggiornato da fetchForecast) */
window.timezoneOffsetSeconds = null;

const WeatherAPI = {

    /**
     * Richiede le coordinate GPS al browser tramite l'API Geolocation.
     * Usa enableHighAccuracy: false per compatibilità con le PWA locali,
     * dove il browser preferisce non attivare il chip GPS hardware.
     * @returns {Promise<GeolocationCoordinates>} Oggetto con latitude e longitude
     */
    getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject({ code: 0, message: 'GPS non supportato dal browser' });
                return;
            }
            const options = {
                enableHighAccuracy: false,
                timeout:            10000,
                maximumAge:         0,
            };
            navigator.geolocation.getCurrentPosition(
                pos  => resolve(pos.coords),
                err  => {
                    console.warn('Errore GPS:', err.message);
                    reject(err);
                },
                options
            );
        });
    },

    /**
     * Recupera le previsioni meteo orarie da Open-Meteo per una data specifica.
     * Aggiorna anche window.timezoneOffsetSeconds con l'offset del fuso orario locale.
     *
     * Variabili richieste:
     *  - temperature_2m, relative_humidity_2m, cloud_cover, wind_speed_10m (orarie)
     *  - sunrise, sunset (giornaliere)
     *
     * @param {string|number} lat          - Latitudine
     * @param {string|number} lng          - Longitudine
     * @param {string}        date         - Data nel formato "YYYY-MM-DD"
     * @param {boolean}       [updateInputs=false] - Se true, sincronizza ora e data negli input
     * @returns {Promise<Object|null>} Dati meteo JSON di Open-Meteo, oppure null in caso di errore
     */
    async fetchForecast(lat, lng, date, updateInputs = false) {
        try {
            const url =
                `https://api.open-meteo.com/v1/forecast` +
                `?latitude=${lat}&longitude=${lng}` +
                `&hourly=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m` +
                `&daily=sunrise,sunset` +
                `&timezone=auto` +
                `&start_date=${date}&end_date=${date}`;

            const response = await fetch(url);
            const data     = await response.json();

            // Aggiorna l'offset del fuso orario e sincronizza gli input se richiesto
            if (data.utc_offset_seconds !== undefined) {
                window.timezoneOffsetSeconds = data.utc_offset_seconds;
                if (updateInputs) {
                    updateDashboardClock(true);
                }
            }

            return data;
        } catch (err) {
            console.error('Errore API Meteo (Open-Meteo):', err);
            return null;
        }
    }
};

/**
 * Calcola l'ora locale corretta per il fuso orario del camper (non del dispositivo)
 * e la visualizza nel display centrale. Aggiorna anche gli input ora/data se necessario.
 *
 * Logica:
 *  1. Prende l'ora UTC del dispositivo.
 *  2. Applica l'offset ricevuto dall'API (window.timezoneOffsetSeconds).
 *  3. Aggiorna il display e, se "forza=true", anche gli input.
 *
 * @param {boolean} [forza=false] - Se true, sovrascrive il valore degli input anche se già popolati
 */
function updateDashboardClock(forza = false) {
    const clockElement = document.getElementById('display-hour-center');
    const inputTime    = document.getElementById('input-time');
    const inputDate    = document.getElementById('input-date');
    if (!clockElement) return;

    const oraLocale = new Date();
    let timeToUse   = oraLocale;

    // Corregge il tempo in base al fuso orario della posizione GPS del camper
    if (window.timezoneOffsetSeconds !== null) {
        const utcTimeMs = oraLocale.getTime() + (oraLocale.getTimezoneOffset() * 60000);
        timeToUse = new Date(utcTimeMs + (window.timezoneOffsetSeconds * 1000));
    }

    const h = timeToUse.getHours().toString().padStart(2, '0');
    const m = timeToUse.getMinutes().toString().padStart(2, '0');

    // Aggiorna il display centrale dell'ora
    clockElement.innerText = `${h}:${m}`;

    // Aggiorna l'input ora solo se forzato o se vuoto
    if (forza || (inputTime && !inputTime.value)) {
        if (inputTime) inputTime.value = `${h}:${m}`;
    }

    // Aggiorna l'input data solo se forzato o se vuoto
    if (forza || (inputDate && !inputDate.value)) {
        if (inputDate) {
            const yyyy = timeToUse.getFullYear();
            const mm   = (timeToUse.getMonth() + 1).toString().padStart(2, '0');
            const dd   = timeToUse.getDate().toString().padStart(2, '0');
            inputDate.value = `${yyyy}-${mm}-${dd}`;
        }
    }
}
