/**
 * SOLAR-ENGINE.JS - Vibe Solar v3.0
 * Motore di calcolo solare: potenza istantanea, tilt ottimale, stima ricarica.
 * Nessuna dipendenza esterna — puro JavaScript.
 */
const SolarEngine = {

    /**
     * Calcola l'angolo di tilt ottimale in base all'altezza del sole sull'orizzonte.
     * Il pannello rende al massimo quando è perpendicolare ai raggi solari,
     * ovvero quando il tilt è il complementare dell'altezza solare.
     * @param {number} sunAltitude - Altezza del sole in gradi (0–90)
     * @returns {number} Tilt ottimale in gradi (0–90)
     */
    getOptimalTilt(sunAltitude) {
        if (sunAltitude <= 0) return 0;
        const idealTilt = 90 - sunAltitude;
        return Math.max(0, Math.min(90, idealTilt));
    },

    /**
     * Calcola la potenza istantanea prodotta dai pannelli solari in Watt.
     *
     * Modello fisico applicato:
     *  1. Controllo notte (fuori dalla finestra alba-tramonto → 0 W)
     *  2. Altezza solare effettiva (calcolata se non fornita)
     *  3. Fattore di incidenza  → cos(Δtilt): quanto il pannello punta verso il sole
     *  4. Effetto atmosfera (Air Mass) → sin(altezza): filtro dell'aria a bassa elevazione
     *  5. Riduzione meteo → nubi attenuano fino all'85% dell'irraggiamento
     *  6. Efficienza di sistema → 82% (cavi, calore, MPPT)
     *
     * @param {number} hDec        - Ora corrente in decimale (es. 13.5 = 13:30)
     * @param {number} sunH        - Ora alba in decimale
     * @param {number} setH        - Ora tramonto in decimale
     * @param {number} panelWp     - Potenza di picco del pannello in Watt-peak
     * @param {number} cloudCover  - Copertura nuvolosa in % (0–100)
     * @param {number} [tilt=0]    - Angolo di inclinazione del pannello in gradi
     * @param {number|null} [sunAltitude=null] - Altezza solare precalcolata; se null viene ricalcolata
     * @returns {number} Potenza prodotta in Watt (≥ 0)
     */
    calculatePower(hDec, sunH, setH, panelWp, cloudCover, tilt = 0, sunAltitude = null) {
        // 1. Notte: nessuna produzione
        if (hDec < sunH || hDec > setH) return 0;

        // 2. Altezza solare: usa il valore fornito oppure lo calcola dalla progressione
        let effectiveAltitude = sunAltitude;
        if (effectiveAltitude === null || effectiveAltitude <= 0) {
            const progress = (hDec - sunH) / (setH - sunH);
            effectiveAltitude = Math.sin(progress * Math.PI) * 65;
        }
        if (effectiveAltitude <= 0) return 0;

        // 3. Fattore di incidenza: differenza angolare tra il tilt impostato e quello ottimale
        const optimalTilt     = this.getOptimalTilt(effectiveAltitude);
        const angularDiff     = Math.abs(tilt - optimalTilt);
        const radDiff         = (angularDiff * Math.PI) / 180;
        const incidenceFactor = Math.max(0, Math.cos(radDiff));

        // 4. Effetto atmosfera: il sole basso attraversa più aria → meno irraggiamento
        const atmosphereEffect = Math.sin((effectiveAltitude * Math.PI) / 180);

        // 5. Fattore meteo: copertura nuvolosa riduce fino all'85% dell'energia
        const weatherFactor = (100 - (cloudCover * 0.85)) / 100;

        // 6. Efficienza complessiva del sistema (cavi, inverter, MPPT, temperatura)
        const systemEfficiency = 0.82;

        // Calcolo finale
        const finalPower = panelWp * incidenceFactor * atmosphereEffect * weatherFactor * systemEfficiency;
        return Math.max(0, finalPower);
    },

    /**
     * Stima il tempo necessario per raggiungere un target di SOC con la potenza corrente.
     *
     * Formula:
     *  - Energia mancante = capacità totale (Wh) × (target% - attuale%) / 100
     *  - Potenza netta    = potenza corrente × 0.85 (perdite carica) − 10 W (consumo fisso camper)
     *  - Tempo            = energia mancante / potenza netta
     *
     * @param {number} currentSoc  - SOC attuale in % (es. 50)
     * @param {number} targetSoc   - SOC obiettivo in % (es. 80)
     * @param {number} currentPower - Potenza solare istantanea in W
     * @param {number} battAh       - Capacità della batteria in Ah (a 12.8 V)
     * @returns {string} Tempo formattato (es. "2h 15m") oppure "OK", "--", "∞", ">48h"
     */
    estimateChargeTime(currentSoc, targetSoc, currentPower, battAh) {
        if (currentPower <= 5 || battAh <= 0) return '--';
        if (parseFloat(currentSoc) >= targetSoc) return 'OK';

        const voltage      = 12.8;
        const lossFactor   = 0.85;
        const totalWh      = battAh * voltage;
        const energyNeeded = totalWh * ((targetSoc - currentSoc) / 100);

        // Potenza netta: sottraiamo il consumo fisso del camper (10 W)
        const netPower = (currentPower * lossFactor) - 10;
        if (netPower <= 0) return '∞';

        const hoursDecimal = energyNeeded / netPower;
        if (hoursDecimal > 48) return '>48h';

        const h = Math.floor(hoursDecimal);
        const m = Math.round((hoursDecimal - h) * 60);
        return `${h}h ${m}m`;
    },

    /**
     * Converte una stringa oraria "HH:MM" in un numero decimale.
     * Usato per confrontare ore con i valori di alba e tramonto.
     * @param {string} timeStr - Stringa nel formato "HH:MM"
     * @returns {number} Valore decimale (es. "13:30" → 13.5). Restituisce 12 in caso di errore.
     */
    timeToDecimal(timeStr) {
        if (!timeStr || timeStr === '--:--' || typeof timeStr !== 'string') return 12;
        const parts = timeStr.split(':');
        if (parts.length !== 2) return 12;
        const h = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        return h + (m / 60);
    }
};
