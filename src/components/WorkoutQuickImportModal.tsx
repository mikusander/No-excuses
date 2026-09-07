import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Mic,
  MicOff,
  Sparkles,
  Trash2,
  Plus,
  Check,
  AlertCircle,
  Clock,
  RefreshCw,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ExerciseDraft } from '../hooks/useWorkoutBuilder';
import { useLocalOcr } from '../hooks/useLocalOcr';
import { useWorkoutDictation } from '../hooks/useWorkoutDictation';
import { parseOcrWorkoutLines, parseSpokenWorkout } from '../utils/workoutTextTokenizer';
import type { ParsedWorkoutItem } from '../utils/parseExerciseInput';
import { recordCorrection } from '../utils/userCorrectionsManager';

interface WorkoutQuickImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportExercises: (exercises: ExerciseDraft[], mode: 'append' | 'replace') => void;
}

export const WorkoutQuickImportModal: React.FC<WorkoutQuickImportModalProps> = ({
  isOpen,
  onClose,
  onImportExercises,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'ocr' | 'voice'>('ocr');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [parsedItems, setParsedItems] = useState<ParsedWorkoutItem[]>([]);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [rawEditableText, setRawEditableText] = useState('');

  const originalParsedMapRef = useRef<Map<number, ParsedWorkoutItem>>(new Map());
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Hook OCR Locale
  const {
    status: ocrStatus,
    progress: ocrProgress,
    statusText: ocrStatusText,
    error: ocrError,
    recognizedText,
    recognizeImage,
    resetOcr,
  } = useLocalOcr();

  // Hook Dettatura Vocale
  const {
    isListening,
    isSupported: isVoiceSupported,
    fullTranscript,
    error: voiceError,
    startListening,
    stopListening,
    resetTranscript,
  } = useWorkoutDictation();

  // Reset dello stato quando si apre o chiude il modale
  useEffect(() => {
    if (!isOpen) {
      resetOcr();
      resetTranscript();
      setParsedItems([]);
      setSelectedImageName(null);
      setImagePreviewUrl(null);
      setShowRawText(false);
      setRawEditableText('');
    }
  }, [isOpen, resetOcr, resetTranscript]);

  // Quando l'OCR restituisce del testo, analizzalo automaticamente
  useEffect(() => {
    if (recognizedText) {
      setRawEditableText(recognizedText);
      const items = parseOcrWorkoutLines(recognizedText, 90, user?.id);
      setParsedItems(items);
      originalParsedMapRef.current = new Map(items.map((it, idx) => [idx, { ...it }]));
    }
  }, [recognizedText, user?.id]);

  // Quando la dettatura vocale accumula testo, aggiorna il parser
  useEffect(() => {
    if (fullTranscript && activeTab === 'voice') {
      const items = parseSpokenWorkout(fullTranscript, 90, user?.id);
      setParsedItems(items);
      originalParsedMapRef.current = new Map(items.map((it, idx) => [idx, { ...it }]));
      setRawEditableText(fullTranscript);
    }
  }, [fullTranscript, activeTab, user?.id]);

  if (!isOpen) return null;

  // Gestione caricamento immagine
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedImageName(file.name);
    setImagePreviewUrl(URL.createObjectURL(file));

    try {
      await recognizeImage(file);
    } catch (err) {
      console.warn('Errore scansione OCR:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleReParseRawText = (text: string) => {
    setRawEditableText(text);
    if (activeTab === 'ocr') {
      const items = parseOcrWorkoutLines(text, 90, user?.id);
      setParsedItems(items);
      originalParsedMapRef.current = new Map(items.map((it, idx) => [idx, { ...it }]));
    } else {
      const items = parseSpokenWorkout(text, 90, user?.id);
      setParsedItems(items);
      originalParsedMapRef.current = new Map(items.map((it, idx) => [idx, { ...it }]));
    }
  };

  // Modifiche manuali alla tabella di revisione
  const updateParsedItem = (index: number, field: keyof ParsedWorkoutItem, value: unknown) => {
    setParsedItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeParsedItem = (index: number) => {
    setParsedItems(prev => prev.filter((_, i) => i !== index));
  };

  const addManualItem = () => {
    const newItem: ParsedWorkoutItem = {
      matched: true,
      type: 'reps',
      name: 'Nuovo Esercizio',
      sets: 3,
      reps: 10,
      duration_seconds: 0,
      rest_seconds: 90,
      rawInput: '',
    };
    setParsedItems(prev => [...prev, newItem]);
  };

  // Conversione definitiva in ExerciseDraft[] per l'inserimento
  const handleConfirmImport = () => {
    // Apprendimento continuo: memorizza eventuali modifiche e correzioni manuali dell'utente
    parsedItems.forEach((item, index) => {
      const raw = item.rawInput ? item.rawInput.trim() : '';
      if (raw.length < 2) return;

      const original = originalParsedMapRef.current.get(index);
      recordCorrection(
        raw,
        {
          name: item.name,
          modality: item.type,
          setsOrRounds: item.sets || (item.type === 'circuit' || item.type === 'emom' ? item.emom_rounds || 3 : 3),
          repsTarget: item.type === 'isometry' ? undefined : (item.isMaxReps ? 'max' : String(item.reps || 10)),
          durationSeconds: item.type === 'isometry' ? (item.duration_seconds || 30) : undefined,
          restSeconds: item.rest_seconds ?? 90,
          weightKg: item.weight_kg ?? null,
          subExercises: item.subExercises?.map(s => ({
            name: s.name,
            type: s.type,
            reps: s.reps,
            duration_seconds: s.duration_seconds,
            weight_kg: s.weight_kg ?? null,
          })),
          pyramidSteps: item.pyramid_steps?.map(p => ({
            reps: p.reps,
            restSeconds: p.rest_seconds,
            weightKg: p.weight_kg ?? null,
          })),
        },
        original ? {
          name: original.name,
          type: original.type,
          sets: original.sets,
          reps: original.reps,
          weight_kg: original.weight_kg,
          rest_seconds: original.rest_seconds,
        } : null,
        user?.id
      );
    });

    const drafts: ExerciseDraft[] = parsedItems.map(item => {
      const id = crypto.randomUUID();

      if (item.type === 'emom') {
        return {
          id,
          type: 'emom',
          name: item.name,
          sets: item.sets || 10,
          reps: 0,
          duration_seconds: 0,
          rest_seconds: item.rest_seconds || 90,
          emom_rounds: item.emom_rounds || item.sets || 10,
          emom_round_duration: item.emom_round_duration || 60,
          subExercises: (item.subExercises || []).map(s => ({
            name: s.name,
            type: s.type,
            reps: s.reps,
            duration_seconds: s.duration_seconds,
            weight_kg: s.weight_kg ?? null,
            instruction_note: '',
          })),
        };
      }

      if (item.type === 'circuit') {
        return {
          id,
          type: 'circuit',
          name: item.name,
          sets: item.sets || 3,
          reps: 0,
          duration_seconds: 0,
          rest_seconds: item.rest_seconds || 90,
          subExercises: (item.subExercises || []).map(s => ({
            name: s.name,
            type: s.type,
            reps: s.reps,
            duration_seconds: s.duration_seconds,
            weight_kg: s.weight_kg ?? null,
            instruction_note: '',
          })),
        };
      }

      if (item.type === 'superset') {
        return {
          id,
          type: 'superset',
          name: item.name,
          sets: item.sets || 3,
          reps: 0,
          duration_seconds: 0,
          rest_seconds: item.rest_seconds || 90,
          subExercises: (item.subExercises || []).map(s => ({
            name: s.name,
            type: s.type,
            reps: s.reps,
            duration_seconds: s.duration_seconds,
            weight_kg: s.weight_kg ?? null,
            instruction_note: '',
          })),
        };
      }

      if (item.type === 'pyramid') {
        return {
          id,
          type: 'pyramid',
          name: item.name,
          sets: 1,
          reps: item.reps || 10,
          duration_seconds: 0,
          rest_seconds: 0,
          pyramid_steps: (item.pyramid_steps || []).map(step => ({
            reps: step.reps,
            rest_seconds: step.rest_seconds,
            weight_kg: step.weight_kg ?? null,
          })),
        };
      }

      if (item.type === 'isometry') {
        return {
          id,
          type: 'isometry',
          name: item.name,
          sets: item.sets || 3,
          reps: 0,
          duration_seconds: item.duration_seconds || 30,
          rest_seconds: item.rest_seconds || 90,
          transition_rest_seconds: 0,
          weight_kg: null,
        };
      }

      // Default reps
      return {
        id,
        type: 'reps',
        name: item.name,
        sets: item.sets || 3,
        reps: item.reps || 10,
        duration_seconds: 0,
        rest_seconds: item.rest_seconds || 90,
        transition_rest_seconds: 0,
        weight_kg: null,
      };
    });

    onImportExercises(drafts, importMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header Modale */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-2xl bg-brand-orange/15 text-brand-orange">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <span>Importazione Scheda Rapida</span>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  100% Locale & Privacy
                </span>
              </h2>
              <p className="text-xs text-brand-grey/70">
                Scansiona una foto o detta a voce: nessun dato viene inviato a server esterni.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-brand-grey hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-white/10 bg-black/20 p-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ocr');
              if (isListening) stopListening();
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all ${
              activeTab === 'ocr'
                ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                : 'text-brand-grey hover:text-white hover:bg-white/5'
            }`}
          >
            <Camera size={16} />
            <span>Scansione Foto (OCR Locale)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('voice');
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all ${
              activeTab === 'voice'
                ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                : 'text-brand-grey hover:text-white hover:bg-white/5'
            }`}
          >
            <Mic size={16} />
            <span>Dettatura Vocale Live</span>
          </button>
        </div>

        {/* Corpo Modale con Scroll */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: OCR SCANSIONE */}
          {activeTab === 'ocr' && (
            <div className="space-y-4">
              {/* Input per Galleria / File dal dispositivo (NO capture, apre foto, file, screenshot) */}
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Input per Fotocamera diretta (capture=environment) */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Due Opzioni Chiare: Galleria/File e Fotocamera */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex items-center space-x-3.5 p-4 rounded-2xl bg-black/40 hover:bg-white/5 border border-white/10 hover:border-brand-orange/50 text-left transition-all active:scale-98 group cursor-pointer shadow-sm"
                >
                  <div className="p-3 rounded-xl bg-brand-orange/15 text-brand-orange group-hover:scale-110 transition-transform shrink-0">
                    <ImageIcon size={24} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white group-hover:text-brand-orange transition-colors">
                      Scegli da Galleria / File
                    </div>
                    <div className="text-xs text-brand-grey/60 mt-0.5">
                      Foto salvate, screenshot o download sul telefono
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center space-x-3.5 p-4 rounded-2xl bg-black/40 hover:bg-white/5 border border-white/10 hover:border-cyan-500/50 text-left transition-all active:scale-98 group cursor-pointer shadow-sm"
                >
                  <div className="p-3 rounded-xl bg-cyan-500/15 text-cyan-400 group-hover:scale-110 transition-transform shrink-0">
                    <Camera size={24} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                      Scatta con Fotocamera
                    </div>
                    <div className="text-xs text-brand-grey/60 mt-0.5">
                      Inquadra direttamente la scheda cartacea
                    </div>
                  </div>
                </button>
              </div>

              {/* Anteprima Immagine Selezionata */}
              {imagePreviewUrl && (
                <div className="p-3.5 bg-black/40 border border-brand-orange/30 rounded-2xl flex items-center justify-between space-x-3 animate-fade-in">
                  <div className="flex items-center space-x-3 min-w-0">
                    <img
                      src={imagePreviewUrl}
                      alt="Anteprima"
                      className="w-12 h-12 object-cover rounded-xl border border-white/10 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {selectedImageName || 'Immagine caricata'}
                      </p>
                      <p className="text-[11px] text-emerald-400 flex items-center mt-0.5 font-medium">
                        <Check size={12} className="mr-1 shrink-0" /> Pronta per l'analisi OCR locale
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                    >
                      Cambia
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedImageName(null);
                        setImagePreviewUrl(null);
                        setParsedItems([]);
                        resetOcr();
                      }}
                      className="p-2 text-brand-grey/60 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="Rimuovi immagine"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Barra di Progresso OCR */}
              {(ocrStatus === 'preprocessing' || ocrStatus === 'recognizing') && (
                <div className="bg-black/40 border border-brand-orange/30 p-4 rounded-2xl space-y-2 animate-fade-in">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-brand-orange flex items-center">
                      <RefreshCw size={13} className="animate-spin mr-1.5" />
                      {ocrStatusText}
                    </span>
                    <span className="text-white font-mono">{ocrProgress}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-brand-orange h-full transition-all duration-300 rounded-full shadow-sm shadow-brand-orange"
                      style={{ width: `${ocrProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {ocrError && (
                <div className="p-3 bg-red-950/50 border border-red-500/40 text-red-300 rounded-xl text-xs flex items-center space-x-2">
                  <AlertCircle size={16} className="text-red-400 shrink-0" />
                  <span>{ocrError}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DETTATURA VOCALE */}
          {activeTab === 'voice' && (
            <div className="space-y-4">
              {!isVoiceSupported ? (
                <div className="p-4 bg-amber-950/40 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-start space-x-3">
                  <AlertCircle size={18} className="shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1">Riconoscimento vocale non disponibile in questo browser</p>
                    <p className="opacity-80">
                      Usa Google Chrome, Microsoft Edge o Safari (iOS/macOS) per la dettatura nativa, oppure usa la Scansione Foto OCR.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Pulsante Microfono Grande */}
                  <div className="flex flex-col items-center justify-center p-6 bg-black/30 border border-white/10 rounded-3xl relative overflow-hidden">
                    <button
                      type="button"
                      onClick={isListening ? stopListening : startListening}
                      className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl active:scale-95 ${
                        isListening
                          ? 'bg-red-500 text-white shadow-red-500/30 animate-pulse'
                          : 'bg-brand-orange text-black shadow-brand-orange/30 hover:scale-105'
                      }`}
                    >
                      {isListening ? <MicOff size={32} /> : <Mic size={32} />}
                      {isListening && (
                        <span className="absolute -inset-2 rounded-full border-2 border-red-500/50 animate-ping pointer-events-none" />
                      )}
                    </button>

                    <p className="mt-4 font-bold text-sm text-white">
                      {isListening ? 'Ascolto attivo... Parla ora' : 'Tocca il microfono per avviare la dettatura'}
                    </p>
                    <p className="text-xs text-brand-grey/60 mt-1 text-center max-w-sm">
                      Pronuncia gli esercizi separandoli con &quot;poi&quot; o &quot;dopo&quot;. Riconosce anche EMOM, piramidi e superset!
                    </p>
                  </div>

                  {/* Esempi di Frasi Parlate */}
                  <div className="bg-black/20 border border-white/5 p-3 rounded-2xl space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-brand-grey/60 flex items-center">
                      <Sparkles size={11} className="mr-1 text-brand-orange" />
                      Esempi che puoi pronunciare a voce:
                    </div>
                    <p className="text-xs text-brand-grey/80 italic">
                      &bull; &quot;Panca piana 4 serie da 8 recupero 90 secondi poi trazioni 4 al cedimento&quot;
                    </p>
                    <p className="text-xs text-brand-grey/80 italic">
                      &bull; &quot;Superset 4 serie 10 trazioni e 12 dip recupero novanta secondi&quot;
                    </p>
                    <p className="text-xs text-brand-grey/80 italic">
                      &bull; &quot;Squat piramidale 15 12 10 8 recupero due minuti&quot;
                    </p>
                    <p className="text-xs text-brand-grey/80 italic">
                      &bull; &quot;EMOM dieci round da un minuto dieci push up e cinque pull up&quot;
                    </p>
                  </div>

                  {voiceError && (
                    <div className="p-3 bg-red-950/50 border border-red-500/40 text-red-300 rounded-xl text-xs flex items-center space-x-2">
                      <AlertCircle size={16} className="text-red-400 shrink-0" />
                      <span>{voiceError}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Testo Trascritto / Riconosciuto (Ispezionabile ed Editabile) */}
          {rawEditableText.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowRawText(!showRawText)}
                  className="text-xs font-semibold text-brand-orange flex items-center space-x-1 hover:underline"
                >
                  <FileText size={13} />
                  <span>{showRawText ? 'Nascondi testo grezzo' : 'Mostra / Modifica testo grezzo'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleReParseRawText(rawEditableText)}
                  className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
                >
                  Rianalizza Testo
                </button>
              </div>

              {showRawText && (
                <textarea
                  rows={4}
                  value={rawEditableText}
                  onChange={(e) => handleReParseRawText(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-2xl p-3 text-white text-xs font-mono focus:border-brand-orange outline-none resize-none"
                  placeholder="Testo estratto..."
                />
              )}
            </div>
          )}

          {/* SEZIONE REVISIONE ED EDITING RAPIDO DEGLI ESERCIZI ESTRATTI */}
          <div className="border-t border-white/10 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-white">Esercizi Riconosciuti</span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/30">
                  {parsedItems.length}
                </span>
              </div>
              <button
                type="button"
                onClick={addManualItem}
                className="text-xs font-bold text-brand-orange hover:text-white flex items-center space-x-1 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                <Plus size={14} />
                <span>Aggiungi Riga</span>
              </button>
            </div>

            {parsedItems.length === 0 ? (
              <div className="text-center p-6 bg-black/20 rounded-2xl border border-dashed border-white/10 text-brand-grey/50 text-xs">
                {activeTab === 'ocr'
                  ? 'Carica una foto per estrarre automaticamente la tabella esercizi.'
                  : 'Avvia la dettatura vocale per popolare gli esercizi.'}
              </div>
            ) : (
              <div className="space-y-3">
                {parsedItems.map((item, index) => (
                  <div
                    key={index}
                    className="p-3.5 bg-black/40 border border-white/10 rounded-2xl space-y-2.5 hover:border-brand-orange/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2 flex-1">
                        <span className="text-xs font-bold text-brand-grey/50 w-5 text-center">
                          #{index + 1}
                        </span>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateParsedItem(index, 'name', e.target.value)}
                          placeholder="Nome esercizio"
                          className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm font-bold text-white focus:border-brand-orange outline-none"
                        />
                      </div>
                      {item.learnedRule && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 shrink-0"
                          title="Esercizio riconosciuto tramite regola appresa"
                        >
                          💡 Appreso
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand-orange/20 text-brand-orange uppercase">
                        {item.type}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeParsedItem(index)}
                        className="text-brand-grey/50 hover:text-red-500 p-1 transition-colors"
                        title="Rimuovi esercizio"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Dettagli specifici se complesso */}
                    {item.subExercises && item.subExercises.length > 0 && (
                      <div className="bg-brand-orange/5 border border-brand-orange/20 rounded-xl p-2 text-xs space-y-1">
                        <span className="text-[10px] font-bold uppercase text-brand-orange tracking-wider block">
                          Stazioni ({item.subExercises.length}):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {item.subExercises.map((sub, sIdx) => (
                            <span
                              key={sIdx}
                              className="px-2 py-0.5 rounded bg-black/40 text-brand-grey/90 text-[11px] border border-white/5"
                            >
                              {sub.name} ({sub.type === 'isometry' ? `${sub.duration_seconds}s` : `${sub.reps} reps`})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.pyramid_steps && item.pyramid_steps.length > 0 && (
                      <div className="bg-brand-orange/5 border border-brand-orange/20 rounded-xl p-2 text-xs space-y-1">
                        <span className="text-[10px] font-bold uppercase text-brand-orange tracking-wider block">
                          Step Piramide ({item.pyramid_steps.length}):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {item.pyramid_steps.map((step, sIdx) => (
                            <span
                              key={sIdx}
                              className="px-2 py-0.5 rounded bg-black/40 text-brand-grey/90 text-[11px] border border-white/5"
                            >
                              Step {sIdx + 1}: {step.reps} reps ({step.rest_seconds}s)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Campi Numerici Modificabili */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col">
                        <label className="text-[9px] uppercase font-bold text-brand-grey/60 mb-0.5">
                          {item.type === 'circuit' || item.type === 'emom' ? 'Round' : 'Serie'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={item.sets || 3}
                          onChange={(e) => updateParsedItem(index, 'sets', parseInt(e.target.value, 10) || 1)}
                          className="bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-center text-xs font-bold text-white focus:border-brand-orange outline-none"
                        />
                      </div>

                      <div className="flex flex-col">
                        <label className="text-[9px] uppercase font-bold text-brand-grey/60 mb-0.5">
                          {item.type === 'isometry' ? 'Durata (s)' : 'Ripetizioni'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.type === 'isometry' ? (item.duration_seconds || 30) : (item.reps || 10)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 0;
                            if (item.type === 'isometry') {
                              updateParsedItem(index, 'duration_seconds', val);
                            } else {
                              updateParsedItem(index, 'reps', val);
                            }
                          }}
                          className="bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-center text-xs font-bold text-white focus:border-brand-orange outline-none"
                        />
                      </div>

                      <div className="flex flex-col">
                        <label className="text-[9px] uppercase font-bold text-brand-grey/60 mb-0.5 flex items-center justify-center">
                          <Clock size={10} className="mr-0.5 text-brand-orange" />
                          Recupero
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="15"
                          value={item.rest_seconds ?? 90}
                          onChange={(e) => updateParsedItem(index, 'rest_seconds', parseInt(e.target.value, 10) || 0)}
                          className="bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-center text-xs font-bold text-brand-orange focus:border-brand-orange outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer con Opzioni di Importazione e Conferma */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-black/50 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Opzione Append vs Replace */}
          <div className="flex items-center space-x-2 text-xs text-brand-grey/80">
            <span className="font-semibold">Modalità:</span>
            <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setImportMode('append')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  importMode === 'append' ? 'bg-brand-orange text-black font-bold' : 'text-brand-grey hover:text-white'
                }`}
              >
                Aggiungi in coda
              </button>
              <button
                type="button"
                onClick={() => setImportMode('replace')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  importMode === 'replace' ? 'bg-brand-orange text-black font-bold' : 'text-brand-grey hover:text-white'
                }`}
              >
                Sostituisci scheda
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/10 text-brand-grey/90 text-xs font-bold transition-colors"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={parsedItems.length === 0}
              onClick={handleConfirmImport}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-brand-orange hover:bg-brand-orange/90 text-black font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={16} />
              <span>Aggiungi alla Scheda ({parsedItems.length})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkoutQuickImportModal;
