#!/bin/bash
# start.sh - Avvia l'applicazione Gym App (HTTPS per Mobile)

# Recupera l'IP locale (macOS)
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "localhost")


# Controlla se il server è già in esecuzione sulla porta 5173
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null ; then
    echo "Il server è già in esecuzione sulla porta 5173."
else
    echo "Avvio del server di sviluppo (HTTPS exposed)..."
    npm run dev -- --host &
    echo "Server avviato in background."
fi

# Aspetta un momento per l'avvio
sleep 4
echo "--------------------------------------------------------"
echo "L'app è pronta (HTTPS attivo per abilitare la Camera)!"
echo "Accesso Locale: https://localhost:5173"
echo "Accesso da Telefono: https://$IP:5173"
echo "--------------------------------------------------------"
echo "NOTA: Vedrai un avviso di sicurezza (certificato auto-firmato)."
echo "Clicca su 'Avanzate' e poi 'Procedi su... (non sicuro)' per continuare."
echo "Certificati HTTPS sono OBBLIGATORI sui browser moderni per usare la camera."
echo "--------------------------------------------------------"
