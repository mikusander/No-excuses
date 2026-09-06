/**
 * PeriodicReportModal.tsx — Modale interattivo per la visualizzazione del Report Periodico
 * degli Allenamenti, analisi dei gruppi muscolari, dettaglio esercizi e resoconto delle note.
 *
 * Include gestione difensiva dei dati storici/snapshot e Error Boundary per evitare
 * schermate nere o crash su dati imprevisti.
 */

import React, { useState, useMemo, Component, type ErrorInfo, type ReactNode } from 'react';
import {
  X,
  BarChart3,
  Dumbbell,
  Layers,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import type { MuscleGroup } from '../utils/exerciseClassifier';
import {
  type ReportPeriodType,
  type CustomDateRange,
  type RawWorkoutSession,
  generatePeriodicReport,
  getEmptyReport,
  exportReportSummaryText,
  parseSafeDate,
} from '../utils/periodicReportEngine';

interface PeriodicReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workouts: RawWorkoutSession[];
}

const MUSCLE_COLORS: Record<MuscleGroup, { bar: string; text: string; bg: string; border: string }> = {
  Petto: {
    bar: 'bg-orange-500',
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
  },
  Dorso: {
    bar: 'bg-cyan-500',
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
  },
  Gambe: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  Spalle: {
    bar: 'bg-purple-500',
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
  Braccia: {
    bar: 'bg-rose-500',
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
  Addome: {
    bar: 'bg-amber-500',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  Altro: {
    bar: 'bg-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
  },
};

const getMuscleColorTheme = (group?: string | null) => {
  if (group && group in MUSCLE_COLORS) {
    return MUSCLE_COLORS[group as MuscleGroup];
  }
  return MUSCLE_COLORS.Altro;
};

const formatSafeNumber = (val: unknown): string => {
  const n = Number(val);
  return Number.isFinite(n) ? n.toLocaleString('it-IT') : '0';
};

const formatIsoDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface ErrorBoundaryProps {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class ReportErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error?.message || 'Errore imprevisto' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ReportErrorBoundary caught an error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.isOpen && !this.props.isOpen && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  handleClose = () => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onClose();
  };

  render() {
    if (!this.props.isOpen) {
      return null;
    }

    if (this.state.hasError) {
      return (
        <div
          onClick={this.handleClose}
          className="fixed inset-0 z-[100] h-[100dvh] w-screen flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-6"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#181818] border border-brand-orange/40 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl space-y-4"
          >
            <div className="p-3 bg-brand-orange/20 border border-brand-orange/40 rounded-2xl w-fit mx-auto text-brand-orange">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white">
              Impossibile aprire il Report
            </h3>
            <p className="text-xs sm:text-sm text-brand-grey/80 leading-relaxed">
              Si è verificato un errore durante l'elaborazione dei dati delle sessioni. Nessun dato è andato perso.
            </p>
            {this.state.errorMessage && (
              <div className="p-2.5 rounded-xl bg-black/60 border border-white/10 text-[11px] text-red-300/90 font-mono text-left max-h-24 overflow-y-auto break-all select-all">
                {this.state.errorMessage}
              </div>
            )}
            <div className="pt-2">
              <button
                onClick={this.handleClose}
                type="button"
                className="w-full py-3 px-5 rounded-2xl bg-brand-orange text-black font-extrabold text-sm uppercase tracking-wider hover:bg-brand-lightOrange transition-colors cursor-pointer active:scale-95 shadow-lg shadow-brand-orange/20"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const PeriodicReportModalInner: React.FC<PeriodicReportModalProps> = ({
  isOpen,
  onClose,
  workouts,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriodType>('month');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    return formatIsoDate(d);
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return formatIsoDate(new Date());
  });

  const [activeTab, setActiveTab] = useState<'muscles' | 'exercises' | 'notes'>('muscles');
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState('');
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState<string>('all');
  const [exerciseSortMode, setExerciseSortMode] = useState<'reps' | 'volume' | 'sets'>('reps');
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [expandedDossiers, setExpandedDossiers] = useState<Record<string, boolean>>({});

  const customRange = useMemo<CustomDateRange>(() => {
    return {
      startDate: customStartDate,
      endDate: customEndDate,
    };
  }, [customStartDate, customEndDate]);

  // Calcolo del report analitico con fallback sicuro
  const report = useMemo(() => {
    try {
      return generatePeriodicReport(
        workouts || [],
        selectedPeriod,
        selectedPeriod === 'custom' ? customRange : undefined
      );
    } catch (err) {
      console.error('Error generating periodic report:', err);
      return getEmptyReport(selectedPeriod, selectedPeriod === 'custom' ? customRange : undefined);
    }
  }, [workouts, selectedPeriod, customRange]);

  const handleApplyCustomPreset = (preset: 'this_month' | 'last_month' | 'last_14' | 'all_time') => {
    const now = new Date();
    if (preset === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(now));
    } else if (preset === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(end));
    } else if (preset === 'last_14') {
      const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      setCustomStartDate(formatIsoDate(start));
      setCustomEndDate(formatIsoDate(now));
    } else if (preset === 'all_time' && workouts && workouts.length > 0) {
      const timestamps = workouts
        .map((w) => parseSafeDate(w.executedAt)?.getTime() || 0)
        .filter((t) => t > 0);
      if (timestamps.length > 0) {
        const minDate = new Date(Math.min(...timestamps));
        const maxDate = new Date(Math.max(...timestamps));
        setCustomStartDate(formatIsoDate(minDate));
        setCustomEndDate(formatIsoDate(maxDate));
      }
    }
  };

  if (!isOpen) return null;

  const handleCopySummary = async () => {
    try {
      const text = exportReportSummaryText(report);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const toggleDossierExpanded = (canonicalId: string) => {
    setExpandedDossiers((prev) => ({
      ...prev,
      [canonicalId]: !prev[canonicalId],
    }));
  };

  // Filtro e ordinamento esercizi
  const sortedFilteredExercises = useMemo(() => {
    const list = (report?.exercises || []).filter((ex) => {
      if (!ex) return false;
      const displayName = String(ex.displayName || '');
      const matchesSearch =
        exerciseSearchQuery === '' ||
        displayName.toLowerCase().includes(exerciseSearchQuery.toLowerCase());
      const matchesGroup =
        selectedMuscleFilter === 'all' || ex.muscleGroup === selectedMuscleFilter;
      return matchesSearch && matchesGroup;
    });

    return list.sort((a, b) => {
      const aReps = Number(a?.totalReps) || 0;
      const bReps = Number(b?.totalReps) || 0;
      const aVol = Number(a?.totalVolumeKg) || 0;
      const bVol = Number(b?.totalVolumeKg) || 0;
      const aSets = Number(a?.totalSets) || 0;
      const bSets = Number(b?.totalSets) || 0;

      if (exerciseSortMode === 'reps') {
        if (bReps !== aReps) return bReps - aReps;
        return bVol - aVol;
      }
      if (exerciseSortMode === 'volume') {
        if (bVol !== aVol) return bVol - aVol;
        return bReps - aReps;
      }
      if (bSets !== aSets) return bSets - aSets;
      return bReps - aReps;
    });
  }, [report?.exercises, exerciseSearchQuery, selectedMuscleFilter, exerciseSortMode]);

  // Filtro dossier note
  const filteredDossiers = (report?.notesDossiers || []).filter((dossier) => {
    if (!dossier) return false;
    const exName = String(dossier.exerciseName || '');
    const searchLower = exerciseSearchQuery.toLowerCase();
    const matchesSearch =
      exerciseSearchQuery === '' ||
      exName.toLowerCase().includes(searchLower) ||
      (dossier.chronologicalNotes || []).some((n) =>
        String(n?.text || '').toLowerCase().includes(searchLower)
      );
    const matchesGroup =
      selectedMuscleFilter === 'all' || dossier.muscleGroup === selectedMuscleFilter;
    return matchesSearch && matchesGroup;
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] h-[100dvh] w-screen flex flex-col items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 10px)',
        paddingRight: 'calc(env(safe-area-inset-right, 0px) + 10px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl h-full max-h-full sm:max-h-[88vh] flex flex-col bg-[#141414] border border-white/15 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden min-h-0"
      >
        
        {/* ─── HEADER ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-3.5 sm:p-6 border-b border-white/10 bg-black/60 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-2xl bg-brand-orange/20 border border-brand-orange/40 text-brand-orange shrink-0">
              <BarChart3 size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-2xl font-black tracking-tight text-white truncate">
                  Report Periodico
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/40 shrink-0">
                  <Sparkles size={11} /> Analytics
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-brand-grey/80 mt-0.5 truncate">
                {report.period?.label || 'Periodo'} • {report.totalWorkouts} {report.totalWorkouts === 1 ? 'sessione' : 'sessioni'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
            <button
              onClick={handleCopySummary}
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-bold transition-all border border-brand-orange/40 bg-brand-orange/15 hover:bg-brand-orange/30 text-brand-orange active:scale-95 cursor-pointer shadow-sm"
              title="Copia riepilogo testuale per appunti o WhatsApp"
            >
              {copiedNotification ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
              <span className="hidden md:inline">
                {copiedNotification ? 'Copiato!' : 'Copia Riepilogo'}
              </span>
            </button>

            <button
              onClick={onClose}
              type="button"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-brand-grey hover:text-white border border-white/10 transition-colors cursor-pointer"
              title="Chiudi report"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ─── CORPO SCORREVOLE ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6 space-y-6">
          
          {/* SELETTORE PERIODO TEMPORALE */}
          <div className="flex flex-col gap-3 p-2.5 sm:p-3.5 rounded-2xl bg-black/40 border border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-brand-grey/70 ml-1">
                Periodo di Analisi:
              </span>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {[
                  { id: 'week', label: '7 Giorni' },
                  { id: 'month', label: '30 Giorni' },
                  { id: 'quarter', label: '3 Mesi' },
                  { id: 'semester', label: '6 Mesi' },
                  { id: 'year', label: '1 Anno' },
                  { id: 'custom', label: 'Personalizzato' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPeriod(p.id as ReportPeriodType)}
                    type="button"
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedPeriod === p.id
                        ? 'bg-brand-orange text-black font-black shadow-lg shadow-brand-orange/20 scale-105'
                        : 'bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/5'
                    }`}
                  >
                    {p.id === 'custom' && (
                      <Calendar size={13} className={selectedPeriod === 'custom' ? 'text-black' : 'text-brand-orange'} />
                    )}
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* SELEZIONE DATA PERSONALIZZATA (QUANDO selectedPeriod === 'custom') */}
            {selectedPeriod === 'custom' && (
              <div className="mt-1 pt-3 border-t border-white/10 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <span className="text-brand-orange flex items-center gap-1">
                      <Calendar size={14} /> Intervallo Date:
                    </span>
                    <span className="text-brand-grey text-[11px] font-medium">
                      {report.period.label}
                    </span>
                  </div>

                  {/* Scorciatoie rapide preimpostate */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('this_month')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Questo mese
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('last_month')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Mese scorso
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset('last_14')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-colors cursor-pointer active:scale-95"
                    >
                      Ultimi 14 gg
                    </button>
                    {workouts && workouts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleApplyCustomPreset('all_time')}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange border border-brand-orange/30 transition-colors font-semibold cursor-pointer active:scale-95"
                      >
                        Tutto lo storico
                      </button>
                    )}
                  </div>
                </div>

                {/* Date Inputs con formato dark mode nativo e look premium */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-brand-orange transition-colors">
                    <span className="text-xs font-black text-brand-orange uppercase tracking-wider w-8 shrink-0">
                      Dal:
                    </span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="bg-transparent text-white text-xs sm:text-sm font-bold focus:outline-none w-full [color-scheme:dark] cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-brand-orange transition-colors">
                    <span className="text-xs font-black text-brand-orange uppercase tracking-wider w-8 shrink-0">
                      Al:
                    </span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="bg-transparent text-white text-xs sm:text-sm font-bold focus:outline-none w-full [color-scheme:dark] cursor-pointer"
                    />
                  </div>
                </div>

                {customStartDate && customEndDate && customStartDate > customEndDate && (
                  <p className="text-[11px] text-amber-400 font-medium flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 px-3 py-1.5 rounded-lg">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>La data di inizio è successiva alla data di fine: le date verranno invertite automaticamente nel calcolo.</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* KPI CARDS GENERALI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-orange/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Dumbbell size={16} className="text-brand-orange" />
                <span>Volume Carico</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {formatSafeNumber(report.totalVolumeKg)}
                </span>
                <span className="text-xs font-bold text-brand-orange uppercase">kg</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                ≈ {((Number(report.totalVolumeKg) || 0) / 1000).toFixed(2)} tonnellate sollevate
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Activity size={16} className="text-cyan-400" />
                <span>Volume Ripetizioni</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {formatSafeNumber(report.totalReps)}
                </span>
                <span className="text-xs font-bold text-cyan-400 uppercase">rip.</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                Media {report.totalWorkouts > 0 ? Math.round((Number(report.totalReps) || 0) / report.totalWorkouts).toLocaleString('it-IT') : 0} rip a sessione
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Layers size={16} className="text-emerald-400" />
                <span>Serie Totali</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {Number(report.totalSets) || 0}
                </span>
                <span className="text-xs font-bold text-emerald-400 uppercase">serie</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                Media {Number(report.averageSetsPerWorkout) || 0} serie a sessione
              </p>
            </div>

            <div className="bg-brand-darkGrey/30 border border-white/10 rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center gap-2 text-brand-grey/80 text-xs font-bold uppercase tracking-wider mb-1">
                <Calendar size={16} className="text-purple-400" />
                <span>Sessioni Svolte</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {Number(report.totalWorkouts) || 0}
                </span>
                <span className="text-xs font-bold text-purple-400 uppercase">workout</span>
              </div>
              <p className="text-[11px] text-brand-grey/60 mt-1">
                {(report.notesDossiers || []).length} esercizi con note registrate
              </p>
            </div>
          </div>

          {/* TAB BAR DI NAVIGAZIONE INTERNA */}
          <div className="flex border-b border-white/10 gap-2 sm:gap-6">
            <button
              onClick={() => setActiveTab('muscles')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 ${
                activeTab === 'muscles'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              💪 Gruppi Muscolari
            </button>
            <button
              onClick={() => setActiveTab('exercises')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'exercises'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              <span>🏋️ Dettaglio Esercizi</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-white/80">
                {(report.exercises || []).length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              type="button"
              className={`pb-3 text-xs sm:text-sm font-black uppercase tracking-wider transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
                activeTab === 'notes'
                  ? 'text-brand-orange border-brand-orange'
                  : 'text-brand-grey/60 border-transparent hover:text-white'
              }`}
            >
              <span>📋 Resoconto Note & Dossier</span>
              {(report.notesDossiers || []).length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-brand-orange/20 text-brand-orange font-bold">
                  {report.notesDossiers.length}
                </span>
              )}
            </button>
          </div>

          {/* ─── TAB 1: GRUPPI MUSCOLARI ───────────────────────────────────── */}
          {activeTab === 'muscles' && (
            <div className="space-y-6">
              {/* Barra di Distribuzione Proporzionale del Volume */}
              <div className="bg-brand-darkGrey/20 border border-white/10 rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-white">
                    Distribuzione Proporzionale del Volume (kg)
                  </span>
                  <span className="text-xs text-brand-grey/70">
                    Totale: {formatSafeNumber(report.totalVolumeKg)} kg
                  </span>
                </div>

                {/* Progress bar multicolore */}
                <div className="w-full h-4 sm:h-5 bg-black/60 rounded-full overflow-hidden flex border border-white/5">
                  {(report.muscleGroups || [])
                    .filter((mg) => Number(mg.volumePercent) > 0)
                    .map((mg) => (
                      <div
                        key={mg.group}
                        style={{ width: `${mg.volumePercent}%` }}
                        className={`${getMuscleColorTheme(mg.group).bar} transition-all duration-500 relative group`}
                        title={`${mg.group}: ${mg.volumePercent}% (${formatSafeNumber(mg.volumeKg)} kg)`}
                      />
                    ))}
                </div>

                {/* Legenda rapida */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs">
                  {(report.muscleGroups || [])
                    .filter((mg) => Number(mg.volumePercent) > 0)
                    .map((mg) => (
                      <div key={mg.group} className="flex items-center gap-1.5">
                        <span className={`w-3 h-3 rounded-full ${getMuscleColorTheme(mg.group).bar}`} />
                        <span className="text-white/80 font-semibold">{mg.group}:</span>
                        <span className="font-bold text-white">{mg.volumePercent}%</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Schede Dettagliate per ciascun Gruppo Muscolare */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(report.muscleGroups || [])
                  .filter((mg) => Number(mg.volumeKg) > 0 || Number(mg.setsCount) > 0 || Number(mg.repsCount) > 0)
                  .map((mg) => {
                    const theme = getMuscleColorTheme(mg.group);
                    return (
                      <div
                        key={mg.group}
                        className={`bg-brand-darkGrey/25 border ${theme.border} rounded-2xl p-4 sm:p-5 relative overflow-hidden flex flex-col justify-between`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-base font-black tracking-wide ${theme.text}`}>
                              {mg.group}
                            </span>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 font-bold text-white/90">
                              {Number(mg.exerciseCount) || 0} {Number(mg.exerciseCount) === 1 ? 'esercizio' : 'esercizi'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Volume Carico</span>
                              <span className="text-lg font-black text-white">
                                {formatSafeNumber(mg.volumeKg)} <span className="text-xs text-brand-orange">kg</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                {Number(mg.volumePercent) || 0}% del totale
                              </span>
                            </div>

                            <div className="bg-black/30 rounded-xl p-2.5 border border-white/5">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Volume Ripetizioni</span>
                              <span className="text-lg font-black text-white">
                                {formatSafeNumber(mg.repsCount)} <span className="text-xs text-cyan-400">rip</span>
                              </span>
                              <span className="text-[10px] text-brand-grey/60 block mt-0.5">
                                in {Number(mg.setsCount) || 0} serie ({Number(mg.setsPercent) || 0}%)
                              </span>
                            </div>
                          </div>

                          {(mg.topExercises || []).length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block mb-1.5">
                                Principali movimenti:
                              </span>
                              <div className="space-y-1">
                                {(mg.topExercises || []).map((topEx, idx) => {
                                  if (!topEx) return null;
                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-white/5"
                                    >
                                      <span className="text-white/90 font-medium truncate max-w-[55%]">
                                        {String(topEx.displayName || 'Esercizio')}
                                      </span>
                                      <span className="font-mono text-cyan-300 font-bold text-[11px]">
                                        {formatSafeNumber(topEx.reps)} rip ({Number(topEx.sets) || 0} set{Number(topEx.volumeKg) > 0 ? ` • ${formatSafeNumber(topEx.volumeKg)} kg` : ''})
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ─── TAB 2: DETTAGLIO ESERCIZI ─────────────────────────────────── */}
          {activeTab === 'exercises' && (
            <div className="space-y-4">
              {/* Barra di ricerca e filtro gruppo muscolare */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-grey/50" />
                    <input
                      type="text"
                      placeholder="Cerca esercizio..."
                      value={exerciseSearchQuery}
                      onChange={(e) => setExerciseSearchQuery(e.target.value)}
                      className="w-full bg-brand-darkGrey/30 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-brand-grey/40 focus:outline-none focus:border-brand-orange"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    <button
                      onClick={() => setSelectedMuscleFilter('all')}
                      type="button"
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                        selectedMuscleFilter === 'all'
                          ? 'bg-brand-orange text-black'
                          : 'bg-white/5 hover:bg-white/10 text-brand-grey'
                      }`}
                    >
                      Tutti
                    </button>
                    {['Petto', 'Dorso', 'Gambe', 'Spalle', 'Braccia', 'Addome'].map((group) => (
                      <button
                        key={group}
                        onClick={() => setSelectedMuscleFilter(group)}
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                          selectedMuscleFilter === group
                            ? 'bg-brand-orange text-black'
                            : 'bg-white/5 hover:bg-white/10 text-brand-grey'
                        }`}
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selettore ordinamento: Ripetizioni, Carico, Serie */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] font-bold text-brand-grey/60 mr-1">Ordina per:</span>
                  <button
                    onClick={() => setExerciseSortMode('reps')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'reps'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    🔢 Ripetizioni (Volume)
                  </button>
                  <button
                    onClick={() => setExerciseSortMode('volume')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'volume'
                        ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    🏋️ Carico (kg)
                  </button>
                  <button
                    onClick={() => setExerciseSortMode('sets')}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      exerciseSortMode === 'sets'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                        : 'bg-white/5 text-brand-grey hover:bg-white/10'
                    }`}
                  >
                    📋 Serie (Set)
                  </button>
                </div>
              </div>

              {sortedFilteredExercises.length === 0 ? (
                <div className="text-center py-12 bg-brand-darkGrey/15 border border-dashed border-white/10 rounded-2xl">
                  <Dumbbell size={36} className="mx-auto text-brand-grey/30 mb-2" />
                  <p className="text-sm text-brand-grey font-bold">Nessun esercizio trovato per i filtri selezionati</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {sortedFilteredExercises.map((ex) => {
                    const theme = getMuscleColorTheme(ex.muscleGroup);
                    return (
                      <div
                        key={ex.canonicalId}
                        className="bg-brand-darkGrey/20 border border-white/10 hover:border-white/20 rounded-2xl p-3.5 sm:p-4 transition-all"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${theme.bg} ${theme.text} ${theme.border} mt-0.5 shrink-0`}
                            >
                              {ex.muscleGroup}
                            </span>
                            <div>
                              <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                                {ex.displayName}
                              </h3>
                              <p className="text-[11px] text-brand-grey/60 mt-0.5">
                                Eseguito in {Number(ex.sessionsCount) || 0} {Number(ex.sessionsCount) === 1 ? 'sessione' : 'sessioni'} • {Number(ex.totalSets) || 0} serie totali
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 sm:gap-5 self-end sm:self-auto flex-wrap">
                            {/* Volume Ripetizioni */}
                            <div className="text-right min-w-[75px]">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Vol. Ripetizioni</span>
                              <span className="text-sm font-black text-cyan-400 font-mono">
                                {formatSafeNumber(ex.totalReps)} <span className="text-[10px]">rip</span>
                              </span>
                            </div>

                            {/* Volume Carico (se > 0 o corpo libero) */}
                            <div className="text-right min-w-[75px]">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Vol. Carico</span>
                              {Number(ex.totalVolumeKg) > 0 ? (
                                <span className="text-sm font-black text-brand-orange font-mono">
                                  {formatSafeNumber(ex.totalVolumeKg)} <span className="text-[10px]">kg</span>
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-brand-grey/60">
                                  Corpo Libero
                                </span>
                              )}
                            </div>

                            {/* Carico Max / PR */}
                            {Number(ex.maxWeightKg) > 0 && (
                              <div className="text-right min-w-[55px]">
                                <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Carico Max</span>
                                <span className="text-xs font-black text-white font-mono">
                                  {ex.maxWeightKg} <span className="text-brand-orange text-[10px]">kg</span>
                                </span>
                              </div>
                            )}

                            {/* Indicatore di Trend */}
                            <div className="text-right min-w-[60px]">
                              <span className="text-[10px] uppercase font-bold text-brand-grey/50 block">Trend</span>
                              {ex.trend === 'up' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-400">
                                  <TrendingUp size={14} /> +{ex.percentChange ?? 0}%
                                </span>
                              )}
                              {ex.trend === 'down' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-rose-400">
                                  <TrendingDown size={14} /> {ex.percentChange ?? 0}%
                                </span>
                              )}
                              {ex.trend === 'stable' && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-grey/70">
                                  <Minus size={14} /> Stabile
                                </span>
                              )}
                              {ex.trend === 'new' && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-brand-orange uppercase">
                                  Nuovo
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── TAB 3: RESOCONTO NOTE & OSSERVAZIONI ───────────────────────── */}
          {activeTab === 'notes' && (
            <div className="space-y-6">
              <div className="bg-brand-orange/10 border border-brand-orange/30 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
                <FileText size={22} className="text-brand-orange shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm sm:text-base font-black text-white">
                    Resoconto Sintetico delle Note per Esercizio
                  </h3>
                  <p className="text-xs text-white/80 mt-1 leading-relaxed">
                    Il sistema ha analizzato tutte le note lasciate nelle sessioni del periodo, raggruppandole
                    sotto ciascun esercizio canonico per offrirti una sintesi descrittiva di sensazioni, progressioni di carico e affaticamento.
                  </p>
                </div>
              </div>

              {filteredDossiers.length === 0 ? (
                <div className="text-center py-12 bg-brand-darkGrey/15 border border-dashed border-white/10 rounded-2xl">
                  <FileText size={36} className="mx-auto text-brand-grey/30 mb-2" />
                  <p className="text-sm text-brand-grey font-bold">Nessuna nota o osservazione registrata nel periodo selezionato.</p>
                  <p className="text-xs text-brand-grey/50 mt-1">
                    Lascia note durante l'allenamento con l'icona note per vederle riassunte qui!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredDossiers.map((dossier) => {
                    const theme = getMuscleColorTheme(dossier.muscleGroup);
                    const isExpanded = Boolean(expandedDossiers[dossier.canonicalId]);

                    return (
                      <div
                        key={dossier.canonicalId}
                        className="bg-brand-darkGrey/25 border border-white/10 rounded-2xl p-4 sm:p-5 transition-all"
                      >
                        {/* Header Dossier */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${theme.bg} ${theme.text} ${theme.border}`}>
                              {dossier.muscleGroup}
                            </span>
                            <h4 className="text-base font-black text-white">
                              {dossier.exerciseName}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-brand-grey/70">
                              {Number(dossier.totalNotes) || 0} {Number(dossier.totalNotes) === 1 ? 'osservazione' : 'osservazioni'}
                            </span>
                            {/* Temi dominanti badge */}
                            {(dossier.dominantThemes || []).map((themeTag) => (
                              <span
                                key={themeTag}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  themeTag === 'Progresso'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : themeTag === 'Fastidio'
                                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                    : themeTag === 'Fatica'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    : themeTag === 'Tecnica'
                                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                    : 'bg-white/5 text-brand-grey border-white/10'
                                }`}
                              >
                                {themeTag === 'Progresso' && '↗️ '}
                                {themeTag === 'Fastidio' && '⚠️ '}
                                {themeTag === 'Fatica' && '🔥 '}
                                {themeTag === 'Tecnica' && '⚙️ '}
                                {themeTag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Sintesi Scritta Descrittiva */}
                        <div className="bg-black/40 border border-white/5 rounded-xl p-3 sm:p-4 mb-3">
                          <p className="text-xs sm:text-sm text-white/90 leading-relaxed font-sans">
                            {dossier.writtenSynthesis}
                          </p>
                        </div>

                        {/* Pulsante per mostrare/nascondere la cronologia dettagliata note */}
                        <button
                          onClick={() => toggleDossierExpanded(dossier.canonicalId)}
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                        >
                          <span>{isExpanded ? 'Nascondi cronologia note' : `Mostra cronologia note (${(dossier.chronologicalNotes || []).length})`}</span>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>

                        {/* Lista cronologica note espandibile */}
                        {isExpanded && (
                          <div className="mt-3 space-y-2 pt-3 border-t border-white/5">
                            {(dossier.chronologicalNotes || []).map((note, idx) => {
                              if (!note) return null;
                              return (
                                <div
                                  key={idx}
                                  className="bg-white/5 rounded-xl p-3 border border-white/5 text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between text-brand-grey/60 text-[10px]">
                                    <span className="font-bold text-white/70">{String(note.formattedDate || '')}</span>
                                    <span>{String(note.workoutName || 'Workout')}</span>
                                  </div>
                                  <p className="text-white text-xs leading-relaxed">{String(note.text || '')}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
        <div className="p-3.5 sm:p-4 border-t border-white/10 bg-black/80 flex items-center justify-between shrink-0">
          <span className="text-xs text-brand-grey/60 truncate mr-2">
            {Number(report.totalWorkouts) || 0} {Number(report.totalWorkouts) === 1 ? 'sessione' : 'sessioni'} • {formatSafeNumber(report.totalVolumeKg)} kg totali
          </span>
          <button
            onClick={onClose}
            type="button"
            className="px-5 py-2.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-brand-orange/20 shrink-0 active:scale-95"
          >
            Chiudi
          </button>
        </div>

      </div>
    </div>
  );
};

const PeriodicReportModal: React.FC<PeriodicReportModalProps> = (props) => {
  if (!props.isOpen) return null;

  return (
    <ReportErrorBoundary onClose={props.onClose} isOpen={props.isOpen}>
      <PeriodicReportModalInner {...props} />
    </ReportErrorBoundary>
  );
};

export default PeriodicReportModal;
