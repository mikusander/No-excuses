# Trova i processi sulle porte 5173
VITE_PID=$(lsof -Pi :5173 -sTCP:LISTEN -t)
if [ -n "$VITE_PID" ]; then
    echo "Fermando Vite (PID $VITE_PID)..."
    kill -9 $VITE_PID
fi


echo "Tutti i servizi fermati."
