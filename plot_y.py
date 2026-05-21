import pandas as pd
import matplotlib.pyplot as plt
import os

csv_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv"

try:
    df = pd.read_csv(csv_path)
    
    plt.figure(figsize=(12, 6))
    
    # Raggruppo per nome del landmark e traccio
    for landmark in df['landmark_name'].unique():
        subset = df[df['landmark_name'] == landmark].sort_values('frame_index')
        plt.plot(subset['elapsed_ms'] / 1000.0, subset['y'], label=landmark, linewidth=1.5)
        
    plt.title('Andamento asse Y dei Landmark (Push-up)')
    plt.xlabel('Tempo (secondi)')
    plt.ylabel('Coordinata Y (normalizzata, 0 = alto, 1 = basso)')
    
    # In mediaPipe la Y=0 è in alto, quindi inverto l'asse per renderlo più intuitivo (movimento verso il basso)
    plt.gca().invert_yaxis()
    
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.tight_layout()
    
    output_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\andamento_y.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"SUCCESS: Grafico salvato in {output_path}")
except Exception as e:
    print(f"ERROR: {e}")
